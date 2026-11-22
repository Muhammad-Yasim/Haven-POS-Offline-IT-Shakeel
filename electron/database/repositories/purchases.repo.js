'use strict';

/**
 * electron/database/repositories/purchases.repo.js
 *
 * Repository for Purchases, Purchase Items, Purchase Returns, and Purchase Due.
 * Uses Node.js built-in `node:sqlite` via `getDb()` and `transaction()`.
 */

const { getDb, transaction } = require('../db');

/**
 * Return a list of purchases with supplier and location joined.
 */
function getPurchases(filters = {}) {
  const db = getDb();
  let sql = `
    SELECT 
      p.*,
      c.name AS supplier_name,
      l.name AS location_name,
      (SELECT COUNT(*) FROM purchase_items pi WHERE pi.purchase_id = p.id) AS items_count,
      (p.grand_total - p.advance_payment) AS due_amount
    FROM purchases p
    LEFT JOIN contacts c ON c.id = p.supplier_id
    LEFT JOIN locations l ON l.id = p.location_id
    WHERE p.is_active = 1
  `;
  const params = {};

  if (filters.business_id) {
    sql += ` AND p.business_id = @business_id`;
    params.business_id = filters.business_id;
  }
  if (filters.location_id) {
    sql += ` AND p.location_id = @location_id`;
    params.location_id = filters.location_id;
  }
  if (filters.supplier_id) {
    sql += ` AND p.supplier_id = @supplier_id`;
    params.supplier_id = filters.supplier_id;
  }
  if (filters.purchase_status) {
    sql += ` AND p.purchase_status = @purchase_status`;
    params.purchase_status = filters.purchase_status;
  }
  if (filters.from_date) {
    sql += ` AND p.purchase_date >= @from_date`;
    params.from_date = filters.from_date;
  }
  if (filters.to_date) {
    sql += ` AND p.purchase_date <= @to_date`;
    params.to_date = filters.to_date;
  }

  sql += ` ORDER BY p.created_at DESC, p.id DESC`;

  const rows = db.prepare(sql).all(params);
  return rows.map((r) => ({
    ...r,
    contacts: r.supplier_name ? { name: r.supplier_name } : null,
    locations: r.location_name ? { name: r.location_name } : null,
  }));
}

/**
 * Return a single purchase by ID, including its line items (with product name)
 * and supplier/location details.
 */
function getPurchaseById(id) {
  const db = getDb();
  const purchase = db
    .prepare(
      `
      SELECT 
        p.*,
        c.name AS supplier_name,
        l.name AS location_name,
        (p.grand_total - p.advance_payment) AS due_amount
      FROM purchases p
      LEFT JOIN contacts c ON c.id = p.supplier_id
      LEFT JOIN locations l ON l.id = p.location_id
      WHERE p.id = @id
    `
    )
    .get({ id });

  if (!purchase) return null;

  const items = db
    .prepare(
      `
      SELECT 
        pi.*,
        pr.name AS product_name,
        pr.sku AS product_sku
      FROM purchase_items pi
      LEFT JOIN products pr ON pr.id = pi.product_id
      WHERE pi.purchase_id = @purchase_id
      ORDER BY pi.id ASC
    `
    )
    .all({ purchase_id: id });

  purchase.contacts = purchase.supplier_name ? { name: purchase.supplier_name } : null;
  purchase.locations = purchase.location_name ? { name: purchase.location_name } : null;
  purchase.items = items.map((it) => ({
    ...it,
    products: it.product_name ? { name: it.product_name, sku: it.product_sku } : null,
  }));

  return purchase;
}

/**
 * Get purchase items for a given purchase_id (without loading the full purchase).
 */
function getPurchaseItems(purchaseId) {
  const db = getDb();
  const rows = db
    .prepare(
      `
      SELECT 
        pi.*,
        pr.name  AS product_name,
        pr.sku   AS product_sku,
        pr.alert_quantity AS product_alert_quantity
      FROM purchase_items pi
      LEFT JOIN products pr ON pr.id = pi.product_id
      WHERE pi.purchase_id = @purchaseId
      ORDER BY pi.id ASC
    `
    )
    .all({ purchaseId });

  return rows.map((it) => ({
    ...it,
    products: it.product_name
      ? { name: it.product_name, sku: it.product_sku, alert_quantity: it.product_alert_quantity }
      : null,
  }));
}

/**
 * Create a new purchase with line items in a single transaction.
 *
 * The frontend sends the fully-computed purchase header and line items.
 * This repo function handles:
 *  - Inserting the purchase + items
 *  - If status is 'received': stock_ledger entries, selling price updates,
 *    contact_ledger for the full bill and advance payment
 */
function createPurchase(payload) {
  return transaction((db) => {
    const {
      business_id = 1,
      supplier_id = null,
      location_id = null,
      purchase_status = 'draft',
      purchase_date,
      pay_term = null,
      supplier_invoice_number = null,
      subtotal = 0,
      discount_type = 'fixed',
      discount_amount = 0,
      tax_amount = 0,
      shipping_charges = 0,
      grand_total = 0,
      advance_payment = 0,
      payment_method = null,
      payment_note = null,
      paid_on = null,
      created_by = 1,
      items = [],
    } = payload;

    const result = db.prepare(`
      INSERT INTO purchases (
        business_id, supplier_id, location_id, purchase_status,
        purchase_date, pay_term, supplier_invoice_number,
        subtotal, discount_type, discount_amount, tax_amount,
        shipping_charges, grand_total, advance_payment,
        payment_method, payment_note, paid_on, created_by, is_active
      ) VALUES (
        @business_id, @supplier_id, @location_id, @purchase_status,
        @purchase_date, @pay_term, @supplier_invoice_number,
        @subtotal, @discount_type, @discount_amount, @tax_amount,
        @shipping_charges, @grand_total, @advance_payment,
        @payment_method, @payment_note, @paid_on, @created_by, 1
      )
    `).run({
      business_id,
      supplier_id,
      location_id,
      purchase_status,
      purchase_date,
      pay_term,
      supplier_invoice_number,
      subtotal,
      discount_type,
      discount_amount,
      tax_amount,
      shipping_charges,
      grand_total,
      advance_payment,
      payment_method,
      payment_note,
      paid_on: Number(advance_payment) > 0 ? (paid_on || purchase_date) : null,
      created_by,
    });

    const purchaseId = Number(result.lastInsertRowid);

    // Insert purchase items
    const insertItemStmt = db.prepare(`
      INSERT INTO purchase_items (
        purchase_id, product_id, variant_id, quantity, unit_cost,
        discount_type, discount_amount, tax_id, line_total
      ) VALUES (
        @purchase_id, @product_id, @variant_id, @quantity, @unit_cost,
        @discount_type, @discount_amount, @tax_id, @line_total
      )
    `);

    for (const item of items) {
      insertItemStmt.run({
        purchase_id: purchaseId,
        product_id: item.product_id,
        variant_id: item.variant_id || null,
        quantity: item.quantity,
        unit_cost: item.unit_cost,
        discount_type: item.discount_type || 'fixed',
        discount_amount: item.discount_amount || 0,
        tax_id: item.tax_id || null,
        line_total: item.line_total,
      });
    }

    // If marked received upon creation
    if (purchase_status === 'received') {
      _applyReceivedEffects(db, {
        purchaseId,
        business_id,
        location_id,
        supplier_id,
        grand_total,
        advance_payment,
        created_by,
        items,
        isEdit: false,
      });
    }

    return { id: purchaseId };
  });
}

/**
 * Update a purchase. The frontend sends the fully-computed data.
 *
 * Guard: If any purchase_return_items exist for this purchase, editing is blocked.
 *
 * Stock & contact ledger diffs are computed by the frontend and passed as
 * stockRows / ledgerRows, OR the repo can recompute them. Here we match
 * the original frontend approach: the frontend sends stockRows and
 * ledger operations, and the repo simply executes them.
 *
 * To keep the repo self-contained and transactional, we accept all the
 * pieces from the frontend and apply them inside a single transaction.
 */
function updatePurchase(id, payload) {
  return transaction((db) => {
    const existing = db.prepare(`SELECT * FROM purchases WHERE id = @id`).get({ id });
    if (!existing) {
      throw new Error(`Purchase with ID ${id} not found.`);
    }

    // Check if returns exist
    const returnCheck = db
      .prepare(
        `
        SELECT COUNT(*) AS count
        FROM purchase_return_items pri
        JOIN purchase_items pi ON pi.id = pri.purchase_item_id
        WHERE pi.purchase_id = @id
      `
      )
      .get({ id });

    if (returnCheck && returnCheck.count > 0) {
      throw new Error(
        'This purchase has recorded returns and cannot be edited. Create an adjustment instead.'
      );
    }

    const {
      business_id = existing.business_id,
      supplier_id,
      location_id,
      purchase_status,
      purchase_date,
      pay_term,
      supplier_invoice_number,
      subtotal,
      discount_type,
      discount_amount,
      tax_amount,
      shipping_charges,
      grand_total,
      advance_payment,
      payment_method,
      payment_note,
      paid_on,
      created_by = existing.created_by,
      items = [],
      // Stock delta rows computed by frontend
      stockRows = [],
      // Ledger operations computed by frontend
      ledgerOps = [],
      // Selling price updates
      sellingPriceUpdates = [],
    } = payload;

    // 1. Update purchase header
    db.prepare(`
      UPDATE purchases SET
        supplier_id = @supplier_id,
        location_id = @location_id,
        purchase_status = @purchase_status,
        purchase_date = @purchase_date,
        pay_term = @pay_term,
        supplier_invoice_number = @supplier_invoice_number,
        subtotal = @subtotal,
        discount_type = @discount_type,
        discount_amount = @discount_amount,
        tax_amount = @tax_amount,
        shipping_charges = @shipping_charges,
        grand_total = @grand_total,
        advance_payment = @advance_payment,
        payment_method = @payment_method,
        payment_note = @payment_note,
        paid_on = @paid_on
      WHERE id = @id
    `).run({
      id,
      supplier_id: supplier_id !== undefined ? supplier_id : existing.supplier_id,
      location_id: location_id !== undefined ? location_id : existing.location_id,
      purchase_status: purchase_status !== undefined ? purchase_status : existing.purchase_status,
      purchase_date: purchase_date !== undefined ? purchase_date : existing.purchase_date,
      pay_term: pay_term !== undefined ? pay_term : existing.pay_term,
      supplier_invoice_number: supplier_invoice_number !== undefined ? supplier_invoice_number : existing.supplier_invoice_number,
      subtotal: subtotal !== undefined ? subtotal : existing.subtotal,
      discount_type: discount_type !== undefined ? discount_type : existing.discount_type,
      discount_amount: discount_amount !== undefined ? discount_amount : existing.discount_amount,
      tax_amount: tax_amount !== undefined ? tax_amount : existing.tax_amount,
      shipping_charges: shipping_charges !== undefined ? shipping_charges : existing.shipping_charges,
      grand_total: grand_total !== undefined ? grand_total : existing.grand_total,
      advance_payment: advance_payment !== undefined ? advance_payment : existing.advance_payment,
      payment_method: payment_method !== undefined ? payment_method : existing.payment_method,
      payment_note: payment_note !== undefined ? payment_note : existing.payment_note,
      paid_on: Number(advance_payment) > 0 ? (paid_on || purchase_date || existing.paid_on) : null,
    });

    // 2. Delete existing items and insert new items
    db.prepare(`DELETE FROM purchase_items WHERE purchase_id = @id`).run({ id });

    const insertItemStmt = db.prepare(`
      INSERT INTO purchase_items (
        purchase_id, product_id, variant_id, quantity, unit_cost,
        discount_type, discount_amount, tax_id, line_total
      ) VALUES (
        @purchase_id, @product_id, @variant_id, @quantity, @unit_cost,
        @discount_type, @discount_amount, @tax_id, @line_total
      )
    `);

    for (const item of items) {
      insertItemStmt.run({
        purchase_id: id,
        product_id: item.product_id,
        variant_id: item.variant_id || null,
        quantity: item.quantity,
        unit_cost: item.unit_cost,
        discount_type: item.discount_type || 'fixed',
        discount_amount: item.discount_amount || 0,
        tax_id: item.tax_id || null,
        line_total: item.line_total,
      });
    }

    // 3. Apply selling price updates
    if (sellingPriceUpdates.length > 0) {
      const spStmt = db.prepare(`UPDATE products SET default_selling_price = @sp WHERE id = @id`);
      for (const { product_id, selling_price } of sellingPriceUpdates) {
        const sp = Number(selling_price);
        if (!isNaN(sp) && sp > 0) {
          spStmt.run({ sp, id: product_id });
        }
      }
    }

    // 4. Insert stock ledger rows (deltas computed by frontend)
    if (stockRows.length > 0) {
      const insertStockStmt = db.prepare(`
        INSERT INTO stock_ledger (
          business_id, product_id, variant_id, location_id, change_qty, reason,
          reference_type, reference_id, created_by
        ) VALUES (
          @business_id, @product_id, @variant_id, @location_id, @change_qty, @reason,
          @reference_type, @reference_id, @created_by
        )
      `);
      for (const sr of stockRows) {
        insertStockStmt.run({
          business_id: sr.business_id,
          product_id: sr.product_id,
          variant_id: sr.variant_id || null,
          location_id: sr.location_id,
          change_qty: sr.change_qty,
          reason: sr.reason || 'purchase',
          reference_type: sr.reference_type || 'purchase',
          reference_id: sr.reference_id || id,
          created_by: sr.created_by || created_by,
        });
      }
    }

    // 5. Insert contact ledger operations
    if (ledgerOps.length > 0) {
      const insertLedgerStmt = db.prepare(`
        INSERT INTO contact_ledger (
          business_id, contact_id, reference_type, reference_id, amount
        ) VALUES (
          @business_id, @contact_id, @reference_type, @reference_id, @amount
        )
      `);
      for (const op of ledgerOps) {
        insertLedgerStmt.run({
          business_id: op.business_id,
          contact_id: op.contact_id,
          reference_type: op.reference_type,
          reference_id: op.reference_id || id,
          amount: op.amount,
        });
      }
    }

    return { id };
  });
}

/**
 * Mark a draft/ordered purchase as received.
 */
function markReceived(id) {
  return transaction((db) => {
    const existing = db.prepare(`SELECT * FROM purchases WHERE id = @id`).get({ id });
    if (!existing) {
      throw new Error(`Purchase with ID ${id} not found.`);
    }
    if (existing.purchase_status === 'received') {
      return getPurchaseById(id);
    }

    db.prepare(`UPDATE purchases SET purchase_status = 'received' WHERE id = @id`).run({ id });

    const items = db.prepare(`SELECT * FROM purchase_items WHERE purchase_id = @id`).all({ id });

    // Stock ledger
    const insertStockStmt = db.prepare(`
      INSERT INTO stock_ledger (
        business_id, product_id, location_id, change_qty, reason,
        reference_type, reference_id, created_by
      ) VALUES (
        @business_id, @product_id, @location_id, @change_qty, 'purchase',
        'purchase', @reference_id, @created_by
      )
    `);

    for (const item of items) {
      if (Number(item.quantity) > 0) {
        insertStockStmt.run({
          business_id: existing.business_id,
          product_id: item.product_id,
          location_id: existing.location_id,
          change_qty: Number(item.quantity),
          reference_id: id,
          created_by: existing.created_by,
        });
      }
    }

    // Supplier ledger — post full bill
    if (existing.supplier_id && Number(existing.grand_total) > 0) {
      const owed = Number(existing.grand_total) - Number(existing.advance_payment);
      if (owed !== 0) {
        db.prepare(`
          INSERT INTO contact_ledger (
            business_id, contact_id, reference_type, reference_id, amount
          ) VALUES (
            @business_id, @contact_id, 'purchase', @reference_id, @amount
          )
        `).run({
          business_id: existing.business_id,
          contact_id: existing.supplier_id,
          reference_id: id,
          amount: owed,
        });
      }
    }

    return getPurchaseById(id);
  });
}

/**
 * Soft delete a purchase.
 */
function softDeletePurchase(id) {
  const db = getDb();
  db.prepare(`UPDATE purchases SET is_active = 0 WHERE id = @id`).run({ id });
  return { success: true };
}

/**
 * Purchase returns list with details.
 */
function getPurchaseReturns(filters = {}) {
  const db = getDb();
  let sql = `
    SELECT 
      pr.*,
      p.supplier_id,
      p.location_id,
      p.purchase_date,
      c.name AS supplier_name,
      l.name AS location_name
    FROM purchase_returns pr
    JOIN purchases p ON p.id = pr.purchase_id
    LEFT JOIN contacts c ON c.id = p.supplier_id
    LEFT JOIN locations l ON l.id = p.location_id
    WHERE 1=1
  `;
  const params = {};

  if (filters.business_id) {
    sql += ` AND pr.business_id = @business_id`;
    params.business_id = filters.business_id;
  }
  if (filters.purchase_id) {
    sql += ` AND pr.purchase_id = @purchase_id`;
    params.purchase_id = filters.purchase_id;
  }

  sql += ` ORDER BY pr.created_at DESC, pr.id DESC`;

  const rows = db.prepare(sql).all(params);
  return rows.map((r) => ({
    ...r,
    contacts: r.supplier_name ? { name: r.supplier_name } : null,
    locations: r.location_name ? { name: r.location_name } : null,
  }));
}

/**
 * Get items belonging to a purchase return.
 */
function getPurchaseReturnItems(returnId) {
  const db = getDb();
  const rows = db
    .prepare(
      `
      SELECT 
        pri.*,
        pi.product_id,
        prod.name AS product_name,
        prod.sku AS product_sku
      FROM purchase_return_items pri
      JOIN purchase_items pi ON pi.id = pri.purchase_item_id
      LEFT JOIN products prod ON prod.id = pi.product_id
      WHERE pri.purchase_return_id = @returnId
    `
    )
    .all({ returnId });

  return rows.map((r) => ({
    ...r,
    purchase_items: {
      product_id: r.product_id,
      products: r.product_name ? { name: r.product_name, sku: r.product_sku } : null,
    },
  }));
}

/**
 * Create a purchase return in a single transaction:
 * - Insert purchase_returns header
 * - Insert purchase_return_items
 * - Deduct stock in stock_ledger (change_qty = -qty, reason: 'purchase_return')
 * - Credit contact_ledger (amount = -totalAmount)
 * - Adjust purchases.grand_total = max(grand_total - totalAmount, 0)
 */
function createPurchaseReturn(payload) {
  return transaction((db) => {
    const {
      business_id = 1,
      purchase_id,
      return_date,
      reason = null,
      total_amount,
      created_by = 1,
      items = [], // array of { purchase_item_id, product_id, quantity_returned, amount }
    } = payload;

    const purchase = db.prepare(`SELECT * FROM purchases WHERE id = @purchase_id`).get({ purchase_id });
    if (!purchase) {
      throw new Error(`Purchase with ID ${purchase_id} not found.`);
    }

    // Insert purchase_returns
    const res = db
      .prepare(
        `
        INSERT INTO purchase_returns (
          business_id, purchase_id, return_date, reason, total_amount, created_by
        ) VALUES (
          @business_id, @purchase_id, @return_date, @reason, @total_amount, @created_by
        )
      `
      )
      .run({
        business_id,
        purchase_id,
        return_date,
        reason,
        total_amount,
        created_by,
      });

    const returnId = Number(res.lastInsertRowid);

    const insertReturnItemStmt = db.prepare(`
      INSERT INTO purchase_return_items (
        purchase_return_id, purchase_item_id, quantity_returned, amount
      ) VALUES (
        @purchase_return_id, @purchase_item_id, @quantity_returned, @amount
      )
    `);

    const insertStockStmt = db.prepare(`
      INSERT INTO stock_ledger (
        business_id, product_id, location_id, change_qty, reason,
        reference_type, reference_id, created_by
      ) VALUES (
        @business_id, @product_id, @location_id, @change_qty, 'purchase_return',
        'purchase_return', @reference_id, @created_by
      )
    `);

    for (const item of items) {
      insertReturnItemStmt.run({
        purchase_return_id: returnId,
        purchase_item_id: item.purchase_item_id,
        quantity_returned: item.quantity_returned,
        amount: item.amount,
      });

      // Stock deduction
      insertStockStmt.run({
        business_id,
        product_id: item.product_id,
        location_id: purchase.location_id,
        change_qty: -Number(item.quantity_returned),
        reference_id: returnId,
        created_by,
      });
    }

    // Credit contact ledger
    if (purchase.supplier_id && Number(total_amount) > 0) {
      db.prepare(`
        INSERT INTO contact_ledger (
          business_id, contact_id, reference_type, reference_id, amount
        ) VALUES (
          @business_id, @contact_id, 'purchase_return', @reference_id, @amount
        )
      `).run({
        business_id,
        contact_id: purchase.supplier_id,
        reference_id: returnId,
        amount: -Number(total_amount),
      });
    }

    // Increase advance_payment to reflect the return value (preserves grand_total for audit trail).
    // Due = grand_total - advance_payment; returning goods reduces what we still owe.
    const newAdvance = Math.min(
      Number(purchase.advance_payment || 0) + Number(total_amount),
      Number(purchase.grand_total || 0)
    );
    db.prepare(`UPDATE purchases SET advance_payment = @newAdvance WHERE id = @id`).run({
      newAdvance,
      id: purchase.id,
    });

    return { id: returnId, total_amount, purchase_id };
  });
}

/**
 * Purchases with outstanding balance (grand_total - advance_payment > 0).
 */
function getPurchaseDue(filters = {}) {
  const db = getDb();
  let sql = `
    SELECT 
      p.id,
      p.purchase_date,
      p.grand_total,
      p.advance_payment,
      p.supplier_id,
      p.payment_method,
      c.name AS supplier_name,
      l.name AS location_name,
      (p.grand_total - p.advance_payment) AS due
    FROM purchases p
    LEFT JOIN contacts c ON c.id = p.supplier_id
    LEFT JOIN locations l ON l.id = p.location_id
    WHERE p.is_active = 1
      AND p.purchase_status = 'received'
      AND (p.grand_total - p.advance_payment) > 0
  `;
  const params = {};

  if (filters.business_id) {
    sql += ` AND p.business_id = @business_id`;
    params.business_id = filters.business_id;
  }

  sql += ` ORDER BY p.purchase_date DESC, p.id DESC`;

  const rows = db.prepare(sql).all(params);
  return rows.map((r) => ({
    ...r,
    contacts: r.supplier_name ? { name: r.supplier_name } : null,
    locations: r.location_name ? { name: r.location_name } : null,
  }));
}

/**
 * Record a payment against an outstanding purchase due.
 */
function recordPurchaseDuePayment({ purchaseId, amount, paymentMethod, paidOn }) {
  return transaction((db) => {
    const purchase = db.prepare(`SELECT * FROM purchases WHERE id = @purchaseId`).get({ purchaseId });
    if (!purchase) {
      throw new Error(`Purchase with ID ${purchaseId} not found.`);
    }

    const amt = Number(amount);
    if (isNaN(amt) || amt <= 0) {
      throw new Error('Enter a valid payment amount.');
    }

    const newAdvance = Number(purchase.advance_payment || 0) + amt;
    const paidDate = paidOn || new Date().toISOString().slice(0, 10);

    // Determine new payment status: 'paid' if fully settled
    const grandTotal = Number(purchase.grand_total || 0);
    const remaining = Math.round((grandTotal - newAdvance) * 100) / 100;

    // Update advance_payment, payment_method, paid_on
    db.prepare(`
      UPDATE purchases SET
        advance_payment = @newAdvance,
        payment_method = @paymentMethod,
        paid_on = @paidDate
      WHERE id = @purchaseId
    `).run({
      newAdvance,
      paymentMethod: paymentMethod || purchase.payment_method || 'Cash',
      paidDate,
      purchaseId,
    });

    if (purchase.supplier_id) {
      db.prepare(`
        INSERT INTO contact_ledger (
          business_id, contact_id, reference_type, reference_id, amount
        ) VALUES (
          @business_id, @contact_id, 'payment', @reference_id, @amount
        )
      `).run({
        business_id: purchase.business_id,
        contact_id: purchase.supplier_id,
        reference_id: purchaseId,
        amount: -amt,
      });
    }

    return { success: true, purchaseId, newAdvance };
  });
}

/**
 * Get prior returned quantities grouped by purchase_item_id for a given list of item IDs.
 */
function getPriorReturnedByItemIds(itemIds = []) {
  if (!itemIds || itemIds.length === 0) return {};
  const db = getDb();
  const placeholders = itemIds.map((_, i) => `@id${i}`).join(',');
  const params = {};
  itemIds.forEach((id, i) => {
    params[`id${i}`] = id;
  });

  const rows = db
    .prepare(
      `
      SELECT purchase_item_id, SUM(quantity_returned) AS total_returned
      FROM purchase_return_items
      WHERE purchase_item_id IN (${placeholders})
      GROUP BY purchase_item_id
    `
    )
    .all(params);

  const map = {};
  for (const r of rows) {
    map[r.purchase_item_id] = Number(r.total_returned);
  }
  return map;
}

/**
 * Get stock ledger totals by product_id for a given location.
 */
function getStockByLocation({ business_id, location_id }) {
  const db = getDb();
  const rows = db
    .prepare(
      `
      SELECT product_id, SUM(change_qty) AS total_qty
      FROM stock_ledger
      WHERE business_id = @business_id AND location_id = @location_id
      GROUP BY product_id
    `
    )
    .all({ business_id, location_id });

  const map = {};
  for (const r of rows) {
    map[r.product_id] = Number(r.total_qty);
  }
  return map;
}

/**
 * Internal helper: apply effects of marking purchase as received
 * (stock entries, selling prices, contact ledger).
 */
function _applyReceivedEffects(db, opts) {
  const {
    purchaseId,
    business_id,
    location_id,
    supplier_id,
    grand_total,
    advance_payment,
    created_by,
    items,
    isEdit,
  } = opts;

  const insertStockStmt = db.prepare(`
    INSERT INTO stock_ledger (
      business_id, product_id, location_id, change_qty, reason,
      reference_type, reference_id, created_by
    ) VALUES (
      @business_id, @product_id, @location_id, @change_qty, 'purchase',
      'purchase', @reference_id, @created_by
    )
  `);

  for (const item of items) {
    if (Number(item.quantity) > 0) {
      insertStockStmt.run({
        business_id,
        product_id: item.product_id,
        location_id,
        change_qty: Number(item.quantity),
        reference_id: purchaseId,
        created_by,
      });
    }

    // Update selling price if provided
    if (item.selling_price !== undefined && item.selling_price !== null && item.selling_price !== '') {
      const sp = Number(item.selling_price);
      if (!isNaN(sp) && sp > 0) {
        db.prepare(`UPDATE products SET default_selling_price = @sp WHERE id = @id`).run({
          sp,
          id: item.product_id,
        });
      }
    }
  }

  // Supplier ledger — post owed amount
  if (supplier_id) {
    const owed = Number(grand_total) - Number(advance_payment);
    if (owed !== 0) {
      db.prepare(`
        INSERT INTO contact_ledger (
          business_id, contact_id, reference_type, reference_id, amount
        ) VALUES (
          @business_id, @contact_id, 'purchase', @reference_id, @amount
        )
      `).run({
        business_id,
        contact_id: supplier_id,
        reference_id: purchaseId,
        amount: owed,
      });
    }
  }
}

module.exports = {
  getPurchases,
  getPurchaseById,
  getPurchaseItems,
  createPurchase,
  updatePurchase,
  markReceived,
  softDeletePurchase,
  getPurchaseReturns,
  getPurchaseReturnItems,
  createPurchaseReturn,
  getPurchaseDue,
  recordPurchaseDuePayment,
  getPriorReturnedByItemIds,
  getStockByLocation,
};
