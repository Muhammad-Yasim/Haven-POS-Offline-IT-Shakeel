import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AppLayout from '../components/AppLayout.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../lib/electronAPI.js';
import { todayLocal } from '../lib/timezone.js';
import { getOpenRegisterId } from '../lib/registerUtils.js';
import './userForm.css';

export default function SellReturnForm({
  embedded = false,
  initialSaleId = '',
  onSuccess,
}) {
  const navigate = useNavigate();
  const { business, profile } = useAuth();

  const [sales, setSales] = useState([]);
  const [saleId, setSaleId] = useState(
    initialSaleId ? String(initialSaleId) : ''
  );
  const [saleSearch, setSaleSearch] = useState('');

  const [saleItems, setSaleItems] = useState([]);
  const [alreadyReturned, setAlreadyReturned] = useState({});
  const [returnQty, setReturnQty] = useState({});
  const [returnDate, setReturnDate] = useState(
    todayLocal(business?.time_zone)
  );
  const [reason, setReason] = useState('');
  const [loadingItems, setLoadingItems] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (initialSaleId) {
      setSaleId(String(initialSaleId));
    }
  }, [initialSaleId]);

  useEffect(() => {
    if (!business?.id) return;

    api.sales.getAll({ business_id: business.id }).then(({ data, error }) => {
      if (error) {
        console.error('Error loading sales:', error);
        return;
      }
      const eligible = (data || [])
        .filter((s) => ['confirmed', 'shipped', 'partially_returned'].includes(s.status))
        .map((s) => ({
          ...s,
          contacts: { name: s.customer_name },
        }));
      setSales(eligible);
    });
  }, [business?.id]);

  useEffect(() => {
    if (!saleId) {
      setSaleItems([]);
      setAlreadyReturned({});
      return;
    }

    setLoadingItems(true);

    api.sales.getItems(saleId).then(async ({ data, error }) => {
      if (error) {
        console.error('Error loading sale items:', error);
        setSaleItems([]);
        setLoadingItems(false);
        return;
      }

      const items = data || [];
      setSaleItems(items);

      const itemIds = items.map((item) => item.id);
      let returned = {};

      if (itemIds.length > 0) {
        const { data: priorReturns, error: returnError } =
          await api.sellReturns.getPriorReturned(itemIds);

        if (returnError) {
          console.error('Error loading previous returns:', returnError);
        }
        returned = priorReturns || {};
      }

      setAlreadyReturned(returned);
      setReturnQty({});
      setLoadingItems(false);
    });
  }, [saleId]);

  const selectedSale = sales.find((sale) => sale.id === Number(saleId));

  const filteredSales = useMemo(() => {
    const search = saleSearch.trim().toLowerCase();
    if (!search) return sales;

    return sales.filter((sale) => {
      const invoiceNumber = String(sale.id);
      const customerName = sale.contacts?.name || 'Walk-in';
      const saleDate = sale.sale_date || '';

      return (
        invoiceNumber.includes(search) ||
        customerName.toLowerCase().includes(search) ||
        saleDate.toLowerCase().includes(search)
      );
    });
  }, [sales, saleSearch]);

  const rows = useMemo(
    () =>
      saleItems.map((item) => {
        const soldQty = Number(item.quantity);
        const returned = alreadyReturned[item.id] || 0;
        const remaining = Math.max(soldQty - returned, 0);

        const unitEffective =
          soldQty > 0
            ? Math.round((Number(item.line_total) / soldQty) * 100) / 100
            : 0;

        const qty = Number(returnQty[item.id] || 0);
        const amount = Math.round(qty * unitEffective * 100) / 100;

        return {
          item,
          soldQty,
          returned,
          remaining,
          unitEffective,
          qty,
          amount,
        };
      }),
    [saleItems, alreadyReturned, returnQty]
  );

  const totalAmount = rows.reduce((sum, row) => sum + row.amount, 0);
  const totalReturnUnits = rows.reduce((sum, row) => sum + Number(row.qty || 0), 0);

  const setQty = (itemId, value) => {
    if (value === '') {
      setReturnQty((prev) => ({
        ...prev,
        [itemId]: '',
      }));
      return;
    }

    if (!/^\d+$/.test(value)) return;
    const quantity = Number(value);
    if (quantity <= 0) return;

    setReturnQty((prev) => ({
      ...prev,
      [itemId]: value,
    }));
  };

  const setMaxQty = (itemId, maxRemaining) => {
    if (maxRemaining <= 0) return;
    setReturnQty((prev) => ({
      ...prev,
      [itemId]: String(maxRemaining),
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    const activeRows = rows.filter((row) => Number(row.qty) > 0);

    if (!saleId) {
      setError('Select a sale invoice.');
      return;
    }

    if (activeRows.length === 0) {
      setError(
        'Enter a return quantity greater than 0 for at least one item.'
      );
      return;
    }

    for (const row of activeRows) {
      const quantity = Number(row.qty);

      if (!Number.isInteger(quantity) || quantity <= 0) {
        setError(
          `Return quantity for ${row.item.products?.name} must be a whole number greater than 0.`
        );
        return;
      }

      if (quantity > row.remaining) {
        setError(
          `Return quantity for ${row.item.products?.name} exceeds available quantity (${row.remaining}).`
        );
        return;
      }
    }

    setSubmitting(true);

    try {
      const register_id = await getOpenRegisterId(
        business.id,
        profile.id
      );

      const res = await api.sellReturns.create({
        business_id: business.id,
        sale_id: Number(saleId),
        return_date: returnDate,
        reason: reason.trim() || null,
        total_amount: totalAmount,
        created_by: profile.id,
        register_id,
        items: activeRows.map((row) => ({
          sale_item_id: row.item.id,
          quantity_returned: Number(row.qty),
          amount: row.amount,
          product_id: row.item.product_id,
          variant_id: row.item.variant_id,
        })),
      });

      if (res?.error) throw new Error(res.error);

      if (embedded && onSuccess) {
        setSaleId('');
        setSaleSearch('');
        setReturnQty({});
        setReason('');
        onSuccess();
      } else {
        navigate('/sales/returns');
      }
    } catch (err) {
      setError(err.message || 'Could not save this return.');
    } finally {
      setSubmitting(false);
    }
  };

  const formContent = (
    <form onSubmit={handleSubmit} className="form-shell">
      {/* RETURN DETAILS CONFIGURATION PANEL */}
      <div className="form-section-compact">
        <div className="form-section-header">
          <span className="form-section-title">Return Parameters</span>
          {selectedSale && (
            <span
              className="badge badge-info"
              style={{ fontSize: 11, padding: '2px 8px' }}
            >
              Invoice #{selectedSale.id} — {selectedSale.contacts?.name || 'Walk-in'} (Due: {business?.currency} {Number(selectedSale.due_amount || 0).toFixed(2)})
            </span>
          )}
        </div>

        <div className="form-grid-4">
          <div className="compact-field">
            <label className="compact-label">
              Sale / Invoice # <span className="req">*</span>
            </label>
            <input
              type="text"
              list="sales-invoice-list"
              className="compact-input"
              value={saleId ? `#${saleId}` : saleSearch}
              onChange={(e) => {
                const value = e.target.value;
                const invoiceNumber = value.replace(/^#/, '');
                const matchingSale = sales.find(
                  (sale) => String(sale.id) === invoiceNumber
                );

                if (matchingSale) {
                  setSaleId(String(matchingSale.id));
                  setSaleSearch(String(matchingSale.id));
                } else {
                  setSaleId('');
                  setSaleSearch(invoiceNumber);
                }
              }}
              placeholder="Type or select Invoice #"
              required
            />
            <datalist id="sales-invoice-list">
              {filteredSales.map((sale) => (
                <option key={sale.id} value={`#${sale.id}`}>
                  {sale.sale_date} — {sale.contacts?.name || 'Walk-in'}
                </option>
              ))}
            </datalist>
          </div>

          <div className="compact-field">
            <label className="compact-label">Return Date</label>
            <input
              type="date"
              className="compact-input"
              value={returnDate}
              onChange={(e) => setReturnDate(e.target.value)}
            />
          </div>

          <div className="compact-field col-span-2">
            <label className="compact-label">Return Reason</label>
            <input
              className="compact-input"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Defective item, customer exchange, incorrect product"
            />
          </div>
        </div>
      </div>

      {/* ITEMS TO RETURN TABLE */}
      {saleId ? (
        <div className="form-section-compact">
          <div className="form-section-header">
            <span className="form-section-title">Invoice Items & Return Qty</span>
            <span className="form-section-subtitle">
              Specify quantity to return for restock & credit
            </span>
          </div>

          {loadingItems ? (
            <div className="muted" style={{ padding: '16px 8px', fontSize: 13 }}>
              Loading line items…
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="compact-data-table">
                <thead>
                  <tr>
                    <th className="text-left" style={{ width: '35%' }}>Product</th>
                    <th className="text-center" style={{ width: '10%' }}>Sold Qty</th>
                    <th className="text-center" style={{ width: '12%' }}>Already Returned</th>
                    <th className="text-center" style={{ width: '12%' }}>Available</th>
                    <th className="text-right" style={{ width: '12%' }}>Effective Price</th>
                    <th className="text-center" style={{ width: '14%' }}>Return Qty</th>
                    <th className="text-right" style={{ width: '15%' }}>Credit Total</th>
                  </tr>
                </thead>

                <tbody>
                  {rows.map((row) => {
                    const hasRemaining = row.remaining > 0;
                    return (
                      <tr key={row.item.id}>
                        <td>
                          <span style={{ fontWeight: 600 }}>{row.item.products?.name}</span>
                        </td>

                        <td className="text-center">
                          <span className="num-align">{row.soldQty}</span>
                        </td>

                        <td className="text-center">
                          <span className="num-align" style={{ color: row.returned > 0 ? 'var(--warning)' : 'inherit' }}>
                            {row.returned}
                          </span>
                        </td>

                        <td className="text-center">
                          <span
                            className={`badge ${
                              hasRemaining ? 'badge-success' : 'badge-danger'
                            }`}
                            style={{ fontSize: 11, padding: '1px 6px' }}
                          >
                            {row.remaining}
                          </span>
                        </td>

                        <td className="num-align">
                          {business?.currency} {row.unitEffective.toFixed(2)}
                        </td>

                        <td className="text-center">
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <input
                              type="number"
                              min="1"
                              max={row.remaining}
                              step="1"
                              inputMode="numeric"
                              className="compact-input num-align"
                              style={{ width: 68, height: 28, padding: '2px 6px' }}
                              value={returnQty[row.item.id] || ''}
                              onChange={(e) => setQty(row.item.id, e.target.value)}
                              disabled={!hasRemaining}
                              placeholder="0"
                            />
                            {hasRemaining && (
                              <button
                                type="button"
                                className="perm-col-toggle"
                                onClick={() => setMaxQty(row.item.id, row.remaining)}
                                title="Return all available"
                              >
                                Max
                              </button>
                            )}
                          </div>
                        </td>

                        <td className="num-align" style={{ fontWeight: 700 }}>
                          {business?.currency} {row.amount.toFixed(2)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        <div
          className="form-section-compact"
          style={{
            padding: '28px 16px',
            textAlign: 'center',
            color: 'var(--text-muted)',
            fontSize: 13,
            background: 'var(--navy-50)',
            borderStyle: 'dashed',
          }}
        >
          🔍 Select an Invoice # above to display invoice items and start the return process.
        </div>
      )}

      {error && (
        <div
          className="error-text"
          style={{
            padding: '8px 12px',
            background: 'var(--danger-bg)',
            borderRadius: 4,
            border: '1px solid #f5c2c2',
            fontSize: 12.5,
          }}
        >
          {error}
        </div>
      )}

      {/* FINANCIAL SUMMARY & ACTIONS BAR */}
      <div className="compact-summary-bar">
        <div className="compact-stat-group">
          <div className="compact-stat-item">
            <span className="stat-label">Units to Return:</span>
            <span className="stat-val">{totalReturnUnits}</span>
          </div>

          <div className="compact-stat-item">
            <span className="stat-label">Total Credit / Refund:</span>
            <span className="stat-val stat-val-highlight">
              {business?.currency} {totalAmount.toFixed(2)}
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          {!embedded && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => navigate('/sales/returns')}
            >
              Cancel
            </button>
          )}

          <button
            type="submit"
            className="btn btn-primary btn-sm"
            disabled={submitting || !saleId || totalReturnUnits === 0}
          >
            {submitting ? 'Saving Return…' : 'Save Return'}
          </button>
        </div>
      </div>
    </form>
  );

  if (embedded) {
    return (
      <div style={{ marginTop: 12 }}>
        <div className="compact-page-header">
          <div>
            <h1 style={{ fontSize: 16 }}>New Sales Return</h1>
            <p>Restocks the returned items and credits the customer's balance.</p>
          </div>
        </div>
        {formContent}
      </div>
    );
  }

  return (
    <AppLayout>
      <div className="compact-page-header">
        <div>
          <h1>New Sales Return</h1>
          <p>Restocks the selected items and adjusts customer balance/ledger.</p>
        </div>

        <div className="compact-header-actions">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => navigate('/sales/returns')}
          >
            Cancel
          </button>
        </div>
      </div>

      {formContent}
    </AppLayout>
  );
}
