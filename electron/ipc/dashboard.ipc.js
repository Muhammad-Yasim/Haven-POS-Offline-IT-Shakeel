'use strict';

/**
 * electron/ipc/dashboard.ipc.js
 *
 * IPC handlers for dashboard data.
 */

const { ipcMain } = require('electron');
const repo = require('../database/repositories/dashboard.repo');

function registerDashboardHandlers() {
  ipcMain.handle('dashboard:getMetrics', async (_e, filters) => {
    try {
      const data = repo.getDashboardMetrics(filters || {});
      return { data, error: null };
    } catch (err) {
      return { data: null, error: err.message };
    }
  });

  ipcMain.handle('dashboard:getGraph', async (_e, filters) => {
    try {
      const data = repo.getDashboardGraph(filters || {});
      return { data, error: null };
    } catch (err) {
      return { data: null, error: err.message };
    }
  });

  ipcMain.handle('dashboard:getLowerSections', async (_e, filters) => {
    try {
      const data = repo.getDashboardLowerSections(filters || {});
      return { data, error: null };
    } catch (err) {
      return { data: null, error: err.message };
    }
  });
}

module.exports = { registerDashboardHandlers };
