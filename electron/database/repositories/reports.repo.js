'use strict';

/**
 * electron/database/repositories/reports.repo.js
 *
 * Repository providing aggregated and raw dataset queries for all reports:
 *   - getSalesSummary (salesReport)
 *   - getProfitLoss (profitLossReport)
 *   - getStockReport (stockReport)
 *   - getStockHistory (stockReport modal)
 *   - getCustomers (customersReport)
 *   - getSuppliers (suppliersReport)
 *   - getExpenses (expensesReport)
 *   - getUserActivity (userActivityReport)
 *   - getDailyItems (dailyItemsReport)
 */

const { getDb } = require('../db');
const authRepo = require('./auth.repo');

// ---------------------------------------------------------------------------
// 1. SALES & PURCHASES SUMMARY REPORT
// ---------------------------------------------------------------------------

function getSalesSummary(filters = {}) {
  const db = getDb();
  const businessId = filters.businessId || filters.business_id || authRepo.getCurrentBusinessId() || 1;
  const { from, to, locationId, location_id, scopedLocationIds } = filters;
  const locId = locationId || location_id;

  // --- Sales ---
  let salesSql = `
    SELECT id, grand_total, tax_amount, due_amount, status, sale_date, location_id
    FROM sales
    WHERE business_id = ?
      AND status IN ('confirmed', 'shipped', 'returned', 'partially_returned')
  `;
  const salesParams = [businessId];
  if (from) {
    salesSql += ` AND sale_date >= ?`;
    salesParams.push(from);
  }
  if (to) {
    salesSql += ` AND sale_date <= ?`;
    salesParams.push(to);
  }
  if (Array.isArray(scopedLocationIds) && scopedLocationIds.length > 0) {
    const ph = scopedLocationIds.map(() => '?').join(',');
    salesSql += ` AND location_id IN (${ph})`;
    salesParams.push(...scopedLocationIds.map(Number));
  } else if (locId) {
    salesSql += ` AND location_id = ?`;
    salesParams.push(Number(locId));
  }
  const sales = db.prepare(salesSql).all(...salesParams);

  // --- Sell Returns ---
  let srSql = `
    SELECT sr.id, sr.total_amount, sr.return_date, sr.sale_id, s.location_id
    FROM sell_returns sr
    LEFT JOIN sales s ON s.id = sr.sale_id
    WHERE sr.business_id = ?
  `;
  const srParams = [businessId];
  if (from) {
    srSql += ` AND sr.return_date >= ?`;
    srParams.push(from);
  }
  if (to) {
    srSql += ` AND sr.return_date <= ?`;
    srParams.push(to);
  }
  if (Array.isArray(scopedLocationIds) && scopedLocationIds.length > 0) {
    const ph = scopedLocationIds.map(() => '?').join(',');
    srSql += ` AND s.location_id IN (${ph})`;
    srParams.push(...scopedLocationIds.map(Number));
  } else if (locId) {
    srSql += ` AND s.location_id = ?`;
    srParams.push(Number(locId));
  }
  const sellReturns = db.prepare(srSql).all(...srParams);

  // --- Purchases ---
  let purchSql = `
    SELECT id, grand_total, tax_amount, advance_payment, purchase_status, location_id, purchase_date
    FROM purchases
    WHERE business_id = ?
      AND purchase_status = 'received'
  `;
  const purchParams = [businessId];
  if (from) {
    purchSql += ` AND purchase_date >= ?`;
    purchParams.push(from);
  }
  if (to) {
    purchSql += ` AND purchase_date <= ?`;
    purchParams.push(to);
  }
  if (Array.isArray(scopedLocationIds) && scopedLocationIds.length > 0) {
    const ph = scopedLocationIds.map(() => '?').join(',');
    purchSql += ` AND location_id IN (${ph})`;
    purchParams.push(...scopedLocationIds.map(Number));
  } else if (locId) {
    purchSql += ` AND location_id = ?`;
    purchParams.push(Number(locId));
  }
  const purchases = db.prepare(purchSql).all(...purchParams);

  // --- Purchase Returns ---
  let prSql = `
    SELECT pr.id, pr.total_amount, pr.return_date, pr.purchase_id, p.location_id
    FROM purchase_returns pr
    LEFT JOIN purchases p ON p.id = pr.purchase_id
    WHERE pr.business_id = ?
  `;
  const prParams = [businessId];
  if (from) {
    prSql += ` AND pr.return_date >= ?`;
    prParams.push(from);
  }
  if (to) {
    prSql += ` AND pr.return_date <= ?`;
    prParams.push(to);
  }
  if (Array.isArray(scopedLocationIds) && scopedLocationIds.length > 0) {
    const ph = scopedLocationIds.map(() => '?').join(',');
    prSql += ` AND p.location_id IN (${ph})`;
    prParams.push(...scopedLocationIds.map(Number));
  } else if (locId) {
    prSql += ` AND p.location_id = ?`;
    prParams.push(Number(locId));
  }
  const purchaseReturns = db.prepare(prSql).all(...prParams);

  // Computed summary
  const totalSales = sales.reduce((a, r) => a + Number(r.grand_total || 0), 0);
  const salesTax = sales.reduce((a, r) => a + Number(r.tax_amount || 0), 0);
  const salesIncTax = totalSales;
  const totalSellReturn = sellReturns.reduce((a, r) => a + Number(r.total_amount || 0), 0);
  const saleDue = sales.reduce((a, r) => a + Number(r.due_amount || 0), 0);

  const netPurchases = purchases.reduce((a, r) => a + Number(r.grand_total || 0), 0);
  const purchaseTax = purchases.reduce((a, r) => a + Number(r.tax_amount || 0), 0);
  const totalPurchaseReturn = purchaseReturns.reduce((a, r) => a + Number(r.total_amount || 0), 0);
  const totalPurchases = netPurchases + totalPurchaseReturn;
  const purchaseIncTax = totalPurchases;
  const purchaseDue = purchases.reduce(
    (a, r) => a + Math.max(Number(r.grand_total || 0) - Number(r.advance_payment || 0), 0),
    0
  );

  return {
    sales,
    sellReturns,
    purchases,
    purchaseReturns,
    summary: {
      totalSales,
      salesTax,
      salesIncTax,
      totalSellReturn,
      saleDue,
      totalPurchases,
      netPurchases,
      purchaseTax,
      purchaseIncTax,
      totalPurchaseReturn,
      purchaseDue,
    },
  };
}

// ---------------------------------------------------------------------------
// 2. PROFIT & LOSS REPORT
// ---------------------------------------------------------------------------

function getProfitLoss(filters = {}) {
  const db = getDb();
  const businessId = filters.businessId || filters.business_id || authRepo.getCurrentBusinessId() || 1;

  const locations = db.prepare(`
    SELECT id, name FROM locations WHERE business_id = ? AND is_active = 1
  `).all(businessId);

  const sales = db.prepare(`
    SELECT * FROM sales
    WHERE business_id = ? AND status IN ('confirmed', 'shipped', 'returned', 'partially_returned')
  `).all(businessId);

  const saleItems = db.prepare(`
    SELECT si.id, si.sale_id, si.product_id, si.quantity, si.line_total, si.unit_cost
    FROM sale_items si
    JOIN sales s ON s.id = si.sale_id
    WHERE s.business_id = ?
  `).all(businessId);

  const purchases = db.prepare(`
    SELECT * FROM purchases
    WHERE business_id = ? AND purchase_status = 'received'
  `).all(businessId);

  const purchaseItems = db.prepare(`
    SELECT pi.id, pi.purchase_id, pi.product_id, pi.quantity, pi.unit_cost
    FROM purchase_items pi
    JOIN purchases p ON p.id = pi.purchase_id
    WHERE p.business_id = ?
  `).all(businessId);

  const expenses = db.prepare(`
    SELECT * FROM expenses WHERE business_id = ?
  `).all(businessId);

  const stockLedger = db.prepare(`
    SELECT * FROM stock_ledger WHERE business_id = ?
  `).all(businessId);

  const sellReturns = db.prepare(`
    SELECT * FROM sell_returns WHERE business_id = ?
  `).all(businessId);

  const sellReturnItems = db.prepare(`
    SELECT sri.*
    FROM sell_return_items sri
    JOIN sell_returns sr ON sr.id = sri.sell_return_id
    WHERE sr.business_id = ?
  `).all(businessId);

  const purchaseReturns = db.prepare(`
    SELECT * FROM purchase_returns WHERE business_id = ?
  `).all(businessId);

  const products = db.prepare(`
    SELECT id, name, sku, cost_price, default_selling_price, category_id
    FROM products WHERE business_id = ?
  `).all(businessId);

  const categories = db.prepare(`
    SELECT id, name FROM categories WHERE business_id = ?
  `).all(businessId);

  const contacts = db.prepare(`
    SELECT id, name FROM contacts WHERE business_id = ?
  `).all(businessId);

  return {
    locations,
    sales,
    saleItems,
    purchases,
    purchaseItems,
    expenses,
    stockLedger,
    sellReturns,
    sellReturnItems,
    purchaseReturns,
    products,
    categories,
    contacts,
  };
}

// ---------------------------------------------------------------------------
// 3. STOCK VALUATION REPORT
// ---------------------------------------------------------------------------

function getStockReport(filters = {}) {
  const db = getDb();
  const businessId = filters.businessId || filters.business_id || authRepo.getCurrentBusinessId() || 1;

  const products = db.prepare(`
    SELECT id, name, sku, cost_price, default_selling_price, alert_quantity, category_id
    FROM products
    WHERE business_id = ? AND is_active = 1
  `).all(businessId);

  const purchaseItems = db.prepare(`
    SELECT pi.product_id, pi.quantity, pi.unit_cost, p.location_id, p.business_id
    FROM purchase_items pi
    JOIN purchases p ON p.id = pi.purchase_id
    WHERE p.business_id = ?
  `).all(businessId);

  const locations = db.prepare(`
    SELECT id, name FROM locations WHERE business_id = ? AND is_active = 1
  `).all(businessId);

  const categories = db.prepare(`
    SELECT id, name FROM categories WHERE business_id = ?
  `).all(businessId);

  const stockLedger = db.prepare(`
    SELECT * FROM stock_ledger WHERE business_id = ?
  `).all(businessId);

  return {
    products,
    purchaseItems,
    locations,
    categories,
    stockLedger,
  };
}

// ---------------------------------------------------------------------------
// 4. STOCK HISTORY (MODAL)
// ---------------------------------------------------------------------------

function getStockHistory(payload = {}) {
  const db = getDb();
  const productId = Number(payload.productId || payload.prodId);
  const locationId = payload.locationId ? Number(payload.locationId) : null;

  let sql = `
    SELECT
      sl.*,
      p.name AS product_name,
      p.sku  AS product_sku,
      l.name AS location_name,
      CASE
        WHEN sl.reason = 'sale' OR sl.reference_type = 'sale' THEN '#' || sl.reference_id
        WHEN sl.reason = 'purchase' OR sl.reference_type = 'purchase' THEN '#' || sl.reference_id
        WHEN sl.reason = 'sell_return' OR sl.reference_type = 'sell_return' THEN '#' || sl.reference_id
        WHEN sl.reason = 'purchase_return' OR sl.reference_type = 'purchase_return' THEN '#' || sl.reference_id
        ELSE '—'
      END AS ref_no,
      CASE
        WHEN sl.reason = 'sale' OR sl.reference_type = 'sale' THEN COALESCE(sc.name, 'Walk-in')
        WHEN sl.reason = 'purchase' OR sl.reference_type = 'purchase' THEN COALESCE(pc.name, '—')
        WHEN sl.reason = 'sell_return' OR sl.reference_type = 'sell_return' THEN COALESCE(src.name, 'Walk-in')
        WHEN sl.reason = 'purchase_return' OR sl.reference_type = 'purchase_return' THEN COALESCE(prc.name, '—')
        ELSE '—'
      END AS contact_name
    FROM stock_ledger sl
    JOIN products p ON p.id = sl.product_id
    JOIN locations l ON l.id = sl.location_id
    LEFT JOIN sales s ON (sl.reason = 'sale' OR sl.reference_type = 'sale') AND s.id = sl.reference_id
    LEFT JOIN contacts sc ON sc.id = s.customer_id
    LEFT JOIN purchases pur ON (sl.reason = 'purchase' OR sl.reference_type = 'purchase') AND pur.id = sl.reference_id
    LEFT JOIN contacts pc ON pc.id = pur.supplier_id
    LEFT JOIN sell_returns sr ON (sl.reason = 'sell_return' OR sl.reference_type = 'sell_return') AND sr.id = sl.reference_id
    LEFT JOIN contacts src ON src.id = sr.customer_id
    LEFT JOIN purchase_returns pr ON (sl.reason = 'purchase_return' OR sl.reference_type = 'purchase_return') AND pr.id = sl.reference_id
    LEFT JOIN purchases pr_pur ON pr_pur.id = pr.purchase_id
    LEFT JOIN contacts prc ON prc.id = pr_pur.supplier_id
    WHERE sl.product_id = ?
  `;
  const params = [productId];

  if (locationId) {
    sql += ` AND sl.location_id = ?`;
    params.push(locationId);
  }

  sql += ` ORDER BY sl.created_at DESC, sl.id DESC`;

  return db.prepare(sql).all(...params);
}

// ---------------------------------------------------------------------------
// 5. CUSTOMERS REPORT
// ---------------------------------------------------------------------------

function getCustomers(filters = {}) {
  const db = getDb();
  const businessId = filters.businessId || filters.business_id || authRepo.getCurrentBusinessId() || 1;
  const { userFilter, created_by } = filters;
  const userId = userFilter || created_by;

  let custSql = `
    SELECT * FROM contacts
    WHERE business_id = ? AND contact_type = 'customer'
  `;
  const custParams = [businessId];
  if (userId) {
    custSql += ` AND created_by = ?`;
    custParams.push(userId);
  }
  const customers = db.prepare(custSql).all(...custParams);

  const sales = db.prepare(`
    SELECT id, customer_id, location_id, grand_total, sale_date, status
    FROM sales
    WHERE business_id = ?
      AND status IN ('confirmed', 'shipped', 'returned', 'partially_returned')
      AND customer_id IS NOT NULL
  `).all(businessId);

  const sellReturns = db.prepare(`
    SELECT sale_id, total_amount FROM sell_returns WHERE business_id = ?
  `).all(businessId);

  const users = db.prepare(`
    SELECT id, first_name, last_name, username FROM users WHERE business_id = ?
  `).all(businessId);

  const locations = db.prepare(`
    SELECT id, name FROM locations WHERE business_id = ? AND is_active = 1
  `).all(businessId);

  let ledger = [];
  if (customers.length > 0) {
    const ids = customers.map(c => c.id);
    const ph = ids.map(() => '?').join(',');
    ledger = db.prepare(`
      SELECT contact_id, amount, reference_type
      FROM contact_ledger
      WHERE contact_id IN (${ph})
    `).all(...ids);
  }

  return {
    customers,
    sales,
    sellReturns,
    users,
    ledger,
    locations,
  };
}

// ---------------------------------------------------------------------------
// 6. SUPPLIERS REPORT
// ---------------------------------------------------------------------------

function getSuppliers(filters = {}) {
  const db = getDb();
  const businessId = filters.businessId || filters.business_id || authRepo.getCurrentBusinessId() || 1;
  const { userFilter, created_by } = filters;
  const userId = userFilter || created_by;

  let suppSql = `
    SELECT * FROM contacts
    WHERE business_id = ? AND contact_type = 'supplier'
  `;
  const suppParams = [businessId];
  if (userId) {
    suppSql += ` AND created_by = ?`;
    suppParams.push(userId);
  }
  const suppliers = db.prepare(suppSql).all(...suppParams);

  const purchases = db.prepare(`
    SELECT supplier_id, location_id, grand_total, purchase_date, purchase_status
    FROM purchases
    WHERE business_id = ?
      AND purchase_status = 'received'
      AND supplier_id IS NOT NULL
  `).all(businessId);

  const users = db.prepare(`
    SELECT id, first_name, last_name, username FROM users WHERE business_id = ?
  `).all(businessId);

  const locations = db.prepare(`
    SELECT id, name FROM locations WHERE business_id = ? AND is_active = 1
  `).all(businessId);

  let ledger = [];
  if (suppliers.length > 0) {
    const ids = suppliers.map(s => s.id);
    const ph = ids.map(() => '?').join(',');
    ledger = db.prepare(`
      SELECT contact_id, amount, reference_type
      FROM contact_ledger
      WHERE contact_id IN (${ph})
    `).all(...ids);
  }

  return {
    suppliers,
    purchases,
    users,
    ledger,
    locations,
  };
}

// ---------------------------------------------------------------------------
// 7. EXPENSES REPORT
// ---------------------------------------------------------------------------

function getExpensesReport(filters = {}) {
  const db = getDb();
  const businessId = filters.businessId || filters.business_id || authRepo.getCurrentBusinessId() || 1;
  const { from, to, locationId, location_id, categoryId, category_id, scopedLocationIds } = filters;
  const locId = locationId || location_id;
  const catId = categoryId || category_id;

  const locations = db.prepare(`
    SELECT id, name FROM locations WHERE business_id = ?
  `).all(businessId);

  const categories = db.prepare(`
    SELECT id, name FROM expense_categories WHERE business_id = ?
  `).all(businessId);

  let sql = `
    SELECT * FROM expenses
    WHERE business_id = ?
  `;
  const params = [businessId];

  if (from) {
    sql += ` AND expense_date >= ?`;
    params.push(from);
  }
  if (to) {
    sql += ` AND expense_date <= ?`;
    params.push(to);
  }
  if (Array.isArray(scopedLocationIds) && scopedLocationIds.length > 0) {
    const ph = scopedLocationIds.map(() => '?').join(',');
    sql += ` AND location_id IN (${ph})`;
    params.push(...scopedLocationIds.map(Number));
  } else if (locId) {
    sql += ` AND location_id = ?`;
    params.push(Number(locId));
  }
  if (catId) {
    sql += ` AND category_id = ?`;
    params.push(Number(catId));
  }

  sql += ` ORDER BY expense_date DESC, id DESC`;

  const expenses = db.prepare(sql).all(...params);

  return {
    locations,
    categories,
    expenses,
  };
}

// ---------------------------------------------------------------------------
// 8. USER ACTIVITY REPORT
// ---------------------------------------------------------------------------

function getUserActivity(filters = {}) {
  const db = getDb();
  const businessId = filters.businessId || filters.business_id || authRepo.getCurrentBusinessId() || 1;
  const { from, to } = filters;

  const users = db.prepare(`
    SELECT id, first_name, last_name, is_owner, 'active' AS employment_status, date(created_at) AS joining_date
    FROM users
    WHERE business_id = ?
  `).all(businessId);

  let salesSql = `
    SELECT created_by, grand_total, sale_date
    FROM sales
    WHERE business_id = ?
      AND status IN ('confirmed', 'shipped', 'returned', 'partially_returned')
  `;
  const salesParams = [businessId];
  if (from) {
    salesSql += ` AND sale_date >= ?`;
    salesParams.push(from);
  }
  if (to) {
    salesSql += ` AND sale_date <= ?`;
    salesParams.push(to);
  }
  const sales = db.prepare(salesSql).all(...salesParams);

  let purchSql = `
    SELECT created_by, grand_total, purchase_date
    FROM purchases
    WHERE business_id = ?
      AND purchase_status = 'received'
  `;
  const purchParams = [businessId];
  if (from) {
    purchSql += ` AND purchase_date >= ?`;
    purchParams.push(from);
  }
  if (to) {
    purchSql += ` AND purchase_date <= ?`;
    purchParams.push(to);
  }
  const purchases = db.prepare(purchSql).all(...purchParams);

  let expSql = `
    SELECT expense_from_user_id, expense_date
    FROM expenses
    WHERE business_id = ?
  `;
  const expParams = [businessId];
  if (from) {
    expSql += ` AND expense_date >= ?`;
    expParams.push(from);
  }
  if (to) {
    expSql += ` AND expense_date <= ?`;
    expParams.push(to);
  }
  const expenses = db.prepare(expSql).all(...expParams);

  let srSql = `
    SELECT sr.created_by, sr.total_amount, sr.return_date, s.created_by AS sale_created_by
    FROM sell_returns sr
    LEFT JOIN sales s ON s.id = sr.sale_id
    WHERE sr.business_id = ?
  `;
  const srParams = [businessId];
  if (from) {
    srSql += ` AND sr.return_date >= ?`;
    srParams.push(from);
  }
  if (to) {
    srSql += ` AND sr.return_date <= ?`;
    srParams.push(to);
  }
  const sellReturns = db.prepare(srSql).all(...srParams).map((sr) => ({
    created_by: sr.created_by,
    total_amount: sr.total_amount,
    return_date: sr.return_date,
    sales: { created_by: sr.sale_created_by },
  }));

  let prSql = `
    SELECT pr.created_by, pr.total_amount, pr.return_date, p.created_by AS purchase_created_by
    FROM purchase_returns pr
    LEFT JOIN purchases p ON p.id = pr.purchase_id
    WHERE pr.business_id = ?
  `;
  const prParams = [businessId];
  if (from) {
    prSql += ` AND pr.return_date >= ?`;
    prParams.push(from);
  }
  if (to) {
    prSql += ` AND pr.return_date <= ?`;
    prParams.push(to);
  }
  const purchaseReturns = db.prepare(prSql).all(...prParams).map((pr) => ({
    created_by: pr.created_by,
    total_amount: pr.total_amount,
    return_date: pr.return_date,
    purchases: { created_by: pr.purchase_created_by },
  }));

  return {
    users,
    sales,
    purchases,
    expenses,
    sellReturns,
    purchaseReturns,
  };
}

// ---------------------------------------------------------------------------
// 9. DAILY ITEMS REPORT
// ---------------------------------------------------------------------------

function getDailyItems(filters = {}) {
  const db = getDb();
  const businessId = filters.businessId || filters.business_id || authRepo.getCurrentBusinessId() || 1;
  const { from, to, locationId, location_id, scopedLocationIds } = filters;
  const locId = locationId || location_id;

  let sql = `
    SELECT
      si.id,
      si.product_id,
      si.quantity,
      si.unit_price,
      si.line_total,
      s.sale_date,
      s.status,
      s.location_id
    FROM sale_items si
    JOIN sales s ON s.id = si.sale_id
    WHERE s.business_id = ?
      AND s.status IN ('confirmed', 'shipped', 'partially_returned', 'returned')
  `;
  const params = [businessId];

  if (from) {
    sql += ` AND s.sale_date >= ?`;
    params.push(from);
  }
  if (to) {
    sql += ` AND s.sale_date <= ?`;
    params.push(to);
  }
  if (Array.isArray(scopedLocationIds) && scopedLocationIds.length > 0) {
    const ph = scopedLocationIds.map(() => '?').join(',');
    sql += ` AND s.location_id IN (${ph})`;
    params.push(...scopedLocationIds.map(Number));
  } else if (locId) {
    sql += ` AND s.location_id = ?`;
    params.push(Number(locId));
  }

  sql += ` ORDER BY s.sale_date DESC, si.id DESC`;

  const saleItems = db.prepare(sql).all(...params);

  let returnItems = [];
  if (saleItems.length > 0) {
    const itemIds = saleItems.map(i => i.id);
    const ph = itemIds.map(() => '?').join(',');
    returnItems = db.prepare(`
      SELECT sale_item_id, quantity_returned, amount
      FROM sell_return_items
      WHERE sale_item_id IN (${ph})
    `).all(...itemIds);
  }

  const products = db.prepare(`
    SELECT id, name, sku FROM products WHERE business_id = ?
  `).all(businessId);

  return {
    saleItems,
    returnItems,
    products,
  };
}

module.exports = {
  getSalesSummary,
  getProfitLoss,
  getStockReport,
  getStockHistory,
  getCustomers,
  getSuppliers,
  getExpensesReport,
  getExpenses: getExpensesReport,
  getUserActivity,
  getDailyItems,
};

