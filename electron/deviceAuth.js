'use strict';

/**
 * electron/deviceAuth.js
 *
 * Hardware Device Authentication:
 * Checks the machine's permanent hardware Device ID against the hardcoded
 * authorized list. If the ID does not match, the application terminates
 * with a "Device Authentication Error" dialog.
 */

const { execSync } = require('child_process');
const crypto = require('crypto');
const os = require('os');

/**
 * HARDCODED AUTHORIZED DEVICE ID(S)
 *
 * Put the allowed computer's Device ID below.
 * Can be the Windows Settings -> System -> About "Device ID",
 * or the Windows MachineGuid / UUID.
 */
const AUTHORIZED_DEVICE_IDS = [
  '5404F72A-C185-4F8A-96C8-B3BA6E8424FB', // ahtsham pc device id
  // '4D065250-0985-4642-AA12-4F5F745050BD', // computer 1 device id
  // '3E8CA5AA-E08D-4D75-8DFE-E311EBC6E7C8', // auto parts 1 pc device id
];

/**
 * Retrieves all valid hardware identifiers for this computer.
 * On Windows, this includes:
 *   1. Windows Settings -> System -> About "Device ID" (SQMClient MachineId)
 *   2. Windows Cryptography MachineGuid
 *   3. Hardware Profile GUID (HwProfileGuid)
 *   4. Motherboard / BIOS UUID (wmic csproduct)
 */
function getAllSystemDeviceIds() {
  const ids = [];

  if (process.platform === 'win32') {
    // 1. Windows Settings -> System -> About "Device ID" (SQMClient MachineId)
    try {
      const out = execSync(
        'reg query "HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\SQMClient" /v MachineId',
        { encoding: 'utf8', windowsHide: true, timeout: 3000 }
      );
      const match = out.match(/MachineId\s+REG_SZ\s+\{?([a-zA-Z0-9-]+)\}?/i);
      if (match && match[1]) {
        ids.push(match[1].replace(/[{}]/g, '').trim().toUpperCase());
      }
    } catch (_e) { }

    // 2. Windows Cryptography MachineGuid
    try {
      const out = execSync(
        'reg query "HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid',
        { encoding: 'utf8', windowsHide: true, timeout: 3000 }
      );
      const match = out.match(/MachineGuid\s+REG_SZ\s+\{?([a-zA-Z0-9-]+)\}?/i);
      if (match && match[1]) {
        ids.push(match[1].replace(/[{}]/g, '').trim().toUpperCase());
      }
    } catch (_e) { }

    // 3. Hardware Profile GUID
    try {
      const out = execSync(
        'reg query "HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Control\\IDConfigDB\\Hardware Profiles\\0001" /v HwProfileGuid',
        { encoding: 'utf8', windowsHide: true, timeout: 3000 }
      );
      const match = out.match(/HwProfileGuid\s+REG_SZ\s+\{?([a-zA-Z0-9-]+)\}?/i);
      if (match && match[1]) {
        ids.push(match[1].replace(/[{}]/g, '').trim().toUpperCase());
      }
    } catch (_e) { }

    // 4. Motherboard / BIOS UUID
    try {
      const out = execSync('wmic csproduct get uuid', {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 3000,
      });
      const lines = out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      if (lines.length > 1 && lines[1] && lines[1].toLowerCase() !== 'uuid') {
        ids.push(lines[1].replace(/[{}]/g, '').trim().toUpperCase());
      }
    } catch (_e) { }
  } else if (process.platform === 'darwin') {
    // macOS: IOPlatformUUID
    try {
      const out = execSync("ioreg -rd1 -c IOPlatformExpertDevice | grep -E '(IOPlatformUUID)'", {
        encoding: 'utf8',
        timeout: 3000,
      });
      const match = out.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/i);
      if (match && match[1]) ids.push(match[1].trim().toUpperCase());
    } catch (_e) { }
  } else if (process.platform === 'linux') {
    // Linux: /etc/machine-id
    try {
      const fs = require('fs');
      if (fs.existsSync('/etc/machine-id')) {
        ids.push(fs.readFileSync('/etc/machine-id', 'utf8').trim().toUpperCase());
      }
    } catch (_e) { }
  }

  // Fallback if none found: derive from hostname + CPU info
  if (ids.length === 0) {
    const cpus = os.cpus() || [];
    const cpuModel = cpus[0]?.model || '';
    const raw = `${os.hostname()}::${os.platform()}::${os.arch()}::${cpuModel}`;
    ids.push(crypto.createHash('sha256').update(raw).digest('hex').slice(0, 32).toUpperCase());
  }

  // Return unique uppercase IDs
  return [...new Set(ids)];
}

/**
 * Returns the primary system device ID (matching Windows Settings -> System -> About).
 */
function getSystemDeviceId() {
  const ids = getAllSystemDeviceIds();
  return ids[0] || 'UNKNOWN';
}

/**
 * Validates whether the current machine's Device ID is authorized.
 * Checks against all valid hardware IDs for this machine.
 *
 * @returns {{ authorized: boolean, systemDeviceId: string, allSystemIds: string[], reason?: string }}
 */
function checkDeviceAuth() {
  const systemIds = getAllSystemDeviceIds();
  const primaryId = systemIds[0] || 'UNKNOWN';

  // Normalize all system IDs (remove hyphens, braces, whitespace)
  const normalizedSystemIds = systemIds.map((id) => id.replace(/[^A-Z0-9]/gi, '').toUpperCase());

  // Check if ANY authorized ID matches ANY of the system's hardware IDs
  const isMatch = AUTHORIZED_DEVICE_IDS.some((authId) => {
    if (!authId || typeof authId !== 'string' || authId.startsWith('REPLACE_')) return false;
    const normalizedAuthId = authId.replace(/[^A-Z0-9]/gi, '').toUpperCase();
    return normalizedSystemIds.includes(normalizedAuthId);
  });

  return {
    authorized: isMatch,
    systemDeviceId: primaryId,
    allSystemIds: systemIds,
    reason: isMatch ? 'Authorized' : 'Device ID does not match this computer',
  };
}

module.exports = {
  getSystemDeviceId,
  getAllSystemDeviceIds,
  checkDeviceAuth,
  AUTHORIZED_DEVICE_IDS,
};
