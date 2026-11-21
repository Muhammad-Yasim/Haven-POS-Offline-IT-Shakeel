'use strict';

/**
 * electron/ipc/settings.ipc.js
 *
 * IPC handlers for:
 *   - business:get / business:update
 *   - locations:getAll / getById / create / update / toggleActive
 *   - settings:getInvoiceSettings / saveInvoiceSettings
 *   - settings:getUserPrefs / saveUserPrefs
 */

const { ipcMain } = require('electron');
const repo = require('../database/repositories/settings.repo');

function registerSettingsHandlers() {

  // =========================================================================
  // BUSINESS
  // =========================================================================

  ipcMain.handle('business:get', async () => {
    try {
      const data = repo.getBusiness();
      return { data, error: null };
    } catch (err) {
      return { data: null, error: err.message };
    }
  });

  ipcMain.handle('business:update', async (_e, payload) => {
    try {
      repo.updateBusiness(payload || {});
      return { data: true, error: null };
    } catch (err) {
      return { data: null, error: err.message };
    }
  });

  // =========================================================================
  // LOCATIONS
  // =========================================================================

  ipcMain.handle('locations:getAll', async () => {
    try {
      const data = repo.getAllLocations();
      return { data, error: null };
    } catch (err) {
      return { data: null, error: err.message };
    }
  });

  ipcMain.handle('locations:getById', async (_e, id) => {
    try {
      const data = repo.getLocationById(id);
      return { data, error: null };
    } catch (err) {
      return { data: null, error: err.message };
    }
  });

  ipcMain.handle('locations:create', async (_e, payload) => {
    try {
      const data = repo.createLocation(payload || {});
      return { data, error: null };
    } catch (err) {
      return { data: null, error: err.message };
    }
  });

  ipcMain.handle('locations:update', async (_e, payload) => {
    try {
      repo.updateLocation(payload || {});
      return { data: true, error: null };
    } catch (err) {
      return { data: null, error: err.message };
    }
  });

  ipcMain.handle('locations:toggleActive', async (_e, id) => {
    try {
      repo.toggleLocationActive(id);
      return { data: true, error: null };
    } catch (err) {
      return { data: null, error: err.message };
    }
  });

  // =========================================================================
  // INVOICE / RECEIPT SETTINGS
  // =========================================================================

  ipcMain.handle('settings:getInvoiceSettings', async () => {
    try {
      const data = repo.getInvoiceSettings();
      return { data, error: null };
    } catch (err) {
      return { data: null, error: err.message };
    }
  });

  ipcMain.handle('settings:saveInvoiceSettings', async (_e, payload) => {
    try {
      repo.saveInvoiceSettings(payload || {});
      return { data: true, error: null };
    } catch (err) {
      return { data: null, error: err.message };
    }
  });

  // =========================================================================
  // USER PREFERENCES
  // =========================================================================

  ipcMain.handle('settings:getUserPrefs', async () => {
    try {
      const data = repo.getUserPrefs();
      return { data, error: null };
    } catch (err) {
      return { data: null, error: err.message };
    }
  });

  ipcMain.handle('settings:saveUserPrefs', async (_e, payload) => {
    try {
      repo.saveUserPrefs(payload || {});
      return { data: true, error: null };
    } catch (err) {
      return { data: null, error: err.message };
    }
  });

  // =========================================================================
  // SYSTEM / DEVICE INFO
  // =========================================================================

  ipcMain.handle('system:getDeviceInfo', async () => {
    try {
      const { app } = require('electron');
      const { getSystemDeviceId, checkDeviceAuth } = require('../deviceAuth');
      const auth = checkDeviceAuth();
      const os = require('os');

      return {
        data: {
          deviceId: auth.systemDeviceId,
          isAuthorized: auth.authorized,
          isDevBypass: !!auth.isDevBypass,
          appVersion: app.getVersion(),
          platform: process.platform === 'win32' ? 'Windows' : process.platform === 'darwin' ? 'macOS' : 'Linux',
          arch: process.arch,
          hostname: os.hostname(),
        },
        error: null,
      };
    } catch (err) {
      return { data: null, error: err.message };
    }
  });
}

module.exports = { registerSettingsHandlers };
