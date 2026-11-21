import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AppLayout from '../components/AppLayout.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../lib/electronAPI.js';
import { todayLocal } from '../lib/timezone.js';
import './userForm.css';

export default function PurchaseReturnForm() {
  const navigate = useNavigate();
  const { business, profile } = useAuth();

  // ── List of received purchases to pick from ──────────────────────────────
  const [purchases, setPurchases] = useState([]);
  const [purchaseId, setPurchaseId] = useState('');
  const [purchaseSearch, setPurchaseSearch] = useState('');

  // ── Items for the selected purchase ──────────────────────────────────────
  const [purchaseItems, setPurchaseItems] = useState([]);
  const [alreadyReturned, setAlreadyReturned] = useState({});
  const [returnQty, setReturnQty] = useState({});

  // ── Form fields ───────────────────────────────────────────────────────────
  const [returnDate, setReturnDate] = useState(
    todayLocal(business?.time_zone)
  );
  const [reason, setReason] = useState('');

  // ── UI state ──────────────────────────────────────────────────────────────
  const [loadingItems, setLoadingItems] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // ── Load all RECEIVED purchases ───────────────────────────────────────────
  useEffect(() => {
    if (!business?.id) return;

    api.purchases
      .getAll({
        business_id: business.id,
        purchase_status: 'received',
      })
      .then(({ data, error: err }) => {
        if (err) {
          console.error('Error loading purchases:', err);
          return;
        }
        setPurchases(data || []);
      });
  }, [business?.id]);

  // ── Load items + already-returned quantities when purchase is selected ────
  useEffect(() => {
    if (!purchaseId) {
      setPurchaseItems([]);
      setAlreadyReturned({});
      setReturnQty({});
      return;
    }

    setLoadingItems(true);

    api.purchases
      .getItems(purchaseId)
      .then(async ({ data, error: err }) => {
        if (err) {
          console.error('Error loading purchase items:', err);
          setPurchaseItems([]);
          setLoadingItems(false);
          return;
        }

        const items = data || [];
        setPurchaseItems(items);

        // Work out how much of each item has already been returned
        const itemIds = items.map((item) => item.id);

        if (itemIds.length > 0) {
          const { data: returnedMap, error: returnErr } =
            await api.purchaseReturns.getPriorReturned(itemIds);

          if (returnErr) {
            console.error('Error loading prior returns:', returnErr);
          }

          setAlreadyReturned(returnedMap || {});
        } else {
          setAlreadyReturned({});
        }

        setReturnQty({});
        setLoadingItems(false);
      });
  }, [purchaseId]);

  // ── Derived data ──────────────────────────────────────────────────────────
  const selectedPurchase = purchases.find(
    (p) => p.id === Number(purchaseId)
  );

  const filteredPurchases = useMemo(() => {
    const q = purchaseSearch.trim().toLowerCase();
    if (!q) return purchases;
    return purchases.filter((p) => {
      const idStr = String(p.id);
      const supplierName = p.contacts?.name || '';
      return (
        idStr.includes(q) ||
        supplierName.toLowerCase().includes(q) ||
        (p.purchase_date || '').includes(q)
      );
    });
  }, [purchases, purchaseSearch]);

  // Per-row: purchased qty, already returned, still returnable, return value
  const rows = useMemo(
    () =>
      purchaseItems.map((item) => {
        const purchasedQty = Number(item.quantity);
        const returned = alreadyReturned[item.id] || 0;
        const remaining = purchasedQty - returned;

        // unit cost from the recorded line_total (most accurate)
        const unitCost =
          purchasedQty > 0
            ? Math.round((Number(item.line_total) / purchasedQty) * 100) / 100
            : Number(item.unit_cost || 0);

        const qty = Number(returnQty[item.id] || 0);
        const amount = Math.round(qty * unitCost * 100) / 100;

        return {
          item,
          purchasedQty,
          returned,
          remaining,
          unitCost,
          qty,
          amount,
        };
      }),
    [purchaseItems, alreadyReturned, returnQty]
  );

  const totalAmount = rows.reduce((sum, row) => sum + row.amount, 0);

  // ── Qty input handler ─────────────────────────────────────────────────────
  const setQty = (itemId, value) => {
    if (value === '') {
      setReturnQty((prev) => ({ ...prev, [itemId]: '' }));
      return;
    }
    if (!/^\d+$/.test(value)) return;
    const qty = Number(value);
    if (qty <= 0) return;
    setReturnQty((prev) => ({ ...prev, [itemId]: value }));
  };

  // ── Submit ────────────────────────────────────────────────────────────────
  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!purchaseId) {
      setError('Select a purchase.');
      return;
    }

    const activeRows = rows.filter((row) => Number(row.qty) > 0);

    if (activeRows.length === 0) {
      setError(
        'Enter a return quantity greater than 0 for at least one item.'
      );
      return;
    }

    for (const row of activeRows) {
      const qty = Number(row.qty);
      if (!Number.isInteger(qty) || qty <= 0) {
        setError(
          `Return quantity for "${row.item.products?.name}" must be a whole number greater than 0.`
        );
        return;
      }
      if (qty > row.remaining) {
        setError(
          `Return quantity for "${row.item.products?.name}" exceeds the returnable amount (${row.remaining}).`
        );
        return;
      }
    }

    setSubmitting(true);

    try {
      const itemRows = activeRows.map((row) => ({
        purchase_item_id: row.item.id,
        product_id: row.item.product_id,
        quantity_returned: Number(row.qty),
        amount: row.amount,
      }));

      const { error: prErr } = await api.purchaseReturns.create({
        business_id: business.id,
        purchase_id: Number(purchaseId),
        return_date: returnDate,
        reason: reason.trim() || null,
        total_amount: totalAmount,
        created_by: profile.id,
        items: itemRows,
      });

      if (prErr) throw new Error(prErr);

      navigate('/purchases/returns');
    } catch (err) {
      setError(err.message || 'Could not save this return.');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <AppLayout>
      <div className="page-header">
        <div>
          <h1>New purchase return</h1>
          <p className="muted">
            Returns stock to the supplier and reduces your outstanding payable
            balance.
          </p>
        </div>
        <button
          className="btn btn-secondary"
          onClick={() => navigate('/purchases/returns')}
        >
          Cancel
        </button>
      </div>

      <form onSubmit={handleSubmit} className="user-form">
        {/* ── Return details section ─────────────────────────────────────── */}
        <section className="card form-section">
          <h2>Return details</h2>

          <div className="form-grid">
            {/* Purchase picker */}
            <div className="field">
              <label>Purchase / Invoice # *</label>
              <input
                type="text"
                list="purchases-datalist"
                value={purchaseId ? `#${purchaseId}` : purchaseSearch}
                onChange={(e) => {
                  const val = e.target.value;
                  const id = val.replace(/^#/, '');
                  const match = purchases.find((p) => String(p.id) === id);
                  if (match) {
                    setPurchaseId(String(match.id));
                    setPurchaseSearch(String(match.id));
                  } else {
                    setPurchaseId('');
                    setPurchaseSearch(id);
                  }
                }}
                placeholder="Search by purchase # or supplier name"
                required
              />
              <datalist id="purchases-datalist">
                {filteredPurchases.map((p) => (
                  <option key={p.id} value={`#${p.id}`}>
                    {p.purchase_date} —{' '}
                    {p.contacts?.name || 'Cash / unspecified'}
                  </option>
                ))}
              </datalist>

              {purchaseId && selectedPurchase && (
                <small className="muted">
                  Purchase #{selectedPurchase.id} —{' '}
                  {selectedPurchase.purchase_date} —{' '}
                  {selectedPurchase.contacts?.name || 'Cash / unspecified'}
                </small>
              )}
            </div>

            {/* Return date */}
            <div className="field">
              <label>Return date</label>
              <input
                type="date"
                value={returnDate}
                onChange={(e) => setReturnDate(e.target.value)}
              />
            </div>

            {/* Reason */}
            <div className="field" style={{ gridColumn: '1 / -1' }}>
              <label>Reason</label>
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Damaged goods, overstock, wrong item, etc."
              />
            </div>
          </div>
        </section>

        {/* ── Items table (shown once a purchase is selected) ────────────── */}
        {purchaseId && (
          <section className="card form-section">
            <h2>Items</h2>

            {loadingItems ? (
              <div className="muted">Loading items…</div>
            ) : purchaseItems.length === 0 ? (
              <div className="muted">No items found for this purchase.</div>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Purchased</th>
                    <th>Already returned</th>
                    <th>Remaining</th>
                    <th>Return qty</th>
                    <th>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.item.id}>
                      <td style={{ fontWeight: 500 }}>
                        {row.item.products?.name || '—'}
                      </td>
                      <td>{row.purchasedQty}</td>
                      <td>{row.returned}</td>
                      <td>{row.remaining}</td>
                      <td>
                        <input
                          type="number"
                          min="1"
                          max={row.remaining}
                          step="1"
                          inputMode="numeric"
                          className="line-input line-input-sm"
                          value={returnQty[row.item.id] || ''}
                          onChange={(e) =>
                            setQty(row.item.id, e.target.value)
                          }
                          disabled={row.remaining <= 0}
                        />
                      </td>
                      <td>
                        {business?.currency}{' '}
                        {row.amount.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <div className="totals-summary">
              <div className="totals-grand">
                <span>Total return amount</span>
                <span>
                  {business?.currency} {totalAmount.toFixed(2)}
                </span>
              </div>
            </div>
          </section>
        )}

        {error && <div className="error-text">{error}</div>}

        <div className="form-actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => navigate('/purchases/returns')}
          >
            Cancel
          </button>

          <button
            type="submit"
            className="btn btn-primary"
            disabled={submitting || !purchaseId}
          >
            {submitting ? 'Saving…' : 'Save return'}
          </button>
        </div>
      </form>
    </AppLayout>
  );
}
