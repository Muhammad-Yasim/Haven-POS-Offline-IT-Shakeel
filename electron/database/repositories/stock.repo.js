'use strict';

/**
 * electron/database/repositories/stock.repo.js
 *
 * Repository for Stock Management:
 *   - getStock: returns aggregated on-hand quantities for (product x location)
 *   - adjustStock: performs inventory adjustments with FIFO layer freezing & notifications
 *   - getStockLedger: transaction audit history
 */

const { getDb, transaction } = require('../db');
const authRepo = require('./auth.repo');
const notificationsRepo = require('./notifications.repo');

/**
 * Get stock on hand for all active products across locations.
 * Returns an array of items shaped with `key`, `product`, `location`, `qty`.
 */
function getStock(filters = {}) {
  const db = getDb();
  const businessId = filters.businessId || filters.business_id || authRepo.getCurrentBusinessId() || 1;
  const { locationId, location_id, scopedLocationIds, search } = filters;

  const locId = locationId || location_id;

  let sql = `
    SELECT
      pairs.product_id,
      pairs.location_id,
      p.name AS product_name,
      p.sku AS product_sku,
      p.alert_quantity,
      p.cost_price,
      l.name AS location_name,
      COALESCE(SUM(sl.change_qty), 0) AS qty
    FROM (
      SELECT DISTINCT product_id, location_id FROM stock_ledger WHERE business_id = ?
      UNION
      SELECT pl.product_id, pl.location_id FROM product_locations pl
      JOIN products p2 ON p2.id = pl.product_id AND p2.business_id = ?
    ) pairs
    JOIN products p ON p.id = pairs.product_id AND p.business_id = ? AND p.is_active = 1
    JOIN locations l ON l.id = pairs.location_id AND l.business_id = ? AND l.is_active = 1
    LEFT JOIN stock_ledger sl
      ON sl.product_id = pairs.product_id
     AND sl.location_id = pairs.location_id
     AND sl.business_id = ?
    WHERE 1=1
  `;

  const params = [businessId, businessId, businessId, businessId, businessId];

  if (locId) {
    sql += ` AND pairs.location_id = ?`;
    params.push(Number(locId));
  } else if (Array.isArray(scopedLocationIds) && scopedLocationIds.length > 0) {
    const placeholders = scopedLocationIds.map(() => '?').join(',');
    sql += ` AND pairs.location_id IN (${placeholders})`;
    params.push(...scopedLocationIds.map(Number));
  }

  if (search && typeof search === 'string' && search.trim()) {
    sql += ` AND (p.name LIKE ? OR p.sku LIKE ?)`;
    const q = `%${search.trim()}%`;
    params.push(q, q);
  }

  sql += `
    GROUP BY pairs.product_id, pairs.location_id
    ORDER BY p.name COLLATE NOCASE ASC, l.name COLLATE NOCASE ASC
  `;

  const rows = db.prepare(sql).all(...params);

  return rows.map((r) => ({
    key: `${r.product_id}:${r.location_id}`,
    product_id: r.product_id,
    location_id: r.location_id,
    qty: Number(r.qty || 0),
    product: {
      id: r.product_id,
      name: r.product_name,
      sku: r.product_sku || '',
      alert_quantity: r.alert_quantity != null ? Number(r.alert_quantity) : null,
      cost_price: r.cost_price != null ? Number(r.cost_price) : 0,
    },
    location: {
      id: r.location_id,
      name: r.location_name,
    },
  }));
}

/**
 * Adjust stock for a single product at a location.
 * Computes delta = target - currentOnHand, and writes a stock_ledger entry.
 *
 * For delta > 0:
 *   Creates an inbound FIFO batch with unitCost (user provided or product.cost_price).
 * For delta < 0:
 *   Freezes current product.cost_price as valuation of write-off/shrinkage.
 */
function adjustStock(payload = {}) {
  const db = getDb();
  const businessId = payload.businessId || payload.business_id || authRepo.getCurrentBusinessId() || 1;
  const currentUserId = payload.userId || authRepo.getCurrentUserId();
  const productId = Number(payload.productId);
  const locationId = Number(payload.locationId);

  if (!productId || isNaN(productId)) {
    throw new Error('Valid product ID is required.');
  }
  if (!locationId || isNaN(locationId)) {
    throw new Error('Valid location ID is required.');
  }

  const product = db.prepare(`
    SELECT id, name, sku, alert_quantity, cost_price
    FROM products
    WHERE id = ? AND business_id = ?
  `).get(productId, businessId);

  if (!product) {
    throw new Error('Product not found.');
  }

  const location = db.prepare(`
    SELECT id, name
    FROM locations
    WHERE id = ? AND business_id = ?
  `).get(locationId, businessId);

  if (!location) {
    throw new Error('Location not found.');
  }

  const target = payload.newQty !== undefined ? Number(payload.newQty) : Number(payload.targetQty);
  if (isNaN(target) || !Number.isInteger(target) || target < 0) {
    throw new Error('Quantity must be a positive whole number.');
  }

  // Calculate current stock on hand
  const currentStockRow = db.prepare(`
    SELECT COALESCE(SUM(change_qty), 0) AS on_hand
    FROM stock_ledger
    WHERE business_id = ? AND product_id = ? AND location_id = ?
  `).get(businessId, productId, locationId);

  const currentOnHand = Number(currentStockRow?.on_hand || 0);
  const delta = target - currentOnHand;

  if (delta === 0) {
    return { success: true, delta: 0, currentQty: target };
  }

  let costForInsert = null;
  if (delta > 0) {
    if (payload.unitCost !== undefined && payload.unitCost !== null && payload.unitCost !== '') {
      const cost = Number(payload.unitCost);
      if (isNaN(cost) || cost < 0) {
        throw new Error('Enter a valid unit cost for the added stock (0 or more).');
      }
      costForInsert = cost;
    } else {
      costForInsert = Number(product.cost_price) || 0;
    }
  } else {
    // Write-off / shrinkage: freeze today's product cost price
    costForInsert = Number(product.cost_price) || 0;
  }

  const reason = payload.reason || 'adjustment';

  transaction(() => {
    db.prepare(`
      INSERT INTO stock_ledger (
        business_id, product_id, location_id, change_qty, reason, unit_cost, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      businessId,
      productId,
      locationId,
      delta,
      reason,
      costForInsert,
      currentUserId
    );

    // Ensure mapping exists in product_locations
    db.prepare(`
      INSERT OR IGNORE INTO product_locations (product_id, location_id)
      VALUES (?, ?)
    `).run(productId, locationId);
  });

  // Best-effort low stock alert
  try {
    notificationsRepo.checkLowStockDirect({
      businessId,
      productId,
      productName: product.name,
      locationName: location.name,
      newQty: target,
      alertQuantity: product.alert_quantity,
    });
  } catch (_e) {
    // Best-effort — do not fail the adjustment
  }

  return { success: true, delta, currentQty: target };
}

/**
 * Get stock ledger history for a product or location.
 */
function getStockLedger(filters = {}) {
  const db = getDb();
  const businessId = filters.businessId || filters.business_id || authRepo.getCurrentBusinessId() || 1;
  const { productId, locationId, limit = 100, offset = 0 } = filters;

  let sql = `
    SELECT
      sl.*,
      p.name AS product_name,
      p.sku AS product_sku,
      l.name AS location_name,
      u.first_name || ' ' || COALESCE(u.last_name, '') AS created_by_name
    FROM stock_ledger sl
    JOIN products p ON p.id = sl.product_id
    JOIN locations l ON l.id = sl.location_id
    LEFT JOIN users u ON u.id = sl.created_by
    WHERE sl.business_id = ?
  `;
  const params = [businessId];

  if (productId) {
    sql += ` AND sl.product_id = ?`;
    params.push(Number(productId));
  }
  if (locationId) {
    sql += ` AND sl.location_id = ?`;
    params.push(Number(locationId));
  }

  sql += ` ORDER BY sl.created_at DESC, sl.id DESC LIMIT ? OFFSET ?`;
  params.push(Number(limit), Number(offset));

  return db.prepare(sql).all(...params);
}

module.exports = {
  getStock,
  adjustStock,
  getStockLedger,
};
