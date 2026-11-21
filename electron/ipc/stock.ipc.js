'use strict';

/**
 * electron/ipc/stock.ipc.js
 *
 * IPC handlers for Stock Management.
 */

const { ipcMain } = require('electron');
const repo = require('../database/repositories/stock.repo');
const authRepo = require('../database/repositories/auth.repo');

function registerStockHandlers() {
  ipcMain.handle('stock:getAll', async (_e, filters) => {
    try {
      const businessId = filters?.businessId || filters?.business_id || authRepo.getCurrentBusinessId() || 1;
      const data = repo.getStock({ ...filters, businessId });
      return { data, error: null };
    } catch (err) {
      return { data: null, error: err.message };
    }
  });

  ipcMain.handle('stock:adjust', async (_e, payload) => {
    try {
      const businessId = payload?.businessId || payload?.business_id || authRepo.getCurrentBusinessId() || 1;
      const userId = payload?.userId || authRepo.getCurrentUserId();
      const data = repo.adjustStock({ ...payload, businessId, userId });
      return { data, error: null };
    } catch (err) {
      return { data: null, error: err.message };
    }
  });

  ipcMain.handle('stock:getLedger', async (_e, filters) => {
    try {
      const businessId = filters?.businessId || filters?.business_id || authRepo.getCurrentBusinessId() || 1;
      const data = repo.getStockLedger({ ...filters, businessId });
      return { data, error: null };
    } catch (err) {
      return { data: null, error: err.message };
    }
  });
}

module.exports = { registerStockHandlers };
