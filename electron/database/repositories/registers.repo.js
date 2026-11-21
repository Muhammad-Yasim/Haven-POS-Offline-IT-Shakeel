'use strict';

/**
 * electron/database/repositories/registers.repo.js
 *
 * Repository for POS Registers and Cash Drawer sessions.
 */

const { getDb, transaction } = require('../db');

function getOpenRegister({ business_id, user_id }) {
  const db = getDb();
  const row = db.prepare(`
    SELECT * FROM registers
    WHERE business_id = @business_id
      AND user_id     = @user_id
      AND status      = 'open'
    ORDER BY opened_at DESC
    LIMIT 1
  `).get({ business_id, user_id });

  return row || null;
}

function openRegister({ business_id, location_id, user_id, opening_cash = 0 }) {
  const db = getDb();

  return transaction(() => {
    // Check if user already has an open register
    const existing = db.prepare(`
      SELECT * FROM registers
      WHERE business_id = @business_id AND user_id = @user_id AND status = 'open'
      LIMIT 1
    `).get({ business_id, user_id });

    if (existing) {
      return existing;
    }

    const result = db.prepare(`
      INSERT INTO registers (
        business_id, location_id, user_id, opening_cash, status, opened_at
      ) VALUES (
        @business_id, @location_id, @user_id, @opening_cash, 'open', datetime('now')
      )
    `).run({
      business_id,
      location_id,
      user_id,
      opening_cash: Number(opening_cash) || 0,
    });

    return db.prepare(`SELECT * FROM registers WHERE id = ?`).get(result.lastInsertRowid);
  });
}

function closeRegister({ id, closing_cash = 0 }) {
  const db = getDb();

  return transaction(() => {
    db.prepare(`
      UPDATE registers
      SET closing_cash = @closing_cash,
          status       = 'closed',
          closed_at    = datetime('now')
      WHERE id = @id
    `).run({
      id,
      closing_cash: Number(closing_cash) || 0,
    });

    return db.prepare(`SELECT * FROM registers WHERE id = ?`).get(id);
  });
}

function getRegisterById(id) {
  const db = getDb();
  return db.prepare(`SELECT * FROM registers WHERE id = ?`).get(id) || null;
}

function getAllRegisters(filters = {}) {
  const db = getDb();
  const { business_id, location_id, status } = filters;

  let sql = `
    SELECT r.*, l.name AS location_name, u.first_name, u.last_name, u.username
    FROM   registers r
    LEFT JOIN locations l ON l.id = r.location_id
    LEFT JOIN users     u ON u.id = r.user_id
    WHERE  1=1
  `;
  const params = {};

  if (business_id) {
    sql += ` AND r.business_id = @business_id`;
    params.business_id = business_id;
  }
  if (location_id) {
    sql += ` AND r.location_id = @location_id`;
    params.location_id = location_id;
  }
  if (status) {
    sql += ` AND r.status = @status`;
    params.status = status;
  }

  sql += ` ORDER BY r.opened_at DESC`;

  const rows = db.prepare(sql).all(params);
  return rows.map((r) => ({
    ...r,
    locations: { name: r.location_name || '—' },
    users: { first_name: r.first_name || '', last_name: r.last_name || '', username: r.username || '' },
  }));
}

function getRegisterSummary(registerId) {
  const db = getDb();

  const register = db.prepare(`
    SELECT r.*, l.name AS location_name, u.first_name, u.last_name
    FROM registers r
    LEFT JOIN locations l ON l.id = r.location_id
    LEFT JOIN users u ON u.id = r.user_id
    WHERE r.id = ?
  `).get(registerId);
  if (!register) return null;

  register.locations = { name: register.location_name || '—' };
  register.users = { first_name: register.first_name || '', last_name: register.last_name || '' };

  const sales = db.prepare(`
    SELECT * FROM sales WHERE register_id = ?
  `).all(registerId);

  const sellReturns = db.prepare(`
    SELECT * FROM sell_returns WHERE register_id = ?
  `).all(registerId);

  const expenses = db.prepare(`
    SELECT * FROM expenses WHERE register_id = ?
  `).all(registerId);

  const saleItems = db.prepare(`
    SELECT si.*, p.name AS product_name, p.sku
    FROM   sale_items si
    JOIN   sales s ON s.id = si.sale_id
    LEFT JOIN products p ON p.id = si.product_id
    WHERE  s.register_id = ?
  `).all(registerId);

  const formattedSaleItems = saleItems.map((it) => ({
    ...it,
    products: { name: it.product_name, sku: it.sku },
  }));

  return {
    register,
    sales,
    sellReturns,
    expenses,
    saleItems: formattedSaleItems,
  };
}

module.exports = {
  getOpenRegister,
  openRegister,
  closeRegister,
  getRegisterById,
  getAllRegisters,
  getRegisterSummary,
};
