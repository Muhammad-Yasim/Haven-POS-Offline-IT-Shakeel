'use strict';

/**
 * electron/database/repositories/expenses.repo.js
 *
 * Repository for:
 *   - Expenses
 *   - Expense Categories
 *   - Recurring Expense Templates
 */

const { getDb, transaction } = require('../db');
const authRepo = require('./auth.repo');

// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------

function advanceDate(dateStr, frequency) {
  const d = new Date(dateStr + 'T12:00:00Z');
  switch (frequency) {
    case 'daily':
      d.setUTCDate(d.getUTCDate() + 1);
      break;
    case 'weekly':
      d.setUTCDate(d.getUTCDate() + 7);
      break;
    case 'yearly':
      d.setUTCFullYear(d.getUTCFullYear() + 1);
      break;
    case 'monthly':
    default:
      d.setUTCMonth(d.getUTCMonth() + 1);
      break;
  }
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// EXPENSE CATEGORIES
// ---------------------------------------------------------------------------

function getExpenseCategories(businessId = 1) {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM expense_categories
    WHERE business_id = ?
    ORDER BY name COLLATE NOCASE ASC
  `).all(businessId);
}

function createExpenseCategory(payload) {
  const db = getDb();
  const businessId = payload.business_id || payload.businessId || authRepo.getCurrentBusinessId() || 1;
  const name = (typeof payload === 'string' ? payload : payload.name || '').trim();

  if (!name) {
    throw new Error('Category name cannot be empty.');
  }

  try {
    const result = db.prepare(`
      INSERT INTO expense_categories (business_id, name)
      VALUES (?, ?)
    `).run(businessId, name);

    return { id: Number(result.lastInsertRowid), name };
  } catch (err) {
    if (err.message && err.message.includes('UNIQUE')) {
      throw new Error(`Category "${name}" already exists.`);
    }
    throw err;
  }
}

function updateExpenseCategory(payload) {
  const db = getDb();
  const id = Number(payload.id);
  const name = (payload.name || '').trim();

  if (!id) throw new Error('Category ID is required.');
  if (!name) throw new Error('Category name cannot be empty.');

  try {
    db.prepare(`
      UPDATE expense_categories
      SET name = ?
      WHERE id = ?
    `).run(name, id);

    return { success: true };
  } catch (err) {
    if (err.message && err.message.includes('UNIQUE')) {
      throw new Error(`Category "${name}" already exists.`);
    }
    throw err;
  }
}

function deleteExpenseCategory(id) {
  const db = getDb();
  const catId = Number(id);

  // Check FK usages before deletion
  const expUsage = db.prepare(`
    SELECT COUNT(*) AS cnt FROM expenses WHERE category_id = ?
  `).get(catId);

  if (expUsage && expUsage.cnt > 0) {
    throw new Error('Cannot delete — one or more expenses still use this category.');
  }

  const tmplUsage = db.prepare(`
    SELECT COUNT(*) AS cnt FROM recurring_expense_templates WHERE category_id = ?
  `).get(catId);

  if (tmplUsage && tmplUsage.cnt > 0) {
    throw new Error('Cannot delete — one or more recurring templates still use this category.');
  }

  db.prepare(`DELETE FROM expense_categories WHERE id = ?`).run(catId);
  return { success: true };
}

// ---------------------------------------------------------------------------
// EXPENSES
// ---------------------------------------------------------------------------

function getExpenses(filters = {}) {
  const db = getDb();
  const businessId = filters.business_id || filters.businessId || authRepo.getCurrentBusinessId() || 1;
  const { location_id, locationId, scopedLocationIds, register_id, registerId, category_id, categoryId, status } = filters;

  const locId = locationId || location_id;
  const regId = registerId || register_id;
  const catId = categoryId || category_id;

  let sql = `
    SELECT
      e.*,
      ec.name AS category_name,
      l.name  AS location_name,
      u.first_name || ' ' || COALESCE(u.last_name, '') AS user_name
    FROM expenses e
    LEFT JOIN expense_categories ec ON ec.id = e.category_id
    LEFT JOIN locations          l  ON l.id  = e.location_id
    LEFT JOIN users              u  ON u.id  = e.expense_from_user_id
    WHERE e.business_id = ?
  `;
  const params = [businessId];

  if (locId) {
    sql += ` AND e.location_id = ?`;
    params.push(Number(locId));
  } else if (Array.isArray(scopedLocationIds) && scopedLocationIds.length > 0) {
    const placeholders = scopedLocationIds.map(() => '?').join(',');
    sql += ` AND e.location_id IN (${placeholders})`;
    params.push(...scopedLocationIds.map(Number));
  }

  if (regId) {
    sql += ` AND e.register_id = ?`;
    params.push(Number(regId));
  }

  if (catId) {
    sql += ` AND e.category_id = ?`;
    params.push(Number(catId));
  }

  if (status) {
    sql += ` AND e.status = ?`;
    params.push(status);
  }

  sql += ` ORDER BY e.expense_date DESC, e.created_at DESC, e.id DESC`;

  return db.prepare(sql).all(...params);
}

function getExpenseById(id) {
  const db = getDb();
  return db.prepare(`SELECT * FROM expenses WHERE id = ?`).get(Number(id));
}

function createExpense(payload = {}) {
  const db = getDb();
  const businessId = payload.business_id || payload.businessId || authRepo.getCurrentBusinessId() || 1;
  const currentUserId = payload.expense_from_user_id || authRepo.getCurrentUserId();

  const {
    location_id,
    locationId,
    category_id,
    categoryId,
    expense_date,
    amount,
    title,
    note,
    payment_method,
    status = 'paid',
    vendor,
    reference_number,
    register_id,
    registerId,
    recurring_template_id,
  } = payload;

  const locId = Number(locationId || location_id);
  const catId = category_id || categoryId ? Number(category_id || categoryId) : null;
  const regId = register_id || registerId ? Number(register_id || registerId) : null;
  const amt = Number(amount) || 0;
  const expTitle = (title || '').trim() || 'Expense';
  const expDate = expense_date || new Date().toISOString().slice(0, 10);

  const result = db.prepare(`
    INSERT INTO expenses (
      business_id, location_id, register_id, category_id,
      expense_date, expense_from_user_id, amount,
      title, note, payment_method, status, vendor,
      reference_number, recurring_template_id, created_at
    ) VALUES (
      @business_id, @location_id, @register_id, @category_id,
      @expense_date, @expense_from_user_id, @amount,
      @title, @note, @payment_method, @status, @vendor,
      @reference_number, @recurring_template_id, (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    )
  `).run({
    business_id: businessId,
    location_id: locId,
    register_id: regId,
    category_id: catId,
    expense_date: expDate,
    expense_from_user_id: currentUserId || null,
    amount: amt,
    title: expTitle,
    note: note ? note.trim() : null,
    payment_method: payment_method || null,
    status: status || 'paid',
    vendor: vendor ? vendor.trim() : null,
    reference_number: reference_number != null && reference_number !== '' ? Number(reference_number) : null,
    recurring_template_id: recurring_template_id ? Number(recurring_template_id) : null,
  });

  return { id: Number(result.lastInsertRowid) };
}

function updateExpense(idOrPayload, maybePayload) {
  const db = getDb();
  let id;
  let payload;

  if (typeof idOrPayload === 'object' && idOrPayload !== null) {
    id = Number(idOrPayload.id);
    payload = idOrPayload;
  } else {
    id = Number(idOrPayload);
    payload = maybePayload || {};
  }

  if (!id) throw new Error('Expense ID is required.');

  const {
    location_id,
    locationId,
    category_id,
    categoryId,
    expense_date,
    expense_from_user_id,
    amount,
    title,
    note,
    payment_method,
    status,
    vendor,
    reference_number,
    register_id,
    registerId,
  } = payload;

  const locId = locationId || location_id ? Number(locationId || location_id) : undefined;
  const catId = categoryId || category_id ? Number(categoryId || category_id) : undefined;
  const regId = registerId || register_id ? Number(registerId || register_id) : undefined;

  const updates = [];
  const params = { id };

  if (locId !== undefined) {
    updates.push('location_id = @location_id');
    params.location_id = locId;
  }
  if (catId !== undefined) {
    updates.push('category_id = @category_id');
    params.category_id = catId;
  }
  if (expense_date !== undefined) {
    updates.push('expense_date = @expense_date');
    params.expense_date = expense_date;
  }
  if (expense_from_user_id !== undefined) {
    updates.push('expense_from_user_id = @expense_from_user_id');
    params.expense_from_user_id = expense_from_user_id;
  }
  if (amount !== undefined) {
    updates.push('amount = @amount');
    params.amount = Number(amount);
  }
  if (title !== undefined) {
    updates.push('title = @title');
    params.title = title ? title.trim() : 'Expense';
  }
  if (note !== undefined) {
    updates.push('note = @note');
    params.note = note ? note.trim() : null;
  }
  if (payment_method !== undefined) {
    updates.push('payment_method = @payment_method');
    params.payment_method = payment_method || null;
  }
  if (status !== undefined) {
    updates.push('status = @status');
    params.status = status;
  }
  if (vendor !== undefined) {
    updates.push('vendor = @vendor');
    params.vendor = vendor ? vendor.trim() : null;
  }
  if (reference_number !== undefined) {
    updates.push('reference_number = @reference_number');
    params.reference_number = reference_number != null && reference_number !== '' ? Number(reference_number) : null;
  }
  if (regId !== undefined) {
    updates.push('register_id = @register_id');
    params.register_id = regId;
  }

  if (updates.length === 0) return { success: true };

  const sql = `UPDATE expenses SET ${updates.join(', ')} WHERE id = @id`;
  db.prepare(sql).run(params);

  return { success: true };
}

function deleteExpense(id) {
  const db = getDb();
  db.prepare(`DELETE FROM expenses WHERE id = ?`).run(Number(id));
  return { success: true };
}

// ---------------------------------------------------------------------------
// RECURRING EXPENSE TEMPLATES
// ---------------------------------------------------------------------------

function getRecurringTemplates(businessId = 1) {
  const db = getDb();
  return db.prepare(`
    SELECT
      t.*,
      ec.name AS category_name,
      l.name  AS location_name
    FROM recurring_expense_templates t
    LEFT JOIN expense_categories ec ON ec.id = t.category_id
    LEFT JOIN locations          l  ON l.id  = t.location_id
    WHERE t.business_id = ?
    ORDER BY t.next_due_date ASC, t.id ASC
  `).all(businessId);
}

function getRecurringTemplateById(id) {
  const db = getDb();
  return db.prepare(`SELECT * FROM recurring_expense_templates WHERE id = ?`).get(Number(id));
}

function createRecurringTemplate(payload = {}) {
  const db = getDb();
  const businessId = payload.business_id || payload.businessId || authRepo.getCurrentBusinessId() || 1;

  const {
    location_id,
    locationId,
    category_id,
    categoryId,
    amount,
    frequency = 'monthly',
    next_due_date,
    is_active = 1,
  } = payload;

  const locId = Number(locationId || location_id);
  const catId = Number(categoryId || category_id);
  const amt = Number(amount) || 0;
  const active = is_active ? 1 : 0;

  const result = db.prepare(`
    INSERT INTO recurring_expense_templates (
      business_id, location_id, category_id, amount,
      frequency, next_due_date, is_active, created_at
    ) VALUES (
      ?, ?, ?, ?,
      ?, ?, ?, (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    )
  `).run(businessId, locId, catId, amt, frequency, next_due_date, active);

  return { id: Number(result.lastInsertRowid) };
}

function updateRecurringTemplate(idOrPayload, maybePayload) {
  const db = getDb();
  let id;
  let payload;

  if (typeof idOrPayload === 'object' && idOrPayload !== null) {
    id = Number(idOrPayload.id);
    payload = idOrPayload;
  } else {
    id = Number(idOrPayload);
    payload = maybePayload || {};
  }

  if (!id) throw new Error('Template ID is required.');

  const {
    location_id,
    locationId,
    category_id,
    categoryId,
    amount,
    frequency,
    next_due_date,
    is_active,
  } = payload;

  const locId = locationId || location_id ? Number(locationId || location_id) : undefined;
  const catId = categoryId || category_id ? Number(categoryId || category_id) : undefined;

  const updates = [];
  const params = { id };

  if (locId !== undefined) {
    updates.push('location_id = @location_id');
    params.location_id = locId;
  }
  if (catId !== undefined) {
    updates.push('category_id = @category_id');
    params.category_id = catId;
  }
  if (amount !== undefined) {
    updates.push('amount = @amount');
    params.amount = Number(amount);
  }
  if (frequency !== undefined) {
    updates.push('frequency = @frequency');
    params.frequency = frequency;
  }
  if (next_due_date !== undefined) {
    updates.push('next_due_date = @next_due_date');
    params.next_due_date = next_due_date;
  }
  if (is_active !== undefined) {
    updates.push('is_active = @is_active');
    params.is_active = is_active ? 1 : 0;
  }

  if (updates.length === 0) return { success: true };

  const sql = `UPDATE recurring_expense_templates SET ${updates.join(', ')} WHERE id = @id`;
  db.prepare(sql).run(params);

  return { success: true };
}

function deleteRecurringTemplate(id) {
  const db = getDb();
  db.prepare(`DELETE FROM recurring_expense_templates WHERE id = ?`).run(Number(id));
  return { success: true };
}

function toggleRecurringActive(id) {
  const db = getDb();
  db.prepare(`
    UPDATE recurring_expense_templates
    SET is_active = CASE WHEN is_active = 1 THEN 0 ELSE 1 END
    WHERE id = ?
  `).run(Number(id));

  return { success: true };
}

function runRecurringNow(id) {
  const db = getDb();
  const templateId = Number(id);

  const template = db.prepare(`
    SELECT * FROM recurring_expense_templates WHERE id = ?
  `).get(templateId);

  if (!template) {
    throw new Error('Recurring template not found.');
  }

  const category = db.prepare(`
    SELECT name FROM expense_categories WHERE id = ?
  `).get(template.category_id);

  const title = category?.name ? `${category.name} (recurring)` : 'Recurring expense';
  const nextDate = advanceDate(template.next_due_date, template.frequency);

  return transaction(() => {
    const expResult = db.prepare(`
      INSERT INTO expenses (
        business_id, location_id, category_id, expense_date,
        amount, title, note, recurring_template_id, status, created_at
      ) VALUES (
        ?, ?, ?, ?,
        ?, ?, 'Generated from recurring template', ?, 'pending',
        (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      )
    `).run(
      template.business_id,
      template.location_id,
      template.category_id,
      template.next_due_date,
      template.amount,
      title,
      templateId
    );

    db.prepare(`
      UPDATE recurring_expense_templates
      SET next_due_date = ?
      WHERE id = ?
    `).run(nextDate, templateId);

    return { success: true, expenseId: Number(expResult.lastInsertRowid), nextDueDate: nextDate };
  });
}

module.exports = {
  // Categories
  getExpenseCategories,
  createExpenseCategory,
  updateExpenseCategory,
  deleteExpenseCategory,

  // Expenses
  getExpenses,
  getExpenseById,
  createExpense,
  updateExpense,
  deleteExpense,

  // Recurring templates
  getRecurringTemplates,
  getRecurringTemplateById,
  createRecurringTemplate,
  updateRecurringTemplate,
  deleteRecurringTemplate,
  toggleRecurringActive,
  runRecurringNow,
};
