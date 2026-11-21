# POS Web Application — Architecture & Flow Documentation

> A comprehensive reference for the multi-tenant, web-based Point of Sale (POS) system built with React, Supabase, and client-side business logic.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Tech Stack](#2-tech-stack)
3. [High-Level Architecture](#3-high-level-architecture)
4. [Multi-Tenancy & Security Model](#4-multi-tenancy--security-model)
5. [Authentication & Registration Flow](#5-authentication--registration-flow)
6. [Account Lifecycle (Trial / Active / Inactive)](#6-account-lifecycle-trial--active--inactive)
7. [Authorization: Roles & Permissions](#7-authorization-roles--permissions)
8. [Application Shell & Navigation](#8-application-shell--navigation)
9. [Database Schema Summary](#9-database-schema-summary)
10. [Module-by-Module Flows](#10-module-by-module-flows)
    - 10.1 [Dashboard](#101-dashboard)
    - 10.2 [User Management](#102-user-management)
    - 10.3 [Contacts (Customers & Suppliers)](#103-contacts-customers--suppliers)
    - 10.4 [Products, Categories & Tax Rates](#104-products-categories--tax-rates)
    - 10.5 [Purchases](#105-purchases)
    - 10.6 [Purchase Returns](#106-purchase-returns)
    - 10.7 [Sales](#107-sales)
    - 10.8 [Sales Returns](#108-sales-returns)
    - 10.9 [POS Billing Screen](#109-pos-billing-screen)
    - 10.10 [Stock](#1010-stock)
    - 10.11 [Expenses](#1011-expenses)
    - 10.12 [Reports](#1012-reports)
    - 10.13 [Settings](#1013-settings)
11. [Shared Components & Hooks](#11-shared-components--hooks)
12. [Business Calculations Reference](#12-business-calculations-reference)
13. [Notifications System](#13-notifications-system)
14. [Printing / Invoices](#14-printing--invoices)
15. [Folder Structure](#15-folder-structure)
16. [Known Gaps, Placeholders & Future Work](#16-known-gaps-placeholders--future-work)

---

## 1. Overview

This is a **responsive, multi-tenant Point of Sale (POS) system**. Each registered business ("tenant") gets its own isolated data space enforced at the database level. A business has one **Owner** who can invite staff, assign granular module-level permissions, manage multiple store **Locations**, and run the full retail workflow: products → stock → purchases → sales/POS → returns → expenses → reports.

There is currently **no dedicated backend server** — the React app talks directly to Supabase (Postgres + Auth) using the anon key, with **Row Level Security (RLS)** policies doing all tenant isolation. The codebase is intentionally structured so it *could* be moved behind a real backend later without a rewrite (see [§16](#16-known-gaps-placeholders--future-work)).

---

## 2. Tech Stack

| Layer | Technology |
|---|---|
| Frontend framework | React (JavaScript, functional components + hooks) |
| Routing | `react-router-dom` |
| Styling | Plain CSS per page/component, shared design tokens in `index.css` |
| Backend / DB | Supabase (Postgres) |
| Auth | Supabase Email Authentication |
| Charts | `recharts` |
| Screenshots / chart export | `html2canvas` |
| Deployment | Netlify |
| State management | React Context (`AuthContext`) + local component state — no Redux/Zustand |

---

## 3. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Browser (React SPA)                   │
│                                                                │
│  main.jsx                                                     │
│   └── BrowserRouter                                           │
│        └── AuthProvider (context/AuthContext.jsx)             │
│             └── App.jsx  (route table)                        │
│                  ├── Public routes: /login /signup /forgot... │
│                  └── ProtectedRoute-wrapped pages              │
│                       (checks session, business status,        │
│                        and per-module permission)              │
└───────────────────────────────┬───────────────────────────────┘
                                 │  supabase-js (anon key)
                                 ▼
┌─────────────────────────────────────────────────────────────┐
│                         Supabase                              │
│  ┌───────────────┐   ┌────────────────────┐                  │
│  │ Supabase Auth  │   │ Postgres (RLS ON)  │                  │
│  │ (auth.users)   │──▶│ public.users, ...  │                  │
│  └───────────────┘   └────────────────────┘                  │
│  current_business_id() SECURITY DEFINER function derives      │
│  the caller's tenant from auth.uid() → public.users.business_id│
└─────────────────────────────────────────────────────────────┘
```

There is no Express/Node/Edge Function layer today. All CRUD, totals math, stock ledger writes, and notification generation happen **in the browser**, then are persisted via Supabase client calls. The one exception noted in code comments: **new business registration** ideally needs a service-role backend step (to create the business row before a `public.users` row exists for RLS to key off), but the current signup flow works around this using RLS policies that specifically permit the initial insert sequence (business → user → referral code → default location).

---

## 4. Multi-Tenancy & Security Model

- Every tenant-scoped table carries a `business_id` foreign key into `businesses`.
- A single Postgres helper function does the heavy lifting:

```sql
current_business_id() -- SECURITY DEFINER
  SELECT business_id FROM public.users WHERE id = auth.uid() LIMIT 1;
```

- Every table has a `tenant_isolation_<table>` RLS policy of the form:

```sql
USING (business_id = public.current_business_id())
WITH CHECK (business_id = public.current_business_id())
```

- Tables that don't carry `business_id` directly (e.g. `purchase_items`, `sale_items`, `user_locations`, `product_locations`, `role_permissions`, `purchase_return_items`, `sell_return_items`, `shipments`) are scoped via a `IN (SELECT id FROM parent WHERE business_id = current_business_id())` subquery policy.
- **Frontend never needs to filter by `business_id` for security** — RLS already guarantees isolation — but the app *does* still pass `business_id` explicitly on every insert/select for clarity, indexing, and to satisfy `WITH CHECK`.
- The Supabase **anon key** is the only key shipped to the browser. The **service_role key must never reach the frontend** (explicitly called out in the schema comments) — it would be required only for a future backend-driven admin operation such as creating employee auth accounts server-side.

---

## 5. Authentication & Registration Flow

### 5.1 Sign Up (`signup.jsx`)

Two-step wizard:

**Step 1 — Business details**: name, currency, contact info, address, time zone, optional referral code (`REF00001` format, entered manually by the referred user, resolved dynamically — not stored as a literal FK).

**Step 2 — Owner account**: name, username, mobile, address, email + password (Supabase Auth credentials).

On submit, the sequence (with rollback safety) is:

1. `supabase.auth.signUp({ email, password })` → creates the `auth.users` row.
2. Insert into `businesses` (status defaults to `'trial'` in Postgres). `settings` JSONB stores `referred_by_code` if supplied.
3. **Immediately** insert the matching `public.users` row for the owner (`is_owner: true`) — this must happen right after step 2 and before any other write, because every RLS policy for this business resolves `current_business_id()` by reading this exact row.
4. Update `businesses.referral_code` to `REF${zero-padded business id}` (this business's own shareable code, generated from its ID — not manually chosen).
5. Insert a default `locations` row named `"Main Location"`.
6. If `auth.session` exists immediately (email confirmation disabled), call `applySession()` and redirect to `/dashboard`. Otherwise redirect to `/login` with a "check your email" message.

**Failure cleanup:** if any step after business creation fails, the business row is deleted (an RLS policy specifically allows deleting a business that has zero `users` rows — safe no-op otherwise).

### 5.2 Sign In (`login.jsx`)

Standard email/password via `supabase.auth.signInWithPassword`. `AuthContext.signIn()` explicitly `await`s `applySession()` before returning, specifically to avoid a "have to log in twice" bug where the profile/business hadn't loaded yet when the router redirected.

### 5.3 Forgot / Reset Password

- `forgotPassword.jsx` → `supabase.auth.resetPasswordForEmail(email, { redirectTo: /reset-password })`.
- `resetPassword.jsx` reads Supabase's recovery session from the URL hash. If the link is expired/used, Supabase puts a machine-readable `error_description` in the hash — the page parses and displays it instead of showing a silently broken form. Otherwise calls `supabase.auth.updateUser({ password })`.

### 5.4 Session Bootstrapping (`AuthContext.jsx`)

On mount: `supabase.auth.getSession()` → `applySession()` → `loadProfile(userId)`, which fetches:
- `public.users` row (the profile)
- `public.businesses` row (via `users.business_id`)
- `role_permissions` rows for the user

All three are held in context (`profile`, `business`, `permissions`) alongside `session`. `supabase.auth.onAuthStateChange` keeps this in sync on token refresh / sign-out from any tab.

### 5.5 Inactivity Logout (`useInactivityLogout.js`)

Mounted once in `App.jsx` with a 10-minute (`600_000`ms) timeout. Tracks mouse/keyboard/touch/scroll activity, persists `last_activity_at` to `localStorage` (so it survives tab close/reopen), and force-signs-out + redirects to `/login` with an explanatory message if the timeout elapses — checked both live (via `setTimeout`) and on `visibilitychange` (tab refocus).

---

## 6. Account Lifecycle (Trial / Active / Inactive)

`businesses.status` is a Postgres enum: `trial | active | inactive`.

- New businesses always start as `trial`.
- There is **no automated trial-expiry job** in this codebase — moving `trial → inactive` and `inactive → active` (after payment) are described as **platform-owner-only manual actions** (outside this app, e.g. via direct DB/admin tooling).
- `ProtectedRoute.jsx` checks `business?.status === 'inactive'` on every protected page load and redirects to `/account-inactive`.
- `AppLayout.jsx` shows a persistent trial banner (`banner-trial`) when `status === 'trial'`, linking to `/settings` for "Manage billing" (billing itself isn't implemented yet — see [§16](#16-known-gaps-placeholders--future-work)).
- `accountInactive.jsx` is a simple full-screen message with a sign-out button; no in-app payment flow exists yet.

---

## 7. Authorization: Roles & Permissions

Two tiers of access:

1. **Owner** (`users.is_owner = true`) — always has full access to every module and action; permission checks short-circuit to `true`.
2. **Staff** — access is governed by the `role_permissions` table: one row per `(user_id, module)` with four booleans — `can_view`, `can_create`, `can_edit`, `can_delete`.

**Modules currently modeled:** `purchases`, `sales`, `products`, `contacts`, `expenses`, `stock`, `reports`, `settings`, `user_management`, `pos`.

`AuthContext.can(module, action = 'view')` resolves this. `ProtectedRoute` uses it per-route (`<ProtectedRoute module="sales" action="create">`). Individual pages also call `can()` directly to conditionally show/hide buttons like "+ Add", "Edit", "Delete".

**Permission editing UI** (`userForm.jsx`) enforces a dependency rule client-side: any of Create/Edit/Delete being checked forces View on; unchecking View clears all three actions; unchecking the last remaining action re-derives whether View should stay on.

**Location scoping:** `user_locations` assigns staff to specific store locations. POS Billing (`posBilling.jsx`) filters the location dropdown to only the locations a non-owner user is assigned to (owners see all; a user assigned to zero locations also sees all, as a fallback).

---

## 8. Application Shell & Navigation

```
AppLayout
 ├── Sidebar        — left nav, filtered by can(module, 'view'); collapsible on desktop, drawer on mobile
 ├── Header          — business name, live clock, notifications bell, calculator popover, profile menu, "POS" quick-launch button
 ├── Trial banner    — shown only when business.status === 'trial'
 └── <main className="app-content"> {children} </main>
```

`SettingsLayout` is a second-level layout used only under `/settings/*`, adding its own left sub-nav (Business Profile, Locations, Invoice & Receipt — owner only; Categories, Tax Rates, My Preferences — everyone).

**Routing table** (`App.jsx`) maps every module to `view/create/edit` protected routes. Notable routing details:
- `/` redirects to `/dashboard`.
- `/pos` is a **full-screen, sidebar-less experience** (`pos-fullscreen` CSS class) — it renders without going through `AppLayout`.
- `/shipments` currently renders a generic `<Placeholder>` component — "This module is coming up next in the build order."
- `/reports/purchases` route element is (apparently by oversight) wired to `<SalesReport />` rather than a dedicated purchases report component — flagged in [§16](#16-known-gaps-placeholders--future-work).

---

## 9. Database Schema Summary

### Core tenancy
- `businesses` — one row per tenant. Holds address/contact/currency/time zone, `status` enum, `referral_code`, and a catch-all `settings JSONB` (used today for Invoice/Receipt settings — prefix, footer note, terms, tax breakdown toggle).
- `locations` — store/branch locations per business.
- `users` — staff profiles, 1:1 with `auth.users.id` (UUID PK = FK to Supabase Auth). Includes HR-ish fields (guardian info, ID proof, employment status, sales-agent flag + commission period) alongside `custom_fields JSONB` (used for a POS default-location preference).
- `user_locations` — many-to-many staff↔location assignment.
- `user_bank_details` — optional 1:1 bank info per user.
- `role_permissions` — per-user, per-module CRUD flags.

### Contacts & catalog
- `contacts` — unified customers/suppliers table (`contact_type` enum), with `opening_balance` and a soft-delete `is_active` flag.
- `contact_ledger` — append-only running ledger of balance-affecting events (`opening_balance`, `sale`, `purchase`, `payment`, `sale_return`, `purchase_return`, plus `*_edit` variants). **Positive amount = contact owes the business more; negative = balance reduced.** Current balance for a contact = `opening_balance + SUM(ledger rows excluding the opening_balance entry)`.
- `categories`, `tax_rates` — simple per-business lookup lists.
- `products` — SKU/barcode (auto-generated if left blank), cost price, default selling price, tax config (`applicable_tax_id`, `selling_price_tax_type`: inclusive/exclusive), `alert_quantity` for low-stock, soft-delete `is_active`.
- `product_locations` — which locations stock a given product.

### Inventory
- `stock_ledger` — **the single source of truth for on-hand quantity.** Every stock-moving event (purchase received, sale, purchase return, sell return, manual adjustment, sale/purchase edits and their reversals) writes a signed `change_qty` row here. Current stock for `(product, location)` = `SUM(change_qty)`. A `transfer` reason value already exists in the enum for a future stock-transfer feature, even though it's unused today (see [§16](#16-known-gaps-placeholders--future-work)).

### Transactions
- `purchases` / `purchase_items` — `purchase_status`: `draft | received | cancelled`. Stock is only affected once status becomes `received`. All monetary totals (`subtotal`, `tax_amount`, `discount_amount`, `shipping_charges`, `grand_total`) are computed by the app and written — never trusted from raw client input beyond the line items themselves.
- `purchase_returns` / `purchase_return_items` — always reference the original purchase (`ON DELETE RESTRICT`); each return line references a specific `purchase_item_id`.
- `sales` / `sale_items` — `sale_status`: `draft | quotation | confirmed | shipped | returned | partially_returned`. `channel`: `pos` vs `manual` distinguishes POS-billing-created sales from the regular Sales module. Stock is only affected once status becomes `confirmed`.
- `sell_returns` / `sell_return_items` — every sell return **writes a positive row straight back to `stock_ledger`** (restocked as sellable immediately — there's intentionally no "written off"/quarantine state).
- `shipments` — schema exists (`shipment_status`, `tracking_info`) but the UI is a placeholder page today.
- `agent_commissions` — schema exists for sales-agent commission tracking; not yet wired into any UI flow found in this codebase.

### Expenses
- `expense_categories`, `recurring_expense_templates`, `expenses` (extended beyond the original schema draft with `title`, `vendor`, `reference_number`, `status` (`paid`/`pending`) columns — see `expenseutils.js`).

### Notifications
- `notifications` — polymorphic `related_reference_type` / `related_reference_id`, `type` (e.g. `low_stock`, `payment_due_customer`, `payment_due_supplier`), `is_read`.

### RLS
Every table above has `ENABLE ROW LEVEL SECURITY` plus a tenant-isolation policy (direct `business_id` check, or a subquery through the parent table for child tables). See [§4](#4-multi-tenancy--security-model).

---

## 10. Module-by-Module Flows

### 10.1 Dashboard

**Route:** `/dashboard` · **File:** `dashboard.jsx`

Two independent data zones:

1. **Date-filtered summary cards** (Total Sales, Net, Invoice Due, Total Sales Return, Total Purchase, Purchase Due, Total Purchase Return, Expense) — driven by a preset/custom date-range picker (`dateRanges.js` → `DASHBOARD_PRESETS`: Today, Yesterday, 7/30 Days, This/Last Month, This/Last Year, or Custom). Only confirmed sales / received purchases / active `is_active` records are aggregated.
2. **Always-live sections** (explicitly *not* affected by the date filter, with a note in the UI saying so):
   - **Sales Payment Due** — confirmed, active sales with `due_amount > 0`, sorted by due amount descending.
   - **Purchase Payment Due** — received, active purchases where `grand_total − advance_payment > 0`.
   - **Low Stock Alerts** — computed by summing `stock_ledger.change_qty` per `(product, location)` and comparing against `products.alert_quantity`.
   - **Pending Shipments** — `shipments` not yet `delivered`, joined through `sales` for customer/location context.

Also includes a **Sales Overview bar chart** (Recharts) with its own independent filter: Last 30 Days / Specific Month / Whole Year, aggregating `sales.grand_total` by day or by month.

All four "live" sections and the chart use `Promise.all` for parallel fetches, and all four tables share the generic `usePagination` hook (10 rows/page).

### 10.2 User Management

**Routes:** `/users`, `/users/new`, `/users/:id` · **Files:** `users.jsx`, `userForm.jsx`

- List view: searchable (name/username/mobile), sortable, paginated. Shows Name, Username, Mobile, Role badge (Owner/Staff + optional "Agent" badge), Employment status, Active/Disabled toggle.
- Owners cannot be disabled from this screen (`toggleActive` no-ops for `is_owner` rows).
- **Create flow** uses `supabaseAdminAction` — a **second, isolated Supabase client** with a different `storageKey` (`pos-auth-admin-action`) and `persistSession: false`. This exists solely so that calling `auth.signUp()` for a *new employee* does not clobber the *owner's own* logged-in session in the same browser tab. After the new `public.users` row, bank details, permissions, and location assignments are all saved, the admin-action client explicitly signs itself out. The code comments flag this as a **stopgap**: the correct long-term fix is a small backend/Edge Function using the `service_role` key server-side (`auth.admin.createUser()`), so the new employee doesn't need email verification and the owner's session is never at risk.
- **Edit flow** updates profile fields, bank details (upserted, or deleted if all fields are blanked), permissions (`upsert` on `(user_id, module)`), and location assignments (delete-all-then-reinsert).
- Permission matrix UI enforces the View↔Action dependency described in [§7](#7-authorization-roles--permissions).

### 10.3 Contacts (Customers & Suppliers)

**Routes:** `/contacts`, `/contacts/new`, `/contacts/:id` · **Files:** `contacts.jsx`, `contactForm.jsx`

- Single table (`contacts`) with a `contact_type` tab switch (Customer/Supplier) in the list UI — type cannot be changed after creation (`disabled={isEdit}` on the select in the form).
- Balance column = `opening_balance + Σ(contact_ledger.amount excluding opening_balance rows)`, computed client-side per page load.
- Soft delete: sets `is_active = false` rather than removing the row (so historical sales/purchases keep referencing a valid contact).
- Suppliers get an extra `tax_ntn_number` field; customers don't.
- Each list has a shortcut to its dedicated report (`/reports/customers` or `/reports/suppliers`).

### 10.4 Products, Categories & Tax Rates

**Routes:** `/products`, `/products/new`, `/products/:id`, `/categories`, `/tax-rates` · **Files:** `products.jsx`, `productForm.jsx`, `categories.jsx`, `taxRates.jsx`

- **Product list**: current stock is computed by summing `stock_ledger.change_qty` per product across all locations (loaded in bulk via `.in('product_id', ids)` rather than N+1 queries). Low-stock rows get a danger badge.
- **Product form**:
  - SKU/barcode auto-generate (`{first3letters}-{base36 timestamp}`) if left blank.
  - **Two-way price ↔ profit-margin calculator**: editing cost price, selling price, profit margin %, tax rate, or tax type recalculates the other dependent field live (`calculateSellingPrice` / `calculateProfitMargin`, respecting inclusive vs. exclusive tax).
  - Multi-location assignment via toggle chips (`product_locations`).
  - **"Save and add opening stock"** flow: after creating the product and its location links, a second inline screen asks for an opening quantity per selected location, written to `stock_ledger` with `reason: 'adjustment'`. New (non-edit) products always get zero-quantity ledger rows inserted for every selected location up front, so the product always has a row in `stock_ledger` to sum over (avoiding "invisible" zero-stock products).
  - Duplicate name detection surfaces Postgres unique-violation (`23505`) as a friendly message.
- **Categories / Tax Rates**: simple CRUD lookup-list pages sharing `lookupList.css`. Deleting a category/tax rate in use elsewhere is caught and surfaced as a friendly error (FK `RESTRICT` on `products.category_id` / `applicable_tax_id`). Tax rates support soft deactivate/reactivate instead of hard delete.

### 10.5 Purchases

**Routes:** `/purchases`, `/purchases/new`, `/purchases/due` · **Files:** `purchases.jsx`, `purchaseForm.jsx`, `purchaseDue.jsx`

**Purchase Form (`purchaseForm.jsx`)** handles both create and edit (`?id=` query param) in one component:
- Loads locations, suppliers, products, tax rates.
- Uses the shared `LineItemsEditor` in **purchase mode** (shows discount, unit-price-before-tax, profit-margin %, and default selling price columns — purchasing a product can update its forward-looking selling price expectations).
- **Save as Draft** vs **Save & Receive Stock** — `purchase_status` is set accordingly; the whole computation of stock-ledger deltas is status-aware:
  - `getEffectiveStockMap(status, locationId, items)` returns an empty map unless `status === 'received'`.
  - On **edit**, the old effective stock map (based on the original saved status/location/items) is diffed against the new effective map; only the **delta** per `(product, variant, location)` key is written to `stock_ledger`, tagged `reason: 'purchase_edit'` (vs `'purchase'` on create). This correctly handles all edit transitions: draft→draft (no stock change), draft→received (full add), received→received with changed quantities (delta only), received→draft (full reversal).
  - Editing is **blocked** if any of the purchase's original items already have linked `purchase_return_items` — the user is told to create a new adjustment instead, to avoid corrupting return references.
- **Supplier ledger**: on edit, if the purchase *was* received, the old `due` amount is reversed via a negative `contact_ledger` insert (`reference_type: 'purchase_edit'`); if the new status is received, the new `due` is applied. This keeps the ledger additive/append-only rather than mutating history.
- Notifies the supplier's payment-due alert (`notifyPaymentDueSupplier`) only when the received-status actually changed or the supplier changed, to avoid duplicate notifications on unrelated edits.

**Purchases list (`purchases.jsx`)**:
- Rich filter bar: Supplier, Location, Status, Payment Status (due/paid, computed client-side), Added By.
- Expandable rows show line items (lazy-loaded on first expand, cached thereafter).
- **"Mark received"** action (for draft purchases) directly in the list — writes stock, applies supplier ledger, updates status, and fires the payment-due notification — all without navigating to the form.
- **Inline Return modal**: opens on a received purchase, loads its items plus any prior returns against them (to compute "remaining returnable qty"), lets the user enter whole-number return quantities, computes the credit amount using each item's *effective* per-unit price (`line_total / purchased_qty`, so proportional discounts/tax carry through), and on submit: inserts `purchase_returns` + `purchase_return_items`, writes negative `stock_ledger` rows (`reason: 'purchase_return'`), credits the supplier ledger (negative amount), and runs a best-effort low-stock check.

**Purchases Due (`purchaseDue.jsx`)**: a focused, searchable/filterable/sortable list of only purchases with `grand_total − advance_payment > 0`, with a **Record Payment** modal that increments `advance_payment`, sets `paid_on`, and writes a negative `contact_ledger` entry.

### 10.6 Purchase Returns

**Routes:** `/purchases/returns`, `/purchases/returns/new` · **Files:** `purchaseReturns.jsx`, `purchaseReturnForm.jsx`

A read-mostly log of all `purchase_returns`, expandable to show line items, searchable by supplier/amount, sortable, paginated, with a running "current page total." (Creation happens primarily through the inline modal in the Purchases list described above; `purchaseReturnForm.jsx` exists as a standalone equivalent view/entry point sharing the same expandable-row pattern.)

### 10.7 Sales

**Routes:** `/sales`, `/sales/new`, `/sales/due`, `/sales/returns`, `/sales/returns/new` · **Files:** `sales.jsx`, `saleForm.jsx`, `salesDue.jsx`

**Sale Form (`saleForm.jsx`)** — create or edit (`?edit=` query param):
- Loads locations, customers, sales agents (`users.is_sales_agent = true`), products, tax rates.
- `LineItemsEditor` in **sale mode** (no purchase-only columns; stock-aware — items are disabled once out of stock).
- **Stock-aware quantity guard for edits**: `getAvailableStockForEdit()` adds back the *original* confirmed sale's quantities to the live stock figure before validating the *new* requested quantities, so editing a confirmed sale doesn't falsely report insufficient stock against its own prior deduction.
- Returned/partially-returned sales **cannot be edited** (thrown as an error immediately on load).
- **Save as Draft / Save as Quotation / Confirm & Deduct Stock** — three explicit status targets.
- On edit of a previously-confirmed sale: the old stock deduction is **reversed** (`reason: 'sale_edit_reversal'`, positive `change_qty`) before the new deduction is applied (`reason: 'sale_edit'`), and the old sale items are deleted and reinserted fresh.
- `contact_ledger` entries for sales are **deleted and recreated** on every edit (rather than diffed), keeping the logic simple at the cost of ledger granularity for edits specifically.
- Fires low-stock and payment-due-customer notifications (best-effort, failures swallowed) only when the sale is being confirmed.

**Sales list (`sales.jsx`)**:
- The richest filter set in the app: free-text search (invoice #, customer, total) + dropdown filters for Status, Payment Status, Location, Customer, Payment Method, Added By — all client-side over the loaded dataset, combined with sort and manual (non-hook) pagination (18/page).
- Expandable rows show line items.
- Row actions are contextual: **Edit** (if `canEdit`), **Confirm sale** (draft/quotation only), **Return** (only for `confirmed | shipped | partially_returned`).
- **Confirm Sale inline** mirrors the "Mark received" purchase action: writes stock, applies customer ledger if there's a due balance, updates status, runs low-stock + payment-due checks.
- **Inline Return modal**: loads sale items + prior return quantities, validates remaining quantities are whole numbers within bounds, and on submit: inserts `sell_returns`/`sell_return_items`, writes **positive** stock rows (immediate restock — see schema note in [§9](#9-database-schema-summary)), credits the customer ledger, and updates the parent sale's `status` to `returned` (if every line is now fully returned) or `partially_returned`, along with a recalculated `due_amount`.

**Sales Due (`salesDue.jsx`)**: same pattern as Purchases Due — filtered list of `due_amount > 0` confirmed sales with a Record Payment modal that decrements `due_amount`, increments `paid_amount`, and writes a negative ledger entry.

### 10.8 Sales Returns

**Routes:** `/sales/returns`, `/sales/returns/new` · **Files:** `sellReturns.jsx`, `sellReturnForm.jsx`

- `sellReturns.jsx`: full log of all returns — search (invoice/customer/amount), filters (invoice, customer, created-by), sort, pagination, expandable line items.
- `sellReturnForm.jsx`: a **standalone, also-embeddable** form component (`embedded` prop + `onSuccess` callback lets it be reused inside another flow, though the primary entry point today is the dedicated `/sales/returns/new` route or the inline modal in Sales/POS). Supports searching for the source sale by invoice number or customer/date via a `<datalist>`-backed autocomplete, then the same remaining-quantity/whole-number validation and stock-restock/ledger-credit logic as the inline modal.

### 10.9 POS Billing Screen

**Route:** `/pos` · **File:** `posBilling.jsx` (full-screen, no sidebar)

The most feature-dense screen in the app — a real-time checkout register:

- **Layout**: fixed-height, two-column — left column (cart + payment controls + quick-action footer) never scrolls out of view; right column (product grid with category tabs) scrolls independently. Collapses to a single scrollable column under 1100px.
- **Location switcher** in the toolbar (only shown if the user has access to >1 location); switching resets the current register.
- **Live clock**, fullscreen toggle (`document.requestFullscreen`), and a **Calculator** popover (shared `Calculator.jsx` component — see [§11](#11-shared-components--hooks)).
- **Product search**: type-ahead dropdown with keyboard navigation (↑/↓/Enter/Escape), and **exact-SKU barcode-scanner support** (pressing Enter with a search string that exactly matches a SKU adds it directly, bypassing the dropdown — this is how a physical barcode scanner "typing + Enter" integrates without special hardware APIs).
- **Cart**: editable quantity (± buttons or direct input, clamped to available stock with an inline "Stock is N" error), editable per-line unit price (session-only override — does not touch `products.default_selling_price`, shown with a "was $X" strikethrough when overridden).
- **Customer search** with the same dropdown pattern, defaulting to "Walk-In Customer."
- **Totals**: subtotal, overall discount (fixed or %), auto-computed order tax (rolled up from `computeLine()` per item, respecting each product's inclusive/exclusive tax type), shipping, grand total — all rounded to whole units at each step (`Math.round`) to avoid fractional-cent drift, matching the currencies typically used (e.g. PKR).
- **Payment actions**: Cash, Card, Multi/Split-pay (modal for cash+card combination, validated not to exceed the total), and **Credit Sale** (pays $0 now, due in full — requires a non-walk-in customer, enforced in `finalizeSale`).
- **Keyboard shortcuts**: F8 = open multi-pay, F9 = pay by card, F10 = pay by cash (guarded against firing while a modal is already open or a submission is in flight).
- **Quick actions row**: Save as Draft, Save as Quotation, **Suspend Sale** (holds the current cart in component state only — explicitly *not* persisted, lost on refresh, with a badge counter and a "Suspended sales" modal to resume/discard), Credit Sale, Cancel/Clear.
- **Inline "+" modals** to create a new Customer, a new Product (with optional opening stock at the current location, added to the cart immediately after creation), or a new Expense (against the current location, defaulting to Cash) — all without leaving the POS screen.
- **Recent Transactions** modal (last 10 POS sales) and **Today's Summary** modal (count + total for the current location, from midnight).
- **On finalize**: inserts the `sales` row (`channel: 'pos'`, `status: 'confirmed'`), `sale_items`, negative `stock_ledger` rows, optional `contact_ledger` entry, best-effort low-stock + payment-due notifications, then shows a **Sale Completed** receipt modal with a **Print Invoice** button (`printSaleInvoice`, see [§14](#14-printing--invoices)).

### 10.10 Stock

**Route:** `/stock` · **File:** `stock.jsx`

- Flattened `(product × location)` grid — only rows that actually have a `stock_ledger` entry are shown (i.e., products not stocked at a location don't appear as a phantom zero row).
- Inline **Adjust** action: click to edit on-hand quantity directly; the diff between the entered target and current on-hand is written as a single `stock_ledger` row (`reason: 'adjustment'`), then a best-effort low-stock check runs against the new quantity.
- Search (name/SKU) + location filter, paginated.
- Links out to the fuller `/reports/stock` for valuation and historical drill-down (see [§10.12](#1012-reports)).

### 10.11 Expenses

**Routes:** `/expenses`, `/expenses/new`, `/expenses/:id`, `/expense-categories`, `/recurring-expenses`, `/recurring-expenses/new`, `/recurring-expenses/:id`
**Files:** `expenses.jsx`, `expenseForm.jsx` (thin wrapper), `ExpenseFormDialog.jsx` (the actual modal form, shared/reused), `ExpenseViewDrawer.jsx`, `expenseCategories.jsx`, `recurringExpenses.jsx`, `recurringExpenseForm.jsx`, `expenseutils.js`

- Expenses are explicitly scoped to **operational costs** (rent, utilities, salaries) — the UI repeatedly notes that inventory purchases belong in the Purchases module, not here.
- `expenseutils.js` centralizes shared logic: date-preset matching, CSV export (`exportExpensesCsv`, escapes quotes/commas/newlines, filename includes business name + date), money formatting, status derivation (`status` column if present, else inferred from whether a `payment_method` is set), and form↔row mapping.
- **List page** (`expenses.jsx`): 5-card summary strip (Total / Today / This Month / Pending / Paid), rich filter toolbar (search, category, location, payment method, status, date-preset chips + custom range), a right-aligned live "Filtered total," CSV export, browser print, and a **View drawer** (`ExpenseViewDrawer.jsx`) for read-only detail before committing to Edit.
- **Form** (`ExpenseFormDialog.jsx`) is a reusable modal (not a full page) invoked both from the Expenses list and from within POS Billing's "+ Add Expense" modal — driven by an `open`/`expenseId`/`onSaved`/`onClose` prop contract. Includes a disabled file-upload placeholder explicitly marked "will connect when document storage is enabled."
- **Categories** (`expenseCategories.jsx`): CRUD list with modal edit/delete (delete blocked with a friendly message if expenses reference the category — FK `RESTRICT`).
- **Recurring templates** (`recurringExpenses.jsx` / `recurringExpenseForm.jsx`): defines an amount/category/location/frequency/`next_due_date`. **There is no automatic scheduler** — a **"Run now"** button manually inserts a real `expenses` row dated on `next_due_date` and advances the template's `next_due_date` by its frequency (`advanceDate()` helper: daily/weekly/monthly/yearly). The list flags overdue-but-active templates with a "Due" badge. Pause/Resume toggles `is_active` without deleting the template.

### 10.12 Reports

**Route:** `/reports` (index) plus one route per report · **File:** `reportsIndex.jsx` + individual report files

All report pages share a consistent shape: a filter bar (date preset/custom range, sometimes location/status), a `PrintReportHeader` component that renders **only in print media** (business identity, generated-by/at, active-filter chips — hidden on screen, shown via `@media print`), summary cards, and one or more detail tables/charts. Every report has a **Print / Save PDF** button (`window.print()`) with dedicated print CSS (see [§14](#14-printing--invoices) note on shared print rules in `index.css`).

| Report | File | Highlights |
|---|---|---|
| Sales & Purchase | `salesReport.jsx` | Side-by-side purchase vs. sales panels: totals, tax, returns, dues, and a derived "Net" figure per side. |
| Profit & Loss | `profitLossReport.jsx` | The most complex report. Computes opening/closing stock valuation (at both cost and selling price) from `stock_ledger` split by date boundary, COGS = opening + purchases − closing, gross profit = sales − COGS, then net profit = gross profit + credits (shipping/discounts) − debits (adjustments, expenses, purchase shipping, sell discounts). Includes 8 tabbed breakdown views (by Product, Category, Brand [derived from the first word of the product name], Location, Invoice, Date, Customer, Day-of-week), each independently searchable. |
| Stock | `stockReport.jsx` | Valuation at cost & sale price, potential profit/margin, filterable by location/category/derived-brand, paginated. Each row has a **"History"** drill-down into a dedicated sub-view showing every `stock_ledger` entry for that product with resolved reference names (sale/purchase/return counter-party), plus a full opening/purchase/sold/adjustment/return reconciliation summary. |
| Customers | `customersReport.jsx` | Per-customer orders count, revenue, last purchase date, and live outstanding balance; location filter. |
| Suppliers | `suppliersReport.jsx` | Mirror of the Customers report for the supply side. |
| Expenses | `expensesReport.jsx` | Bar chart of expenses over time (downloadable as PNG via `html2canvas`), category/location breakdown, detailed list. |
| User Activity | `userActivityReport.jsx` | Per-staff sales/purchases processed (count + total) and expenses logged, a top-5 leaderboard bar chart, and an explicit disclaimer that the schema doesn't track login/logout or page-view telemetry — this is transactional attribution only. |

### 10.13 Settings

**Routes:** `/settings` (redirects to Business Profile for owners, My Preferences for staff), `/settings/business`, `/settings/locations`, `/settings/locations/new`, `/settings/locations/:id`, `/settings/invoice`, `/settings/preferences`

- **Business Profile** (`businessSettings.jsx`, owner-only route): edits `businesses` columns directly. **Currency is locked once any sale or purchase exists** (`hasTransactions` check via count queries) since all stored totals are denominated in it.
- **Locations** (`locations.jsx` / `locationForm.jsx`, owner-only): CRUD; deactivating a location that has stock history prompts a confirm dialog first (deactivation hides it from new transactions but preserves historical records — it never hard-deletes).
- **Invoice & Receipt Settings** (`invoiceReceiptSettings.jsx`, owner-only): stored inside `businesses.settings JSONB` (merged/patched, not overwritten wholesale) — invoice number prefix, footer note, terms, receipt footer note, and a tax-breakdown toggle.
- **My Preferences** (`userPreferences.jsx`, everyone): a default POS location (stored in `users.custom_fields JSONB`, read by `posBilling.jsx` on load) and a self-service password change (`supabase.auth.updateUser`).
- Categories and Tax Rates are also reachable from the Settings sidebar but live at top-level routes `/categories` and `/tax-rates` (shared with the Products module — see [§10.4](#104-products-categories--tax-rates)).

---

## 11. Shared Components & Hooks

| Name | Purpose |
|---|---|
| `AppLayout.jsx` / `SettingsLayout.jsx` | Page chrome (sidebar/header, or settings sub-nav). |
| `Sidebar.jsx` / `Header.jsx` | Nav + business identity/clock/notifications/calculator/profile menu. |
| `ProtectedRoute.jsx` | Session, account-status, and permission gate for every authenticated route. |
| `LineItemsEditor.jsx` (+ `computeLine`) | Shared line-item table for both Purchases and Sales forms, mode-aware (`purchase` vs `sale`), with a type-ahead product search, stock-awareness for sales, and the canonical **line total formula** (see [§12](#12-business-calculations-reference)) reused everywhere a line item is priced. |
| `DataSearchBar.jsx` + `useDataSearch.js` | Generic free-text search over an array of rows, matching against string fields or custom accessor functions. |
| `SortableHeader.jsx` + `useDataSort.js` | Generic 3-state (asc → desc → none) column sorting with typed comparators (text/number/date). |
| `Pagination.jsx` + `usePagination.js` | Generic page-window slicing with ellipsis-collapsed page-number UI. |
| `Calculator.jsx` | A **hand-rolled, safe arithmetic evaluator** (custom tokenizer/parser for `+ - * / .`) used instead of `eval`/`Function` specifically to avoid both code-injection risk and a strict-mode octal-literal parsing bug. Supports keyboard input, click-outside-to-close. |
| `ReportFilters.jsx` / `PrintReportHeader.jsx` / `ReportHeader.jsx` | Shared report-page filter bar and print-only headers. |
| `useInactivityLogout.js` | Described in [§5.5](#55-inactivity-logout-useinactivitylogoutjs). |
| `notifications.js` (`checkLowStockForItems`, `checkLowStockDirect`, `notifyPaymentDueCustomer`, `notifyPaymentDueSupplier`, `notifyOnce`) | Described in [§13](#13-notifications-system). |
| `printInvoice.js` | Described in [§14](#14-printing--invoices). |
| `dateRanges.js` | Canonical preset→`{from,to}` resolver shared by the Dashboard and every Report page. |
| `expenseutils.js` | Expense-domain helpers (CSV export, status derivation, form↔row mapping). |

---

## 12. Business Calculations Reference

All monetary math is computed **client-side** and then persisted (never trusted as raw client input beyond the line-item inputs themselves — see the schema comment on `purchases`).

**Per-line-item** (`computeLine` in `LineItemsEditor.jsx`):
```
subtotal   = quantity × unit_price
discount   = discount_type === 'percentage' ? subtotal × discount_amount / 100 : discount_amount
net        = max(subtotal − discount, 0)
taxRate    = tax_id ? taxRates[tax_id].rate_percentage : 0
taxType    = product.selling_price_tax_type ?? 'exclusive'

if taxType === 'inclusive':
    taxAmount = net − net / (1 + taxRate/100)     // tax is backed out of net
    lineTotal = net
else:  // exclusive
    taxAmount = net × taxRate / 100
    lineTotal = net + taxAmount
```

**Document totals** (Purchases / Sales forms):
```
subtotal        = Σ (line.subtotal − line.discount)
taxAmount       = Σ line.taxAmount
overallDiscount = discount_type === 'percentage' ? subtotal × discount_amount / 100 : discount_amount
grandTotal      = max(subtotal − overallDiscount, 0) + taxAmount + shipping
due (sales)     = max(grandTotal − paidAmount, 0)
```

**POS Billing** uses the same shape but explicitly **rounds subtotal, tax, discount, and shipping to whole numbers at each step** (`Math.round`) before summing, rather than rounding only the final total — this is a deliberate choice to keep register math matching physical cash/whole-currency-unit expectations.

**Contact balance** (Contacts list / Customers & Suppliers reports):
```
balance = opening_balance + Σ(contact_ledger.amount WHERE reference_type != 'opening_balance')
```

**Profit & Loss** (`profitLossReport.jsx`):
```
COGS         = openingStockAtCost + totalPurchases − closingStockAtCost
grossProfit  = totalSales − COGS
netProfit    = grossProfit
             + (sellShippingCharges + purchaseDiscounts)             // credits
             − (stockAdjustmentValue + expenses + purchaseShipping   // debits
                + sellDiscounts)
```
Opening/closing stock quantities are derived by partitioning `stock_ledger` rows by `created_at` against the report's date range boundary, then valued at each product's current `cost_price`/`default_selling_price` (not a historical price snapshot — a known simplification).

---

## 13. Notifications System

Centralized in `lib/notifications.js`. Key design: **de-duplication via `notifyOnce()`** — before inserting a notification, it checks for an existing **unread** row with the same `(business_id, type, related_reference_type, related_reference_id)`. If one exists, nothing new is inserted. This means a single low-stock condition doesn't spam a new row on every sale — it only raises a fresh alert **after** the previous one has been marked read. Two low-stock entry points exist:

- `checkLowStockForItems({ businessId, locationId, items, productsById })` — re-queries the live on-hand quantity per affected product after a stock-moving write (sale, purchase return, etc.) and compares to `alert_quantity`.
- `checkLowStockDirect(...)` — for call sites that already know the resulting quantity (e.g. a manual Stock adjustment), skipping the extra query.

Payment-due notifications (`notifyPaymentDueCustomer`, `notifyPaymentDueSupplier`) are fired opportunistically after a sale/purchase is confirmed/received with a non-zero due amount. **All notification calls throughout the app are wrapped in try/catch and treated as best-effort** — a notification failure never blocks or rolls back the underlying business transaction. Notifications are surfaced in `Header.jsx`'s bell icon dropdown (`getLatestNotifications`, last 10, mark-one-read or mark-all-read).

---

## 14. Printing / Invoices

Two distinct printing mechanisms exist:

1. **Report printing** — `window.print()` against the current page, using `@media print` rules defined centrally in `index.css` (hides sidebar/header/banners, keeps navy accents via `print-color-adjust: exact`, forces tables to repeat headers per page and avoid mid-row page breaks, collapses multi-column dashboard grids to one column) plus each report's own `PrintReportHeader` component for a consistent business-identity block.
2. **Invoice/Receipt printing** — `lib/printInvoice.js` opens a **new browser window** and writes a fully self-contained HTML document (own inline `<style>`, since a popup window has no access to the app's bundled CSS), then calls `window.print()` on load. This is deliberately decoupled from any React component — it's a plain function callable from anywhere (currently used from POS Billing's receipt modal via `printSaleInvoice`; `printPurchaseInvoice` exists as an equally-ready counterpart for the Purchases side). Both convenience wrappers delegate to the generic `printInvoice({ documentType, business, party, seller, columns, rows, totals, footerNote })` so any future document type (quotation, delivery note, etc.) can reuse the same layout engine by just changing the `columns`/`totals` config.

---

## 15. Folder Structure

```
src/
 ├── main.jsx                  — app entry, wraps App in BrowserRouter + AuthProvider
 ├── App.jsx                   — full route table
 ├── index.css                 — design tokens, shared component classes, print rules
 │
 ├── context/
 │    └── AuthContext.jsx      — session/profile/business/permissions + can()
 │
 ├── components/                — shared, reusable UI (not page-specific)
 │    ├── AppLayout.jsx / .css
 │    ├── SettingsLayout.jsx / .css
 │    ├── Sidebar.jsx / .css
 │    ├── Header.jsx / .css
 │    ├── ProtectedRoute.jsx
 │    ├── Calculator.jsx / .css
 │    ├── LineItemsEditor.jsx / .css
 │    ├── DataSearchBar.jsx / .css
 │    ├── SortableHeader.jsx / .css
 │    ├── Pagination.jsx / .css
 │    ├── ReportFilters.jsx / .css
 │    ├── ReportHeader.jsx / PrintReportHeader.jsx / .css
 │    └── expenses/
 │         ├── ExpenseFormDialog.jsx
 │         └── ExpenseViewDrawer.jsx
 │
 ├── hooks/
 │    ├── useDataSearch.js
 │    ├── useDataSort.js
 │    ├── usePagination.js
 │    ├── useDateFilter.js
 │    └── useInactivityLogout.js
 │
 ├── lib/
 │    ├── supabaseClient.js    — two clients: `supabase` (main session) + `supabaseAdminAction` (isolated, for employee signUp)
 │    ├── dateRanges.js
 │    ├── notifications.js
 │    ├── printInvoice.js
 │    └── expenseUtils.js
 │
 └── pages/                     — one file (+ optional .css) per route, described in §10
      ├── login.jsx / signup.jsx / forgotPassword.jsx / resetPassword.jsx / accountInactive.jsx
      ├── dashboard.jsx
      ├── users.jsx / userForm.jsx
      ├── contacts.jsx / contactForm.jsx
      ├── products.jsx / productForm.jsx / categories.jsx / taxRates.jsx
      ├── purchases.jsx / purchaseForm.jsx / purchaseDue.jsx
      ├── purchaseReturns.jsx / purchaseReturnForm.jsx
      ├── sales.jsx / saleForm.jsx / salesDue.jsx
      ├── sellReturns.jsx / sellReturnForm.jsx
      ├── posBilling.jsx / posBilling.css
      ├── stock.jsx
      ├── expenses.jsx / expenseForm.jsx / expenseCategories.jsx
      ├── recurringExpenses.jsx / recurringExpenseForm.jsx
      ├── reportsIndex.jsx / salesReport.jsx / profitLossReport.jsx / stockReport.jsx /
      │    customersReport.jsx / suppliersReport.jsx / expensesReport.jsx / userActivityReport.jsx
      ├── settingsIndex.jsx / businessSettings.jsx / locations.jsx / locationForm.jsx /
      │    invoiceReceiptSettings.jsx / userPreferences.jsx
      └── placeholder.jsx        — generic "coming up next" stand-in (used by /shipments)
```

---

## 16. Known Gaps, Placeholders & Future Work

These are things visible directly in the current code/comments — useful as a punch list:

- **No real backend yet.** All business logic runs client-side against Supabase with the anon key. The project instructions explicitly frame this as intentional-for-now, structured so it can be lifted into a proper backend later without a rewrite.
- **Employee account creation is a stopgap.** Using a second isolated Supabase client to call `auth.signUp()` for a new employee (from `userForm.jsx`) works, but the maintainable fix is a backend/Edge Function using `service_role` + `auth.admin.createUser()`.
- **Trial-expiry and Active-status transitions are fully manual** — no scheduled job flips `trial → inactive`, and only "platform owners" (outside this app) can flip a business to `active` after payment. There's no in-app billing/payment integration yet (`AppLayout`'s trial banner links to `/settings` but Settings has no billing page).
- **Shipments module** is routed but renders only a `<Placeholder>` — the `shipments` table and Dashboard "Pending Shipments" section exist, but there's no create/manage UI yet.
- **`/reports/purchases`** route currently points at the `SalesReport` component instead of a dedicated purchases-only report — likely an oversight in `App.jsx`.
- **Stock Transfer** — the `stock_reason_enum` already includes a `'transfer'` value "even though stock transfer is out of v1 scope," per the schema's own comment, and Stock Report's UI already renders "Stock Transfer (In/Out)" cards hardcoded to `0` — the feature is scaffolded but not implemented.
- **Quotations, Drafts, Discounts (as a standalone module), and Referral rewards** are named in the original product brief (`POS-INSTRUCTIONS.txt`) but only partially realized: Quotations/Drafts exist as **sale statuses** (not a separate module/list beyond the main Sales table with a status filter), Discounts are per-line/per-document fields rather than a rules engine, and referral-code rewards (`reward_status_enum`) have no visible UI/automation consuming them yet.
- **Agent commissions** (`agent_commissions` table, `is_sales_agent`/`commission_period` on `users`) have no computation/payout UI in this codebase yet.
- **Product variants** — `stock_ledger`, `purchase_items`, `sale_items`, etc. all carry a `variant_id` FK to a `product_variants` table, and `products.product_type` includes `'variable'`/`'combo'` — but no `product_variants` table definition or variant-management UI appears in the reviewed schema/code, so this is forward-scaffolding for a not-yet-built feature.
- **Sale/Purchase edit ledger handling differs in granularity**: purchase edits reverse-then-reapply the *net due* as two ledger rows; sale edits delete-and-recreate the ledger entry outright. Both are functionally correct for current balance but worth harmonizing if a full audit trail becomes a requirement.
- **P&L stock valuation uses current cost/selling price**, not a historical price-at-time-of-transaction snapshot — acceptable for now but will drift from "true" historical P&L if prices change significantly over time.
- **File attachments for expenses** are UI-scaffolded (`expense-upload-zone`) but explicitly disabled pending document storage.

---
FOLDER STRUCTURE
```
src/
 ├── lib/                supabaseClient, dateRanges, notifications helpers
 ├── hooks/               useInactivityLogout
 ├── context/             AuthContext (session, profile, business, permissions)
 ├── components/          AppLayout, Sidebar, Header, Calculator, ProtectedRoute,
 │                        LineItemsEditor, ReportHeader, ReportFilters
 └── pages/                one component + one CSS file per module, per the
                           original project convention
```