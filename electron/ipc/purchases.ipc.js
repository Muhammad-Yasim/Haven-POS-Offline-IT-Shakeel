'use strict';

/**
 * electron/ipc/purchases.ipc.js
 *
 * IPC handlers for Purchases, Purchase Returns, and Purchase Due.
 * Maps incoming IPC calls to purchases.repo.js functions.
 * All handlers return { data, error } standard envelopes.
 */

const { ipcMain } = require('electron');
const purchasesRepo = require('../database/repositories/purchases.repo');

function registerPurchaseHandlers() {
  // ── Purchases ─────────────────────────────────────────────────────────────
  ipcMain.handle('purchases:getAll', async (_event, filters = {}) => {
    try {
      const data = purchasesRepo.getPurchases(filters);
      return { data, error: null };
    } catch (err) {
      console.error('[purchases:getAll]', err);
      return { data: null, error: err.message };
    }
  });

  ipcMain.handle('purchases:getById', async (_event, id) => {
    try {
      const data = purchasesRepo.getPurchaseById(id);
      return { data, error: null };
    } catch (err) {
      console.error('[purchases:getById]', err);
      return { data: null, error: err.message };
    }
  });

  ipcMain.handle('purchases:getItems', async (_event, purchaseId) => {
    try {
      const data = purchasesRepo.getPurchaseItems(purchaseId);
      return { data, error: null };
    } catch (err) {
      console.error('[purchases:getItems]', err);
      return { data: null, error: err.message };
    }
  });

  ipcMain.handle('purchases:getStockByLocation', async (_event, payload) => {
    try {
      const data = purchasesRepo.getStockByLocation(payload);
      return { data, error: null };
    } catch (err) {
      console.error('[purchases:getStockByLocation]', err);
      return { data: null, error: err.message };
    }
  });

  ipcMain.handle('purchases:create', async (_event, payload) => {
    try {
      const data = purchasesRepo.createPurchase(payload);
      return { data, error: null };
    } catch (err) {
      console.error('[purchases:create]', err);
      return { data: null, error: err.message };
    }
  });

  ipcMain.handle('purchases:update', async (_event, { id, ...payload }) => {
    try {
      const data = purchasesRepo.updatePurchase(id, payload);
      return { data, error: null };
    } catch (err) {
      console.error('[purchases:update]', err);
      return { data: null, error: err.message };
    }
  });

  ipcMain.handle('purchases:markReceived', async (_event, id) => {
    try {
      const data = purchasesRepo.markReceived(id);
      return { data, error: null };
    } catch (err) {
      console.error('[purchases:markReceived]', err);
      return { data: null, error: err.message };
    }
  });

  ipcMain.handle('purchases:softDelete', async (_event, id) => {
    try {
      const data = purchasesRepo.softDeletePurchase(id);
      return { data, error: null };
    } catch (err) {
      console.error('[purchases:softDelete]', err);
      return { data: null, error: err.message };
    }
  });

  // ── Purchase Returns ───────────────────────────────────────────────────────
  ipcMain.handle('purchaseReturns:getAll', async (_event, filters = {}) => {
    try {
      const data = purchasesRepo.getPurchaseReturns(filters);
      return { data, error: null };
    } catch (err) {
      console.error('[purchaseReturns:getAll]', err);
      return { data: null, error: err.message };
    }
  });

  ipcMain.handle('purchaseReturns:getItems', async (_event, returnId) => {
    try {
      const data = purchasesRepo.getPurchaseReturnItems(returnId);
      return { data, error: null };
    } catch (err) {
      console.error('[purchaseReturns:getItems]', err);
      return { data: null, error: err.message };
    }
  });

  ipcMain.handle('purchaseReturns:getPriorReturned', async (_event, itemIds) => {
    try {
      const data = purchasesRepo.getPriorReturnedByItemIds(itemIds);
      return { data, error: null };
    } catch (err) {
      console.error('[purchaseReturns:getPriorReturned]', err);
      return { data: null, error: err.message };
    }
  });

  ipcMain.handle('purchaseReturns:create', async (_event, payload) => {
    try {
      const data = purchasesRepo.createPurchaseReturn(payload);
      return { data, error: null };
    } catch (err) {
      console.error('[purchaseReturns:create]', err);
      return { data: null, error: err.message };
    }
  });

  // ── Purchase Due ───────────────────────────────────────────────────────────
  ipcMain.handle('purchaseDue:getAll', async (_event, filters = {}) => {
    try {
      const data = purchasesRepo.getPurchaseDue(filters);
      return { data, error: null };
    } catch (err) {
      console.error('[purchaseDue:getAll]', err);
      return { data: null, error: err.message };
    }
  });

  ipcMain.handle('purchaseDue:recordPayment', async (_event, payload) => {
    try {
      const data = purchasesRepo.recordPurchaseDuePayment(payload);
      return { data, error: null };
    } catch (err) {
      console.error('[purchaseDue:recordPayment]', err);
      return { data: null, error: err.message };
    }
  });
}

module.exports = { registerPurchaseHandlers };
