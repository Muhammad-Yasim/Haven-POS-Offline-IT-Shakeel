'use strict';

/**
 * electron/ipc/products.ipc.js
 *
 * Registers IPC handlers for Products, Categories, Tax Rates, and Locations.
 */

const { ipcMain } = require('electron');
const productsRepo = require('../database/repositories/products.repo');

function handle(channel, fn) {
  ipcMain.handle(channel, async (_event, ...args) => {
    try {
      const result = await fn(...args);
      return { data: result ?? null, error: null };
    } catch (err) {
      console.error(`[IPC] ${channel} error:`, err.message);
      return { data: null, error: err.message };
    }
  });
}

function registerProductHandlers() {
  // Categories
  handle('categories:getAll', () => productsRepo.getCategories());
  handle('categories:create', (payload) => productsRepo.createCategory(payload));
  handle('categories:update', (payload) => productsRepo.updateCategory(payload));
  handle('categories:delete', (id) => productsRepo.deleteCategory(id));

  // Tax Rates
  handle('taxRates:getAll', () => productsRepo.getTaxRates());
  handle('taxRates:create', (payload) => productsRepo.createTaxRate(payload));
  handle('taxRates:update', (payload) => productsRepo.updateTaxRate(payload));
  handle('taxRates:toggleActive', (payload) => {
    if (typeof payload === 'object') {
      return productsRepo.toggleTaxRateActive(payload);
    }
    return productsRepo.toggleTaxRateActive({ id: payload, is_active: false });
  });
  handle('taxRates:delete', (id) => productsRepo.deleteTaxRate(id));

  // Products
  handle('products:getAll', (filters) => productsRepo.getProducts(filters));
  handle('products:getById', (id) => productsRepo.getProductById(id));
  handle('products:create', (payload) => productsRepo.createProduct(payload));
  handle('products:update', ({ id, ...payload }) => productsRepo.updateProduct(id, payload));
  handle('products:delete', (id) => productsRepo.deleteProduct(id));
  handle('products:softDelete', (id) => productsRepo.softDeleteProduct(id));
  handle('products:addOpeningStock', (payload) => productsRepo.addOpeningStock(payload));
}

module.exports = { registerProductHandlers };
