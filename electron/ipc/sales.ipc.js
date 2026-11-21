'use strict';

/**
 * electron/ipc/sales.ipc.js
 *
 * IPC handlers for Sales, Sell Returns, and Sales Due.
 * All repo functions are synchronous; handlers are async wrappers.
 */

const { ipcMain } = require('electron');
const repo = require('../database/repositories/sales.repo');

function registerSalesHandlers() {

  // =========================================================================
  // SALES
  // =========================================================================

  ipcMain.handle('sales:getAll', async (_e, filters) => {
    try {
      const data = repo.getSales(filters || {});
      return { data, error: null };
    } catch (err) {
      return { data: null, error: err.message };
    }
  });

  ipcMain.handle('sales:getById', async (_e, id) => {
    try {
      const data = repo.getSaleById(id);
      return { data, error: null };
    } catch (err) {
      return { data: null, error: err.message };
    }
  });

  ipcMain.handle('sales:getItems', async (_e, saleId) => {
    try {
      const data = repo.getSaleItems(saleId);
      return { data, error: null };
    } catch (err) {
      return { data: null, error: err.message };
    }
  });

  ipcMain.handle('sales:getFifoCosts', async (_e, payload) => {
    try {
      const { businessId, items } = payload || {};
      const data = repo.getFifoCosts(businessId, items || []);
      return { data, error: null };
    } catch (err) {
      return { data: null, error: err.message };
    }
  });

  ipcMain.handle('sales:create', async (_e, payload) => {
    try {
      const data = repo.createSale(payload);
      return { data, error: null };
    } catch (err) {
      return { data: null, error: err.message };
    }
  });

  ipcMain.handle('sales:update', async (_e, payload) => {
    try {
      const data = repo.updateSale(payload);
      return { data, error: null };
    } catch (err) {
      return { data: null, error: err.message };
    }
  });

  ipcMain.handle('sales:confirmSale', async (_e, saleId) => {
    try {
      const data = repo.confirmSale(saleId);
      return { data, error: null };
    } catch (err) {
      return { data: null, error: err.message };
    }
  });

  ipcMain.handle('sales:softDelete', async (_e, id) => {
    try {
      const data = repo.softDeleteSale(id);
      return { data, error: null };
    } catch (err) {
      return { data: null, error: err.message };
    }
  });

  ipcMain.handle('sales:getRecentPos', async (_e, payload) => {
    try {
      const data = repo.getRecentPosSales(payload || {});
      return { data, error: null };
    } catch (err) {
      return { data: null, error: err.message };
    }
  });

  ipcMain.handle('sales:getPosSummary', async (_e, payload) => {
    try {
      const data = repo.getPosSummary(payload || {});
      return { data, error: null };
    } catch (err) {
      return { data: null, error: err.message };
    }
  });

  // =========================================================================
  // SELL RETURNS
  // =========================================================================

  ipcMain.handle('sellReturns:getAll', async (_e, filters) => {
    try {
      const data = repo.getSellReturns(filters || {});
      return { data, error: null };
    } catch (err) {
      return { data: null, error: err.message };
    }
  });

  ipcMain.handle('sellReturns:getItems', async (_e, returnId) => {
    try {
      const data = repo.getSellReturnItems(returnId);
      return { data, error: null };
    } catch (err) {
      return { data: null, error: err.message };
    }
  });

  ipcMain.handle('sellReturns:getPriorReturned', async (_e, itemIds) => {
    try {
      const data = repo.getPriorReturnedByItemIds(itemIds || []);
      return { data, error: null };
    } catch (err) {
      return { data: null, error: err.message };
    }
  });

  ipcMain.handle('sellReturns:create', async (_e, payload) => {
    try {
      const data = repo.createSellReturn(payload);
      return { data, error: null };
    } catch (err) {
      return { data: null, error: err.message };
    }
  });

  // =========================================================================
  // SALES DUE
  // =========================================================================

  ipcMain.handle('salesDue:getAll', async (_e, filters) => {
    try {
      const data = repo.getSalesDue(filters || {});
      return { data, error: null };
    } catch (err) {
      return { data: null, error: err.message };
    }
  });

  ipcMain.handle('salesDue:recordPayment', async (_e, payload) => {
    try {
      const data = repo.recordSaleDuePayment(payload);
      return { data, error: null };
    } catch (err) {
      return { data: null, error: err.message };
    }
  });
}

module.exports = { registerSalesHandlers };
