'use strict';

/**
 * electron/database/repositories/sales.repo.js
 *
 * Full CRUD + stock/ledger logic for:
 *   - sales / sale_items
 *   - sell_returns / sell_return_items
 *   - sales_due payments
 *   - FIFO cost resolution
 */

const { getDb, transaction } = require('../db');

// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------

function parseRow(row) {
  if (!row) return null;
  return row;
}

// ---------------------------------------------------------------------------
// SALES — LIST
// ---------------------------------------------------------------------------

function getSales(filters = {}) {
  const db = getDb();
  const { business_id, is_active = 1, scopedLocationIds } = filters;

  let sql = `
    SELECT
      s.*,
      c.name           AS customer_name,
      l.name           AS location_name,
      (SELECT COALESCE(SUM(si.quantity),0) FROM sale_items si WHERE si.sale_id = s.id) AS total_items
    FROM sales s
    LEFT JOIN contacts  c ON c.id = s.customer_id
    LEFT JOIN locations l ON l.id = s.location_id
    WHERE s.business_id = @business_id
      AND s.is_active   = @is_active
  `;

  const params = { business_id, is_active };

  if (filters.customer_id) {
    sql += ` AND s.customer_id = @customer_id`;
    params.customer_id = filters.customer_id;
  }

  if (Array.isArray(scopedLocationIds) && scopedLocationIds.length > 0) {
    sql += ` AND s.location_id IN (${scopedLocationIds.map((_, i) => `@loc${i}`).join(',')})`;
    scopedLocationIds.forEach((id, i) => { params[`loc${i}`] = id; });
  }

  sql += ` ORDER BY s.created_at DESC`;

  return db.prepare(sql).all(params);
}

// ---------------------------------------------------------------------------
// SALES — SINGLE
// ---------------------------------------------------------------------------

function getSaleById(id) {
  const db = getDb();
  const sale = db.prepare(`
    SELECT s.*,
           c.name AS customer_name,
           l.name AS location_name
    FROM   sales s
    LEFT JOIN contacts  c ON c.id = s.customer_id
    LEFT JOIN locations l ON l.id = s.location_id
    WHERE  s.id = @id
  `).get({ id });

  if (!sale) return null;

  const items = getSaleItems(id);
  sale.items = items;
  return sale;
}

// ---------------------------------------------------------------------------
// SALE ITEMS
// ---------------------------------------------------------------------------

function getSaleItems(saleId) {
  const db = getDb();
  const rows = db.prepare(`
    SELECT si.*,
           p.name           AS product_name,
           p.alert_quantity AS alert_quantity
    FROM   sale_items si
    LEFT JOIN products p ON p.id = si.product_id
    WHERE  si.sale_id = @saleId
    ORDER  BY si.id
  `).all({ saleId });

  return rows.map((r) => ({
    ...r,
    products: { name: r.product_name, alert_quantity: r.alert_quantity },
  }));
}

// ---------------------------------------------------------------------------
// CREATE SALE
// ---------------------------------------------------------------------------

function createSale(payload) {
  const {
    business_id, location_id, customer_id, sales_agent_id,
    channel, sale_date, status, pay_term,
    subtotal, discount_type, discount_amount, tax_amount,
    shipping_charges, grand_total, payment_method, payment_note,
    paid_amount, due_amount, staff_note, created_by,
    items, // array of item objects
    // If status is 'confirmed' these are pre-computed by frontend:
    fifoCosts,  // { product_id: unit_cost }
    register_id,
  } = payload;

  return transaction(() => {
    const db = getDb();

    // 1. Insert sale
    const saleResult = db.prepare(`
      INSERT INTO sales (
        business_id, location_id, customer_id, sales_agent_id, register_id,
        channel, sale_date, status, pay_term,
        subtotal, discount_type, discount_amount, tax_amount,
        shipping_charges, grand_total, payment_method, payment_note,
        paid_amount, due_amount, staff_note,
        is_active, created_by, created_at
      ) VALUES (
        @business_id, @location_id, @customer_id, @sales_agent_id, @register_id,
        @channel, @sale_date, @status, @pay_term,
        @subtotal, @discount_type, @discount_amount, @tax_amount,
        @shipping_charges, @grand_total, @payment_method, @payment_note,
        @paid_amount, @due_amount, @staff_note,
        1, @created_by, datetime('now')
      )
    `).run({
      business_id, location_id,
      customer_id:    customer_id    || null,
      sales_agent_id: sales_agent_id || null,
      register_id:    register_id    || null,
      channel:        channel        || 'manual',
      sale_date, status,
      pay_term:          pay_term          || null,
      subtotal,
      discount_type:     discount_type     || 'fixed',
      discount_amount:   discount_amount   || 0,
      tax_amount:        tax_amount        || 0,
      shipping_charges:  shipping_charges  || 0,
      grand_total,
      payment_method:    payment_method    || null,
      payment_note:      payment_note      || null,
      paid_amount:       paid_amount       || 0,
      due_amount:        due_amount        || 0,
      staff_note:        staff_note        || null,
      created_by:        created_by        || null,
    });

    const saleId = saleResult.lastInsertRowid;
    const costs  = fifoCosts || {};

    // 2. Insert sale items
    const insertItem = db.prepare(`
      INSERT INTO sale_items (
        sale_id, product_id, variant_id, quantity, unit_price, unit_cost,
        discount_type, discount_amount, tax_id, line_total
      ) VALUES (
        @sale_id, @product_id, @variant_id, @quantity, @unit_price, @unit_cost,
        @discount_type, @discount_amount, @tax_id, @line_total
      )
    `);

    for (const it of (items || [])) {
      insertItem.run({
        sale_id:         saleId,
        product_id:      it.product_id,
        variant_id:      it.variant_id      || null,
        quantity:        it.quantity,
        unit_price:      it.unit_price,
        unit_cost:       costs[it.product_id] ?? (it.unit_cost ?? 0),
        discount_type:   it.discount_type   || 'fixed',
        discount_amount: it.discount_amount || 0,
        tax_id:          it.tax_id          || null,
        line_total:      it.line_total      || 0,
      });
    }

    // 3. If confirmed: deduct stock, post contact ledger
    if (status === 'confirmed') {
      _applyStockAndLedger({
        db, business_id, location_id,
        saleId, customerId: customer_id,
        items: items || [],
        dueAmount: due_amount || 0,
        createdBy: created_by,
        isEdit: false,
      });
    }

    return { id: saleId };
  });
}

// ---------------------------------------------------------------------------
// UPDATE SALE
// ---------------------------------------------------------------------------

function updateSale(payload) {
  const {
    id, business_id, location_id, customer_id, sales_agent_id,
    channel, sale_date, status, pay_term,
    subtotal, discount_type, discount_amount, tax_amount,
    shipping_charges, grand_total, payment_method, payment_note,
    paid_amount, due_amount, staff_note, created_by,
    items,
    fifoCosts,
    register_id,
    // edit-mode context
    originalStatus,
    originalLocationId,
    originalItems, // needed for stock reversal
  } = payload;

  return transaction(() => {
    const db = getDb();

    // 1. Update sale header
    db.prepare(`
      UPDATE sales SET
        location_id      = @location_id,
        customer_id      = @customer_id,
        sales_agent_id   = @sales_agent_id,
        register_id      = COALESCE(@register_id, register_id),
        channel          = @channel,
        sale_date        = @sale_date,
        status           = @status,
        pay_term         = @pay_term,
        subtotal         = @subtotal,
        discount_type    = @discount_type,
        discount_amount  = @discount_amount,
        tax_amount       = @tax_amount,
        shipping_charges = @shipping_charges,
        grand_total      = @grand_total,
        payment_method   = @payment_method,
        payment_note     = @payment_note,
        paid_amount      = @paid_amount,
        due_amount       = @due_amount,
        staff_note       = @staff_note
      WHERE id = @id AND business_id = @business_id
    `).run({
      id, business_id,
      location_id,
      customer_id:    customer_id    || null,
      sales_agent_id: sales_agent_id || null,
      register_id:    register_id    || null,
      channel:        channel        || 'manual',
      sale_date, status,
      pay_term:          pay_term          || null,
      subtotal,
      discount_type:     discount_type     || 'fixed',
      discount_amount:   discount_amount   || 0,
      tax_amount:        tax_amount        || 0,
      shipping_charges:  shipping_charges  || 0,
      grand_total,
      payment_method:    payment_method    || null,
      payment_note:      payment_note      || null,
      paid_amount:       paid_amount       || 0,
      due_amount:        due_amount        || 0,
      staff_note:        staff_note        || null,
    });

    // 2. Reverse old stock if original sale was confirmed
    if (originalStatus === 'confirmed' && (originalItems || []).length > 0) {
      const ins = db.prepare(`
        INSERT INTO stock_ledger
          (business_id, product_id, variant_id, location_id, change_qty, reason, reference_type, reference_id, created_by)
        VALUES
          (@business_id, @product_id, @variant_id, @location_id, @change_qty, @reason, @reference_type, @reference_id, @created_by)
      `);
      for (const it of originalItems) {
        ins.run({
          business_id,
          product_id:     it.product_id,
          variant_id:     it.variant_id || null,
          location_id:    originalLocationId,
          change_qty:     Number(it.quantity),  // positive = reversal
          reason:         'sale_edit_reversal',
          reference_type: 'sale',
          reference_id:   id,
          created_by:     created_by || null,
        });
      }
    }

    // 3. Delete old sale items
    db.prepare(`DELETE FROM sale_items WHERE sale_id = @saleId`).run({ saleId: id });

    // 4. Insert new sale items
    const costs = fifoCosts || {};
    const insertItem = db.prepare(`
      INSERT INTO sale_items (
        sale_id, product_id, variant_id, quantity, unit_price, unit_cost,
        discount_type, discount_amount, tax_id, line_total
      ) VALUES (
        @sale_id, @product_id, @variant_id, @quantity, @unit_price, @unit_cost,
        @discount_type, @discount_amount, @tax_id, @line_total
      )
    `);
    for (const it of (items || [])) {
      insertItem.run({
        sale_id:         id,
        product_id:      it.product_id,
        variant_id:      it.variant_id      || null,
        quantity:        it.quantity,
        unit_price:      it.unit_price,
        unit_cost:       costs[it.product_id] ?? (it.unit_cost ?? 0),
        discount_type:   it.discount_type   || 'fixed',
        discount_amount: it.discount_amount || 0,
        tax_id:          it.tax_id          || null,
        line_total:      it.line_total      || 0,
      });
    }

    // 5. Clear old contact_ledger 'sale' entry for this sale
    db.prepare(`
      DELETE FROM contact_ledger
      WHERE reference_type = 'sale' AND reference_id = @id
    `).run({ id });

    // 6. Apply new stock + ledger if confirmed
    if (status === 'confirmed') {
      _applyStockAndLedger({
        db, business_id, location_id,
        saleId: id, customerId: customer_id,
        items: items || [],
        dueAmount: due_amount || 0,
        createdBy: created_by,
        isEdit: true,
      });
    }

    return { id };
  });
}

// ---------------------------------------------------------------------------
// CONFIRM SALE (from list page — draft/quotation → confirmed)
// ---------------------------------------------------------------------------

function confirmSale(saleId) {
  return transaction(() => {
    const db = getDb();

    // Load sale
    const sale = db.prepare(`SELECT * FROM sales WHERE id = @saleId`).get({ saleId });
    if (!sale) throw new Error('Sale not found.');

    // Load items with product info
    const saleItems = db.prepare(`
      SELECT si.*, p.name AS product_name, p.alert_quantity
      FROM   sale_items si
      LEFT JOIN products p ON p.id = si.product_id
      WHERE  si.sale_id = @saleId
    `).all({ saleId });

    if (saleItems.length === 0) throw new Error('Sale has no items.');

    // Stock check
    const productIds = [...new Set(saleItems.map((it) => it.product_id))];
    const stockOnHand = {};
    for (const pid of productIds) {
      const row = db.prepare(`
        SELECT COALESCE(SUM(change_qty),0) AS qty
        FROM   stock_ledger
        WHERE  business_id = @biz AND location_id = @loc AND product_id = @pid
      `).get({ biz: sale.business_id, loc: sale.location_id, pid });
      stockOnHand[pid] = Number(row?.qty || 0);
    }

    const requestedByProduct = {};
    for (const it of saleItems) {
      requestedByProduct[it.product_id] = (requestedByProduct[it.product_id] || 0) + Number(it.quantity);
    }

    for (const it of saleItems) {
      const pid       = it.product_id;
      const requested = requestedByProduct[pid] || 0;
      const available = stockOnHand[pid] || 0;
      if (requested > available) {
        throw new Error(
          `Insufficient stock for "${it.product_name || `Product #${pid}`}". Available: ${available}, requested: ${requested}.`
        );
      }
    }

    // FIFO costs
    const fifoCosts = getFifoCosts(sale.business_id, saleItems.map((it) => ({
      product_id: it.product_id, quantity: it.quantity,
    })));

    // Update unit_cost on each sale item
    const updateCost = db.prepare(`
      UPDATE sale_items SET unit_cost = @cost WHERE id = @id
    `);
    for (const it of saleItems) {
      updateCost.run({ cost: fifoCosts[it.product_id] ?? 0, id: it.id });
    }

    // Deduct stock
    const ins = db.prepare(`
      INSERT INTO stock_ledger
        (business_id, product_id, variant_id, location_id, change_qty, reason, reference_type, reference_id)
      VALUES
        (@business_id, @product_id, @variant_id, @location_id, @change_qty, @reason, @reference_type, @reference_id)
    `);
    for (const it of saleItems) {
      ins.run({
        business_id:    sale.business_id,
        product_id:     it.product_id,
        variant_id:     it.variant_id || null,
        location_id:    sale.location_id,
        change_qty:     -Number(it.quantity),
        reason:         'sale',
        reference_type: 'sale',
        reference_id:   saleId,
      });
    }

    // Contact ledger (if due > 0)
    const dueAmount = Number(sale.due_amount || 0);
    if (sale.customer_id && dueAmount !== 0) {
      db.prepare(`
        INSERT INTO contact_ledger (business_id, contact_id, reference_type, reference_id, amount)
        VALUES (@business_id, @contact_id, 'sale', @reference_id, @amount)
      `).run({
        business_id: sale.business_id,
        contact_id:  sale.customer_id,
        reference_id: saleId,
        amount:       dueAmount,
      });
    }

    // Update status
    db.prepare(`UPDATE sales SET status = 'confirmed' WHERE id = @saleId`).run({ saleId });

    return { id: saleId };
  });
}

// ---------------------------------------------------------------------------
// SOFT DELETE
// ---------------------------------------------------------------------------

function softDeleteSale(id) {
  const db = getDb();
  db.prepare(`UPDATE sales SET is_active = 0 WHERE id = @id`).run({ id });
  return { id };
}

// ---------------------------------------------------------------------------
// SELL RETURNS — LIST
// ---------------------------------------------------------------------------

function getSellReturns(filters = {}) {
  const db = getDb();
  const business_id = typeof filters === 'number' ? filters : (filters?.business_id ?? filters?.businessId ?? null);

  return db.prepare(`
    SELECT
      sr.*,
      s.customer_id,
      c.name  AS customer_name,
      l.name  AS location_name
    FROM   sell_returns sr
    LEFT JOIN sales     s ON s.id = sr.sale_id
    LEFT JOIN contacts  c ON c.id = s.customer_id
    LEFT JOIN locations l ON l.id = s.location_id
    WHERE  sr.business_id = @business_id
    ORDER  BY sr.created_at DESC
  `).all({ business_id });
}

// ---------------------------------------------------------------------------
// SELL RETURN ITEMS
// ---------------------------------------------------------------------------

function getSellReturnItems(returnId) {
  const db = getDb();
  const rows = db.prepare(`
    SELECT
      sri.*,
      si.product_id,
      p.name AS product_name
    FROM   sell_return_items sri
    LEFT JOIN sale_items si ON si.id = sri.sale_item_id
    LEFT JOIN products   p  ON p.id  = si.product_id
    WHERE  sri.sell_return_id = @returnId
  `).all({ returnId });

  return rows.map((r) => ({
    ...r,
    sale_items: {
      product_id: r.product_id,
      products: { name: r.product_name },
    },
  }));
}

// ---------------------------------------------------------------------------
// PRIOR RETURNED BY ITEM IDS
// ---------------------------------------------------------------------------

function getPriorReturnedByItemIds(itemIds) {
  if (!itemIds || itemIds.length === 0) return {};
  const db = getDb();
  const placeholders = itemIds.map((_, i) => `@id${i}`).join(',');
  const params = {};
  itemIds.forEach((id, i) => { params[`id${i}`] = id; });

  const rows = db.prepare(`
    SELECT sale_item_id, SUM(quantity_returned) AS total_returned
    FROM   sell_return_items
    WHERE  sale_item_id IN (${placeholders})
    GROUP  BY sale_item_id
  `).all(params);

  const map = {};
  rows.forEach((r) => { map[r.sale_item_id] = Number(r.total_returned || 0); });
  return map;
}

// ---------------------------------------------------------------------------
// CREATE SELL RETURN
// ---------------------------------------------------------------------------

function createSellReturn(payload) {
  const {
    business_id, sale_id, return_date, reason, total_amount,
    created_by, register_id,
    items, // [{ sale_item_id, quantity_returned, amount, product_id, variant_id }]
  } = payload;

  return transaction(() => {
    const db = getDb();

    // Load parent sale for location + customer + due_amount
    const sale = db.prepare(`SELECT * FROM sales WHERE id = @sale_id`).get({ sale_id });
    if (!sale) throw new Error('Sale not found.');

    // 1. Insert sell_return
    const result = db.prepare(`
      INSERT INTO sell_returns
        (business_id, sale_id, return_date, reason, total_amount, created_by, register_id, created_at)
      VALUES
        (@business_id, @sale_id, @return_date, @reason, @total_amount, @created_by, @register_id, datetime('now'))
    `).run({
      business_id,
      sale_id,
      return_date,
      reason:       reason || null,
      total_amount,
      created_by:   created_by   || null,
      register_id:  register_id  || null,
    });

    const sellReturnId = result.lastInsertRowid;

    // 2. Insert sell_return_items
    const insItem = db.prepare(`
      INSERT INTO sell_return_items (sell_return_id, sale_item_id, quantity_returned, amount)
      VALUES (@sell_return_id, @sale_item_id, @quantity_returned, @amount)
    `);
    for (const it of (items || [])) {
      insItem.run({
        sell_return_id:    sellReturnId,
        sale_item_id:      it.sale_item_id,
        quantity_returned: it.quantity_returned,
        amount:            it.amount,
      });
    }

    // 3. Stock: positive rows (restocking)
    const insStock = db.prepare(`
      INSERT INTO stock_ledger
        (business_id, product_id, variant_id, location_id, change_qty, reason, reference_type, reference_id, created_by)
      VALUES
        (@business_id, @product_id, @variant_id, @location_id, @change_qty, 'sell_return', 'sell_return', @reference_id, @created_by)
    `);
    for (const it of (items || [])) {
      insStock.run({
        business_id,
        product_id:   it.product_id,
        variant_id:   it.variant_id || null,
        location_id:  sale.location_id,
        change_qty:   Number(it.quantity_returned),
        reference_id: sellReturnId,
        created_by:   created_by || null,
      });
    }

    // 4. Contact ledger credit (min of returnTotal and due_amount)
    const dueAmount = Number(sale.due_amount || 0);
    if (sale.customer_id && total_amount !== 0) {
      const creditAmount = Math.min(total_amount, dueAmount);
      if (creditAmount > 0) {
        db.prepare(`
          INSERT INTO contact_ledger
            (business_id, contact_id, reference_type, reference_id, amount)
          VALUES
            (@business_id, @contact_id, 'sell_return', @reference_id, @amount)
        `).run({
          business_id,
          contact_id:   sale.customer_id,
          reference_id: sellReturnId,
          amount:       -creditAmount,
        });
      }
    }

    // 5. Update sale status and due_amount
    // Figure out if fully returned
    // Load all items for this sale with their total returned quantities (after this new return)
    const allItems = db.prepare(`SELECT id, quantity FROM sale_items WHERE sale_id = @sale_id`).all({ sale_id });
    const thisReturnMap = {};
    for (const it of (items || [])) {
      thisReturnMap[it.sale_item_id] = Number(it.quantity_returned);
    }

    let allFullyReturned = allItems.length > 0;
    for (const si of allItems) {
      const totalReturned = db.prepare(`
        SELECT COALESCE(SUM(quantity_returned),0) AS qty FROM sell_return_items WHERE sale_item_id = @id
      `).get({ id: si.id });
      if (Number(totalReturned.qty) < Number(si.quantity)) {
        allFullyReturned = false;
        break;
      }
    }

    const newDue = Math.max(dueAmount - total_amount, 0);
    db.prepare(`
      UPDATE sales SET
        status     = @status,
        due_amount = @due_amount
      WHERE id = @sale_id
    `).run({
      status:     allFullyReturned ? 'returned' : 'partially_returned',
      due_amount: newDue,
      sale_id,
    });

    return { id: sellReturnId };
  });
}

// ---------------------------------------------------------------------------
// SALES DUE — LIST
// ---------------------------------------------------------------------------

function getSalesDue(filters = {}) {
  const db = getDb();
  const business_id = typeof filters === 'number' ? filters : (filters?.business_id ?? filters?.businessId ?? null);

  const rows = db.prepare(`
    SELECT
      s.id, s.sale_date, s.grand_total, s.paid_amount, s.due_amount,
      s.customer_id, s.payment_method, s.location_id,
      c.name AS contact_name,
      l.name AS location_name
    FROM   sales s
    LEFT JOIN contacts  c ON c.id = s.customer_id
    LEFT JOIN locations l ON l.id = s.location_id
    WHERE  s.business_id = @business_id
      AND  s.status IN ('confirmed','shipped','returned','partially_returned')
      AND  s.is_active  = 1
      AND  s.due_amount > 0
    ORDER  BY s.due_amount DESC
  `).all({ business_id });

  return rows.map((r) => ({
    ...r,
    contacts: { name: r.contact_name },
    locations: { name: r.location_name },
  }));
}

// ---------------------------------------------------------------------------
// RECORD SALE DUE PAYMENT
// ---------------------------------------------------------------------------

function recordSaleDuePayment({ saleId, amount, paymentMethod, businessId, customerId }) {
  return transaction(() => {
    const db = getDb();

    const sale = db.prepare(`SELECT * FROM sales WHERE id = @id`).get({ id: saleId });
    if (!sale) throw new Error('Sale not found.');

    const newPaid = Number(sale.paid_amount || 0) + Number(amount);
    const newDue  = Math.max(Number(sale.due_amount || 0) - Number(amount), 0);

    db.prepare(`
      UPDATE sales SET paid_amount = @paid, due_amount = @due, payment_method = @pm
      WHERE id = @id
    `).run({ paid: newPaid, due: newDue, pm: paymentMethod || null, id: saleId });

    if (sale.customer_id) {
      db.prepare(`
        INSERT INTO contact_ledger
          (business_id, contact_id, reference_type, reference_id, amount)
        VALUES
          (@business_id, @contact_id, 'payment', @reference_id, @amount)
      `).run({
        business_id:  businessId || sale.business_id,
        contact_id:   sale.customer_id,
        reference_id: saleId,
        amount:       -Number(amount),
      });
    }

    return { id: saleId, newPaid, newDue };
  });
}

// ---------------------------------------------------------------------------
// FIFO COST CALCULATION (pure SQLite — no Supabase)
// ---------------------------------------------------------------------------

function getFifoCosts(businessId, items) {
  const db = getDb();
  const costMap = {};

  // Deduplicate product IDs and sum requested quantities
  const requestedByProduct = {};
  for (const item of items) {
    const pid = Number(item.product_id);
    requestedByProduct[pid] = (requestedByProduct[pid] || 0) + Number(item.quantity || 0);
  }

  const productIds = Object.keys(requestedByProduct).map(Number);
  if (productIds.length === 0) return costMap;

  // Fallback: product cost_price
  const fallbackCosts = {};
  if (productIds.length > 0) {
    const phs = productIds.map((_, i) => `@pid${i}`).join(',');
    const pms = {};
    productIds.forEach((id, i) => { pms[`pid${i}`] = id; });
    const prodRows = db.prepare(`SELECT id, cost_price FROM products WHERE id IN (${phs})`).all(pms);
    prodRows.forEach((p) => { fallbackCosts[p.id] = Number(p.cost_price || 0); });
  }

  for (const pid of productIds) {
    const pms = { biz: businessId, pid };

    // 1a. Purchase batches (received)
    const purchaseBatches = db.prepare(`
      SELECT pi.id, pi.quantity, pi.unit_cost, p.purchase_date
      FROM   purchase_items pi
      JOIN   purchases p ON p.id = pi.purchase_id
      WHERE  p.business_id      = @biz
        AND  p.purchase_status  = 'received'
        AND  pi.product_id      = @pid
      ORDER  BY pi.id ASC
    `).all(pms);

    // 1b. How many units from each batch were purchase-returned
    const returnedByBatch = {};
    for (const batch of purchaseBatches) {
      const r = db.prepare(`
        SELECT COALESCE(SUM(quantity_returned),0) AS qty
        FROM   purchase_return_items
        WHERE  purchase_item_id = @batchId
      `).get({ batchId: batch.id });
      returnedByBatch[batch.id] = Number(r?.qty || 0);
    }

    // 1c. Positive adjustments
    const positiveAdj = db.prepare(`
      SELECT id, change_qty, unit_cost, created_at
      FROM   stock_ledger
      WHERE  business_id = @biz AND reason = 'adjustment' AND change_qty > 0 AND product_id = @pid
      ORDER  BY id ASC
    `).all(pms);

    // 2a. Already sold (confirmed/shipped/returned/partially_returned)
    const soldRow = db.prepare(`
      SELECT COALESCE(SUM(si.quantity),0) AS qty
      FROM   sale_items si
      JOIN   sales s ON s.id = si.sale_id
      WHERE  s.business_id = @biz
        AND  s.status IN ('confirmed','shipped','returned','partially_returned')
        AND  si.product_id = @pid
    `).get(pms);
    const totalConsumed = Number(soldRow?.qty || 0);

    // 2b. Negative adjustments (write-offs)
    const negAdjRow = db.prepare(`
      SELECT COALESCE(SUM(ABS(change_qty)),0) AS qty
      FROM   stock_ledger
      WHERE  business_id = @biz AND reason = 'adjustment' AND change_qty < 0 AND product_id = @pid
    `).get(pms);
    const negAdj = Number(negAdjRow?.qty || 0);

    const totalConsumedFull = totalConsumed + negAdj;

    // 3. Merge batches
    const batches = [];

    for (const batch of purchaseBatches) {
      const returned     = returnedByBatch[batch.id] || 0;
      const effectiveQty = Math.max(Number(batch.quantity || 0) - returned, 0);
      if (effectiveQty <= 0) continue;
      batches.push({
        quantity: effectiveQty,
        unitCost: Number(batch.unit_cost || 0),
        sortTime: batch.purchase_date
          ? new Date(`${batch.purchase_date}T00:00:00Z`).getTime()
          : 0,
        id: batch.id,
      });
    }

    for (const adj of positiveAdj) {
      batches.push({
        quantity: Number(adj.change_qty || 0),
        unitCost: adj.unit_cost != null ? Number(adj.unit_cost) : (fallbackCosts[pid] || 0),
        sortTime: adj.created_at ? new Date(adj.created_at).getTime() : 0,
        id: adj.id,
      });
    }

    batches.sort((a, b) => {
      if (a.sortTime !== b.sortTime) return a.sortTime - b.sortTime;
      return a.id - b.id;
    });

    // 4. FIFO
    const requestedQty = requestedByProduct[pid] || 0;

    if (batches.length === 0 || requestedQty <= 0) {
      costMap[pid] = fallbackCosts[pid] || 0;
      continue;
    }

    let alreadyConsumed  = totalConsumedFull;
    let totalCostForSale = 0;
    let unitsAssigned    = 0;

    for (const batch of batches) {
      if (unitsAssigned >= requestedQty) break;

      let batchRemaining = batch.quantity;

      if (alreadyConsumed > 0) {
        const skip = Math.min(alreadyConsumed, batchRemaining);
        batchRemaining    -= skip;
        alreadyConsumed   -= skip;
      }

      if (batchRemaining <= 0) continue;

      const take       = Math.min(batchRemaining, requestedQty - unitsAssigned);
      totalCostForSale += take * batch.unitCost;
      unitsAssigned    += take;
    }

    if (unitsAssigned > 0) {
      costMap[pid] = Math.round((totalCostForSale / unitsAssigned) * 100) / 100;
    } else {
      const lastBatch = batches[batches.length - 1];
      costMap[pid]    = lastBatch ? lastBatch.unitCost : (fallbackCosts[pid] || 0);
    }
  }

  return costMap;
}

// ---------------------------------------------------------------------------
// INTERNAL: apply stock deduction + contact ledger after a confirmed sale
// ---------------------------------------------------------------------------

function _applyStockAndLedger({ db, business_id, location_id, saleId, customerId, items, dueAmount, createdBy, isEdit }) {
  const ins = db.prepare(`
    INSERT INTO stock_ledger
      (business_id, product_id, variant_id, location_id, change_qty, reason, reference_type, reference_id, created_by)
    VALUES
      (@business_id, @product_id, @variant_id, @location_id, @change_qty, @reason, 'sale', @reference_id, @created_by)
  `);

  for (const it of items) {
    ins.run({
      business_id,
      product_id:  it.product_id,
      variant_id:  it.variant_id || null,
      location_id,
      change_qty:  -Number(it.quantity),
      reason:      isEdit ? 'sale_edit' : 'sale',
      reference_id: saleId,
      created_by:  createdBy || null,
    });
  }

  if (customerId && dueAmount !== 0) {
    db.prepare(`
      INSERT INTO contact_ledger
        (business_id, contact_id, reference_type, reference_id, amount)
      VALUES
        (@business_id, @contact_id, 'sale', @reference_id, @amount)
    `).run({
      business_id,
      contact_id:  customerId,
      reference_id: saleId,
      amount:       dueAmount,
    });
  }
}

// ---------------------------------------------------------------------------
// POS HELPERS
// ---------------------------------------------------------------------------

function getRecentPosSales({ business_id, limit = 10 }) {
  const db = getDb();
  const rows = db.prepare(`
    SELECT
      s.id, s.sale_date, s.created_at, s.grand_total, s.status, s.payment_method,
      c.name AS customer_name
    FROM   sales s
    LEFT JOIN contacts c ON c.id = s.customer_id
    WHERE  s.business_id = @business_id
      AND  s.channel     = 'pos'
    ORDER  BY s.created_at DESC
    LIMIT  @limit
  `).all({ business_id, limit });

  return rows.map((r) => ({
    ...r,
    contacts: { name: r.customer_name },
  }));
}

function getPosSummary({ business_id, location_id, since }) {
  const db = getDb();
  let sql = `
    SELECT COUNT(*) AS count, COALESCE(SUM(grand_total), 0) AS total
    FROM   sales
    WHERE  business_id = @business_id
      AND  channel     = 'pos'
      AND  status      = 'confirmed'
  `;
  const params = { business_id };

  if (location_id) {
    sql += ` AND location_id = @location_id`;
    params.location_id = location_id;
  }
  if (since) {
    sql += ` AND created_at >= @since`;
    params.since = since;
  }

  const row = db.prepare(sql).get(params);
  return {
    count: Number(row?.count || 0),
    total: Number(row?.total || 0),
  };
}

// ---------------------------------------------------------------------------
// EXPORTS
// ---------------------------------------------------------------------------

module.exports = {
  getSales,
  getSaleById,
  getSaleItems,
  createSale,
  updateSale,
  confirmSale,
  softDeleteSale,
  getSellReturns,
  getSellReturnItems,
  getPriorReturnedByItemIds,
  createSellReturn,
  getSalesDue,
  recordSaleDuePayment,
  getFifoCosts,
  getRecentPosSales,
  getPosSummary,
};
