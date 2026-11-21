'use strict';

/**
 * electron/ipc/reports.ipc.js
 *
 * IPC handlers for all Report datasets.
 */

const { ipcMain } = require('electron');
const repo = require('../database/repositories/reports.repo');
const authRepo = require('../database/repositories/auth.repo');

function registerReportHandlers() {

  ipcMain.handle('reports:getSalesSummary', async (_e, filters) => {
    try {
      const businessId = filters?.business_id || filters?.businessId || authRepo.getCurrentBusinessId() || 1;
      const data = repo.getSalesSummary({ ...filters, businessId });
      return { data, error: null };
    } catch (err) {
      return { data: null, error: err.message };
    }
  });

  ipcMain.handle('reports:getProfitLoss', async (_e, filters) => {
    try {
      const businessId = filters?.business_id || filters?.businessId || authRepo.getCurrentBusinessId() || 1;
      const data = repo.getProfitLoss({ ...filters, businessId });
      return { data, error: null };
    } catch (err) {
      return { data: null, error: err.message };
    }
  });

  ipcMain.handle('reports:getStockReport', async (_e, filters) => {
    try {
      const businessId = filters?.business_id || filters?.businessId || authRepo.getCurrentBusinessId() || 1;
      const data = repo.getStockReport({ ...filters, businessId });
      return { data, error: null };
    } catch (err) {
      return { data: null, error: err.message };
    }
  });

  ipcMain.handle('reports:getStockHistory', async (_e, payload) => {
    try {
      const data = repo.getStockHistory(payload || {});
      return { data, error: null };
    } catch (err) {
      return { data: null, error: err.message };
    }
  });

  ipcMain.handle('reports:getCustomers', async (_e, filters) => {
    try {
      const businessId = filters?.business_id || filters?.businessId || authRepo.getCurrentBusinessId() || 1;
      const data = repo.getCustomers({ ...filters, businessId });
      return { data, error: null };
    } catch (err) {
      return { data: null, error: err.message };
    }
  });

  ipcMain.handle('reports:getSuppliers', async (_e, filters) => {
    try {
      const businessId = filters?.business_id || filters?.businessId || authRepo.getCurrentBusinessId() || 1;
      const data = repo.getSuppliers({ ...filters, businessId });
      return { data, error: null };
    } catch (err) {
      return { data: null, error: err.message };
    }
  });

  ipcMain.handle('reports:getExpenses', async (_e, filters) => {
    try {
      const businessId = filters?.business_id || filters?.businessId || authRepo.getCurrentBusinessId() || 1;
      const data = repo.getExpensesReport({ ...filters, businessId });
      return { data, error: null };
    } catch (err) {
      return { data: null, error: err.message };
    }
  });

  ipcMain.handle('reports:getUserActivity', async (_e, filters) => {
    try {
      const businessId = filters?.business_id || filters?.businessId || authRepo.getCurrentBusinessId() || 1;
      const data = repo.getUserActivity({ ...filters, businessId });
      return { data, error: null };
    } catch (err) {
      return { data: null, error: err.message };
    }
  });

  ipcMain.handle('reports:getDailyItems', async (_e, filters) => {
    try {
      const businessId = filters?.business_id || filters?.businessId || authRepo.getCurrentBusinessId() || 1;
      const data = repo.getDailyItems({ ...filters, businessId });
      return { data, error: null };
    } catch (err) {
      return { data: null, error: err.message };
    }
  });
}

module.exports = { registerReportHandlers };
