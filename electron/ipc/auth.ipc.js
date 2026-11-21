'use strict';

/**
 * electron/ipc/auth.ipc.js
 *
 * Registers IPC handlers for the auth domain.
 * All handlers validate input and delegate to auth.repo.js.
 *
 * Channel naming convention: 'auth:<method>'
 */

const { ipcMain } = require('electron');
const authRepo    = require('../database/repositories/auth.repo');

/**
 * Wraps an async IPC handler so unhandled promise rejections are
 * caught and returned as { error: message } to the renderer instead
 * of crashing the main process.
 */
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

function registerAuthHandlers() {
  // ------------------------------------------------------------------
  // auth:isSetupRequired
  // Returns true if no business row exists yet (first launch).
  // ------------------------------------------------------------------
  handle('auth:isSetupRequired', () => {
    return authRepo.isSetupRequired();
  });

  // ------------------------------------------------------------------
  // auth:setup
  // First-launch: seeds business + admin user, auto-signs-in.
  // Args: { business: {...}, admin: {...} }
  // ------------------------------------------------------------------
  handle('auth:setup', async ({ business, admin }) => {
    if (!business || !admin) throw new Error('Missing setup data.');
    if (!admin.username?.trim())  throw new Error('Username is required.');
    if (!admin.password?.trim())  throw new Error('Password is required.');
    if (!business.business_name?.trim()) throw new Error('Business name is required.');
    if (!business.currency?.trim())      throw new Error('Currency is required.');
    if (!business.contact_number?.trim()) throw new Error('Contact number is required.');
    if (!business.country?.trim())       throw new Error('Country is required.');
    if (!business.city?.trim())          throw new Error('City is required.');
    if (!business.time_zone?.trim())     throw new Error('Time zone is required.');

    return authRepo.setup({ business, admin });
  });

  // ------------------------------------------------------------------
  // auth:signIn
  // Args: { username, password }
  // ------------------------------------------------------------------
  handle('auth:signIn', async ({ username, password }) => {
    if (!username?.trim()) throw new Error('Username is required.');
    if (!password?.trim()) throw new Error('Password is required.');
    return authRepo.signIn({ username, password });
  });

  // ------------------------------------------------------------------
  // auth:signOut
  // ------------------------------------------------------------------
  handle('auth:signOut', () => {
    authRepo.signOut();
  });

  // ------------------------------------------------------------------
  // auth:getSession
  // Returns { profile, business, permissions } or null.
  // ------------------------------------------------------------------
  handle('auth:getSession', () => {
    return authRepo.getSession();
  });

  // ------------------------------------------------------------------
  // auth:changePassword
  // Args: { currentPassword, newPassword }
  // ------------------------------------------------------------------
  handle('auth:changePassword', async ({ currentPassword, newPassword }) => {
    if (!currentPassword?.trim()) throw new Error('Current password is required.');
    if (!newPassword?.trim())     throw new Error('New password is required.');
    if (newPassword.length < 6)   throw new Error('Password must be at least 6 characters.');
    return authRepo.changePassword({ currentPassword, newPassword });
  });
}

module.exports = { registerAuthHandlers };
