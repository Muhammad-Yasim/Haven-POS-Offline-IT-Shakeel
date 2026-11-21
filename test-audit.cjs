const fs = require('fs');
const path = require('path');

process.env.HAVEN_DB_PATH = path.join(__dirname, 'test-audit-db.db');

const { initDb, getDb } = require('./electron/database/db');
initDb();
const db = getDb();

console.log('[AUDIT 5] Testing all 12 repository modules against fresh SQLite schema...');

try {
  // 1. Settings repo
  const settingsRepo = require('./electron/database/repositories/settings.repo');
  settingsRepo.getAllLocations();
  settingsRepo.getBusiness();
  settingsRepo.getInvoiceSettings();
  settingsRepo.getUserPrefs();
  console.log('✓ settings.repo methods pass');

  // 2. Auth repo
  const authRepo = require('./electron/database/repositories/auth.repo');
  const isReq = authRepo.isSetupRequired();
  console.log('✓ auth.repo methods pass (isSetupRequired:', isReq, ')');

  // Seed minimal business & user & location for subsequent repo tests
  db.prepare(`
    INSERT OR REPLACE INTO businesses (id, business_name, currency, contact_number, country, city, time_zone)
    VALUES (1, 'Haven Test Business', 'PKR', '03001234567', 'Pakistan', 'Karachi', 'Asia/Karachi')
  `).run();

  db.prepare(`
    INSERT OR REPLACE INTO users (id, business_id, username, password_hash, first_name, last_name, is_owner, is_active)
    VALUES ('usr-1', 1, 'admin', 'hash', 'Admin', 'User', 1, 1)
  `).run();

  db.prepare(`
    INSERT OR REPLACE INTO locations (id, business_id, name, is_active)
    VALUES (1, 1, 'Main Location', 1)
  `).run();

  // 3. Products repo
  const productsRepo = require('./electron/database/repositories/products.repo');
  productsRepo.getCategories(1);
  productsRepo.getTaxRates(1);
  productsRepo.getProducts({ businessId: 1 });
  console.log('✓ products.repo methods pass');

  // 4. Contacts repo
  const contactsRepo = require('./electron/database/repositories/contacts.repo');
  contactsRepo.getContacts({ businessId: 1 });
  console.log('✓ contacts.repo methods pass');

  // 5. Purchases repo
  const purchasesRepo = require('./electron/database/repositories/purchases.repo');
  purchasesRepo.getPurchases({ business_id: 1 });
  purchasesRepo.getStockByLocation({ business_id: 1, location_id: 1 });
  purchasesRepo.getPurchaseReturns({ business_id: 1 });
  purchasesRepo.getPurchaseDue(1);
  console.log('✓ purchases.repo methods pass');

  // 6. Sales repo
  const salesRepo = require('./electron/database/repositories/sales.repo');
  salesRepo.getSales({ business_id: 1 });
  salesRepo.getSellReturns({ business_id: 1 });
  salesRepo.getSalesDue(1);
  salesRepo.getRecentPosSales({ business_id: 1, limit: 5 });
  salesRepo.getPosSummary({ business_id: 1 });
  console.log('✓ sales.repo methods pass');

  // 7. Registers repo
  const registersRepo = require('./electron/database/repositories/registers.repo');
  registersRepo.getOpenRegister({ business_id: 1, user_id: 'usr-1' });
  registersRepo.getAllRegisters({ business_id: 1 });
  console.log('✓ registers.repo methods pass');

  // 8. Stock repo
  const stockRepo = require('./electron/database/repositories/stock.repo');
  stockRepo.getStock({ businessId: 1 });
  stockRepo.getStockLedger({ businessId: 1 });
  console.log('✓ stock.repo methods pass');

  // 9. Expenses repo
  const expensesRepo = require('./electron/database/repositories/expenses.repo');
  expensesRepo.getExpenseCategories(1);
  expensesRepo.getExpenses({ business_id: 1 });
  expensesRepo.getRecurringTemplates(1);
  console.log('✓ expenses.repo methods pass');

  // 10. Notifications repo
  const notifRepo = require('./electron/database/repositories/notifications.repo');
  notifRepo.getNotifications(1);
  console.log('✓ notifications.repo methods pass');

  // 11. Reports repo
  const reportsRepo = require('./electron/database/repositories/reports.repo');
  reportsRepo.getSalesSummary({ businessId: 1 });
  reportsRepo.getProfitLoss({ businessId: 1 });
  reportsRepo.getStockReport({ businessId: 1 });
  reportsRepo.getCustomers({ businessId: 1 });
  reportsRepo.getSuppliers({ businessId: 1 });
  reportsRepo.getExpensesReport({ businessId: 1 });
  reportsRepo.getUserActivity({ businessId: 1 });
  reportsRepo.getDailyItems({ businessId: 1 });
  console.log('✓ reports.repo methods pass');

  // 12. Dashboard repo
  const dashboardRepo = require('./electron/database/repositories/dashboard.repo');
  dashboardRepo.getDashboardMetrics({ business_id: 1 });
  dashboardRepo.getDashboardGraph({ business_id: 1, startDate: '2026-01-01', endDate: '2026-12-31' });
  dashboardRepo.getDashboardLowerSections({ business_id: 1 });
  console.log('✓ dashboard.repo methods pass');

  console.log('\n[AUDIT 5] ALL 12 REPOSITORIES PASSED END-TO-END SQL QUERIES WITH ZERO ERRORS!');
} catch (err) {
  console.error('[AUDIT 5 FAILED]:', err);
} finally {
  try {
    fs.unlinkSync(process.env.HAVEN_DB_PATH);
  } catch (_e) { }
}
