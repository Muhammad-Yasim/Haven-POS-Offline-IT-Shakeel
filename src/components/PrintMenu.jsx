import { useRef, useState, useEffect } from 'react';
import { printSaleInvoice, printThermalSaleInvoice, printPurchaseInvoice, printThermalPurchaseInvoice } from '../lib/printInvoice.js';
import './PrintMenu.css';

/**
 * PrintMenu — a small dropdown button that offers two print options:
 *   • 🖨 Full Page  (A4 invoice)
 *   • 🧾 Thermal    (80mm receipt roll)
 *
 * Props:
 *   type        'sale' | 'purchase'
 *   getArgs     () => Promise<object>  — async fn that resolves the args object
 *                 for printSaleInvoice / printPurchaseInvoice
 *   label       string  — optional button label (default: "Print")
 *   disabled    bool
 *   className   string  — extra classes for the wrapper
 *   btnClassName string  — extra classes for the trigger button
 *
 * Usage:
 *   <PrintMenu
 *     type="sale"
 *     getArgs={async () => ({ business, sale, items, customer, seller, footerNote })}
 *   />
 */
export default function PrintMenu({
  type = 'sale',
  getArgs,
  label = 'Print',
  disabled = false,
  className = '',
  btnClassName = '',
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const run = async (thermal) => {
    setOpen(false);
    if (!getArgs) return;
    setBusy(true);
    try {
      const args = await getArgs();
      if (!args) return;
      if (type === 'sale') {
        thermal ? printThermalSaleInvoice(args) : printSaleInvoice(args);
      } else {
        thermal ? printThermalPurchaseInvoice(args) : printPurchaseInvoice(args);
      }
    } catch (err) {
      console.error('Print error:', err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`print-menu-wrap ${className}`} ref={ref}>
      <div className="print-menu-btn-group">
        {/* Primary trigger: full-page print */}
        <button
          type="button"
          className={`btn btn-secondary print-menu-trigger ${btnClassName}`}
          disabled={disabled || busy}
          onClick={() => run(false)}
          title="Print full-page A4 invoice"
        >
          {busy ? '…' : `🖨 ${label}`}
        </button>

        {/* Chevron to open menu */}
        <button
          type="button"
          className="btn btn-secondary print-menu-chevron"
          disabled={disabled || busy}
          onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
          title="More print options"
          aria-haspopup="true"
          aria-expanded={open}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
      </div>

      {open && (
        <div className="print-menu-dropdown" role="menu">
          <button
            type="button"
            className="print-menu-item"
            role="menuitem"
            onClick={() => run(false)}
          >
            <span className="print-menu-item-icon">🖨</span>
            <span>
              <span className="print-menu-item-title">Full Page (A4)</span>
              <span className="print-menu-item-sub">Standard invoice on A4 paper</span>
            </span>
          </button>
          <button
            type="button"
            className="print-menu-item"
            role="menuitem"
            onClick={() => run(true)}
          >
            <span className="print-menu-item-icon">🧾</span>
            <span>
              <span className="print-menu-item-title">Thermal Receipt (80mm)</span>
              <span className="print-menu-item-sub">Compact receipt for thermal printers</span>
            </span>
          </button>
        </div>
      )}
    </div>
  );
}

