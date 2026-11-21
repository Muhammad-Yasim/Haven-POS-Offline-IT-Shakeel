'use strict';

/**
 * electron/usageTimer.js
 *
 * Application Runtime / Usage Limiter:
 * Accumulates the total running time of the application across sessions.
 * When the limit is reached (default: 4 hours), the application closes.
 * On subsequent launches, it blocks startup with an unexpected error message.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app, dialog } = require('electron');

// =============================================================================
// DEVELOPER CONFIGURATION
// =============================================================================

// Total allowed usage time in hours (can be fractional, e.g. 0.5 for 30 minutes, 4 for 4 hours)
const MAX_USAGE_HOURS = 3;

// Set to true when the client pays for the full license (disables the timer entirely)
const DISABLE_TIMER = true;

// Set to true once and run the app if you want to reset the 4-hour timer back to 0
const RESET_TIMER = false;

// Contact info shown in the error dialog
const CONTACT_MESSAGE = 'Unexpected error occurred, please contact company to use it again.\nPlease Call : 0335-0846196';

// =============================================================================
// INTERNAL LOGIC
// =============================================================================

const MAX_USAGE_SECONDS = Math.round(MAX_USAGE_HOURS * 3600);
const TICK_INTERVAL_MS = 10000; // Save progress every 10 seconds

let trackingInterval = null;
let currentUsedSeconds = 0;
let isCurrentlyExpired = false;

/**
 * Gets path to the encrypted license state file in the user's AppData directory
 */
function getStateFilePath() {
  const userDataPath = (app && typeof app.getPath === 'function')
    ? app.getPath('userData')
    : path.join(process.env.APPDATA || '.', 'HavenPOS');
  return path.join(userDataPath, '.haven_session.dat');
}

/**
 * Encryption key derived from a fixed secret
 */
const SECRET_KEY = crypto.createHash('sha256').update('HAVEN-POS-TIME-LOCK-2026').digest();
const IV = Buffer.alloc(16, 0); // Initialization vector

function encryptData(text) {
  const cipher = crypto.createCipheriv('aes-256-cbc', SECRET_KEY, IV);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return encrypted;
}

function decryptData(encryptedHex) {
  try {
    const decipher = crypto.createDecipheriv('aes-256-cbc', SECRET_KEY, IV);
    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (_e) {
    return null;
  }
}

/**
 * Reads the persisted state from disk
 */
function readState() {
  const filePath = getStateFilePath();

  if (RESET_TIMER) {
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (_e) { }
    console.log('[USAGE TIMER] Timer was manually reset to 0 by developer.');
  }

  if (!fs.existsSync(filePath)) {
    return {
      usedSeconds: 0,
      isExpired: false,
      lastTick: Date.now(),
    };
  }

  try {
    const rawContent = fs.readFileSync(filePath, 'utf8').trim();
    const decrypted = decryptData(rawContent);
    if (!decrypted) {
      // If file was corrupted or tampered with, treat as expired
      return { usedSeconds: MAX_USAGE_SECONDS, isExpired: true, lastTick: Date.now() };
    }
    const parsed = JSON.parse(decrypted);
    return {
      usedSeconds: Number(parsed.usedSeconds) || 0,
      isExpired: !!parsed.isExpired || Number(parsed.usedSeconds) >= MAX_USAGE_SECONDS,
      lastTick: Number(parsed.lastTick) || Date.now(),
    };
  } catch (_e) {
    return { usedSeconds: MAX_USAGE_SECONDS, isExpired: true, lastTick: Date.now() };
  }
}

/**
 * Writes the updated state to disk (encrypted)
 */
function saveState(usedSeconds, isExpired) {
  const filePath = getStateFilePath();
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const payload = JSON.stringify({
      usedSeconds,
      isExpired,
      lastTick: Date.now(),
    });
    const encrypted = encryptData(payload);
    fs.writeFileSync(filePath, encrypted, 'utf8');
  } catch (err) {
    console.error('[USAGE TIMER] Failed to save usage state:', err);
  }
}

/**
 * Checks if the usage limit has been exceeded on app launch
 */
function checkUsageLimit() {
  if (DISABLE_TIMER) {
    return { expired: false, usedSeconds: 0, remainingSeconds: MAX_USAGE_SECONDS };
  }

  const state = readState();
  currentUsedSeconds = state.usedSeconds;
  isCurrentlyExpired = state.isExpired || currentUsedSeconds >= MAX_USAGE_SECONDS;

  console.log(`[USAGE TIMER] Used: ${Math.round(currentUsedSeconds)}s / ${MAX_USAGE_SECONDS}s (${(currentUsedSeconds / 3600).toFixed(2)}h / ${MAX_USAGE_HOURS}h). Expired: ${isCurrentlyExpired}`);

  return {
    expired: isCurrentlyExpired,
    usedSeconds: currentUsedSeconds,
    remainingSeconds: Math.max(0, MAX_USAGE_SECONDS - currentUsedSeconds),
    contactMessage: CONTACT_MESSAGE,
  };
}

/**
 * Trigger expiration popup and immediately quit
 */
function triggerExpiration() {
  stopUsageTracking();
  saveState(MAX_USAGE_SECONDS, true);

  dialog.showErrorBox(
    'Unexpected Error Occurred',
    CONTACT_MESSAGE
  );

  app.exit(1);
}

/**
 * Starts the heartbeat timer to track app runtime every 10 seconds
 */
function startUsageTracking() {
  if (DISABLE_TIMER) return;
  if (trackingInterval) clearInterval(trackingInterval);

  let lastTickTime = Date.now();

  trackingInterval = setInterval(() => {
    const now = Date.now();
    const elapsedSeconds = Math.max(0, (now - lastTickTime) / 1000);
    lastTickTime = now;

    currentUsedSeconds += elapsedSeconds;

    if (currentUsedSeconds >= MAX_USAGE_SECONDS) {
      triggerExpiration();
      return;
    }

    saveState(Math.round(currentUsedSeconds), false);
  }, TICK_INTERVAL_MS);
}

/**
 * Stops tracking (e.g. on clean quit)
 */
function stopUsageTracking() {
  if (trackingInterval) {
    clearInterval(trackingInterval);
    trackingInterval = null;
  }
  if (!DISABLE_TIMER) {
    saveState(Math.round(currentUsedSeconds), isCurrentlyExpired || currentUsedSeconds >= MAX_USAGE_SECONDS);
  }
}

module.exports = {
  checkUsageLimit,
  startUsageTracking,
  stopUsageTracking,
  CONTACT_MESSAGE,
  MAX_USAGE_HOURS,
};

