'use strict';

/**
 * electron/database/repositories/contacts.repo.js
 *
 * Repository for Contacts (Customers & Suppliers) and Contact Ledger.
 * Uses Node.js built-in `node:sqlite`.
 */

const { getDb, transaction } = require('../db');
const authRepo = require('./auth.repo');

/**
 * Get contacts with calculated balance.
 * Balance = opening_balance + SUM(contact_ledger.amount WHERE reference_type != 'opening_balance')
 */
function getContacts(params = {}) {
  const db = getDb();
  const businessId = params.businessId || authRepo.getCurrentBusinessId() || 1;

  let whereClauses = ['c.business_id = ?'];
  let sqlParams = [businessId];

  // Active / soft-delete
  if (params.includeInactive) {
    // include both
  } else {
    whereClauses.push('c.is_active = 1');
  }

  // Contact Type (customer / supplier)
  if (params.contact_type) {
    whereClauses.push('c.contact_type = ?');
    sqlParams.push(params.contact_type);
  }

  // Location filter
  if (params.location_id) {
    whereClauses.push('(c.location_id = ? OR c.location_id IS NULL)');
    sqlParams.push(Number(params.location_id));
  }

  // Free-text search
  if (params.search && params.search.trim()) {
    const q = `%${params.search.trim()}%`;
    whereClauses.push('(c.name LIKE ? OR c.contact_number LIKE ? OR c.business_name LIKE ?)');
    sqlParams.push(q, q, q);
  }

  const whereSql = whereClauses.join(' AND ');

  const query = `
    SELECT
      c.*,
      l.name AS location_name,
      (
        c.opening_balance + COALESCE((
          SELECT SUM(cl.amount)
          FROM contact_ledger cl
          WHERE cl.contact_id = c.id
            AND cl.business_id = c.business_id
            AND cl.reference_type != 'opening_balance'
        ), 0)
      ) AS balance
    FROM contacts c
    LEFT JOIN locations l ON l.id = c.location_id
    WHERE ${whereSql}
    ORDER BY c.name COLLATE NOCASE ASC
  `;

  return db.prepare(query).all(...sqlParams);
}

/**
 * Get contact by ID (including live balance)
 */
function getContactById(id, businessId = 1) {
  const db = getDb();
  const query = `
    SELECT
      c.*,
      l.name AS location_name,
      (
        c.opening_balance + COALESCE((
          SELECT SUM(cl.amount)
          FROM contact_ledger cl
          WHERE cl.contact_id = c.id
            AND cl.business_id = c.business_id
            AND cl.reference_type != 'opening_balance'
        ), 0)
      ) AS balance
    FROM contacts c
    LEFT JOIN locations l ON l.id = c.location_id
    WHERE c.id = ? AND c.business_id = ?
  `;
  return db.prepare(query).get(id, businessId);
}

/**
 * Create a new contact.
 * Also inserts an 'opening_balance' entry into contact_ledger if opening_balance != 0.
 */
function createContact(data) {
  const db = getDb();
  const businessId = data.business_id || authRepo.getCurrentBusinessId() || 1;
  const currentUserId = authRepo.getCurrentUserId();

  return transaction(() => {
    try {
      const trimmedName = data.name.trim();
      const trimmedNumber = data.contact_number.trim();
      const openingBalance = Number(data.opening_balance || 0);

      const stmt = db.prepare(`
        INSERT INTO contacts (
          business_id, contact_type, name, contact_number, alternate_number,
          email, landline, opening_balance, city, country, tax_ntn_number,
          custom_fields, is_active, business_name, address, location_id,
          created_by
        ) VALUES (
          @business_id, @contact_type, @name, @contact_number, @alternate_number,
          @email, @landline, @opening_balance, @city, @country, @tax_ntn_number,
          '{}', @is_active, @business_name, @address, @location_id,
          @created_by
        )
      `);

      const result = stmt.run({
        business_id: businessId,
        contact_type: data.contact_type || 'customer',
        name: trimmedName,
        contact_number: trimmedNumber,
        alternate_number: data.alternate_number ? data.alternate_number.trim() : null,
        email: data.email ? data.email.trim() : null,
        landline: data.landline ? data.landline.trim() : null,
        opening_balance: openingBalance,
        city: data.city ? data.city.trim() : null,
        country: data.country ? data.country.trim() : null,
        tax_ntn_number: data.contact_type === 'supplier' && data.tax_ntn_number ? data.tax_ntn_number.trim() : null,
        is_active: data.is_active !== undefined ? (data.is_active ? 1 : 0) : 1,
        business_name: data.business_name ? data.business_name.trim() : null,
        address: data.address ? data.address.trim() : null,
        location_id: data.location_id ? Number(data.location_id) : null,
        created_by: currentUserId,
      });

      const contactId = Number(result.lastInsertRowid);

      // Insert opening balance entry into ledger if not 0
      if (openingBalance !== 0) {
        db.prepare(`
          INSERT INTO contact_ledger (
            business_id, contact_id, reference_type, reference_id, amount
          ) VALUES (?, ?, 'opening_balance', NULL, ?)
        `).run(businessId, contactId, openingBalance);
      }

      return { id: contactId };
    } catch (err) {
      if (err.message && err.message.includes('UNIQUE constraint failed')) {
        throw new Error('A contact with this contact number already exists.');
      }
      throw err;
    }
  });
}

/**
 * Update contact
 */
function updateContact(id, data) {
  const db = getDb();
  const businessId = data.business_id || authRepo.getCurrentBusinessId() || 1;

  return transaction(() => {
    try {
      const openingBalance = Number(data.opening_balance || 0);

      db.prepare(`
        UPDATE contacts SET
          name = @name,
          contact_number = @contact_number,
          alternate_number = @alternate_number,
          email = @email,
          landline = @landline,
          opening_balance = @opening_balance,
          city = @city,
          country = @country,
          tax_ntn_number = @tax_ntn_number,
          is_active = @is_active,
          business_name = @business_name,
          address = @address,
          location_id = @location_id
        WHERE id = @id AND business_id = @business_id
      `).run({
        id: Number(id),
        business_id: businessId,
        name: data.name.trim(),
        contact_number: data.contact_number.trim(),
        alternate_number: data.alternate_number ? data.alternate_number.trim() : null,
        email: data.email ? data.email.trim() : null,
        landline: data.landline ? data.landline.trim() : null,
        opening_balance: openingBalance,
        city: data.city ? data.city.trim() : null,
        country: data.country ? data.country.trim() : null,
        tax_ntn_number: data.tax_ntn_number ? data.tax_ntn_number.trim() : null,
        is_active: data.is_active ? 1 : 0,
        business_name: data.business_name ? data.business_name.trim() : null,
        address: data.address ? data.address.trim() : null,
        location_id: data.location_id ? Number(data.location_id) : null,
      });

      // Update or create opening balance ledger entry if changed
      const existingOpening = db.prepare(`
        SELECT id, amount FROM contact_ledger
        WHERE contact_id = ? AND reference_type = 'opening_balance'
      `).get(id);

      if (existingOpening) {
        if (openingBalance !== Number(existingOpening.amount)) {
          db.prepare(`
            UPDATE contact_ledger
            SET amount = ?
            WHERE id = ?
          `).run(openingBalance, existingOpening.id);
        }
      } else if (openingBalance !== 0) {
        db.prepare(`
          INSERT INTO contact_ledger (
            business_id, contact_id, reference_type, reference_id, amount
          ) VALUES (?, ?, 'opening_balance', NULL, ?)
        `).run(businessId, Number(id), openingBalance);
      }

      return { id: Number(id) };
    } catch (err) {
      if (err.message && err.message.includes('UNIQUE constraint failed')) {
        throw new Error('A contact with this contact number already exists.');
      }
      throw err;
    }
  });
}

/**
 * Soft delete contact (sets is_active = 0)
 */
function softDeleteContact(id, businessId = 1) {
  const db = getDb();
  db.prepare(`
    UPDATE contacts
    SET is_active = 0
    WHERE id = ? AND business_id = ?
  `).run(id, businessId);
}

/**
 * Hard delete contact (fails with error if FK constraint violated)
 */
function deleteContact(id, businessId = 1) {
  const db = getDb();
  try {
    db.prepare(`
      DELETE FROM contacts
      WHERE id = ? AND business_id = ?
    `).run(id, businessId);
  } catch (err) {
    if (err.message && err.message.includes('FOREIGN KEY')) {
      throw new Error('Cannot delete this contact because sales, purchases, or ledger entries still reference it.');
    }
    throw err;
  }
}

/**
 * Get contact ledger history
 */
function getContactLedger(contactId, businessId = 1) {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM contact_ledger
    WHERE contact_id = ? AND business_id = ?
    ORDER BY created_at ASC
  `).all(contactId, businessId);
}

/**
 * Record a payment against contact ledger
 * (Negative amount reduces debt)
 */
function recordPayment({ contactId, amount, paymentMethod, note, businessId = 1 }) {
  const db = getDb();
  const payAmount = Number(amount);
  if (payAmount <= 0) {
    throw new Error('Payment amount must be greater than zero.');
  }

  return transaction(() => {
    // Negative amount on ledger reduces contact balance
    const result = db.prepare(`
      INSERT INTO contact_ledger (
        business_id, contact_id, reference_type, reference_id, amount
      ) VALUES (?, ?, 'payment', NULL, ?)
    `).run(businessId, Number(contactId), -payAmount);

    return { id: Number(result.lastInsertRowid) };
  });
}

module.exports = {
  getContacts,
  getContactById,
  createContact,
  updateContact,
  softDeleteContact,
  deleteContact,
  getContactLedger,
  recordPayment,
};
