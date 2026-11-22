import { INVOICE_HEADER_DATA_URL, INVOICE_SIGNATURE_DATA_URL } from './invoiceAssets.js';

/**
 * printInvoice — opens a clean, print-ready invoice/receipt in a new window
 * and triggers the browser's print dialog. Callable from anywhere — POS
 * Billing, the Sales list, the Purchases list, wherever — because it's a
 * plain function, not a component you have to mount in your page's JSX.
 *
 * Works for both sales and purchase documents; you decide what appears via
 * `columns`, `totals`, and the party/seller info you pass in.
 *
 * -------------------------------------------------------------------------
 * @param {object} options
 * @param {string} [options.documentType='Invoice']  e.g. 'Sales Invoice', 'Purchase Invoice', 'Receipt'
 * @param {{ name?, address?, city?, country?, contact_number? }} options.business
 * @param {{ label?, name?, contact_number? }} [options.party]
 *    The other side of the transaction — customer for a sale, supplier for
 *    a purchase. `label` defaults to 'Customer'.
 * @param {{ name?, contact_number? }} [options.seller]
 *    The staff member who processed it — name + phone shown at the very
 *    bottom, per your spec.
 * @param {string|number} [options.invoiceNumber]
 * @param {string} [options.date]
 * @param {Array<{ key: string, label: string, align?: 'left'|'right'|'center', format?: (row) => string|number }>} options.columns
 *    Exactly the columns you want on the line-items table, in order.
 * @param {Array<object>} options.rows  The line items (sale_items / purchase_items, or anything).
 * @param {Array<{ label: string, value: string|number, emphasize?: boolean }>} [options.totals]
 *    Rendered as a totals block below the table, in order. Set
 *    `emphasize: true` on the grand-total row to make it stand out.
 * @param {string} [options.footerNote]  e.g. your Invoice Settings footer note / terms.
 *
 * @example
 *   printInvoice({
 *     documentType: 'Sales Invoice',
 *     business: { name: business.business_name, address: business.landmark, city: business.city, country: business.country, contact_number: business.contact_number },
 *     party: { label: 'Customer', name: customerName, contact_number: customerPhone },
 *     seller: { name: `${profile.first_name} ${profile.last_name || ''}`, contact_number: profile.mobile_number },
 *     invoiceNumber: sale.id,
 *     date: sale.sale_date,
 *     columns: [
 *       { key: 'name', label: 'Product' },
 *       { key: 'quantity', label: 'Qty', align: 'right' },
 *       { key: 'unit_price', label: 'Unit Price', align: 'right', format: (r) => Number(r.unit_price).toFixed(2) },
 *       { key: 'line_total', label: 'Total', align: 'right', format: (r) => Number(r.line_total).toFixed(2) },
 *     ],
 *     rows: saleItemsWithProductNames,
 *     totals: [
 *       { label: 'Subtotal', value: sale.subtotal.toFixed(2) },
 *       { label: 'Discount', value: sale.discount_amount.toFixed(2) },
 *       { label: 'Tax', value: sale.tax_amount.toFixed(2) },
 *       { label: 'Grand Total', value: sale.grand_total.toFixed(2), emphasize: true },
 *       { label: 'Paid', value: sale.paid_amount.toFixed(2) },
 *       { label: 'Due', value: sale.due_amount.toFixed(2) },
 *     ],
 *   });
 */
function printViaIframe(html) {
  let iframe = document.getElementById('print-invoice-iframe');
  if (iframe) {
    iframe.remove();
  }
  iframe = document.createElement('iframe');
  iframe.id = 'print-invoice-iframe';
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  document.body.appendChild(iframe);

  const doc = iframe.contentWindow.document;
  doc.open();
  doc.write(html);
  doc.close();

  iframe.contentWindow.focus();
  setTimeout(() => {
    try {
      iframe.contentWindow.print();
    } catch (e) {
      console.error('Iframe print error:', e);
    }
  }, 300);
}

export function printInvoice({
  documentType = 'Invoice',
  business = {},
  party = {},
  seller = {},
  invoiceNumber = '',
  date = '',
  columns = [],
  rows = [],
  totals = [],
  footerNote = '',
  saleNote = '',
} = {}) {
  const html = buildInvoiceHtml({ documentType, business, party, seller, invoiceNumber, date, columns, rows, totals, footerNote, saleNote });

  let printWindow = null;
  try {
    printWindow = window.open('', '_blank', 'width=850,height=1100');
  } catch (_e) {
    printWindow = null;
  }

  if (printWindow && printWindow.document) {
    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
  } else {
    // If popup window is blocked or not available, print seamlessly via hidden iframe
    printViaIframe(html);
  }
}

// ---------------------------------------------------------------------------
// Convenience wrappers for the two document types this app actually has.
// Thin presets over printInvoice() — use these for the common case, drop to
// printInvoice() directly when you need different columns/totals.
// ---------------------------------------------------------------------------

export function printSaleInvoice({ business, sale, items, customer, seller, footerNote, saleNote }) {
  const invNumber = sale.invoice_no || (sale.id ? `SALEORD${sale.id}` : 'SALEORD');
  const currency = business?.currency || 'Rs';

  printInvoice({
    documentType: 'SALE ORDER',
    business,
    party: {
      label: 'Customer',
      name: customer?.name || 'Walk-in',
      contact_number: customer?.contact_number || '',
      address: customer?.address || '',
    },
    seller,
    invoiceNumber: invNumber,
    date: sale.sale_date,
    columns: [
      { key: '_sr', label: 'Sr No.', align: 'center', width: '60px' },
      { key: 'product_name', label: 'Product', align: 'left' },
      { key: 'quantity', label: 'Quantity', align: 'center', width: '85px', format: (r) => Number(r.quantity || 1).toFixed(2) },
      { key: 'unit_price', label: 'Rate', align: 'right', width: '120px', format: (r) => `${currency} ${Number(r.unit_price || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` },
      { key: 'line_total', label: 'Amount', align: 'right', width: '130px', format: (r) => `${currency} ${Number(r.line_total != null ? r.line_total : (Number(r.quantity || 1) * Number(r.unit_price || 0))).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` },
    ],
    rows: items,
    totals: [
      { label: 'Subtotal', value: `${currency} ${Number(sale.subtotal != null ? sale.subtotal : sale.grand_total || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` },
      ...(Number(sale.discount_amount || 0) > 0 ? [{ label: 'Discount', value: `${currency} ${Number(sale.discount_amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` }] : []),
      { label: 'Grand Total', value: `${currency} ${Number(sale.grand_total || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, emphasize: true },
    ],
    footerNote,
    saleNote,
  });
}

export function printPurchaseInvoice({ business, purchase, items, supplier, seller, footerNote }) {
  const due = Number(purchase.grand_total) - Number(purchase.advance_payment);
  printInvoice({
    documentType: 'Purchase Invoice',
    business,
    party: { label: 'Supplier', name: supplier?.name || 'Cash / unspecified', contact_number: supplier?.contact_number },
    seller,
    invoiceNumber: purchase.id,
    date: purchase.purchase_date,
    columns: [
      { key: 'product_name', label: 'Product' },
      { key: 'quantity', label: 'Qty', align: 'right' },
      { key: 'unit_cost', label: 'Unit Cost', align: 'right', format: (r) => Number(r.unit_cost).toFixed(2) },
      { key: 'discount_amount', label: 'Discount', align: 'right', format: (r) => Number(r.discount_amount || 0).toFixed(2) },
      { key: 'line_total', label: 'Total', align: 'right', format: (r) => Number(r.line_total).toFixed(2) },
    ],
    rows: items,
    totals: [
      { label: 'Subtotal', value: Number(purchase.subtotal).toFixed(2) },
      { label: 'Discount', value: Number(purchase.discount_amount).toFixed(2) },
      { label: 'Tax', value: Number(purchase.tax_amount).toFixed(2) },
      { label: 'Shipping', value: Number(purchase.shipping_charges).toFixed(2) },
      { label: 'Grand Total', value: Number(purchase.grand_total).toFixed(2), emphasize: true },
      { label: 'Paid', value: Number(purchase.advance_payment).toFixed(2) },
      { label: 'Due', value: due.toFixed(2) },
    ],
    footerNote,
  });
}

// ---------------------------------------------------------------------------
// HTML generation — self-contained (inline CSS), since a new window has no
// access to the app's bundled stylesheet.
// ---------------------------------------------------------------------------

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d)) return dateStr;
  const pad = (n) => n.toString().padStart(2, '0');
  const dd = pad(d.getDate());
  const mm = pad(d.getMonth() + 1);
  const yyyy = d.getFullYear();
  let hours = d.getHours();
  const minutes = pad(d.getMinutes());
  const ampm = hours >= 12 ? 'pm' : 'am';
  hours = hours % 12;
  hours = hours ? hours : 12;
  const hh = pad(hours);
  return `${dd}-${mm}-${yyyy} ${hh}:${minutes} ${ampm}`;
}

function esc(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ---------------------------------------------------------------------------
// Thermal (80mm roll) print — shared entry points
// ---------------------------------------------------------------------------

/**
 * printThermalInvoice — same API as printInvoice() but renders an 80mm
 * thermal-receipt layout via hidden iframe.
 */
export function printThermalInvoice({
  documentType = 'Invoice',
  business = {},
  party = {},
  seller = {},
  invoiceNumber = '',
  date = '',
  columns = [],
  rows = [],
  totals = [],
  footerNote = '',
  saleNote = '',
} = {}) {
  const html = buildThermalHtml({ documentType, business, party, seller, invoiceNumber, date, columns, rows, totals, footerNote, saleNote });
  printViaIframe(html);
}

export function printThermalSaleInvoice({ business, sale, items, customer, seller, footerNote, saleNote }) {
  printThermalInvoice({
    documentType: 'Sales Receipt',
    business,
    party: { label: 'Customer', name: customer?.name || 'Walk-in', contact_number: customer?.contact_number },
    seller,
    invoiceNumber: sale.id,
    date: sale.sale_date,
    columns: [
      { key: 'product_name', label: 'Item' },
      { key: 'quantity', label: 'Qty', align: 'right' },
      { key: 'unit_price', label: 'Price', align: 'right', format: (r) => Number(r.unit_price).toFixed(2) },
      { key: 'line_total', label: 'Total', align: 'right', format: (r) => Number(r.line_total).toFixed(2) },
    ],
    rows: items,
    totals: [
      { label: 'Subtotal', value: Number(sale.subtotal).toFixed(2) },
      { label: 'Discount', value: Number(sale.discount_amount).toFixed(2) },
      { label: 'Tax', value: Number(sale.tax_amount).toFixed(2) },
      { label: 'Shipping', value: Number(sale.shipping_charges).toFixed(2) },
      { label: 'Grand Total', value: Number(sale.grand_total).toFixed(2), emphasize: true },
      { label: 'Paid', value: Number(sale.paid_amount).toFixed(2) },
      { label: 'Due', value: Number(sale.due_amount).toFixed(2) },
    ],
    footerNote,
    saleNote,
  });
}

export function printThermalPurchaseInvoice({ business, purchase, items, supplier, seller, footerNote }) {
  const due = Number(purchase.grand_total) - Number(purchase.advance_payment);
  printThermalInvoice({
    documentType: 'Purchase Receipt',
    business,
    party: { label: 'Supplier', name: supplier?.name || 'Cash / unspecified', contact_number: supplier?.contact_number },
    seller,
    invoiceNumber: purchase.id,
    date: purchase.purchase_date,
    columns: [
      { key: 'product_name', label: 'Item' },
      { key: 'quantity', label: 'Qty', align: 'right' },
      { key: 'unit_cost', label: 'Cost', align: 'right', format: (r) => Number(r.unit_cost).toFixed(2) },
      { key: 'line_total', label: 'Total', align: 'right', format: (r) => Number(r.line_total).toFixed(2) },
    ],
    rows: items,
    totals: [
      { label: 'Subtotal', value: Number(purchase.subtotal).toFixed(2) },
      { label: 'Discount', value: Number(purchase.discount_amount).toFixed(2) },
      { label: 'Tax', value: Number(purchase.tax_amount).toFixed(2) },
      { label: 'Shipping', value: Number(purchase.shipping_charges).toFixed(2) },
      { label: 'Grand Total', value: Number(purchase.grand_total).toFixed(2), emphasize: true },
      { label: 'Paid', value: Number(purchase.advance_payment).toFixed(2) },
      { label: 'Due', value: due.toFixed(2) },
    ],
    footerNote,
  });
}

// ---------------------------------------------------------------------------
// Thermal HTML builder — 80mm roll, monochrome, compact
// ---------------------------------------------------------------------------

function buildThermalHtml({ documentType, business, party, seller, invoiceNumber, date, columns, rows, totals, footerNote, saleNote }) {
  const bizName = esc(business.name || business.business_name || 'Business');
  const bizAddress = [business.address, business.city, business.country].filter(Boolean).join(', ');
  const bizPhone = business.contact_number || '';

  // Build rows — thermal uses dots to fill the gap between label and value
  const thermalTotals = totals.map((t) => `
    <tr class="${t.emphasize ? 'th-grand' : ''}">
      <td class="th-tot-label">${esc(t.label)}</td>
      <td class="th-tot-value">${esc(t.value)}</td>
    </tr>
  `).join('');

  const thermalItems = rows.map((row) => {
    const nameCells = columns.filter((c) => c.align !== 'right');
    const valueCells = columns.filter((c) => c.align === 'right');
    const name = nameCells.map((c) => typeof c.format === 'function' ? c.format(row) : (row[c.key] ?? '')).join(' ');
    const values = valueCells.map((c) => {
      const v = typeof c.format === 'function' ? c.format(row) : (row[c.key] ?? '');
      return `<span>${esc(c.label)}: ${esc(v)}</span>`;
    }).join(' &nbsp; ');
    return `
      <tr>
        <td class="th-item-name">${esc(name)}</td>
        <td class="th-item-vals">${values}</td>
      </tr>
    `;
  }).join('');

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${esc(documentType)}${invoiceNumber ? ' #' + esc(invoiceNumber) : ''}</title>
<style>
  @page {
    size: 80mm auto;
    margin: 4mm 4mm;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Courier New', Courier, monospace;
    font-size: 11px;
    color: #000;
    width: 72mm;
    padding: 0;
  }
  .th-center { text-align: center; }
  .th-biz-name { font-size: 15px; font-weight: bold; text-align: center; margin-bottom: 1px; }
  .th-biz-sub { font-size: 10px; text-align: center; color: #333; margin-bottom: 1px; }
  .th-divider { border: none; border-top: 1px dashed #000; margin: 4px 0; }
  .th-divider-solid { border: none; border-top: 1px solid #000; margin: 4px 0; }
  .th-doc-title { font-size: 12px; font-weight: bold; text-align: center; text-transform: uppercase; letter-spacing: 0.06em; margin: 3px 0; }
  .th-meta { font-size: 10px; margin-bottom: 1px; display: flex; justify-content: space-between; }
  .th-meta-label { color: #555; }
  .th-items { width: 100%; border-collapse: collapse; margin: 3px 0; }
  .th-items th { font-size: 10px; text-transform: uppercase; border-bottom: 1px solid #000; padding: 1px 0; text-align: left; }
  .th-items th:last-child { text-align: right; }
  .th-item-name { font-size: 11px; padding: 2px 0; vertical-align: top; }
  .th-item-vals { font-size: 10px; text-align: right; vertical-align: top; white-space: nowrap; padding: 2px 0; }
  .th-item-vals span { display: block; }
  .th-totals { width: 100%; border-collapse: collapse; margin-top: 3px; }
  .th-tot-label { font-size: 10px; text-transform: uppercase; color: #333; padding: 1px 0; }
  .th-tot-value { font-size: 11px; font-weight: bold; text-align: right; padding: 1px 0; }
  tr.th-grand .th-tot-label,
  tr.th-grand .th-tot-value { font-size: 13px; font-weight: bold; border-top: 1px solid #000; padding-top: 3px; }
  .th-footer { font-size: 10px; text-align: center; color: #333; margin-top: 4px; font-style: italic; }
  .th-seller { font-size: 10px; text-align: center; color: #444; margin-top: 2px; }
  .th-note { font-size: 10px; margin-top: 3px; }
  @media print {
    body { width: 72mm; }
  }
</style>
</head>
<body>
  <div class="th-biz-name">${bizName}</div>
  ${bizAddress ? `<div class="th-biz-sub">${esc(bizAddress)}</div>` : ''}
  ${bizPhone ? `<div class="th-biz-sub">📞 ${esc(bizPhone)}</div>` : ''}

  <hr class="th-divider-solid" />
  <div class="th-doc-title">${esc(documentType)}</div>
  <hr class="th-divider" />

  <div class="th-meta"><span class="th-meta-label">${esc(party.label || 'Customer')}:</span><span>${esc(party.name || 'Walk-in')}</span></div>
  ${party.contact_number ? `<div class="th-meta"><span class="th-meta-label">Phone:</span><span>${esc(party.contact_number)}</span></div>` : ''}
  <div class="th-meta"><span class="th-meta-label">Invoice #:</span><span>${esc(invoiceNumber)}</span></div>
  <div class="th-meta"><span class="th-meta-label">Date:</span><span>${esc(formatDate(date))}</span></div>
  ${seller.name ? `<div class="th-meta"><span class="th-meta-label">Served by:</span><span>${esc(seller.name)}</span></div>` : ''}

  <hr class="th-divider" />

  <table class="th-items">
    <tbody>${thermalItems}</tbody>
  </table>

  <hr class="th-divider" />

  <table class="th-totals">
    <tbody>${thermalTotals}</tbody>
  </table>

  ${(saleNote && saleNote.trim()) ? `<hr class="th-divider" /><div class="th-note"><strong>Note:</strong> ${esc(saleNote.trim())}</div>` : ''}

  <hr class="th-divider" />

  ${footerNote ? `<div class="th-footer">${esc(footerNote)}</div>` : ''}
  <div class="th-footer" style="margin-top:6px;">★ Thank you ★</div>

  <script>
    window.onload = function () { window.focus(); window.print(); };
  </script>
</body>
</html>`;
}

function formatReceiptDate(dateStr) {
  if (!dateStr) {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(now.getDate())}-${pad(now.getMonth() + 1)}-${now.getFullYear()}`;
  }
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`;
}

// ---------------------------------------------------------------------------
// A4 HTML generation — Default Receipt Format
// ---------------------------------------------------------------------------

function buildInvoiceHtml({ documentType, business, party, seller, invoiceNumber, date, columns, rows, totals, footerNote, saleNote }) {
  const currency = business?.currency || 'Rs';

  const theadCells = columns
    .map((c) => `<th style="text-align:${c.align || 'left'}; ${c.width ? `width:${c.width};` : ''}">${esc(c.label)}</th>`)
    .join('');

  const tbodyRows = rows
    .map((row, idx) => {
      const cells = columns
        .map((c) => {
          let raw;
          if (c.key === '_sr') {
            raw = idx + 1;
          } else if (typeof c.format === 'function') {
            raw = c.format(row, idx);
          } else {
            raw = row[c.key];
          }
          return `<td style="text-align:${c.align || 'left'};">${esc(raw)}</td>`;
        })
        .join('');
      return `<tr>${cells}</tr>`;
    })
    .join('');

  const subTotalItem = totals.find((t) => t.label.toLowerCase() === 'subtotal') || totals[0];
  const grandTotalItem = totals.find((t) => t.emphasize || t.label.toLowerCase() === 'grand total') || totals[totals.length - 1];
  const otherTotals = totals.filter((t) => t !== subTotalItem && t !== grandTotalItem);

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${esc(documentType || 'SALE ORDER')}${invoiceNumber ? ' #' + esc(invoiceNumber) : ''}</title>
<style>
  @page {
    size: A4 portrait;
    margin: 8mm 12mm;
  }
  * {
    box-sizing: border-box;
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
    color-adjust: exact !important;
  }
  body {
    font-family: Arial, 'Helvetica Neue', Helvetica, sans-serif;
    color: #000;
    margin: 0;
    padding: 10px;
    background: #fff;
  }
  .receipt-page {
    max-width: 740px;
    margin: 0 auto;
  }
  .header-banner {
    width: 100%;
    margin: 0 0 4px 0;
  }
  .header-banner img {
    width: 100%;
    height: auto;
    display: block;
  }
  .doc-title {
    text-align: center;
    font-size: 16px;
    font-weight: 800;
    letter-spacing: 0.06em;
    color: #000;
    text-transform: uppercase;
    margin: 8px 0 14px 0;
  }
  .meta-grid {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 14px;
    padding: 0 2px;
  }
  .bill-to-col {
    text-align: left;
  }
  .bill-to-label {
    font-size: 11.5px;
    font-weight: 700;
    color: #000;
    margin-bottom: 2px;
  }
  .customer-name {
    font-size: 13.5px;
    font-weight: 800;
    color: #000;
  }
  .customer-address, .customer-phone {
    font-size: 11.5px;
    color: #1f2937;
    margin-top: 1px;
  }
  .order-meta-col {
    text-align: right;
  }
  .order-number {
    font-size: 17px;
    font-weight: 800;
    color: #000;
    letter-spacing: 0.02em;
  }
  .order-date {
    font-size: 12.5px;
    font-weight: 600;
    color: #000;
    margin-top: 2px;
  }
  table.items-table {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 14px;
  }
  table.items-table th {
    background: #000 !important;
    color: #fff !important;
    padding: 7px 10px;
    font-size: 11.5px;
    font-weight: 700;
    border: none;
    letter-spacing: 0.02em;
  }
  table.items-table td {
    padding: 6px 10px;
    font-size: 12px;
    font-weight: 600;
    border-bottom: 1px solid #e5e7eb;
    color: #000;
  }
  .bottom-section {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 16px;
    margin-top: 8px;
    padding: 0 2px;
  }
  .please-note-col {
    flex: 1 1 56%;
    max-width: 58%;
  }
  .please-note-title {
    font-size: 11.5px;
    font-weight: 800;
    color: #000;
    border-bottom: 1px solid #94a3b8;
    padding-bottom: 2px;
    margin-bottom: 5px;
  }
  .please-note-bullets {
    margin: 0;
    padding-left: 14px;
    font-size: 10px;
    line-height: 1.6;
    color: #111827;
  }
  .please-note-bullets li {
    margin-bottom: 1px;
  }
  .sale-note-box {
    margin-top: 6px;
    font-size: 10.5px;
    color: #374151;
    font-style: italic;
  }
  .totals-and-sig-col {
    flex: 0 0 40%;
    max-width: 42%;
    display: flex;
    flex-direction: column;
  }
  .totals-box {
    width: 100%;
    display: flex;
    flex-direction: column;
  }
  .subtotal-row {
    display: flex;
    justify-content: space-between;
    font-size: 12px;
    font-weight: 700;
    color: #000;
    padding: 3px 6px;
  }
  .grand-total-row {
    background: #000 !important;
    color: #fff !important;
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 13px;
    font-weight: 800;
    padding: 6px 10px;
    margin-top: 3px;
    border-radius: 1px;
  }
  .signature-box {
    margin-top: 24px;
    text-align: right;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
  }
  .sig-image {
    height: 48px;
    width: auto;
    object-fit: contain;
    margin-bottom: 2px;
    display: block;
  }
  .sig-name {
    font-size: 11.5px;
    font-weight: 800;
    color: #000;
  }
  .sig-title {
    font-size: 10px;
    color: #4b5563;
  }
  @media print {
    body {
      padding: 0;
    }
  }
</style>
</head>
<body>
  <div class="receipt-page">
    <div class="header-banner">
      <img src="${INVOICE_HEADER_DATA_URL}" alt="Shahzad Computers & Security" />
    </div>

    <div class="doc-title">${esc(documentType || 'SALE ORDER')}</div>

    <div class="meta-grid">
      <div class="bill-to-col">
        <div class="bill-to-label">Bill To</div>
        <div class="customer-name">${esc(party.name || 'Walk-in Customer')}</div>
        ${party.address ? `<div class="customer-address">${esc(party.address)}</div>` : ''}
        ${party.contact_number ? `<div class="customer-phone">${esc(party.contact_number)}</div>` : ''}
      </div>
      <div class="order-meta-col">
        <div class="order-number">${esc(invoiceNumber || '')}</div>
        <div class="order-date">${esc(formatReceiptDate(date))}</div>
      </div>
    </div>

    <table class="items-table">
      <thead>
        <tr>${theadCells}</tr>
      </thead>
      <tbody>
        ${tbodyRows}
      </tbody>
    </table>

    <div class="bottom-section">
      <div class="please-note-col">
        <div class="please-note-title">Please Note</div>
        <ul class="please-note-bullets">
          <li>Company given 1 year Warranty on installed Items.</li>
          <li>No Warranty without Original Packing &amp; Invoice</li>
          <li>DVR &amp; Camera in Burn/Brake Condition will no be entertained</li>
          <li>No Warranty Of Power Adaptor &amp; Accessories</li>
          <li>Recieved above items in order and good condition</li>
        </ul>
        ${(saleNote && saleNote.trim()) ? `<div class="sale-note-box"><strong>Note:</strong> ${esc(saleNote.trim())}</div>` : ''}
        ${footerNote ? `<div class="sale-note-box" style="margin-top:4px;">${esc(footerNote)}</div>` : ''}
      </div>

      <div class="totals-and-sig-col">
        <div class="totals-box">
          ${subTotalItem ? `
          <div class="subtotal-row">
            <span>Subtotal</span>
            <span>${esc(subTotalItem.value)}</span>
          </div>` : ''}
          ${otherTotals.map(t => `
          <div class="subtotal-row">
            <span>${esc(t.label)}</span>
            <span>${esc(t.value)}</span>
          </div>`).join('')}
          ${grandTotalItem ? `
          <div class="grand-total-row">
            <span>Grand Total</span>
            <span>${esc(grandTotalItem.value)}</span>
          </div>` : ''}
        </div>

        <div class="signature-box">
          <img src="${INVOICE_SIGNATURE_DATA_URL}" alt="Signature" class="sig-image" />
          <div class="sig-name">Abdul Qayyuam</div>
          <div class="sig-title">Signature</div>
        </div>
      </div>
    </div>
  </div>

  <script>
    window.onload = function () {
      window.focus();
      window.print();
    };
  </script>
</body>
</html>`;
}
