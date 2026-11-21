# Haven POS — Offline Electron + SQLite Implementation Plan

> **Goal:** Convert the existing React + Supabase POS into a fully offline Windows desktop application using Electron + SQLite, preserving all business logic and UI/UX. Single-admin, single-business, single-location per install. No User Management module.

---

## Guiding Principles

- **Never rebuild from scratch.** Every existing page, component, hook, CSS file and business-logic util is reused as-is.
- **No business logic changes.** FIFO costing, stock ledger, contact ledger, POS billing, split payments, returns — all preserved exactly.
- **No UI/UX changes.** All pages look and feel identical.
- **Module-by-module delivery.** Each phase is independently shippable. We work on one module at a time per your instruction.
- **No User Management module.** The single admin/owner is seeded at first launch. Routes `/users`, `/users/new`, `/users/:id` are removed.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│          Electron BrowserWindow  (Chromium)          │
│                                                      │
│  React SPA (existing pages + components, unchanged)  │
│      calls window.electronAPI.*  (preload bridge)    │
└────────────────────┬────────────────────────────────┘
                     │  IPC (contextBridge)
                     ▼
┌─────────────────────────────────────────────────────┐
│                 Electron Main Process                 │
│                                                      │
│  electron/main.js                                    │
│  electron/preload.js          (contextBridge API)    │
│  electron/database/db.js      (better-sqlite3 conn)  │
│  electron/database/migrations/ (001_initial…sql)     │
│  electron/database/repositories/  (one file/domain)  │
│  electron/ipc/   (handlers — one file/domain)        │
└─────────────────────────────────────────────────────┘
                     │
                     ▼
         %APPDATA%\HavenPOS\pos-database.db
```

**React side:** replaces every `supabase.*` call with `window.electronAPI.<domain>.<method>(args)`.  
**Electron side:** receives IPC calls → runs SQLite queries via repositories → returns plain JS objects.

---

## File / Folder Structure (new files only)

```
electron/
  main.js                          ← Electron entry point, BrowserWindow, app lifecycle
  preload.js                       ← contextBridge exposing window.electronAPI
  database/
    db.js                          ← opens DB, sets PRAGMAs, runs migrations
    migrations/
      001_initial_schema.sql       ← the provided POS-DATABASE-OFFLINE-SCHEMA.sql (verbatim)
      002_seed_admin.sql           ← seeds business + admin user on first launch
    repositories/
      auth.repo.js
      business.repo.js
      contacts.repo.js
      products.repo.js
      stock.repo.js
      purchases.repo.js
      sales.repo.js
      expenses.repo.js
      reports.repo.js
      registers.repo.js
      notifications.repo.js
      settings.repo.js
  ipc/
    auth.ipc.js
    business.ipc.js
    contacts.ipc.js
    products.ipc.js
    stock.ipc.js
    purchases.ipc.js
    sales.ipc.js
    expenses.ipc.js
    reports.ipc.js
    registers.ipc.js
    notifications.ipc.js
    settings.ipc.js

src/
  lib/
    electronAPI.js                 ← thin wrapper; calls window.electronAPI or throws in browser
  context/
    AuthContext.jsx                ← rewritten: local login instead of Supabase Auth
  components/
    ProtectedRoute.jsx             ← rewritten: checks local session (no Supabase)
  pages/
    login.jsx                      ← rewritten: calls electronAPI.auth.signIn
    setup.jsx                      ← NEW: first-launch business registration wizard
    (all other pages untouched in Phase 0, then updated per module)
```

---

## Phase 0 — Electron Scaffolding & Infrastructure (Do First, Before Any Module)

This phase makes the app *launch as a desktop app* without breaking anything yet. No React page is changed.

### 0.1 — Install dependencies

```
npm install --save-dev electron electron-builder
npm install better-sqlite3 argon2
```

> `better-sqlite3` is synchronous — no async/await needed in the main process.  
> `argon2` for password hashing (Argon2id).

### 0.2 — `electron/database/db.js`

- Opens `%APPDATA%/HavenPOS/pos-database.db` (using `app.getPath('userData')`).
- Sets connection-level PRAGMAs:
  ```sql
  PRAGMA foreign_keys = ON;
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous  = NORMAL;
  ```
- Runs the migration runner on every launch (safe — migrations are idempotent via `CREATE TABLE IF NOT EXISTS` / versioning table).

### 0.3 — Migration Runner

- Maintains a `_migrations` table: `(id INTEGER PK AUTOINCREMENT, filename TEXT UNIQUE, ran_at TEXT)`.
- On each launch, reads all `*.sql` files from `electron/database/migrations/` in filename order.
- Skips already-applied files, runs new ones inside a transaction, records them.
- **Never modifies or deletes applied migrations.**

### 0.4 — `electron/database/migrations/001_initial_schema.sql`

Verbatim copy of `POS-DATABASE-OFFLINE-SCHEMA.sql`. Run once on a fresh DB.

### 0.5 — `electron/main.js`

- Creates `BrowserWindow` with:
  ```js
  webPreferences: {
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: false,          // needed for preload to use require()
    preload: path.join(__dirname, 'preload.js'),
  }
  ```
- Loads the Vite-built `index.html` (production) or `http://localhost:5173` (dev mode).
- Calls `db.js` to initialize the database before the window opens.
- Checks if business exists; if not, adds a URL param `?setup=1` so the React app shows the setup wizard instead of login.

### 0.6 — `electron/preload.js`

Exposes one `window.electronAPI` object via `contextBridge.exposeInMainWorld`, with namespaced methods for every domain. Example shape:
```js
window.electronAPI = {
  auth:          { signIn, signOut, getSession, changePassword },
  business:      { get, update },
  contacts:      { getAll, getById, create, update, delete, getLedger },
  products:      { getAll, getById, create, update, delete, getStock },
  stock:         { getLedger, adjust },
  purchases:     { getAll, getById, create, update, markReceived, delete },
  purchaseReturns: { getAll, create },
  sales:         { getAll, getById, create, update, confirm, delete },
  sellReturns:   { getAll, create },
  expenses:      { getAll, getById, create, update, delete },
  expenseCategories: { getAll, create, update, delete },
  recurringExpenses: { getAll, getById, create, update, delete, runNow },
  reports:       { getSalesSummary, getProfitLoss, getStockReport,
                   getCustomers, getSuppliers, getExpenses,
                   getUserActivity, getDailyItems },
  registers:     { getAll, getById, getOpen, open, close },
  notifications: { getAll, markRead, markAllRead },
  settings:      { getInvoiceSettings, saveInvoiceSettings },
  locations:     { getAll, getById, create, update, toggleActive },
}
```

### 0.7 — `src/lib/electronAPI.js`

```js
// Thin shim — React code imports from here, never from window directly.
export const api = window.electronAPI;
```

### 0.8 — `vite.config.js` update

Add the `build.outDir = 'dist'` target and ensure assets are relative-pathed for Electron file:// loading.

### 0.9 — `package.json` update

Add:
```json
"main": "electron/main.js",
"scripts": {
  "electron:dev":   "concurrently \"vite\" \"electron .\"",
  "electron:build": "vite build && electron-builder",
  "electron:pack":  "electron-builder --dir"
},
"build": {
  "appId": "com.havenpos.app",
  "productName": "Haven POS",
  "directories": { "output": "release" },
  "files": ["dist/**", "electron/**", "node_modules/**"],
  "win": {
    "target": "nsis",
    "icon": "public/icon.ico"
  },
  "nsis": {
    "oneClick": false,
    "allowToChangeInstallationDirectory": true
  }
}
```

---

## Phase 1 — Auth & Session (replaces Supabase Auth)

**Files changed:** `AuthContext.jsx`, `login.jsx`, `ProtectedRoute.jsx`  
**New files:** `pages/setup.jsx`, `electron/ipc/auth.ipc.js`, `electron/database/repositories/auth.repo.js`

### What changes

| Old (Supabase) | New (Electron/SQLite) |
|---|---|
| `supabase.auth.signInWithPassword` | `electronAPI.auth.signIn(username, password)` → Argon2id verify |
| `supabase.auth.getSession()` | `electronAPI.auth.getSession()` → reads in-memory session |
| `supabase.auth.signOut()` | `electronAPI.auth.signOut()` → clears in-memory session |
| `supabase.auth.onAuthStateChange` | removed — session is synchronous on this single-process desktop app |
| `supabase.auth.updateUser({ password })` | `electronAPI.auth.changePassword(old, new)` |
| Supabase JWT `user.id` | SQLite `users.id` (UUID text) stored in IPC session |
| Multi-tab session sync | not needed (single window Electron app) |

### New `AuthContext.jsx` shape

```jsx
// State: { profile, business, permissions, loading, isSetupRequired }
// No "session" object — the user UUID is held by the main process.
// On mount: calls electronAPI.auth.getSession() → loads profile + business + permissions.
// signIn(username, password) → IPC → Argon2id verify → returns {profile, business, permissions}.
// signOut() → IPC → clears main-process session.
// can(module, action) → same logic as before (is_owner shortcut + permissions array).
```

### `login.jsx` changes

- Replace Supabase email/password form with **username + password**.
- Call `api.auth.signIn(username, password)`.
- Remove "Forgot Password" and "Sign Up" links (not applicable for single-admin offline).
- Keep all CSS/styling identical.

### `setup.jsx` (new page)

- Shown only on first launch (when `businesses` table is empty).
- Two-step wizard mirroring the old `signup.jsx` UI:
  - Step 1: Business details (name, currency, contact, address, timezone).
  - Step 2: Admin account (first name, last name, username, password).
- On submit: `electronAPI.auth.setup({ business: {...}, admin: {...} })`.
  - Main process: inserts `businesses` row (id=1), hashes password with Argon2id, inserts `users` row (`is_owner=1`), seeds `role_permissions` for all modules with full access, inserts default `locations` row ("Main Location"), sets up `product_locations` for existing products if any.
- After setup: auto-signs-in and redirects to `/dashboard`.

### `ProtectedRoute.jsx` changes

- Remove Supabase session check.
- Check `loading` + `profile` from new local `AuthContext`.
- Remove `business.status === 'inactive'` redirect (single-admin, always active).
- Remove trial banner logic.
- Keep all module + action permission checks (`can(module, action)`) — logic unchanged.

### Remove entirely

- `src/pages/signup.jsx` (replaced by `setup.jsx`)
- `src/pages/forgotPassword.jsx`
- `src/pages/resetPassword.jsx`
- `src/pages/accountInactive.jsx`
- `src/hooks/useInactivityLogout.js` (optional: keep the timer, but remove Supabase signOut call, replace with `api.auth.signOut()`)
- `src/lib/supabaseClient.js` (keep for now until all modules migrated, then delete)

---

## Phase 2 — Products, Categories & Tax Rates

**Files changed:** `products.jsx`, `productForm.jsx`, `categories.jsx`, `taxRates.jsx`  
**New files:** `electron/ipc/products.ipc.js`, `electron/database/repositories/products.repo.js`

### IPC methods

```
products.getAll(filters)         → products[] with stock sums joined
products.getById(id)             → product + variants + combo items + locations
products.create(data)            → new product id
products.update(id, data)        → void
products.softDelete(id)          → void (is_active = 0)
products.addOpeningStock(entries) → writes stock_ledger rows (reason='adjustment')

categories.getAll()              → categories[]
categories.create(name)          → id
categories.update(id, name)      → void
categories.delete(id)            → void (FK RESTRICT — surfaces error)

taxRates.getAll()                → taxRates[]
taxRates.create(data)            → id
taxRates.update(id, data)        → void
taxRates.toggleActive(id)        → void
taxRates.delete(id)              → void
```

### Key notes

- **Stock sum per product**: single SQL query using `SUM(change_qty)` grouped by `product_id` — replaces the Supabase `.in('product_id', ids)` bulk fetch.
- **Low-stock badge**: same logic, computed in `products.getAll` JOIN.
- **SKU/barcode auto-generation**: stays in React (pure string logic, no DB involved).
- **Two-way price calculator**: stays in React (no DB involved).
- **Unique name violation** (`23505` error code in Postgres) → SQLite throws `SQLITE_CONSTRAINT_UNIQUE`; map to same user-friendly message.
- Product form UI unchanged.

---

## Phase 3 — Contacts & Contact Ledger

**Files changed:** `contacts.jsx`, `contactForm.jsx`  
**New files:** `electron/ipc/contacts.ipc.js`, `electron/database/repositories/contacts.repo.js`

### IPC methods

```
contacts.getAll(type, filters)         → contacts[] with computed balance
contacts.getById(id)                   → contact row
contacts.create(data)                  → id  (also inserts opening_balance ledger entry)
contacts.update(id, data)              → void
contacts.softDelete(id)                → void (is_active = 0)
contacts.getLedger(contactId)          → ledger rows[]
contacts.recordPayment(contactId, amount, method) → void (inserts negative ledger entry)
```

### Key notes

- **Balance computation**: `opening_balance + SUM(ledger rows where reference_type != 'opening_balance')` → done in SQL, not client-side.
- Opening balance ledger entry (`reference_type: 'opening_balance'`) is inserted on `contacts.create` if `opening_balance != 0`.
- `contact_type` immutable after creation — enforced in repo (not just UI).

---

## Phase 4 — Purchases & Purchase Returns (COMPLETED)

**Files changed:** `purchases.jsx`, `purchaseForm.jsx`, `purchaseDue.jsx`, `purchaseReturns.jsx`, `purchaseReturnForm.jsx`  
**New files:** `electron/ipc/purchases.ipc.js`, `electron/database/repositories/purchases.repo.js`

### IPC methods

```
purchases.getAll(filters)              → purchases[] + items (lazy expand)
purchases.getById(id)                  → purchase + items + return summary
purchases.create(data)                 → id  (stock + ledger side effects if received)
purchases.update(id, data)             → void (delta stock logic preserved)
purchases.markReceived(id)             → void
purchases.softDelete(id)               → void

purchaseReturns.getAll(filters)        → returns[]
purchaseReturns.create(purchaseId, items, reason) → id (reverses stock + credits ledger)

purchaseDue.getAll()                   → purchases where grand_total - advance_payment > 0
purchaseDue.recordPayment(id, amount, method, paidOn) → void
```

### Key notes

- **Stock delta logic** on edit (`getEffectiveStockMap` diff) is **moved to the repository** — exact same algorithm, but runs in the trusted main process, not the browser.
- Contact ledger entries for purchases are **append-only** (edit writes a reversal + new entry — same as before).
- `notifyPaymentDueSupplier` → becomes an in-process call after the purchase is saved (same logic, calls `notifications.repo.js`).
- FK RESTRICT on purchase items with existing returns is enforced at SQLite level + surfaced in repo error handling.

---

## Phase 5 — Sales & Sales Returns [DONE]

**Files changed:** `sales.jsx`, `saleForm.jsx`, `salesDue.jsx`, `sellReturns.jsx`, `sellReturnForm.jsx`  
**New files:** `electron/ipc/sales.ipc.js`, `electron/database/repositories/sales.repo.js`

### IPC methods

```
sales.getAll(filters)                  → sales[] with items (lazy expand)
sales.getById(id)                      → sale + items
sales.create(data)                     → id  (stock + ledger if confirmed)
sales.update(id, data)                 → void (reversal + re-apply stock, same as before)
sales.confirmSale(id)                  → void
sales.softDelete(id)                   → void

sellReturns.getAll(filters)            → returns[]
sellReturns.create(saleId, items, reason) → id (restocks + credits ledger + updates sale status)

salesDue.getAll()                      → sales where due_amount > 0
salesDue.recordPayment(id, amount, method) → void
```

### Key notes

- **Stock-aware edit guard** (`getAvailableStockForEdit`) preserved in repo.
- Returned/partially-returned sale edit blocked in repo (same rule as before).
- Sale status machine (`draft → quotation → confirmed → returned / partially_returned`) enforced in repo.
- `computeLine` and all subtotal/tax/discount math stays in React (`LineItemsEditor.jsx` untouched).

---

## Phase 6 — POS Billing ✅ COMPLETE

**Files changed:** `posBilling.jsx`, `useRegister.js`, `RegisterModals.jsx`, `registerUtils.js`  
**New files:** `electron/database/repositories/registers.repo.js`, `electron/ipc/registers.ipc.js`, `electron/database/repositories/expenses.repo.js`, `electron/ipc/expenses.ipc.js`  
**Reuses:** sales.ipc.js, products.ipc.js, contacts.ipc.js, purchases.ipc.js

This is the most complex page (4,300+ lines) — fully converted to offline IPC:
- **Zero Supabase calls** in `posBilling.jsx`, `useRegister.js`, `RegisterModals.jsx`, `registerUtils.js`.
- **Register lifecycle**: `api.registers.getOpen()`, `api.registers.open()`, `api.registers.close()`, `api.registers.getSummary()`.
- **Catalog & Stock**: `api.products.getAll()` and `api.purchases.getStockByLocation()`.
- **Finalize Sale & Drafts**: `api.sales.create()` with channel `'pos'`, register_id, stock ledger and contact ledger.
- **Recent Sales & Summary**: `api.sales.getRecentPos()`, `api.sales.getPosSummary()`.
- **Inline Modals**: Quick add Customer (`api.contacts.create`), Product (`api.products.create` + `api.products.addOpeningStock`), Expense (`api.expenses.create`).
- **Build verification**: `npx vite build` passed (0 errors, 1,151 modules). All backend modules verified.

---

## Phase 7 — Stock ✅ COMPLETE

**Files changed:** `stock.jsx`  
**New files:** `electron/ipc/stock.ipc.js`, `electron/database/repositories/stock.repo.js`, `electron/ipc/notifications.ipc.js`, `electron/database/repositories/notifications.repo.js`

### IPC methods

```
stock.getAll(filters)                  → (product × location) rows with on-hand qty
stock.adjust(productId, locationId, newQty, reason) → writes stock_ledger delta row
stock.getLedger(filters)               → stock_ledger audit history rows
```

### Key notes

- **On-hand qty**: `SUM(change_qty)` per `(product_id, location_id)` from `stock_ledger` joined with products and locations.
- **Adjustment**: diff = `newQty - currentOnHand`, writes one `stock_ledger` row with `reason='adjustment'` inside a transaction.
- **FIFO Costing**: If stock increases, preserves custom or product cost price as inbound valuation; if decreases (shrinkage/write-off), freezes current product cost price.
- **Low-stock check**: Automatically alerts via `notifications.repo.js` if stock falls at or below `alert_quantity`.
- **Zero Supabase calls**: Full transition to `api.stock.*` and `api.locations.*`.
- **Verification**: All unit tests passed and Vite build passed with 0 errors.

---

## Phase 8 — Expenses ✅ COMPLETE

**Files changed:** `expenses.jsx`, `expenseForm.jsx`, `expenseCategories.jsx`, `recurringExpenses.jsx`, `recurringExpenseForm.jsx`, `ExpenseFormDialog.jsx`  
**Reuses:** `ExpenseViewDrawer.jsx` (component unchanged), `expenseutils.js` (unchanged)  
**New/Updated Backend files:** `electron/database/repositories/expenses.repo.js`, `electron/ipc/expenses.ipc.js`

### IPC methods

```
expenses.getAll(filters)               → expenses[]
expenses.getById(id)                   → expense row
expenses.create(data)                  → id
expenses.update(id, data)              → void
expenses.delete(id)                    → void

expenseCategories.getAll()             → categories[]
expenseCategories.create(name)         → id
expenseCategories.update(id, name)     → void
expenseCategories.delete(id)           → void (FK RESTRICT)

recurringExpenses.getAll()             → templates[]
recurringExpenses.getById(id)          → template
recurringExpenses.create(data)         → id
recurringExpenses.update(id, data)     → void
recurringExpenses.delete(id)           → void
recurringExpenses.runNow(id)           → id of created expense (advances next_due_date)
recurringExpenses.toggleActive(id)     → void
```

### Key notes

- **Expenses CRUD**: Fully offline through `api.expenses.*` with support for location scoping, register linkage, status filtering, and notes.
- **Expense Categories**: Full CRUD with FK RESTRICT constraint handling so in-use categories cannot be deleted.
- **Recurring Templates**: Full template management with `runNow` executing in an atomic transaction that generates an expense and advances the `next_due_date` by frequency (daily/weekly/monthly/yearly).
- **Zero Supabase calls**: Completely decoupled from Supabase across all 5 pages and dialogs.
- **Verification**: Integration test suite passed and Vite build passed with 0 errors.

---

## Phase 9 — Reports ✅ COMPLETE

**Files changed:** All report pages (`salesReport.jsx`, `profitLossReport.jsx`, `stockReport.jsx`, `customersReport.jsx`, `suppliersReport.jsx`, `expensesReport.jsx`, `userActivityReport.jsx`, `dailyItemsReport.jsx`, `purchasesReport.jsx`, `registerReport.jsx`)  
**New files:** `electron/ipc/reports.ipc.js`, `electron/database/repositories/reports.repo.js`

### IPC methods

```
reports.getSalesSummary(from, to, locationId)   → { sales totals, purchase totals, returns, dues }
reports.getProfitLoss(from, to, locationId)      → full P&L dataset (opening/closing stock, COGS, etc.)
reports.getStockReport(filters)                  → stock valuation rows
reports.getStockHistory(productId, locationId)   → all stock_ledger entries for one product
reports.getCustomers(filters)                    → per-customer order counts, revenue, balance
reports.getSuppliers(filters)                    → per-supplier equivalent
reports.getExpenses(filters)                     → expense rows + category breakdown
reports.getUserActivity(from, to)                → per-user sales/purchases/expenses
reports.getDailyItems(from, to, locationId)      → daily items sold
```

### Key notes

- **Profit & Loss**: Supplies complete dataset (sales, purchase items, ledger, expenses, contacts, categories, locations) to preserve 100% of the React client-side analytical tabs, charts, and math with zero UI change.
- **Stock & History**: Lazy loads audit history with multi-join reference information (customers, suppliers, invoices) in a single fast local query.
- **Zero Supabase calls**: All 10 report and register report pages migrated to offline IPC (`api.reports.*`, `api.registers.*`, `api.locations.*`, `api.purchases.*`).
- **Verification**: Complete unit test suite passed for all 9 repository methods; Vite build passed with 0 errors across 1,151 modules.

---

## Phase 10 — Settings ✅ COMPLETE

**Files changed:** `businessSettings.jsx`, `locations.jsx`, `locationForm.jsx`, `invoiceReceiptSettings.jsx`, `userPreferences.jsx`, `settingsIndex.jsx`  
**New files:** `electron/ipc/settings.ipc.js`, `electron/database/repositories/settings.repo.js`

### IPC methods

```
business.get()                          → business row
business.update(data)                   → void  (currency lock enforced in repo)

locations.getAll()                      → locations[]
locations.getById(id)                   → location
locations.create(data)                  → id
locations.update(id, data)              → void
locations.toggleActive(id)              → void (checks stock history before deactivating)

settings.getInvoiceSettings()           → parsed businesses.settings JSON
settings.saveInvoiceSettings(patch)     → void (merge-patches businesses.settings JSON)
settings.getUserPrefs()                 → user preferences
settings.saveUserPrefs(patch)           → void

auth.changePassword(oldPw, newPw)       → void (Argon2id verify old, hash new, update)
```

### Key notes

- **Currency lock**: Repo enforces transaction check across sales and purchases before allowing currency change.
- **Locations**: Full offline CRUD, toggle active status, with automatic default location seeding.
- **Invoice & Receipt**: Settings stored directly in `businesses.settings` JSON with atomic patch update.
- **User Preferences**: Offline preferences persistence and password change using Argon2id via `api.auth.changePassword`.
- **Zero Supabase calls**: All 5 settings pages migrated to offline API.
- **Verification**: Database migrations, repository operations, and Vite build pass with 0 errors.

---

## Phase 11 — Registers ✅ COMPLETE

**Files changed:** `registers.jsx`, `registerReport.jsx`, `activeRegister.jsx`, `activeRegisterRedirect.jsx`  
**New/Updated files:** `electron/ipc/registers.ipc.js`, `electron/database/repositories/registers.repo.js`

### IPC methods

```
registers.getAll(filters)              → registers[] with location and user joins
registers.getById(id)                  → register + summary (sales, returns, expenses)
registers.getOpen()                    → open register for current user (or null)
registers.open(locationId, openingCash) → id
registers.close(id, closingCash)       → void
registers.getSummary(id)               → register summary with sales, items, returns, expenses
```

### Key notes

- **Register Lifecycle**: Complete open, close, and get-active drawer session flows migrated to offline SQLite.
- **Reporting & History**: Full history list (`registers.jsx`) with location filtering and detailed session audit (`registerReport.jsx`).
- **Zero Supabase calls**: `registers.jsx`, `activeRegister.jsx`, `activeRegisterRedirect.jsx`, and `registerReport.jsx` all converted to `api.registers.*` and `api.locations.*`.
- **Verification**: Vite build passed with 0 errors (✓ built in 6.52s).

---

## Phase 12 — Notifications ✅ COMPLETE

**Files changed:** `src/components/Header.jsx` (bell icon & notification menu), `src/lib/notifications.js`  
**New/Updated files:** `electron/ipc/notifications.ipc.js`, `electron/database/repositories/notifications.repo.js`

### IPC methods

```
notifications.getAll()                 → notifications[] (unread first, latest 50)
notifications.markRead(id)             → void
notifications.markAllRead()            → void
notifications.create(type, message, refType, refId) → void
```

### Key notes

- **Header notifications dropdown**: Migrated to `api.notifications.getAll()`, `markRead(id)`, `markAllRead()`.
- **Deduplication**: `notifyOnce` checks unread notifications before creating new alerts.
- **Stock & Payment Due triggers**: `checkLowStockForItems`, `checkLowStockDirect`, `notifyPaymentDueCustomer`, and `notifyPaymentDueSupplier` fully ported to offline IPC without any Supabase dependency.
- **Zero Supabase calls**: Neither `Header.jsx` nor `notifications.js` reference Supabase.
- **Verification**: Vite build passed with 0 errors (✓ built in 7.87s).

---

## Phase 13 — Cleanup & Build ✅ COMPLETE

- Deleted `src/lib/supabaseClient.js` and `src/lib/fetchUtils.js`.
- Removed `@supabase/supabase-js` from `package.json` dependencies.
- Cleaned `.env` to remove all Supabase URL/keys.
- Verified absence of `/users`, `/signup`, `/forgot-password`, `/reset-password` routes in `App.jsx` and removed unrouted dead files.
- Verified `useInactivityLogout` delegates to offline `api.auth.signOut`.
- Converted `src/pages/dashboard.jsx` to dedicated offline IPC (`api.dashboard.*`).
- Verified zero Supabase references across all active code in `src/` and `electron/`.
- Production build passes cleanly with 0 errors (`npx vite build` in 10.9s).

---

## Module Conversion Order (per your instruction — one at a time)

| Phase | Module | Complexity | Status |
|---|---|---|---|
| 0 | Electron scaffolding + DB + migrations | High (infra) | ✅ COMPLETE |
| 1 | Auth / Session / Login / Setup wizard | High | ✅ COMPLETE |
| 2 | Products, Categories, Tax Rates | Medium | ✅ COMPLETE |
| 3 | Contacts & Ledger | Medium | ✅ COMPLETE |
| 4 | Purchases & Returns | High | ✅ COMPLETE |
| 5 | Sales & Returns | High | ✅ COMPLETE |
| 6 | POS Billing | High | ✅ COMPLETE |
| 7 | Stock | Low | ✅ COMPLETE |
| 8 | Expenses | Medium | ✅ COMPLETE |
| 9 | Reports | High | ✅ COMPLETE |
| 10 | Settings | Low-Medium | ✅ COMPLETE |
| 11 | Registers | Medium | ✅ COMPLETE |
| 12 | Notifications | Low | ✅ COMPLETE |
| 13 | Cleanup & Build | Low | ✅ COMPLETE |

---

## Critical Data Integrity Rules (Must Preserve)

| Rule | Where enforced |
|---|---|
| Stock only changes on `received` purchase / `confirmed` sale | repo layer |
| FIFO unit_cost captured at sale time in `sale_items.unit_cost` | repo layer |
| Contact ledger is append-only (edits write reversals, not updates) | repo layer |
| `businesses.id = 1` (single-row constraint) | DB schema `CHECK (id = 1)` |
| One open register per user | DB unique partial index |
| Currency lock after first transaction | repo layer |
| Purchase edit blocked if return exists | repo layer |
| Returned sale cannot be edited | repo layer |
| `sale_items.line_total` / `purchase_items.line_total` computed in React, stored in DB | unchanged |
| All monetary rounding: `Math.round` in React before persist | unchanged |

---

## Security Settings (Electron)

```js
// BrowserWindow webPreferences
contextIsolation: true      // renderer cannot access Node APIs
nodeIntegration: false       // no require() in renderer
sandbox: false               // preload can use require() for path/crypto
webSecurity: true            // default, keeps same-origin
```

IPC handlers validate that:
- `business_id` is always `1` (hardcoded in repos — no user can inject a different tenant).
- Input types are checked before SQL binding (numbers are `Number()`, strings are trimmed).
- No raw SQL fragments are accepted over IPC — only structured argument objects.

---

## What Is NOT Changed (Preserved Exactly)

- All page JSX and CSS files (beyond the specific Supabase call replacements)
- `LineItemsEditor.jsx` and `computeLine` function
- All hooks: `useDataSearch`, `useDataSort`, `usePagination`, `useDateFilter`, `useLocationScope`
- `lib/dateRanges.js`, `lib/expenseutils.js`, `lib/fifoCost.js`, `lib/printInvoice.js`, `lib/timezone.js`, `lib/registerUtils.js`
- `Calculator.jsx` (safe arithmetic evaluator)
- All report filter UIs and print CSS
- Recharts / html2canvas usage
- `ConfirmDialog`, `EmptyState`, `Loader`, `StatusBadge`, `TableActions`, `Pagination`, `SortableHeader`, `DataSearchBar` components

---

## First Step to Begin

> **Start with Phase 0** — Electron scaffolding.
>
> Tell me when ready and I will generate the actual code for each file in Phase 0, starting with `package.json` → `vite.config.js` → `electron/main.js` → `electron/preload.js` → `electron/database/db.js` → migration runner → `001_initial_schema.sql`.
