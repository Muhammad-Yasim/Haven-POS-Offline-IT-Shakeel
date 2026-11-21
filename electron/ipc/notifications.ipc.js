'use strict';

/**
 * electron/ipc/notifications.ipc.js
 *
 * IPC handlers for notifications.
 */

const { ipcMain } = require('electron');
const repo = require('../database/repositories/notifications.repo');
const authRepo = require('../database/repositories/auth.repo');

function registerNotifHandlers() {
  ipcMain.handle('notifications:getAll', async () => {
    try {
      const businessId = authRepo.getCurrentBusinessId() || 1;
      const data = repo.getNotifications(businessId);
      return { data, error: null };
    } catch (err) {
      return { data: null, error: err.message };
    }
  });

  ipcMain.handle('notifications:markRead', async (_e, id) => {
    try {
      const data = repo.markRead(id);
      return { data, error: null };
    } catch (err) {
      return { data: null, error: err.message };
    }
  });

  ipcMain.handle('notifications:markAllRead', async () => {
    try {
      const businessId = authRepo.getCurrentBusinessId() || 1;
      const data = repo.markAllRead(businessId);
      return { data, error: null };
    } catch (err) {
      return { data: null, error: err.message };
    }
  });

  ipcMain.handle('notifications:create', async (_e, payload) => {
    try {
      const businessId = payload?.business_id || payload?.businessId || authRepo.getCurrentBusinessId() || 1;
      const data = repo.createNotification({ ...payload, business_id: businessId });
      return { data, error: null };
    } catch (err) {
      return { data: null, error: err.message };
    }
  });
}

module.exports = { registerNotifHandlers };
