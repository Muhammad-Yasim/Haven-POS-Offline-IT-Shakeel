'use strict';

/**
 * electron/database/repositories/settings.repo.js
 *
 * Repository for:
 *   - Business profile (read + update with currency lock)
 *   - Locations (CRUD + toggle active)
 *   - Invoice/Receipt settings (stored as JSON inside businesses.settings)
 *   - User preferences (stored as JSON inside users, custom_fields / preferences)
 */

const { getDb, transaction } = require('../db');
const authRepo = require('./auth.repo');

// ---------------------------------------------------------------------------
// BUSINESS
// ---------------------------------------------------------------------------

function getBusiness() {
  const db = getDb();
  return db.prepare('SELECT * FROM businesses LIMIT 1').get() || null;
}

function updateBusiness(data) {
  const db = getDb();
  const biz = db.prepare('SELECT id FROM businesses LIMIT 1').get();
  if (!biz) throw new Error('No business row found.');

  // Currency lock: cannot change currency once sales or purchases exist
  if (data.currency !== undefined) {
    const salesCount = db.prepare('SELECT COUNT(*) AS cnt FROM sales WHERE business_id = ?').get(biz.id).cnt;
    const purCount = db.prepare('SELECT COUNT(*) AS cnt FROM purchases WHERE business_id = ?').get(biz.id).cnt;
    if ((salesCount + purCount) > 0) {
      delete data.currency; // silently drop if locked — UI already hides the field
    }
  }

  const allowedFields = [
    'business_name', 'business_start_date', 'currency',
    'contact_number', 'alternate_contact',
    'country', 'state', 'city', 'zip_code', 'landmark',
    'website_link', 'time_zone',
  ];

  const fields = Object.keys(data).filter(k => allowedFields.includes(k));
  if (fields.length === 0) return;

  const setClauses = fields.map(f => `${f} = @${f}`).join(', ');
  db.prepare(`UPDATE businesses SET ${setClauses} WHERE id = @id`).run({ ...data, id: biz.id });
}

// ---------------------------------------------------------------------------
// LOCATIONS
// ---------------------------------------------------------------------------

function getAllLocations() {
  const db = getDb();
  const businessId = authRepo.getCurrentBusinessId() || 1;
  return db.prepare(
    'SELECT * FROM locations WHERE business_id = ? ORDER BY name ASC'
  ).all(businessId);
}

function getLocationById(id) {
  const db = getDb();
  return db.prepare('SELECT * FROM locations WHERE id = ?').get(id) || null;
}

function createLocation(data) {
  const db = getDb();
  const businessId = authRepo.getCurrentBusinessId() || 1;
  const result = db.prepare(`
    INSERT INTO locations (business_id, name, address, city, country, is_active, created_at)
    VALUES (@business_id, @name, @address, @city, @country, @is_active, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  `).run({
    business_id: businessId,
    name: data.name,
    address: data.address || null,
    city: data.city || null,
    country: data.country || null,
    is_active: data.is_active === false ? 0 : 1,
  });
  return result.lastInsertRowid;
}

function updateLocation(data) {
  const db = getDb();
  const { id, ...rest } = data;
  if (!id) throw new Error('id is required for updateLocation');
  db.prepare(`
    UPDATE locations SET
      name    = COALESCE(@name,    name),
      address = @address,
      city    = @city,
      country = @country
    WHERE id = @id
  `).run({
    id,
    name: rest.name || null,
    address: rest.address || null,
    city: rest.city || null,
    country: rest.country || null,
  });
}

function toggleLocationActive(id) {
  const db = getDb();
  const loc = db.prepare('SELECT is_active FROM locations WHERE id = ?').get(id);
  if (!loc) throw new Error('Location not found.');

  // Deactivating: check if it has stock history
  if (loc.is_active) {
    const hasStock = db.prepare(
      'SELECT COUNT(*) AS cnt FROM stock_ledger WHERE location_id = ?'
    ).get(id).cnt;
    // We allow it but let caller do the confirm dialog in UI — just toggle
    // (UI shows confirm before calling this)
  }

  db.prepare('UPDATE locations SET is_active = CASE WHEN is_active = 1 THEN 0 ELSE 1 END WHERE id = ?')
    .run(id);
}

// ---------------------------------------------------------------------------
// INVOICE / RECEIPT SETTINGS  (stored in businesses.settings JSON)
// ---------------------------------------------------------------------------

function getInvoiceSettings() {
  const db = getDb();
  const biz = db.prepare('SELECT settings FROM businesses LIMIT 1').get();
  if (!biz) return {};
  try {
    return JSON.parse(biz.settings || '{}');
  } catch {
    return {};
  }
}

function saveInvoiceSettings(patch) {
  const db = getDb();
  const biz = db.prepare('SELECT id, settings FROM businesses LIMIT 1').get();
  if (!biz) throw new Error('No business row found.');
  let existing = {};
  try { existing = JSON.parse(biz.settings || '{}'); } catch { /* ignore */ }
  const merged = JSON.stringify({ ...existing, ...patch });
  db.prepare('UPDATE businesses SET settings = ? WHERE id = ?').run(merged, biz.id);
}

// ---------------------------------------------------------------------------
// USER PREFERENCES  (stored in a simple key-value via businesses.settings or
//                   as a separate lookup — we reuse businesses.settings for now)
// ---------------------------------------------------------------------------

function getUserPrefs() {
  const db = getDb();
  const userId = authRepo.getCurrentUserId();
  if (!userId) return {};
  // For the offline single-user build, prefs are stored in businesses.settings
  // under a "userPrefs" key to avoid a schema change.
  const biz = db.prepare('SELECT settings FROM businesses LIMIT 1').get();
  try {
    const all = JSON.parse(biz?.settings || '{}');
    return all.userPrefs || {};
  } catch {
    return {};
  }
}

function saveUserPrefs(patch) {
  const db = getDb();
  const biz = db.prepare('SELECT id, settings FROM businesses LIMIT 1').get();
  if (!biz) throw new Error('No business row found.');
  let all = {};
  try { all = JSON.parse(biz.settings || '{}'); } catch { /* ignore */ }
  all.userPrefs = { ...(all.userPrefs || {}), ...patch };
  db.prepare('UPDATE businesses SET settings = ? WHERE id = ?').run(JSON.stringify(all), biz.id);
}

module.exports = {
  getBusiness,
  updateBusiness,
  getAllLocations,
  getLocationById,
  createLocation,
  updateLocation,
  toggleLocationActive,
  getInvoiceSettings,
  saveInvoiceSettings,
  getUserPrefs,
  saveUserPrefs,
};
