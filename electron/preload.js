'use strict';

/**
 * electron/preload.js
 *
 * Runs in an isolated context between the renderer (React) and the main process.
 * Exposes a typed, safe window.electronAPI object via contextBridge.
 *
 * Security rules enforced here:
 *   - contextIsolation: true  → renderer cannot reach Node.js directly
 *   - nodeIntegration: false  → no require() in renderer
 *   - Only named, whitelisted methods are exposed — no raw ipcRenderer.invoke
 *
 * Usage in React:
 *   import { api } from '../lib/electronAPI';
 *   const result = await api.auth.signIn({ username, password });
 *   if (result.error) { ... } else { use result.data }
 *
 * Every method returns a Promise<{ data, error }> — data is the payload on
 * success, error is a string message on failure, the other field is null.
 */

const { contextBridge, ipcRenderer } = require('electron');

/** Thin helper — invoke a channel and return the { data, error } object. */
const invoke = (channel, payload) => ipcRenderer.invoke(channel, payload);

contextBridge.exposeInMainWorld('electronAPI', {

  // =========================================================================
  // AUTH
  // =========================================================================
  auth: {
    isSetupRequired: () => invoke('auth:isSetupRequired'),
    setup: (payload) => invoke('auth:setup', payload),
    signIn: (payload) => invoke('auth:signIn', payload),
    signOut: () => invoke('auth:signOut'),
    getSession: () => invoke('auth:getSession'),
    changePassword: (payload) => invoke('auth:changePassword', payload),
  },

  // =========================================================================
  // BUSINESS  (registered in Phase 10 — Settings)
  // =========================================================================
  business: {
    get: () => invoke('business:get'),
    update: (payload) => invoke('business:update', payload),
  },

  // =========================================================================
  // LOCATIONS  (registered in Phase 10 — Settings)
  // =========================================================================
  locations: {
    getAll: () => invoke('locations:getAll'),
    getById: (id) => invoke('locations:getById', id),
    create: (payload) => invoke('locations:create', payload),
    update: (payload) => invoke('locations:update', payload),
    toggleActive: (id) => invoke('locations:toggleActive', id),
  },

  // =========================================================================
  // PRODUCTS  (registered in Phase 2)
  // =========================================================================
  products: {
    getAll: (filters) => invoke('products:getAll', filters),
    getById: (id) => invoke('products:getById', id),
    create: (payload) => invoke('products:create', payload),
    update: (payload) => invoke('products:update', payload),
    delete: (id) => invoke('products:delete', id),
    softDelete: (id) => invoke('products:softDelete', id),
    addOpeningStock: (entries) => invoke('products:addOpeningStock', entries),
  },

  // =========================================================================
  // CATEGORIES  (registered in Phase 2)
  // =========================================================================
  categories: {
    getAll: () => invoke('categories:getAll'),
    create: (payload) => invoke('categories:create', payload),
    update: (payload) => invoke('categories:update', payload),
    delete: (id) => invoke('categories:delete', id),
  },

  // =========================================================================
  // TAX RATES  (registered in Phase 2)
  // =========================================================================
  taxRates: {
    getAll: () => invoke('taxRates:getAll'),
    create: (payload) => invoke('taxRates:create', payload),
    update: (payload) => invoke('taxRates:update', payload),
    toggleActive: (id) => invoke('taxRates:toggleActive', id),
    delete: (id) => invoke('taxRates:delete', id),
  },

  // =========================================================================
  // CONTACTS  (registered in Phase 3)
  // =========================================================================
  contacts: {
    getAll: (filters) => invoke('contacts:getAll', filters),
    getById: (id) => invoke('contacts:getById', id),
    create: (payload) => invoke('contacts:create', payload),
    update: (payload) => invoke('contacts:update', payload),
    delete: (id) => invoke('contacts:delete', id),
    softDelete: (id) => invoke('contacts:softDelete', id),
    getLedger: (id) => invoke('contacts:getLedger', id),
    recordPayment: (payload) => invoke('contacts:recordPayment', payload),
  },

  // =========================================================================
  // PURCHASES  (registered in Phase 4)
  // =========================================================================
  purchases: {
    getAll: (filters) => invoke('purchases:getAll', filters),
    getById: (id) => invoke('purchases:getById', id),
    getItems: (id) => invoke('purchases:getItems', id),
    getStockByLocation: (payload) => invoke('purchases:getStockByLocation', payload),
    create: (payload) => invoke('purchases:create', payload),
    update: (payload) => invoke('purchases:update', payload),
    markReceived: (id) => invoke('purchases:markReceived', id),
    softDelete: (id) => invoke('purchases:softDelete', id),
  },
  purchaseReturns: {
    getAll: (filters) => invoke('purchaseReturns:getAll', filters),
    getItems: (returnId) => invoke('purchaseReturns:getItems', returnId),
    getPriorReturned: (itemIds) => invoke('purchaseReturns:getPriorReturned', itemIds),
    create: (payload) => invoke('purchaseReturns:create', payload),
  },
  purchaseDue: {
    getAll: () => invoke('purchaseDue:getAll'),
    recordPayment: (payload) => invoke('purchaseDue:recordPayment', payload),
  },

  // =========================================================================
  // SALES  (registered in Phase 5)
  // =========================================================================
  sales: {
    getAll: (filters) => invoke('sales:getAll', filters),
    getById: (id) => invoke('sales:getById', id),
    getItems: (id) => invoke('sales:getItems', id),
    getFifoCosts: (payload) => invoke('sales:getFifoCosts', payload),
    create: (payload) => invoke('sales:create', payload),
    update: (payload) => invoke('sales:update', payload),
    confirmSale: (id) => invoke('sales:confirmSale', id),
    softDelete: (id) => invoke('sales:softDelete', id),
    getRecentPos: (payload) => invoke('sales:getRecentPos', payload),
    getPosSummary: (payload) => invoke('sales:getPosSummary', payload),
  },
  sellReturns: {
    getAll: (filters) => invoke('sellReturns:getAll', filters),
    getItems: (returnId) => invoke('sellReturns:getItems', returnId),
    getPriorReturned: (itemIds) => invoke('sellReturns:getPriorReturned', itemIds),
    create: (payload) => invoke('sellReturns:create', payload),
  },
  salesDue: {
    getAll: (filters) => invoke('salesDue:getAll', filters),
    recordPayment: (payload) => invoke('salesDue:recordPayment', payload),
  },

  // =========================================================================
  // STOCK  (registered in Phase 7)
  // =========================================================================
  stock: {
    getAll: (filters) => invoke('stock:getAll', filters),
    adjust: (payload) => invoke('stock:adjust', payload),
    getLedger: (filters) => invoke('stock:getLedger', filters),
  },

  // =========================================================================
  // EXPENSES  (registered in Phase 8)
  // =========================================================================
  expenses: {
    getAll: (filters) => invoke('expenses:getAll', filters),
    getById: (id) => invoke('expenses:getById', id),
    create: (payload) => invoke('expenses:create', payload),
    update: (payload) => invoke('expenses:update', payload),
    delete: (id) => invoke('expenses:delete', id),
  },
  expenseCategories: {
    getAll: () => invoke('expenseCategories:getAll'),
    create: (payload) => invoke('expenseCategories:create', payload),
    update: (payload) => invoke('expenseCategories:update', payload),
    delete: (id) => invoke('expenseCategories:delete', id),
  },
  recurringExpenses: {
    getAll: () => invoke('recurringExpenses:getAll'),
    getById: (id) => invoke('recurringExpenses:getById', id),
    create: (payload) => invoke('recurringExpenses:create', payload),
    update: (payload) => invoke('recurringExpenses:update', payload),
    delete: (id) => invoke('recurringExpenses:delete', id),
    runNow: (id) => invoke('recurringExpenses:runNow', id),
    toggleActive: (id) => invoke('recurringExpenses:toggleActive', id),
  },

  // =========================================================================
  // REPORTS  (registered in Phase 9)
  // =========================================================================
  reports: {
    getSalesSummary: (filters) => invoke('reports:getSalesSummary', filters),
    getProfitLoss: (filters) => invoke('reports:getProfitLoss', filters),
    getStockReport: (filters) => invoke('reports:getStockReport', filters),
    getStockHistory: (payload) => invoke('reports:getStockHistory', payload),
    getCustomers: (filters) => invoke('reports:getCustomers', filters),
    getSuppliers: (filters) => invoke('reports:getSuppliers', filters),
    getExpenses: (filters) => invoke('reports:getExpenses', filters),
    // getUserActivity:  (filters) => invoke('reports:getUserActivity',  filters),
    getDailyItems: (filters) => invoke('reports:getDailyItems', filters),
  },

  // =========================================================================
  // REGISTERS  (registered in Phase 11)
  // =========================================================================
  registers: {
    getAll: (filters) => invoke('registers:getAll', filters),
    getById: (id) => invoke('registers:getById', id),
    getOpen: (payload) => invoke('registers:getOpen', payload),
    open: (payload) => invoke('registers:open', payload),
    close: (payload) => invoke('registers:close', payload),
    getSummary: (id) => invoke('registers:getSummary', id),
  },

  // =========================================================================
  // NOTIFICATIONS  (registered in Phase 12)
  // =========================================================================
  notifications: {
    getAll: () => invoke('notifications:getAll'),
    markRead: (id) => invoke('notifications:markRead', id),
    markAllRead: () => invoke('notifications:markAllRead'),
    create: (payload) => invoke('notifications:create', payload),
  },

  // =========================================================================
  // INVOICE / RECEIPT SETTINGS  (registered in Phase 10)
  // =========================================================================
  settings: {
    getInvoiceSettings: () => invoke('settings:getInvoiceSettings'),
    saveInvoiceSettings: (payload) => invoke('settings:saveInvoiceSettings', payload),
    getUserPrefs: () => invoke('settings:getUserPrefs'),
    saveUserPrefs: (payload) => invoke('settings:saveUserPrefs', payload),
  },

  // =========================================================================
  // DASHBOARD
  // =========================================================================
  dashboard: {
    getMetrics: (filters) => invoke('dashboard:getMetrics', filters),
    getGraph: (filters) => invoke('dashboard:getGraph', filters),
    getLowerSections: (filters) => invoke('dashboard:getLowerSections', filters),
  },

  // =========================================================================
  // SYSTEM & HARDWARE INFO
  // =========================================================================
  system: {
    getDeviceInfo: () => invoke('system:getDeviceInfo'),
  },

});
