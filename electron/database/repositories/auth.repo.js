'use strict';

/**
 * electron/database/repositories/auth.repo.js
 *
 * Handles:
 *  - First-launch business + admin setup (setup)
 *  - Login verification (signIn)
 *  - Session management (in-memory)
 *  - Password change (changePassword)
 *
 * Uses Node.js built-in `node:sqlite`.
 */

const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { getDb, transaction } = require('../db');

let _session = null;

const ALL_MODULES = [
  'purchases', 'sales', 'products', 'contacts',
  'expenses', 'stock', 'reports', 'settings', 'pos',
];

function hashPassword(plaintext) {
  const saltRounds = 12; // bcryptjs: 12 rounds ≈ argon2id strength for offline app
  return bcrypt.hash(plaintext, saltRounds);
}

function verifyPassword(hash, plaintext) {
  return bcrypt.compare(plaintext, hash);
}

/**
 * Seeds the database with the business and admin user.
 */
async function setup({ business, admin }) {
  const db = getDb();

  const existing = db.prepare('SELECT id FROM businesses LIMIT 1').get();
  if (existing) {
    throw new Error('Setup has already been completed.');
  }

  const passwordHash = await hashPassword(admin.password);
  const userId = crypto.randomUUID();
  const now = new Date().toISOString();

  transaction(() => {
    // 1. Insert business
    db.prepare(`
      INSERT INTO businesses (
        business_name, business_start_date, currency,
        contact_number, alternate_contact,
        country, state, city, zip_code, landmark,
        website_link, time_zone, status, settings, created_at
      ) VALUES (
        @business_name, @business_start_date, @currency,
        @contact_number, @alternate_contact,
        @country, @state, @city, @zip_code, @landmark,
        @website_link, @time_zone, 'active', '{}', @now
      )
    `).run({
      business_name: business.business_name,
      business_start_date: business.business_start_date || null,
      currency: business.currency,
      contact_number: business.contact_number,
      alternate_contact: business.alternate_contact || null,
      country: business.country,
      state: business.state || null,
      city: business.city,
      zip_code: business.zip_code || null,
      landmark: business.landmark || null,
      website_link: business.website_link || null,
      time_zone: business.time_zone,
      now,
    });

    const businessId = db.prepare('SELECT last_insert_rowid() AS id').get().id;

    // 2. Insert admin user
    db.prepare(`
      INSERT INTO users (
        id, business_id, first_name, last_name,
        username, password_hash, is_owner, is_active,
        mobile_number, must_change_password, created_at
      ) VALUES (
        @id, @business_id, @first_name, @last_name,
        @username, @password_hash, 1, 1,
        @mobile_number, 0, @now
      )
    `).run({
      id: userId,
      business_id: businessId,
      first_name: admin.first_name,
      last_name: admin.last_name || null,
      username: admin.username,
      password_hash: passwordHash,
      mobile_number: admin.mobile_number || null,
      now,
    });

    // 3. Seed role_permissions
    const insertPerm = db.prepare(`
      INSERT INTO role_permissions (user_id, module, can_view, can_create, can_edit, can_delete)
      VALUES (@user_id, @module, 1, 1, 1, 1)
    `);
    for (const module of ALL_MODULES) {
      insertPerm.run({ user_id: userId, module });
    }

    // 4. Insert default location
    db.prepare(`
      INSERT INTO locations (business_id, name, address, is_active, created_at)
      VALUES (@business_id, 'Main Location', NULL, 1, @now)
    `).run({ business_id: businessId, now });
  });

  return signIn({ username: admin.username, password: admin.password });
}

/**
 * Sign In
 */
async function signIn({ username, password }) {
  const db = getDb();

  const userRow = db.prepare(`
    SELECT u.*, b.id AS b_id
    FROM   users u
    JOIN   businesses b ON b.id = u.business_id
    WHERE  LOWER(u.username) = LOWER(?)
    LIMIT  1
  `).get(username);

  if (!userRow) {
    throw new Error('Invalid username or password.');
  }

  if (!userRow.is_active) {
    throw new Error('Your account has been disabled.');
  }

  const valid = await verifyPassword(userRow.password_hash, password);
  if (!valid) {
    throw new Error('Invalid username or password.');
  }

  _session = { userId: userRow.id, businessId: userRow.business_id };

  const business = db.prepare('SELECT * FROM businesses WHERE id = ?')
    .get(userRow.business_id);

  const permissions = db.prepare(
    'SELECT * FROM role_permissions WHERE user_id = ?'
  ).all(userRow.id);

  const { password_hash: _pw, b_id: _bid, ...profile } = userRow;

  return { profile, business, permissions };
}

/**
 * Get Session
 */
function getSession() {
  if (!_session) return null;

  const db = getDb();

  const profile = db.prepare(`
    SELECT id, business_id, first_name, last_name, username,
           is_owner, is_active, mobile_number, must_change_password, created_at
    FROM   users
    WHERE  id = ?
  `).get(_session.userId);

  if (!profile) {
    _session = null;
    return null;
  }

  const business = db.prepare('SELECT * FROM businesses WHERE id = ?')
    .get(_session.businessId);

  const permissions = db.prepare(
    'SELECT * FROM role_permissions WHERE user_id = ?'
  ).all(_session.userId);

  return { profile, business, permissions };
}

function signOut() {
  _session = null;
}

async function changePassword({ currentPassword, newPassword }) {
  if (!_session) throw new Error('Not signed in.');

  const db = getDb();

  const userRow = db.prepare('SELECT password_hash FROM users WHERE id = ?')
    .get(_session.userId);

  const valid = await verifyPassword(userRow.password_hash, currentPassword);
  if (!valid) {
    throw new Error('Current password is incorrect.');
  }

  const newHash = await hashPassword(newPassword);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
    .run(newHash, _session.userId);
}

function isSetupRequired() {
  const db = getDb();
  const row = db.prepare('SELECT id FROM businesses LIMIT 1').get();
  return !row;
}

function getCurrentUserId() {
  return _session ? _session.userId : null;
}

function getCurrentBusinessId() {
  return _session ? _session.businessId : 1;
}

module.exports = {
  setup,
  signIn,
  signOut,
  getSession,
  changePassword,
  isSetupRequired,
  getCurrentUserId,
  getCurrentBusinessId,
};
