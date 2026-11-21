import { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import AppLayout from '../components/AppLayout.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../lib/electronAPI.js';
import PrintReportHeader from '../components/PrintReportHeader.jsx';
import { computeRegisterSummary } from '../lib/registerUtils.js';
import { CloseRegisterModal } from '../components/pos/RegisterModals.jsx';
import './registerReport.css';

/**
 * RegisterReport
 *
 * Works two ways:
 *  1. Routed:   /registers/:id            → reads the id from useParams()
 *  2. Embedded: <RegisterReport registerId={5} hideLayout isSidebarView
 *                 onRegisterClosed={...} />
 *     used by activeRegister.jsx to show the logged-in user's own open
 *     register inline, without a page navigation.
 *
 * `hideLayout`     — skip the <AppLayout> wrapper (parent already provides one)
 * `isSidebarView`  — compact header, no "Back to Registers" link
 * `onRegisterClosed` — called after the register is closed from this view
 */
export default function RegisterReport({
  registerId: registerIdProp,
  hideLayout = false,
  isSidebarView = false,
  onRegisterClosed,
} = {}) {
  const params = useParams();
  const id = registerIdProp ?? params.id;

  const navigate = useNavigate();
  const { business, profile } = useAuth();

  const [register, setRegister] = useState(null);
  const [locationName, setLocationName] = useState('');
  const [userName, setUserName] = useState('');
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [showCloseRegister, setShowCloseRegister] = useState(false);
  const [registerSubmitting, setRegisterSubmitting] = useState(false);

  const load = useCallback(async () => {
    if (!business?.id || !id) return;

    setLoading(true);
    setError('');

    try {
      const summaryData = await api.registers.getSummary(Number(id));
      if (!summaryData || !summaryData.register) {
        setError('Register not found.');
        setLoading(false);
        return;
      }

      const registerRow = summaryData.register;
      setRegister(registerRow);
      setLocationName(registerRow.locations?.name || '—');
      setUserName(
        `${registerRow.users?.first_name || ''} ${registerRow.users?.last_name || ''}`.trim() || '—'
      );

      setSummary(
        computeRegisterSummary({
          register: registerRow,
          sales: summaryData.sales || [],
          sellReturns: summaryData.sellReturns || [],
          expenses: summaryData.expenses || [],
          saleItems: summaryData.saleItems || [],
        })
      );
    } catch (err) {
      setError(err?.message || 'Error loading register.');
    } finally {
      setLoading(false);
    }
  }, [business?.id, id]);

  useEffect(() => {
    load();
  }, [load]);

  const cur = business?.currency || '';
  const fmt = (n) => `${cur} ${Number(n || 0).toFixed(2)}`;

  // Only the person who opened this register (or the owner) can close it
  // from here — everyone else can still view the report.
  const canClose =
    register?.status === 'open' &&
    (register?.user_id === profile?.id || profile?.is_owner);

  const handleCloseConfirm = async (closingCash) => {
    setRegisterSubmitting(true);
    setError('');
    try {
      await api.registers.close({
        id: register.id,
        closing_cash: Number(closingCash) || 0,
      });

      setShowCloseRegister(false);
      await load();
      onRegisterClosed?.();
    } catch (err) {
      setError(err?.message || 'Could not close register.');
    } finally {
      setRegisterSubmitting(false);
    }
  };

  const content = () => {
    if (loading) return <div className="muted">Loading register report…</div>;
    if (error) return <div className="error-text">{error}</div>;
    if (!register || !summary) return null;

    const diffColor =
      summary.cashDifference == null
        ? 'var(--navy-900)'
        : summary.cashDifference === 0
          ? 'var(--success)'
          : summary.cashDifference < 0
            ? 'var(--danger)'
            : 'var(--warning)';

    return (
      <>
        <div className="page-header no-print">
          <div>
            <h1>Register Report — #{register.id}</h1>
            <p className="muted">{locationName} · {userName}</p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {canClose && (
              <button className="btn btn-primary" onClick={() => setShowCloseRegister(true)}>
                🔒 Close register
              </button>
            )}
            <button className="btn btn-secondary" onClick={() => window.print()}>🖨 Print</button>
            {!isSidebarView && (
              <button className="btn btn-secondary" onClick={() => navigate('/registers')}>
                Back to Registers
              </button>
            )}
          </div>
        </div>

        {error && <div className="error-text" style={{ marginBottom: 12 }}>{error}</div>}

        <PrintReportHeader
          title={`Register Report #${register.id}`}
          location={locationName}
          filtersLabel="Register Details:"
          filters={[
            { label: 'Cashier', value: userName },
            { label: 'Status', value: register.status?.toUpperCase() },
            { label: 'Opened', value: new Date(register.opened_at).toLocaleString() },
            { label: 'Closed', value: register.closed_at ? new Date(register.closed_at).toLocaleString() : 'Still open' },
          ]}
        />

        {/* Screen-only summary cards */}
        <div className="card no-print" style={{ padding: 20, marginBottom: 16 }}>
          <div className="summary-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
            <div className="summary-card">
              <div className="summary-card-label">Opened</div>
              <div className="summary-card-value" style={{ fontSize: 15 }}>
                {new Date(register.opened_at).toLocaleString()}
              </div>
            </div>
            <div className="summary-card">
              <div className="summary-card-label">Closed</div>
              <div className="summary-card-value" style={{ fontSize: 15 }}>
                {register.closed_at ? new Date(register.closed_at).toLocaleString() : 'Still open'}
              </div>
            </div>
            <div className="summary-card">
              <div className="summary-card-label">User</div>
              <div className="summary-card-value" style={{ fontSize: 15 }}>{userName}</div>
            </div>
            <div className="summary-card">
              <div className="summary-card-label">Location</div>
              <div className="summary-card-value" style={{ fontSize: 15 }}>{locationName}</div>
            </div>
          </div>
        </div>

        <div className="summary-grid no-print" style={{ marginBottom: 16 }}>
          <div className="summary-card">
            <div className="summary-card-label">Total Sales</div>
            <div className="summary-card-value">{fmt(summary.totalSales)}</div>
          </div>
          <div className="summary-card summary-card-danger">
            <div className="summary-card-label">Total Refund</div>
            <div className="summary-card-value">{fmt(summary.totalRefund)}</div>
          </div>
          <div className="summary-card summary-card-success">
            <div className="summary-card-label">Total Payment</div>
            <div className="summary-card-value">{fmt(summary.totalPayment)}</div>
          </div>
          <div className="summary-card summary-card-warning">
            <div className="summary-card-label">Credit Sales</div>
            <div className="summary-card-value">{fmt(summary.creditSales)}</div>
          </div>
          <div className="summary-card summary-card-info">
            <div className="summary-card-label">Total Expense</div>
            <div className="summary-card-value">{fmt(summary.totalExpense)}</div>
          </div>
          <div className="summary-card">
            <div className="summary-card-label">Cash Sales</div>
            <div className="summary-card-value">{fmt(summary.cashSales)}</div>
          </div>
          <div className="summary-card">
            <div className="summary-card-label">Card Sales</div>
            <div className="summary-card-value">{fmt(summary.cardSales)}</div>
          </div>
          <div className="summary-card">
            <div className="summary-card-label">Other Tender</div>
            <div className="summary-card-value">{fmt(summary.otherTenderSales)}</div>
          </div>
        </div>

        <div className="card no-print" style={{ padding: 20, marginBottom: 16, maxWidth: 440 }}>
          <h2 style={{ fontSize: 15, marginBottom: 12 }}>Cash Drawer</h2>

          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              <tr>
                <td style={{ padding: '4px 0', color: 'var(--text-secondary)' }}>Opening cash</td>
                <td style={{ padding: '4px 0', textAlign: 'right', fontWeight: 600 }}>{fmt(summary.openingCash)}</td>
              </tr>
              <tr>
                <td style={{ padding: '4px 0', color: 'var(--text-secondary)' }}>+ Cash sales</td>
                <td style={{ padding: '4px 0', textAlign: 'right', fontWeight: 600 }}>{fmt(summary.cashSales)}</td>
              </tr>
              <tr>
                <td style={{ padding: '4px 0', color: 'var(--text-secondary)' }}>- Cash refunds</td>
                <td style={{ padding: '4px 0', textAlign: 'right', fontWeight: 600 }}>{fmt(summary.cashRefunds)}</td>
              </tr>
              <tr>
                <td style={{ padding: '4px 0', color: 'var(--text-secondary)' }}>- Cash expenses</td>
                <td style={{ padding: '4px 0', textAlign: 'right', fontWeight: 600 }}>{fmt(summary.cashExpenses)}</td>
              </tr>
            </tbody>
          </table>

          <div className="totals-grand" style={{ marginTop: 8, maxWidth: 'none', marginLeft: 0 }}>
            <span>Expected cash</span>
            <span>{fmt(summary.expectedCash)}</span>
          </div>

          {summary.actualClosingCash != null && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--text-secondary)', marginTop: 8 }}>
                <span>Actual closing cash</span>
                <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{fmt(summary.actualClosingCash)}</span>
              </div>
              <div
                className="totals-grand"
                style={{ marginTop: 4, maxWidth: 'none', marginLeft: 0, color: diffColor }}
              >
                <span>Cash difference</span>
                <span>{summary.cashDifference > 0 ? '+' : ''}{fmt(summary.cashDifference)}</span>
              </div>
            </>
          )}

          {register.status === 'open' && (
            <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
              Register is still open — expected cash will keep changing until it's closed.
            </p>
          )}
        </div>

        {/* Print-Only Compact Summary (Replaces bulky cards when printing) */}
        <div className="reg-print-summary print-only">
          <div className="reg-print-grid">
            {/* Left: Sales & Tender Summary */}
            <div className="reg-print-panel">
              <div className="reg-print-panel-header">Sales &amp; Tender Summary</div>
              <table className="reg-print-table">
                <tbody>
                  <tr>
                    <td className="reg-print-label">Total Sales</td>
                    <td className="reg-print-val font-bold">{fmt(summary.totalSales)}</td>
                  </tr>
                  <tr>
                    <td className="reg-print-label">Cash Sales</td>
                    <td className="reg-print-val">{fmt(summary.cashSales)}</td>
                  </tr>
                  <tr>
                    <td className="reg-print-label">Card Sales</td>
                    <td className="reg-print-val">{fmt(summary.cardSales)}</td>
                  </tr>
                  <tr>
                    <td className="reg-print-label">Credit Sales</td>
                    <td className="reg-print-val">{fmt(summary.creditSales)}</td>
                  </tr>
                  {Number(summary.otherTenderSales || 0) > 0 && (
                    <tr>
                      <td className="reg-print-label">Other Tender</td>
                      <td className="reg-print-val">{fmt(summary.otherTenderSales)}</td>
                    </tr>
                  )}
                  <tr className="reg-print-subtotal">
                    <td className="reg-print-label font-bold">Total Payments</td>
                    <td className="reg-print-val font-bold" style={{ color: '#16a34a' }}>{fmt(summary.totalPayment)}</td>
                  </tr>
                  <tr>
                    <td className="reg-print-label">Total Refunds</td>
                    <td className="reg-print-val" style={{ color: '#dc2626' }}>-{fmt(summary.totalRefund)}</td>
                  </tr>
                  <tr>
                    <td className="reg-print-label">Total Expenses</td>
                    <td className="reg-print-val" style={{ color: '#dc2626' }}>-{fmt(summary.totalExpense)}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Right: Cash Drawer Reconciliation */}
            <div className="reg-print-panel">
              <div className="reg-print-panel-header">Cash Drawer Reconciliation</div>
              <table className="reg-print-table">
                <tbody>
                  <tr>
                    <td className="reg-print-label">Opening Cash</td>
                    <td className="reg-print-val font-bold">{fmt(summary.openingCash)}</td>
                  </tr>
                  <tr>
                    <td className="reg-print-label">(+) Cash Sales</td>
                    <td className="reg-print-val" style={{ color: '#16a34a' }}>+{fmt(summary.cashSales)}</td>
                  </tr>
                  <tr>
                    <td className="reg-print-label">(-) Cash Refunds</td>
                    <td className="reg-print-val" style={{ color: '#dc2626' }}>-{fmt(summary.cashRefunds)}</td>
                  </tr>
                  <tr>
                    <td className="reg-print-label">(-) Cash Expenses</td>
                    <td className="reg-print-val" style={{ color: '#dc2626' }}>-{fmt(summary.cashExpenses)}</td>
                  </tr>
                  <tr className="reg-print-highlight">
                    <td className="reg-print-label font-bold">Expected Cash</td>
                    <td className="reg-print-val font-bold">{fmt(summary.expectedCash)}</td>
                  </tr>
                  {summary.actualClosingCash != null ? (
                    <>
                      <tr>
                        <td className="reg-print-label">Actual Closing Cash</td>
                        <td className="reg-print-val font-bold">{fmt(summary.actualClosingCash)}</td>
                      </tr>
                      <tr className="reg-print-highlight">
                        <td className="reg-print-label font-bold">Cash Difference</td>
                        <td className="reg-print-val font-bold" style={{ color: diffColor }}>
                          {summary.cashDifference > 0 ? '+' : ''}{fmt(summary.cashDifference)}
                        </td>
                      </tr>
                    </>
                  ) : (
                    <tr>
                      <td colSpan={2} className="reg-print-note">
                        * Register is still open — expected cash will update until closed.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="card list-panel reg-products-card">
          <div className="reg-products-header" style={{ padding: '14px 16px', borderBottom: '1px solid var(--border-light)', fontWeight: 700 }}>
            Products sold ({summary.productsSold.length})
          </div>
          <table className="data-table">
            <thead>
              <tr>
                {/* <th>SKU</th> */}
                <th>Product</th>
                <th>Quantity</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              {summary.productsSold.length === 0 && (
                <tr>
                  <td colSpan={4} className="muted table-empty">
                    No products sold in this register session.
                  </td>
                </tr>
              )}
              {summary.productsSold.map((p) => (
                <tr key={p.product_id}>
                  {/* <td>{p.sku}</td> */}
                  <td style={{ fontWeight: 600, color: 'var(--navy-900)' }}>{p.name}</td>
                  <td style={{ fontWeight: 600, color: 'var(--navy-900)' }}>{p.quantity}</td>
                  <td style={{ fontWeight: 600, color: 'var(--navy-900)' }}>{fmt(p.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {showCloseRegister && (
          <CloseRegisterModal
            register={register}
            business={business}
            submitting={registerSubmitting}
            onCancel={() => setShowCloseRegister(false)}
            onConfirm={handleCloseConfirm}
          />
        )}
      </>
    );
  };

  if (hideLayout) return content();
  return <AppLayout>{content()}</AppLayout>;
}
