'use strict';

/**
 * electron/main.js
 *
 * Electron main process entry point.
 *
 * Responsibilities:
 *   1. Open (or create) the SQLite database and run migrations.
 *   2. Register all IPC handlers.
 *   3. Create the BrowserWindow.
 *   4. Load the React app (built dist/index.html in production,
 *      or the Vite dev server in development).
 *   5. Send 'setup-required' to the renderer if no business exists yet.
 */

const { app, BrowserWindow, ipcMain, shell, Menu, dialog } = require('electron');
const path = require('path');
const { checkDeviceAuth } = require('./deviceAuth');
const { checkUsageLimit, startUsageTracking, stopUsageTracking } = require('./usageTimer');

// ---------------------------------------------------------------------------
// Determine environment
// ---------------------------------------------------------------------------
const isDev = !app.isPackaged;

// ---------------------------------------------------------------------------
// Initialise the database (must happen before IPC handlers are registered)
// ---------------------------------------------------------------------------
const { initDb } = require('./database/db');

// ---------------------------------------------------------------------------
// IPC handler registrations — one file per domain
// ---------------------------------------------------------------------------
const { registerAuthHandlers } = require('./ipc/auth.ipc');
const { registerProductHandlers } = require('./ipc/products.ipc');
const { registerContactHandlers } = require('./ipc/contacts.ipc');
const { registerPurchaseHandlers } = require('./ipc/purchases.ipc');
const { registerSalesHandlers } = require('./ipc/sales.ipc');
const { registerExpenseHandlers } = require('./ipc/expenses.ipc');
const { registerRegisterHandlers } = require('./ipc/registers.ipc');
const { registerStockHandlers } = require('./ipc/stock.ipc');
const { registerNotifHandlers } = require('./ipc/notifications.ipc');
const { registerReportHandlers } = require('./ipc/reports.ipc');
const { registerSettingsHandlers } = require('./ipc/settings.ipc');
const { registerDashboardHandlers } = require('./ipc/dashboard.ipc');

// ---------------------------------------------------------------------------
// Window reference — keep it in module scope to prevent GC
// ---------------------------------------------------------------------------
let mainWindow = null;

function createWindow() {
  // Remove the default application menu ("File Edit View Window")
  Menu.setApplicationMenu(null);

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,   // shown after 'ready-to-show' to avoid white flash
    autoHideMenuBar: true,
    icon: isDev
      ? path.join(__dirname, '../public/icon.ico')
      : path.join(process.resourcesPath, 'icon.ico'),
    webPreferences: {
      contextIsolation: true,       // renderer cannot access Node.js
      nodeIntegration: false,      // no require() in renderer
      sandbox: false,      // preload needs require() (for path/crypto)
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: true,
      // Restrict what the renderer can navigate to
      allowRunningInsecureContent: false,
    },
  });

  // ---- Load the app --------------------------------------------------------
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    console.error(`[MAIN] Failed to load URL "${validatedURL}": ${errorDescription} (${errorCode})`);
  });
  mainWindow.webContents.on('console-message', (_event, _level, message, line, sourceId) => {
    console.log(`[RENDERER] ${message} (${sourceId}:${line})`);
  });

  if (isDev) {
    // Development: Vite dev server
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    // Production: built index.html
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  // ---- Show the window maximized once it's ready ---------------------------
  mainWindow.once('ready-to-show', () => {
    mainWindow.maximize();
    mainWindow.show();
  });

  // ---- Allow toggling DevTools with F12 or Ctrl+Shift+I ---------------------
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i')) {
      mainWindow.webContents.toggleDevTools();
      event.preventDefault();
    }
  });

  // ---- Window open handler -------------------------------------------------
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // Allow blank/local popup windows (e.g. for receipt and invoice printing)
    if (!url || url === 'about:blank' || url.startsWith('blob:') || url.startsWith('data:')) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          autoHideMenuBar: true,
          webPreferences: {
            sandbox: false,
          },
        },
      };
    }
    // External links open in default OS browser
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

app.whenReady().then(() => {
  // 0. Hardware Device Authentication Security Check
  const authCheck = checkDeviceAuth();
  console.log('[DEVICE AUTH] Primary Detected ID:', authCheck.systemDeviceId);
  console.log('[DEVICE AUTH] All System IDs:', authCheck.allSystemIds);
  console.log('[DEVICE AUTH] Authorized:', authCheck.authorized);

  if (!authCheck.authorized) {
    dialog.showErrorBox(
      'Device Authentication Error',
      `Please contact the administrator to use Application.\nPlease Call : 0335-0846196\n\nYour System Device ID:\n${authCheck.systemDeviceId}`
    );
    app.exit(1);
    return;
  }

  // 0.1 Total Application Usage Time Limit Check (4 Hours Trial)
  const timerCheck = checkUsageLimit();
  if (timerCheck.expired) {
    dialog.showErrorBox(
      'Unexpected Error Occurred',
      timerCheck.contactMessage
    );
    app.exit(1);
    return;
  }

  // 1. Open / migrate the database
  initDb();

  // 2. Register IPC handlers
  registerAuthHandlers();
  registerProductHandlers();
  registerContactHandlers();
  registerPurchaseHandlers();
  registerSalesHandlers();
  registerRegisterHandlers();
  registerExpenseHandlers();
  registerStockHandlers();
  registerNotifHandlers();
  registerReportHandlers();
  registerSettingsHandlers();
  registerDashboardHandlers();
  // Additional handlers registered in later phases go here.

  // 3. Create the browser window
  createWindow();

  // 4. Start tracking usage runtime
  startUsageTracking();

  // macOS: re-create window when dock icon is clicked and no windows exist
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Clean up timer and persist state on quit
app.on('before-quit', () => {
  stopUsageTracking();
});

// Quit when all winelahielaeldows are closed (except on macOS)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ---------------------------------------------------------------------------
// Security: prevent new window creation from renderer
// ---------------------------------------------------------------------------
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-navigate', (event, url) => {
    // Allow navigation only to our own app URLs
    if (isDev && url.startsWith('http://localhost:5173')) return;
    if (!isDev && url.startsWith('file://')) return;
    event.preventDefault();
  });
});
