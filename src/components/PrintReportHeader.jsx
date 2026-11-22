import React from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { formatNow } from '../lib/timezone.js';
import { INVOICE_HEADER_DATA_URL } from '../lib/invoiceAssets.js';

/**
 * 
 * PrintReportHeader — visible when printing OR when .pdf-export-mode is active.
 * Renders the standardized Earth iT Center receipt-style header.
 *
 * Props:
 *   title       {string}  — Report title e.g. "Profit & Loss Report"
 *   filters     {Array}   — [{ label: string, value: string }] active filters
 *   location    {string}  — Optional: selected location name (overrides filter)
 */
export default function PrintReportHeader({ title, filters = [], location, filtersLabel = 'Active Filters:' }) {
  const { business, profile } = useAuth();

  const generatedAt = formatNow(business?.time_zone, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const dateOnly = formatNow(business?.time_zone, {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
  const timeOnly = formatNow(business?.time_zone, { hour: '2-digit', minute: '2-digit' });

  const generatedBy = profile?.first_name
    ? `${profile.first_name} ${profile.last_name || ''}`.trim()
    : null;

  return (
    <div className="prh-root">
      {/* ── Top receipt-style banner ── */}
      <div className="prh-header-banner">
        <img src={INVOICE_HEADER_DATA_URL} alt="Earth iT Center" />
      </div>

      {/* ── Centered Report Title (same style as SALE ORDER) ── */}
      <div className="prh-doc-title">{title}</div>

      {/* ── Meta row: filters on left, date/time on right ── */}
      <div className="prh-meta-grid">
        <div className="prh-meta-left">
          {filters
            .filter((f) => f && f.value !== undefined && f.value !== null && f.value !== '')
            .map((f, i) => (
              <span key={i} className="prh-filter-item">
                <span className="prh-chip-label">{f.label}:</span>{' '}
                <span className="prh-chip-value">{String(f.value)}</span>
              </span>
            ))}
        </div>
        <div className="prh-meta-right">
          <div><strong>Date:</strong> {dateOnly} {timeOnly}</div>
          {generatedBy && <div><strong>By:</strong> {generatedBy}</div>}
        </div>
      </div>

      <style>{`
        /* Hidden by default — shown on print or when body has .pdf-export-mode */
        .prh-root {
          display: none;
          font-family: Arial, 'Helvetica Neue', Helvetica, sans-serif;
          margin-bottom: 14px;
          background: #fff;
          page-break-inside: avoid;
          page-break-after: avoid;
        }
        @media print {
          .prh-root { display: block !important; }
        }
        .pdf-export-mode .prh-root {
          display: block !important;
        }

        .prh-header-banner {
          width: 100%;
          margin-bottom: 6px;
        }
        .prh-header-banner img {
          width: 100%;
          height: auto;
          display: block;
        }
        .prh-doc-title {
          text-align: center;
          font-size: 16px;
          font-weight: 800;
          letter-spacing: 0.06em;
          color: #000;
          text-transform: uppercase;
          margin: 6px 0 12px 0;
        }
        .prh-meta-grid {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          font-size: 11.5px;
          margin-bottom: 8px;
          padding: 0 2px;
        }
        .prh-meta-left {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }
        .prh-filter-item {
          background: #f1f5f9;
          border: 1px solid #cbd5e1;
          border-radius: 3px;
          padding: 1px 6px;
        }
        .prh-chip-label { font-weight: 700; color: #0284c7; }
        .prh-chip-value { color: #111827; }
        .prh-meta-right {
          text-align: right;
          color: #111827;
        }
      `}</style>
    </div>
  );
}
