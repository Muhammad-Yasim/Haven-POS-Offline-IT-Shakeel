'use strict';

/**
 * electron/database/repositories/products.repo.js
 *
 * Repository for Products, Categories, Tax Rates, and Locations.
 * Uses Node.js built-in `node:sqlite`.
 */

const { getDb, transaction } = require('../db');
const authRepo = require('./auth.repo');

// ============================================================================
// CATEGORIES
// ============================================================================

function getCategories(businessId = 1) {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM categories
    WHERE business_id = ?
    ORDER BY name COLLATE NOCASE ASC
  `).all(businessId);
}

function createCategory({ name, businessId = 1 }) {
  const db = getDb();
  const trimmed = name.trim();
  const result = db.prepare(`
    INSERT INTO categories (business_id, name)
    VALUES (?, ?)
  `).run(businessId, trimmed);
  return { id: Number(result.lastInsertRowid), name: trimmed };
}

function updateCategory({ id, name, businessId = 1 }) {
  const db = getDb();
  db.prepare(`
    UPDATE categories
    SET name = ?
    WHERE id = ? AND business_id = ?
  `).run(name.trim(), id, businessId);
}

function deleteCategory(id, businessId = 1) {
  const db = getDb();
  try {
    db.prepare(`
      DELETE FROM categories
      WHERE id = ? AND business_id = ?
    `).run(id, businessId);
  } catch (err) {
    if (err.message && err.message.includes('FOREIGN KEY')) {
      throw new Error('Cannot delete — one or more products still use this category.');
    }
    throw err;
  }
}

// ============================================================================
// TAX RATES
// ============================================================================

function getTaxRates(businessId = 1) {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM tax_rates
    WHERE business_id = ?
    ORDER BY id ASC
  `).all(businessId);
}

function createTaxRate({ name, rate_percentage, businessId = 1 }) {
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO tax_rates (business_id, name, rate_percentage, is_active)
    VALUES (?, ?, ?, 1)
  `).run(businessId, name.trim(), Number(rate_percentage));
  return { id: Number(result.lastInsertRowid) };
}

function updateTaxRate({ id, name, rate_percentage, businessId = 1 }) {
  const db = getDb();
  if (name !== undefined && rate_percentage !== undefined) {
    db.prepare(`
      UPDATE tax_rates
      SET name = ?, rate_percentage = ?
      WHERE id = ? AND business_id = ?
    `).run(name.trim(), Number(rate_percentage), id, businessId);
  } else if (rate_percentage !== undefined) {
    db.prepare(`
      UPDATE tax_rates
      SET rate_percentage = ?
      WHERE id = ? AND business_id = ?
    `).run(Number(rate_percentage), id, businessId);
  } else if (name !== undefined) {
    db.prepare(`
      UPDATE tax_rates
      SET name = ?
      WHERE id = ? AND business_id = ?
    `).run(name.trim(), id, businessId);
  }
}

function toggleTaxRateActive({ id, is_active, businessId = 1 }) {
  const db = getDb();
  db.prepare(`
    UPDATE tax_rates
    SET is_active = ?
    WHERE id = ? AND business_id = ?
  `).run(is_active ? 1 : 0, id, businessId);
}

function deleteTaxRate(id, businessId = 1) {
  const db = getDb();
  try {
    db.prepare(`
      DELETE FROM tax_rates
      WHERE id = ? AND business_id = ?
    `).run(id, businessId);
  } catch (err) {
    if (err.message && err.message.includes('FOREIGN KEY')) {
      throw new Error('Cannot delete — products or purchases still use this tax rate.');
    }
    throw err;
  }
}

// ============================================================================
// LOCATIONS
// ============================================================================

function getLocations(businessId = 1) {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM locations
    WHERE business_id = ?
    ORDER BY name COLLATE NOCASE ASC
  `).all(businessId);
}

// ============================================================================
// PRODUCTS
// ============================================================================

function getProducts(params = {}) {
  const db = getDb();
  const businessId = params.businessId || authRepo.getCurrentBusinessId() || 1;

  let whereClauses = ['p.business_id = ?'];
  let sqlParams = [businessId];

  // Search by Name or SKU
  if (params.searchQuery && params.searchQuery.trim()) {
    const q = `%${params.searchQuery.trim()}%`;
    whereClauses.push('(p.name LIKE ? OR p.sku LIKE ?)');
    sqlParams.push(q, q);
  }

  // Category filter
  if (params.categoryFilter) {
    whereClauses.push('p.category_id = ?');
    sqlParams.push(Number(params.categoryFilter));
  }

  // Status filter
  if (params.statusFilter === 'active') {
    whereClauses.push('p.is_active = 1');
  } else if (params.statusFilter === 'inactive') {
    whereClauses.push('p.is_active = 0');
  }

  // Price filters
  if (params.minPrice !== undefined && params.minPrice !== '') {
    whereClauses.push('p.default_selling_price >= ?');
    sqlParams.push(Number(params.minPrice));
  }
  if (params.maxPrice !== undefined && params.maxPrice !== '') {
    whereClauses.push('p.default_selling_price <= ?');
    sqlParams.push(Number(params.maxPrice));
  }

  const whereSql = whereClauses.join(' AND ');

  // Base query with correlated subquery for on-hand stock
  let baseQuery = `
    SELECT
      p.*,
      c.name AS category_name,
      COALESCE((
        SELECT SUM(sl.change_qty)
        FROM stock_ledger sl
        WHERE sl.product_id = p.id AND sl.business_id = p.business_id
      ), 0) AS current_stock
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE ${whereSql}
  `;

  // Having / outer conditions for stock filters
  let outerWhere = [];
  let outerParams = [];

  if (params.minStock !== undefined && params.minStock !== '') {
    outerWhere.push('current_stock >= ?');
    outerParams.push(Number(params.minStock));
  }
  if (params.maxStock !== undefined && params.maxStock !== '') {
    outerWhere.push('current_stock <= ?');
    outerParams.push(Number(params.maxStock));
  }
  if (params.lowStockOnly) {
    outerWhere.push('alert_quantity IS NOT NULL AND current_stock <= alert_quantity');
  }

  let finalQuery = baseQuery;
  let finalParams = [...sqlParams];

  if (outerWhere.length > 0) {
    finalQuery = `
      SELECT * FROM (${baseQuery})
      WHERE ${outerWhere.join(' AND ')}
    `;
    finalParams = [...sqlParams, ...outerParams];
  }

  // Count total items
  const countQuery = `SELECT COUNT(*) AS total FROM (${finalQuery})`;
  const countResult = db.prepare(countQuery).get(...finalParams);
  const totalItems = countResult ? countResult.total : 0;

  // Sorting
  let sortKey = params.sortKey || 'created_at';
  let sortDirection = (params.sortDirection || 'desc').toUpperCase();
  if (sortDirection !== 'ASC' && sortDirection !== 'DESC') sortDirection = 'DESC';

  const validSortCols = {
    'created_at': 'created_at',
    'name': 'name',
    'sku': 'sku',
    'category': 'category_name',
    'status': 'is_active',
    'current_stock': 'current_stock',
    'default_selling_price': 'default_selling_price',
  };

  const sortCol = validSortCols[sortKey] || 'created_at';
  finalQuery += ` ORDER BY ${sortCol} ${sortDirection}`;

  // Pagination (limit/offset or range)
  if (params.limit !== undefined && params.offset !== undefined) {
    finalQuery += ' LIMIT ? OFFSET ?';
    finalParams.push(Number(params.limit), Number(params.offset));
  } else if (params.page !== undefined) {
    const limit = Number(params.limit || 50);
    const offset = (Number(params.page) - 1) * limit;
    finalQuery += ' LIMIT ? OFFSET ?';
    finalParams.push(limit, offset);
  }

  const rows = db.prepare(finalQuery).all(...finalParams);

  if (params.page !== undefined || params.limit !== undefined || params.offset !== undefined) {
    return { rows, totalItems };
  }

  return rows;
}

function getProductById(id, businessId = 1) {
  const db = getDb();
  const product = db.prepare(`
    SELECT * FROM products
    WHERE id = ? AND business_id = ?
  `).get(id, businessId);

  if (!product) return null;

  const locationRows = db.prepare(`
    SELECT location_id FROM product_locations
    WHERE product_id = ?
  `).all(id);

  return {
    ...product,
    location_ids: locationRows.map(r => r.location_id),
  };
}

function createProduct(data) {
  const db = getDb();
  const businessId = data.business_id || authRepo.getCurrentBusinessId() || 1;
  const currentUserId = authRepo.getCurrentUserId();

  return transaction(() => {
    try {
      const stmt = db.prepare(`
        INSERT INTO products (
          business_id, name, sku, barcode_type, barcode_number,
          category_id, alert_quantity, description, not_for_selling,
          rack_row_position, applicable_tax_id, selling_price_tax_type,
          product_type, cost_price, default_selling_price, warranty_info,
          is_active
        ) VALUES (
          @business_id, @name, @sku, @barcode_type, @barcode_number,
          @category_id, @alert_quantity, @description, @not_for_selling,
          @rack_row_position, @applicable_tax_id, @selling_price_tax_type,
          @product_type, @cost_price, @default_selling_price, @warranty_info,
          @is_active
        )
      `);

      const result = stmt.run({
        business_id: businessId,
        name: data.name.trim(),
        sku: data.sku.trim(),
        barcode_type: data.barcode_type || null,
        barcode_number: data.barcode_number ? data.barcode_number.trim() : null,
        category_id: data.category_id ? Number(data.category_id) : null,
        alert_quantity: data.alert_quantity !== null && data.alert_quantity !== undefined && data.alert_quantity !== ''
          ? Number(data.alert_quantity) : null,
        description: data.description || null,
        not_for_selling: data.not_for_selling ? 1 : 0,
        rack_row_position: data.rack_row_position || null,
        applicable_tax_id: data.applicable_tax_id ? Number(data.applicable_tax_id) : null,
        selling_price_tax_type: data.selling_price_tax_type || null,
        product_type: data.product_type || 'single',
        cost_price: Number(data.cost_price || 0),
        default_selling_price: Number(data.default_selling_price || 0),
        warranty_info: data.warranty_info || null,
        is_active: data.is_active !== undefined ? (data.is_active ? 1 : 0) : 1,
      });

      const productId = Number(result.lastInsertRowid);

      // Save locations and zero-stock rows
      const selectedLocations = data.selectedLocations || [];
      if (selectedLocations.length > 0) {
        const insertLocStmt = db.prepare(`
          INSERT INTO product_locations (product_id, location_id) VALUES (?, ?)
        `);
        const insertStockStmt = db.prepare(`
          INSERT INTO stock_ledger (
            business_id, product_id, location_id, change_qty, reason, created_by
          ) VALUES (?, ?, ?, 0, 'adjustment', ?)
        `);

        for (const locId of selectedLocations) {
          insertLocStmt.run(productId, Number(locId));
          insertStockStmt.run(businessId, productId, Number(locId), currentUserId);
        }
      }

      return { id: productId };
    } catch (err) {
      if (err.message && err.message.includes('UNIQUE constraint failed')) {
        if (err.message.includes('name')) {
          throw new Error('A product with this name already exists for this business.');
        }
        if (err.message.includes('sku')) {
          throw new Error('A product with this SKU already exists.');
        }
        if (err.message.includes('barcode')) {
          throw new Error('A product with this barcode already exists.');
        }
      }
      throw err;
    }
  });
}

function updateProduct(id, data) {
  const db = getDb();
  const businessId = data.business_id || authRepo.getCurrentBusinessId() || 1;

  return transaction(() => {
    try {
      db.prepare(`
        UPDATE products SET
          name = @name,
          sku = @sku,
          barcode_type = @barcode_type,
          barcode_number = @barcode_number,
          category_id = @category_id,
          alert_quantity = @alert_quantity,
          description = @description,
          not_for_selling = @not_for_selling,
          rack_row_position = @rack_row_position,
          applicable_tax_id = @applicable_tax_id,
          selling_price_tax_type = @selling_price_tax_type,
          cost_price = @cost_price,
          default_selling_price = @default_selling_price,
          warranty_info = @warranty_info,
          is_active = @is_active
        WHERE id = @id AND business_id = @business_id
      `).run({
        id: Number(id),
        business_id: businessId,
        name: data.name.trim(),
        sku: data.sku.trim(),
        barcode_type: data.barcode_type || null,
        barcode_number: data.barcode_number ? data.barcode_number.trim() : null,
        category_id: data.category_id ? Number(data.category_id) : null,
        alert_quantity: data.alert_quantity !== null && data.alert_quantity !== undefined && data.alert_quantity !== ''
          ? Number(data.alert_quantity) : null,
        description: data.description || null,
        not_for_selling: data.not_for_selling ? 1 : 0,
        rack_row_position: data.rack_row_position || null,
        applicable_tax_id: data.applicable_tax_id ? Number(data.applicable_tax_id) : null,
        selling_price_tax_type: data.selling_price_tax_type || null,
        cost_price: Number(data.cost_price || 0),
        default_selling_price: Number(data.default_selling_price || 0),
        warranty_info: data.warranty_info || null,
        is_active: data.is_active ? 1 : 0,
      });

      // Update locations if provided
      if (Array.isArray(data.selectedLocations)) {
        db.prepare('DELETE FROM product_locations WHERE product_id = ?').run(id);

        const insertLocStmt = db.prepare(`
          INSERT INTO product_locations (product_id, location_id) VALUES (?, ?)
        `);
        for (const locId of data.selectedLocations) {
          insertLocStmt.run(id, Number(locId));
        }
      }

      return { id: Number(id) };
    } catch (err) {
      if (err.message && err.message.includes('UNIQUE constraint failed')) {
        if (err.message.includes('name')) {
          throw new Error('A product with this name already exists for this business.');
        }
        if (err.message.includes('sku')) {
          throw new Error('A product with this SKU already exists.');
        }
        if (err.message.includes('barcode')) {
          throw new Error('A product with this barcode already exists.');
        }
      }
      throw err;
    }
  });
}

function deleteProduct(id, businessId = 1) {
  const db = getDb();
  try {
    db.prepare('DELETE FROM products WHERE id = ? AND business_id = ?').run(id, businessId);
  } catch (err) {
    if (err.message && err.message.includes('FOREIGN KEY')) {
      throw new Error('Cannot delete this product because it has associated sales, purchases, or stock records.');
    }
    throw err;
  }
}

function softDeleteProduct(id, businessId = 1) {
  const db = getDb();
  db.prepare('UPDATE products SET is_active = 0 WHERE id = ? AND business_id = ?').run(id, businessId);
}

function addOpeningStock({ productId, locationId, quantity, unitCost, businessId = 1 }) {
  const db = getDb();
  const currentUserId = authRepo.getCurrentUserId();

  db.prepare(`
    INSERT INTO stock_ledger (
      business_id, product_id, location_id, change_qty, reason, unit_cost, created_by
    ) VALUES (?, ?, ?, ?, 'adjustment', ?, ?)
  `).run(
    businessId,
    Number(productId),
    Number(locationId),
    Number(quantity),
    Number(unitCost || 0),
    currentUserId
  );
}

module.exports = {
  getCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  getTaxRates,
  createTaxRate,
  updateTaxRate,
  toggleTaxRateActive,
  deleteTaxRate,
  getLocations,
  getProducts,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
  softDeleteProduct,
  addOpeningStock,
};
