'use strict';

/**
 * electron/ipc/expenses.ipc.js
 *
 * IPC handlers for Expenses, Expense Categories & Recurring Expense Templates.
 */

const { ipcMain } = require('electron');
const repo = require('../database/repositories/expenses.repo');
const authRepo = require('../database/repositories/auth.repo');

function registerExpenseHandlers() {

  // =========================================================================
  // EXPENSE CATEGORIES
  // =========================================================================

  ipcMain.handle('expenseCategories:getAll', async () => {
    try {
      const businessId = authRepo.getCurrentBusinessId() || 1;
      const data = repo.getExpenseCategories(businessId);
      return { data, error: null };
    } catch (err) {
      return { data: null, error: err.message };
    }
  });

  ipcMain.handle('expenseCategories:create', async (_e, payload) => {
    try {
      const businessId = payload?.business_id || payload?.businessId || authRepo.getCurrentBusinessId() || 1;
      const data = repo.createExpenseCategory({ ...payload, business_id: businessId });
      return { data, error: null };
    } catch (err) {
      return { data: null, error: err.message };
    }
  });

  ipcMain.handle('expenseCategories:update', async (_e, payload) => {
    try {
      const data = repo.updateExpenseCategory(payload);
      return { data, error: null };
    } catch (err) {
      return { data: null, error: err.message };
    }
  });

  ipcMain.handle('expenseCategories:delete', async (_e, id) => {
    try {
      const data = repo.deleteExpenseCategory(id);
      return { data, error: null };
    } catch (err) {
      return { data: null, error: err.message };
    }
  });

  // =========================================================================
  // EXPENSES
  // =========================================================================

  ipcMain.handle('expenses:getAll', async (_e, filters) => {
    try {
      const businessId = filters?.business_id || filters?.businessId || authRepo.getCurrentBusinessId() || 1;
      const data = repo.getExpenses({ ...filters, business_id: businessId });
      return { data, error: null };
    } catch (err) {
      return { data: null, error: err.message };
    }
  });

  ipcMain.handle('expenses:getById', async (_e, id) => {
    try {
      const data = repo.getExpenseById(id);
      return { data, error: null };
    } catch (err) {
      return { data: null, error: err.message };
    }
  });

  ipcMain.handle('expenses:create', async (_e, payload) => {
    try {
      const businessId = payload?.business_id || payload?.businessId || authRepo.getCurrentBusinessId() || 1;
      const data = repo.createExpense({ ...payload, business_id: businessId });
      return { data, error: null };
    } catch (err) {
      return { data: null, error: err.message };
    }
  });

  ipcMain.handle('expenses:update', async (_e, payload) => {
    try {
      const data = repo.updateExpense(payload);
      return { data, error: null };
    } catch (err) {
      return { data: null, error: err.message };
    }
  });

  ipcMain.handle('expenses:delete', async (_e, id) => {
    try {
      const data = repo.deleteExpense(id);
      return { data, error: null };
    } catch (err) {
      return { data: null, error: err.message };
    }
  });

  // =========================================================================
  // RECURRING EXPENSE TEMPLATES
  // =========================================================================

  ipcMain.handle('recurringExpenses:getAll', async () => {
    try {
      const businessId = authRepo.getCurrentBusinessId() || 1;
      const data = repo.getRecurringTemplates(businessId);
      return { data, error: null };
    } catch (err) {
      return { data: null, error: err.message };
    }
  });

  ipcMain.handle('recurringExpenses:getById', async (_e, id) => {
    try {
      const data = repo.getRecurringTemplateById(id);
      return { data, error: null };
    } catch (err) {
      return { data: null, error: err.message };
    }
  });

  ipcMain.handle('recurringExpenses:create', async (_e, payload) => {
    try {
      const businessId = payload?.business_id || payload?.businessId || authRepo.getCurrentBusinessId() || 1;
      const data = repo.createRecurringTemplate({ ...payload, business_id: businessId });
      return { data, error: null };
    } catch (err) {
      return { data: null, error: err.message };
    }
  });

  ipcMain.handle('recurringExpenses:update', async (_e, payload) => {
    try {
      const data = repo.updateRecurringTemplate(payload);
      return { data, error: null };
    } catch (err) {
      return { data: null, error: err.message };
    }
  });

  ipcMain.handle('recurringExpenses:delete', async (_e, id) => {
    try {
      const data = repo.deleteRecurringTemplate(id);
      return { data, error: null };
    } catch (err) {
      return { data: null, error: err.message };
    }
  });

  ipcMain.handle('recurringExpenses:toggleActive', async (_e, id) => {
    try {
      const data = repo.toggleRecurringActive(id);
      return { data, error: null };
    } catch (err) {
      return { data: null, error: err.message };
    }
  });

  ipcMain.handle('recurringExpenses:runNow', async (_e, id) => {
    try {
      const data = repo.runRecurringNow(id);
      return { data, error: null };
    } catch (err) {
      return { data: null, error: err.message };
    }
  });
}

module.exports = { registerExpenseHandlers };
