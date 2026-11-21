'use strict';

/**
 * electron/ipc/registers.ipc.js
 *
 * IPC handlers for Register sessions.
 */

const { ipcMain } = require('electron');
const repo = require('../database/repositories/registers.repo');
const authRepo = require('../database/repositories/auth.repo');

function registerRegisterHandlers() {

  ipcMain.handle('registers:getOpen', async (_e, payload) => {
    try {
      const business_id = payload?.business_id || authRepo.getCurrentBusinessId() || 1;
      const user_id = payload?.user_id || authRepo.getCurrentUserId();
      const data = repo.getOpenRegister({ business_id, user_id });
      return { data, error: null };
    } catch (err) {
      return { data: null, error: err.message };
    }
  });

  ipcMain.handle('registers:open', async (_e, payload) => {
    try {
      const business_id = payload?.business_id || authRepo.getCurrentBusinessId() || 1;
      const user_id = payload?.user_id || authRepo.getCurrentUserId();
      const data = repo.openRegister({ ...payload, business_id, user_id });
      return { data, error: null };
    } catch (err) {
      return { data: null, error: err.message };
    }
  });

  ipcMain.handle('registers:close', async (_e, payload) => {
    try {
      const data = repo.closeRegister(payload || {});
      return { data, error: null };
    } catch (err) {
      return { data: null, error: err.message };
    }
  });

  ipcMain.handle('registers:getById', async (_e, id) => {
    try {
      const data = repo.getRegisterById(id);
      return { data, error: null };
    } catch (err) {
      return { data: null, error: err.message };
    }
  });

  ipcMain.handle('registers:getSummary', async (_e, registerId) => {
    try {
      const data = repo.getRegisterSummary(registerId);
      return { data, error: null };
    } catch (err) {
      return { data: null, error: err.message };
    }
  });

  ipcMain.handle('registers:getAll', async (_e, filters) => {
    try {
      const data = repo.getAllRegisters(filters || {});
      return { data, error: null };
    } catch (err) {
      return { data: null, error: err.message };
    }
  });
}

module.exports = { registerRegisterHandlers };
