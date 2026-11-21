'use strict';

/**
 * electron/database/repositories/dashboard.repo.js
 *
 * Repository for dashboard metrics, graphs, dues, low-stock alerts, and pending shipments.
 */

const { getDb } = require('../db');
const authRepo = require('./auth.repo');

function getDashboardMetrics(filters = {}) {
  const db = getDb();
  const businessId = filters.business_id || authRepo.getCurrentBusinessId() || 1;
  const { from, to, location_id } = filters;

  // 1. Sales
  let salesSql = `
    SELECT grand_total, due_amount, location_id, sale_date
    FROM sales
    WHERE business_id = ?
      AND is_active = 1
      AND status IN ('confirmed', 'shipped', 'returned', 'partially_returned')
  `;
  const salesParams = [businessId];
  if (from) { salesSql += ` AND sale_date >= ?`; salesParams.push(from); }
  if (to) { salesSql += ` AND sale_date <= ?`; salesParams.push(to); }
  if (location_id) { salesSql += ` AND location_id = ?`; salesParams.push(Number(location_id)); }
  const sales = db.prepare(salesSql).all(...salesParams);

  // 2. Purchases
  let purchasesSql = `
    SELECT grand_total, advance_payment, location_id, purchase_date
    FROM purchases
    WHERE business_id = ?
      AND is_active = 1
      AND purchase_status = 'received'
  `;
  const purchasesParams = [businessId];
  if (from) { purchasesSql += ` AND purchase_date >= ?`; purchasesParams.push(from); }
  if (to) { purchasesSql += ` AND purchase_date <= ?`; purchasesParams.push(to); }
  if (location_id) { purchasesSql += ` AND location_id = ?`; purchasesParams.push(Number(location_id)); }
  const purchases = db.prepare(purchasesSql).all(...purchasesParams);

  // 3. Sell Returns
  let sellReturnsSql = `
    SELECT sr.total_amount, s.location_id, sr.return_date
    FROM sell_returns sr
    LEFT JOIN sales s ON s.id = sr.sale_id
    WHERE sr.business_id = ?
  `;
  const sellReturnsParams = [businessId];
  if (from) { sellReturnsSql += ` AND sr.return_date >= ?`; sellReturnsParams.push(from); }
  if (to) { sellReturnsSql += ` AND sr.return_date <= ?`; sellReturnsParams.push(to); }
  if (location_id) { sellReturnsSql += ` AND s.location_id = ?`; sellReturnsParams.push(Number(location_id)); }
  const sellReturns = db.prepare(sellReturnsSql).all(...sellReturnsParams).map((sr) => ({
    total_amount: sr.total_amount,
    sales: { location_id: sr.location_id },
    return_date: sr.return_date,
  }));

  // 4. Purchase Returns
  let purchaseReturnsSql = `
    SELECT pr.total_amount, p.location_id, pr.return_date
    FROM purchase_returns pr
    LEFT JOIN purchases p ON p.id = pr.purchase_id
    WHERE pr.business_id = ?
  `;
  const purchaseReturnsParams = [businessId];
  if (from) { purchaseReturnsSql += ` AND pr.return_date >= ?`; purchaseReturnsParams.push(from); }
  if (to) { purchaseReturnsSql += ` AND pr.return_date <= ?`; purchaseReturnsParams.push(to); }
  if (location_id) { purchaseReturnsSql += ` AND p.location_id = ?`; purchaseReturnsParams.push(Number(location_id)); }
  const purchaseReturns = db.prepare(purchaseReturnsSql).all(...purchaseReturnsParams).map((pr) => ({
    total_amount: pr.total_amount,
    purchases: { location_id: pr.location_id },
    return_date: pr.return_date,
  }));

  // 5. Expenses
  let expensesSql = `
    SELECT amount, location_id, expense_date
    FROM expenses
    WHERE business_id = ?
  `;
  const expensesParams = [businessId];
  if (from) { expensesSql += ` AND expense_date >= ?`; expensesParams.push(from); }
  if (to) { expensesSql += ` AND expense_date <= ?`; expensesParams.push(to); }
  if (location_id) { expensesSql += ` AND location_id = ?`; expensesParams.push(Number(location_id)); }
  const expenses = db.prepare(expensesSql).all(...expensesParams);

  return { sales, purchases, sellReturns, purchaseReturns, expenses };
}

function getDashboardGraph(filters = {}) {
  const db = getDb();
  const businessId = filters.business_id || authRepo.getCurrentBusinessId() || 1;
  const { startDate, endDate, location_id } = filters;

  let salesSql = `
    SELECT sale_date, grand_total, location_id
    FROM sales
    WHERE business_id = ?
      AND is_active = 1
      AND status IN ('confirmed', 'shipped', 'returned', 'partially_returned')
      AND sale_date >= ?
      AND sale_date <= ?
  `;
  const salesParams = [businessId, startDate, endDate];
  if (location_id) { salesSql += ` AND location_id = ?`; salesParams.push(Number(location_id)); }
  const sales = db.prepare(salesSql).all(...salesParams);

  let returnsSql = `
    SELECT sr.return_date, sr.total_amount, s.location_id
    FROM sell_returns sr
    LEFT JOIN sales s ON s.id = sr.sale_id
    WHERE sr.business_id = ?
      AND sr.return_date >= ?
      AND sr.return_date <= ?
  `;
  const returnsParams = [businessId, startDate, endDate];
  if (location_id) { returnsSql += ` AND s.location_id = ?`; returnsParams.push(Number(location_id)); }
  const returns = db.prepare(returnsSql).all(...returnsParams).map((sr) => ({
    return_date: sr.return_date,
    total_amount: sr.total_amount,
    sales: { location_id: sr.location_id },
  }));

  return { sales, returns };
}

function getDashboardLowerSections(filters = {}) {
  const db = getDb();
  const businessId = filters.business_id || authRepo.getCurrentBusinessId() || 1;

  // 1. Sales Due
  const salesDue = db.prepare(`
    SELECT s.id, s.sale_date, s.due_amount, s.grand_total, s.paid_amount, s.location_id,
           l.name AS location_name, c.name AS customer_name
    FROM sales s
    LEFT JOIN locations l ON l.id = s.location_id
    LEFT JOIN contacts c ON c.id = s.customer_id
    WHERE s.business_id = ?
      AND s.is_active = 1
      AND s.status IN ('confirmed', 'shipped', 'returned', 'partially_returned')
      AND s.due_amount > 0
    ORDER BY s.due_amount DESC
  `).all(businessId).map((s) => ({
    ...s,
    contacts: { name: s.customer_name || 'Walk-in' },
    locationName: s.location_name || '—',
  }));

  // 2. Purchases Due
  const purchasesDue = db.prepare(`
    SELECT p.id, p.purchase_date, p.grand_total, p.advance_payment,
           (p.grand_total - p.advance_payment) AS due,
           p.location_id, l.name AS location_name, c.name AS supplier_name
    FROM purchases p
    LEFT JOIN locations l ON l.id = p.location_id
    LEFT JOIN contacts c ON c.id = p.supplier_id
    WHERE p.business_id = ?
      AND p.is_active = 1
      AND p.purchase_status = 'received'
      AND (p.grand_total - p.advance_payment) > 0
    ORDER BY due DESC
  `).all(businessId).map((p) => ({
    ...p,
    contacts: { name: p.supplier_name || '—' },
    locationName: p.location_name || '—',
  }));

  // 3. Low Stock Items
  const lowStock = db.prepare(`
    SELECT
      p.id, p.name, p.sku, p.category_id, p.alert_quantity,
      cat.name AS category_name,
      l.id AS location_id, l.name AS location_name,
      COALESCE(SUM(sl.change_qty), 0) AS current_stock
    FROM products p
    LEFT JOIN categories cat ON cat.id = p.category_id
    CROSS JOIN locations l ON l.business_id = p.business_id AND l.is_active = 1
    LEFT JOIN stock_ledger sl ON sl.product_id = p.id AND sl.location_id = l.id
    WHERE p.business_id = ?
      AND p.is_active = 1
      AND p.alert_quantity IS NOT NULL
    GROUP BY p.id, l.id
    HAVING current_stock <= p.alert_quantity
    ORDER BY current_stock ASC
  `).all(businessId).map((row) => ({
    id: row.id,
    name: row.name,
    sku: row.sku,
    qty: Number(row.current_stock),
    currentStock: Number(row.current_stock),
    alert_quantity: Number(row.alert_quantity),
    alertQuantity: Number(row.alert_quantity),
    categoryName: row.category_name || '—',
    locationName: row.location_name || '—',
    locationId: row.location_id,
  }));

  // 4. Pending Shipments
  const pendingShipments = db.prepare(`
    SELECT sh.id, sh.shipment_status, sh.shipped_date, sh.created_at, sh.sale_id,
           s.sale_date, s.location_id, l.name AS location_name, c.name AS customer_name
    FROM shipments sh
    JOIN sales s ON s.id = sh.sale_id
    LEFT JOIN locations l ON l.id = s.location_id
    LEFT JOIN contacts c ON c.id = s.customer_id
    WHERE s.business_id = ?
      AND sh.shipment_status != 'delivered'
    ORDER BY sh.created_at DESC
  `).all(businessId).map((sh) => ({
    id: sh.id,
    shipment_status: sh.shipment_status,
    shipped_date: sh.shipped_date,
    created_at: sh.created_at,
    sale_id: sh.sale_id,
    sales: {
      sale_date: sh.sale_date,
      location_id: sh.location_id,
      contacts: { name: sh.customer_name || 'Walk-in' },
    },
    locationName: sh.location_name || '—',
    customerName: sh.customer_name || 'Walk-in',
  }));

  return { salesDue, purchasesDue, lowStock, shipments: pendingShipments };
}

module.exports = {
  getDashboardMetrics,
  getDashboardGraph,
  getDashboardLowerSections,
};
