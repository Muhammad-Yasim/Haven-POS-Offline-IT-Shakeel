# Haven POS — Offline Desktop Application

A modern, fast, and fully offline Point of Sale (POS) and inventory management desktop application built with **Electron**, **React**, and **SQLite**.

---

## Key Features

- **100% Offline**: Runs locally with a zero-configuration SQLite database (`pos-database.db`) stored in your user data directory. No cloud database or internet connection required.
- **POS Billing & Cash Register**: High-speed touch & barcode-ready POS register, quick-add products/customers, cash drawer sessions, and instant receipt printing.
- **Inventory & Stock Tracking**: Real-time stock valuation, multi-location stock movements, low-stock notifications, and FIFO inventory costing.
- **Sales & Purchases**: Comprehensive sales invoicing, purchase orders, advance payments, receivables/payables tracking, and customer/supplier returns.
- **Reports & Analytics**: Sales summary, Profit & Loss analysis, customer/supplier ledgers, expense breakdown, and daily items sold with PDF/Print exports.
- **Business & Invoice Settings**: Single-business configuration, custom invoice templates, location management, and personal preferences.

---

## Technology Stack

- **Desktop Framework**: Electron
- **Frontend**: React 18 + Vite + Plain CSS
- **Local Database**: SQLite (Node.js built-in `node:sqlite`)
- **Authentication**: Argon2id password hashing via local secure IPC
- **Reporting**: Recharts, jsPDF, html2canvas

---

## Getting Started

### Prerequisites

- Node.js (v20 or newer recommended)
- npm or pnpm

### Development

Run the Vite dev server and launch the Electron application:

```powershell
npm run electron:dev
```

### Building for Production

Create a standalone Windows installer (`.exe`):

```powershell
npm run electron:build
```

The resulting `.exe` installer will be located in the `release/` directory.

---

## License

Private / Proprietary. Copyright © 2024–2026 Haven POS.
