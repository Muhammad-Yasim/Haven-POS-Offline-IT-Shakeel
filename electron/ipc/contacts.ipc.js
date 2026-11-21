'use strict';

/**
 * electron/ipc/contacts.ipc.js
 *
 * Registers IPC handlers for Contacts and Contact Ledger.
 */

const { ipcMain } = require('electron');
const contactsRepo = require('../database/repositories/contacts.repo');

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

function registerContactHandlers() {
  handle('contacts:getAll', (filters) => contactsRepo.getContacts(filters));
  handle('contacts:getById', (id) => contactsRepo.getContactById(id));
  handle('contacts:create', (payload) => contactsRepo.createContact(payload));
  handle('contacts:update', ({ id, ...payload }) => contactsRepo.updateContact(id, payload));
  handle('contacts:softDelete', (id) => contactsRepo.softDeleteContact(id));
  handle('contacts:delete', (id) => contactsRepo.deleteContact(id));
  handle('contacts:getLedger', (id) => contactsRepo.getContactLedger(id));
  handle('contacts:recordPayment', (payload) => contactsRepo.recordPayment(payload));
}

module.exports = { registerContactHandlers };
