'use strict';

/**
 * electron/database/repositories/notifications.repo.js
 *
 * Repository for user notifications (low stock, invoice due, etc.).
 */

const { getDb } = require('../db');

function getNotifications(businessId = 1) {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM notifications
    WHERE business_id = ?
    ORDER BY is_read ASC, created_at DESC
    LIMIT 50
  `).all(businessId);
}

function markRead(id) {
  const db = getDb();
  db.prepare(`
    UPDATE notifications
    SET is_read = 1
    WHERE id = ?
  `).run(Number(id));
  return { success: true };
}

function markAllRead(businessId = 1) {
  const db = getDb();
  db.prepare(`
    UPDATE notifications
    SET is_read = 1
    WHERE business_id = ? AND is_read = 0
  `).run(businessId);
  return { success: true };
}

function createNotification(payload) {
  const db = getDb();
  const {
    business_id = 1,
    type,
    message,
    related_reference_type = null,
    related_reference_id = null,
  } = payload;

  const result = db.prepare(`
    INSERT INTO notifications (
      business_id, type, message, related_reference_type, related_reference_id
    ) VALUES (?, ?, ?, ?, ?)
  `).run(
    business_id,
    type,
    message,
    related_reference_type || null,
    related_reference_id != null ? Number(related_reference_id) : null
  );

  return { id: Number(result.lastInsertRowid) };
}

function notifyOnce({
  businessId = 1,
  type,
  message,
  referenceType = null,
  referenceId = null,
}) {
  const db = getDb();
  let sql = `
    SELECT id FROM notifications
    WHERE business_id = ? AND type = ? AND is_read = 0
  `;
  const params = [businessId, type];

  if (referenceType) {
    sql += ` AND related_reference_type = ?`;
    params.push(referenceType);
  }
  if (referenceId != null) {
    sql += ` AND related_reference_id = ?`;
    params.push(Number(referenceId));
  }

  sql += ` LIMIT 1`;

  const existing = db.prepare(sql).get(...params);
  if (existing) return;

  createNotification({
    business_id: businessId,
    type,
    message,
    related_reference_type: referenceType,
    related_reference_id: referenceId,
  });
}

function checkLowStockDirect({
  businessId = 1,
  productId,
  productName,
  locationName,
  newQty,
  alertQuantity,
}) {
  if (alertQuantity == null || newQty > Number(alertQuantity)) return;

  notifyOnce({
    businessId,
    type: 'low_stock',
    message: `${productName} is low${locationName ? ` at ${locationName}` : ''} — ${newQty} left (alert at ${alertQuantity}).`,
    referenceType: 'product',
    referenceId: productId,
  });
}

module.exports = {
  getNotifications,
  markRead,
  markAllRead,
  createNotification,
  notifyOnce,
  checkLowStockDirect,
};
