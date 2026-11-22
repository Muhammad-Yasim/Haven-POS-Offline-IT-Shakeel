import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import AppLayout from '../components/AppLayout.jsx';
import ExpenseFormDialog from '../components/expenses/ExpenseFormDialog.jsx';
import ExpenseViewDrawer, { DeleteExpenseDialog } from '../components/expenses/ExpenseViewDrawer.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../lib/electronAPI.js';
import { getPresetRange } from '../lib/dateRanges.js';
import {
  EXPENSE_DATE_PRESETS,
  EXPENSE_PAYMENT_METHODS,
  exportExpensesCsv,
  formatMoney,
  getExpenseStatus,
  getExpenseTitle,
  matchesDatePreset,
  sumAmounts,
} from '../lib/expenseUtils.js';
import './expenses.css';
import { todayLocal } from '../lib/timezone.js';
import useLocationScope from '../hooks/useLocationScope.js';
import DataSearchBar from '../components/DataSearchBar.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import EmptyState from '../components/EmptyState.jsx';
import TableActions from '../components/TableActions.jsx';
import Pagination from '../components/Pagination.jsx';
import usePagination from '../hooks/usePagination.js';

export default function Expenses() {
  const { business, profile, can } = useAuth();
  const { isOwner, isScopedToLocation, scopedLocationIds } = useLocationScope();

  const [rows, setRows] = useState([]);
  const [categoryList, setCategoryList] = useState([]);
  const [locationList, setLocationList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [search, setSearch] = useState('');
  const [datePreset, setDatePreset] = useState('all');
  const [customRange, setCustomRange] = useState({ from: '', to: '' });
  const [categoryFilter, setCategoryFilter] = useState('');
  const [locationFilter, setLocationFilter] = useState('');
  const [paymentFilter, setPaymentFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const [formOpen, setFormOpen] = useState(false);
  const [editId, setEditId] = useState(null);
  const [viewExpense, setViewExpense] = useState(null);
  const [deleteExpense, setDeleteExpense] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [openActionId, setOpenActionId] = useState(null);

  const canCreate = profile?.is_owner || can('expenses', 'create');
  const canEdit = profile?.is_owner || can('expenses', 'edit');
  const canDelete = profile?.is_owner || can('expenses', 'delete');

  const categories = useMemo(
    () => Object.fromEntries(categoryList.map((c) => [c.id, c.name])),
    [categoryList],
  );

  const locations = useMemo(
    () => Object.fromEntries(locationList.map((l) => [l.id, l.name])),
    [locationList],
  );

  const load = async () => {
    if (!business?.id) return;
    setLoading(true);
    setError('');

    try {
      const [expRes, catRes, locRes] = await Promise.all([
        api.expenses.getAll({
          business_id: business.id,
          scopedLocationIds: isScopedToLocation ? scopedLocationIds : undefined,
        }),
        api.expenseCategories.getAll(),
        api.locations.getAll(),
      ]);

      if (expRes?.error) setError(expRes.error);
      setRows(expRes?.data || []);
      setCategoryList(catRes?.data || []);
      const activeLocs = (locRes?.data || []).filter(
        (l) => l.is_active !== 0 && l.is_active !== false
      );
      setLocationList(activeLocs);
    } catch (err) {
      setError(err.message || 'Could not load expenses.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [business?.id]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();

    return rows.filter((row) => {
      if (categoryFilter && String(row.category_id) !== String(categoryFilter)) return false;
      // Location: for staff auto-scope; for owners use optional filter
      if (isScopedToLocation) {
        if (scopedLocationIds.length === 0) return false;
        if (!scopedLocationIds.includes(row.location_id)) return false;
      } else if (locationFilter && String(row.location_id) !== String(locationFilter)) {
        return false;
      }
      if (paymentFilter && row.payment_method !== paymentFilter) return false;
      if (statusFilter && getExpenseStatus(row) !== statusFilter) return false;
      if (!matchesDatePreset(row, datePreset, customRange, business?.time_zone)) return false;

      if (!q) return true;

      const title = getExpenseTitle(row, categories).toLowerCase();
      const haystack = [
        title,
        String(row.id),
        categories[row.category_id] || '',
        locations[row.location_id] || '',
        row.vendor || '',
        row.reference_number || '',
        row.note || '',
        row.payment_method || '',
      ].join(' ').toLowerCase();

      return haystack.includes(q);
    });
  }, [
    rows,
    search,
    categoryFilter,
    locationFilter,
    paymentFilter,
    statusFilter,
    datePreset,
    customRange,
    categories,
    locations,
  ]);

  const {
    currentPage,
    totalPages,
    totalItems,
    paginatedItems,
    firstItemIndex,
    lastItemIndex,
    goToPage,
    nextPage,
    previousPage,
    hasNextPage,
    hasPreviousPage,
  } = usePagination(filtered, 20);

  const monthRange = useMemo(() => getPresetRange('this_month'), []);
  const today = todayLocal();

  const summary = useMemo(() => {
    const totalAll = sumAmounts(rows);
    const todayTotal = sumAmounts(rows.filter((r) => r.expense_date === today));
    const monthTotal = sumAmounts(
      rows.filter((r) => {
        if (monthRange.from && r.expense_date < monthRange.from) return false;
        if (monthRange.to && r.expense_date > monthRange.to) return false;
        return true;
      }),
    );
    const pendingTotal = sumAmounts(rows.filter((r) => getExpenseStatus(r) === 'pending'));
    const paidTotal = sumAmounts(rows.filter((r) => getExpenseStatus(r) === 'paid'));

    return { totalAll, todayTotal, monthTotal, pendingTotal, paidTotal };
  }, [rows, today, monthRange]);

  const openCreate = () => {
    setEditId(null);
    setFormOpen(true);
  };

  const openEdit = (row) => {
    setViewExpense(null);
    setEditId(row.id);
    setFormOpen(true);
  };

  const handleDelete = async () => {
    if (!deleteExpense) return;
    setDeleting(true);
    setError('');
    try {
      const res = await api.expenses.delete(deleteExpense.id);
      if (res?.error) throw new Error(res.error);
      setDeleteExpense(null);
      load();
    } catch (err) {
      setError(err.message || 'Could not delete this expense.');
    } finally {
      setDeleting(false);
    }
  };

  const handleExport = () => {
    exportExpensesCsv(filtered, {
      categories,
      locations,
      currency: business?.currency,
      businessName: business?.business_name,
      tz: business?.time_zone,
    });
  };

  const handlePrint = () => window.print();

  const handlePresetChange = (preset) => {
    setDatePreset(preset);
    if (preset !== 'custom') {
      setCustomRange({ from: '', to: '' });
    }
  };

  const handleFormSaved = () => {
    setFormOpen(false);
    setEditId(null);
    load();
  };

  return (
    <AppLayout>
      {error && (
        <div className="error-text" style={{ marginBottom: 12 }}>
          {error}
        </div>
      )}

      <div className="card list-panel">
        <div className="expenses-print-header">
          <div style={{ fontWeight: 800, fontSize: '13px', color: 'var(--navy-700)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>{business?.business_name}</div>
          <h1>Expenses — {business?.business_name || 'Business name'}</h1>
          <p className="muted">{filtered.length} record(s)</p>
        </div>

        {/* ── Top bar: dark navy header matching Sales & Purchases ── */}
        <div
          className="no-print"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '11px 16px',
            background: 'var(--navy-800)',
            borderRadius: 'var(--radius-md) var(--radius-md) 0 0',
            flexWrap: 'nowrap',
          }}
        >
          <h1
            style={{
              margin: 0,
              fontSize: 15,
              fontWeight: 700,
              whiteSpace: 'nowrap',
              color: '#fff',
              letterSpacing: '0.01em',
            }}
          >
            Expenses
          </h1>

          <div style={{ flex: '1 1 220px', minWidth: 0 }}>
            <DataSearchBar
              query={search}
              setQuery={setSearch}
              clearSearch={() => setSearch('')}
              placeholder="Search title, ID, vendor, ref…"
            />
          </div>

          <Link
            to="/expense-categories"
            className="btn btn-sm"
            style={{
              whiteSpace: 'nowrap',
              background: 'rgba(255,255,255,0.12)',
              color: '#fff',
              border: '1px solid rgba(255,255,255,0.22)',
            }}
          >
            Categories
          </Link>

          <Link
            to="/recurring-expenses"
            className="btn btn-sm"
            style={{
              whiteSpace: 'nowrap',
              background: 'rgba(255,255,255,0.12)',
              color: '#fff',
              border: '1px solid rgba(255,255,255,0.22)',
            }}
          >
            Recurring
          </Link>

          <Link
            to="/reports/expenses"
            className="btn btn-sm"
            style={{
              whiteSpace: 'nowrap',
              background: 'rgba(255,255,255,0.12)',
              color: '#fff',
              border: '1px solid rgba(255,255,255,0.22)',
            }}
          >
            Expense Reports
          </Link>

          <button
            type="button"
            className="btn btn-sm"
            style={{
              whiteSpace: 'nowrap',
              background: 'rgba(255,255,255,0.12)',
              color: '#fff',
              border: '1px solid rgba(255,255,255,0.22)',
            }}
            onClick={handleExport}
            disabled={filtered.length === 0}
          >
            Export
          </button>

          <button
            type="button"
            className="btn btn-sm"
            style={{
              whiteSpace: 'nowrap',
              background: 'rgba(255,255,255,0.12)',
              color: '#fff',
              border: '1px solid rgba(255,255,255,0.22)',
            }}
            onClick={handlePrint}
            disabled={filtered.length === 0}
          >
            🖨 Print
          </button>

          {canCreate && (
            <button
              type="button"
              className="btn btn-sm"
              style={{
                whiteSpace: 'nowrap',
                background: '#fff',
                color: 'var(--navy-800)',
                fontWeight: 700,
                border: 'none',
              }}
              onClick={openCreate}
            >
              + Add Expense
            </button>
          )}
        </div>

        {/* ── Filter bar: light blue tint matching Sales & Purchases ── */}
        <div
          className="no-print"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '8px 16px',
            borderBottom: '1px solid var(--navy-border)',
            flexWrap: 'wrap',
            background: 'var(--navy-100)',
          }}
        >
          <select
            className="filter-select"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
          >
            <option value="">All categories</option>
            {categoryList.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>



          <select
            className="filter-select"
            value={paymentFilter}
            onChange={(e) => setPaymentFilter(e.target.value)}
          >
            <option value="">All payment methods</option>
            {EXPENSE_PAYMENT_METHODS.map((method) => (
              <option key={method} value={method}>{method}</option>
            ))}
          </select>

          <select
            className="filter-select"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">All statuses</option>
            <option value="pending">Pending</option>
            <option value="paid">Paid</option>
          </select>

          <select
            className="filter-select"
            value={datePreset}
            onChange={(e) => handlePresetChange(e.target.value)}
          >
            <option value="all">All time</option>
            {EXPENSE_DATE_PRESETS.map((preset) => (
              <option key={preset.key} value={preset.key}>{preset.label}</option>
            ))}
            <option value="custom">Custom date range</option>
          </select>

          {datePreset === 'custom' && (
            <>
              <input
                type="date"
                className="filter-select"
                value={customRange.from}
                onChange={(e) => setCustomRange((r) => ({ ...r, from: e.target.value }))}
                aria-label="From date"
                style={{ flex: '0 1 130px', minWidth: 120 }}
              />
              <span className="muted" style={{ fontSize: 12 }}>to</span>
              <input
                type="date"
                className="filter-select"
                value={customRange.to}
                onChange={(e) => setCustomRange((r) => ({ ...r, to: e.target.value }))}
                aria-label="To date"
                style={{ flex: '0 1 130px', minWidth: 120 }}
              />
            </>
          )}

          {(categoryFilter || locationFilter || paymentFilter || statusFilter || datePreset !== 'all' || customRange.from || customRange.to || search) && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              style={{ whiteSpace: 'nowrap', fontSize: 12, padding: '5px 10px' }}
              onClick={() => {
                setCategoryFilter('');
                setLocationFilter('');
                setPaymentFilter('');
                setStatusFilter('');
                setDatePreset('all');
                setCustomRange({ from: '', to: '' });
                setSearch('');
              }}
            >
              ✕ Clear
            </button>
          )}

          <div style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 700, color: 'var(--navy-900)' }}>
            Filtered: {formatMoney(business?.currency, sumAmounts(filtered))}
          </div>
        </div>

        {/* ── Sleek KPI strip ── */}
        <div
          className="no-print"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            padding: '7px 16px',
            background: '#fafbfc',
            borderBottom: '1px solid var(--navy-border)',
            fontSize: '12px',
            flexWrap: 'wrap',
          }}
        >
          <span>Total: <strong>{formatMoney(business?.currency, summary.totalAll)}</strong></span>
          <span style={{ color: 'var(--navy-border)' }}>•</span>
          <span>Today: <strong>{formatMoney(business?.currency, summary.todayTotal)}</strong></span>
          <span style={{ color: 'var(--navy-border)' }}>•</span>
          <span>This Month: <strong>{formatMoney(business?.currency, summary.monthTotal)}</strong></span>
          <span style={{ color: 'var(--navy-border)' }}>•</span>
          <span>Pending: <strong style={{ color: 'var(--warning, #d97706)' }}>{formatMoney(business?.currency, summary.pendingTotal)}</strong></span>
          <span style={{ color: 'var(--navy-border)' }}>•</span>
          <span>Paid: <strong style={{ color: 'var(--success, #16a34a)' }}>{formatMoney(business?.currency, summary.paidTotal)}</strong></span>
        </div>

        {/* ── Table view matching Sales & Purchases ── */}
        <div style={{ overflowX: 'auto', paddingBottom: 16 }}>
          <table className="data-table table-compact" style={{ whiteSpace: 'nowrap' }}>
            <thead>
              <tr>
                <th style={{ width: 60 }}>ID</th>
                <th style={{ width: 90 }} className="no-print">Actions</th>
                <th>Expense title</th>
                <th>Category</th>

                <th>Date</th>
                <th>Payment method</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={9} className="muted table-empty">Loading expenses…</td>
                </tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={9} className="muted table-empty">
                    {rows.length === 0 ? 'No expenses recorded yet.' : 'No matching expenses found.'}
                  </td>
                </tr>
              )}
              {!loading && paginatedItems.map((row) => {
                const status = getExpenseStatus(row);
                return (
                  <tr key={row.id}>
                    <td>
                      <span style={{ fontWeight: 600, color: 'var(--navy-muted, #64748b)', fontSize: '12px' }}>#{row.id}</span>
                    </td>
                    <td
                      className="table-actions no-print"
                      onClick={(e) => e.stopPropagation()}
                      style={{ position: 'relative' }}
                    >
                      <TableActions
                        dropdown
                        openId={openActionId}
                        rowId={row.id}
                        setOpenId={setOpenActionId}
                        actions={[
                          { label: '👁️ View', onClick: () => setViewExpense(row) },
                          { label: '✏️ Edit', hidden: !canEdit, onClick: () => openEdit(row) },
                          { label: '🗑️ Delete', hidden: !canDelete, danger: true, onClick: () => setDeleteExpense(row) },
                        ]}
                      />
                    </td>
                    <td>
                      <div style={{ fontWeight: 500 }}>{getExpenseTitle(row, categories)}</div>
                      {row.vendor && <div className="muted" style={{ fontSize: '11px' }}>{row.vendor}</div>}
                    </td>
                    <td>{categories[row.category_id] || '—'}</td>

                    <td>{row.expense_date}</td>
                    <td>{row.payment_method ? row.payment_method.replace('_', ' ') : '—'}</td>
                    <td>
                      <span className={`badge ${status === 'paid' ? 'badge-success' : 'badge-warning'}`}>
                        {status}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                      {formatMoney(business?.currency, row.amount)}
                    </td>
                  </tr>
                );
              })}
              {!loading && paginatedItems.length > 0 && (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'right', fontWeight: 700 }}>
                    TOTAL (PAGE)
                  </td>
                  <td style={{ textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                    {formatMoney(business?.currency, paginatedItems.reduce((sum, r) => sum + Number(r.amount || 0), 0))}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {!loading && totalItems > 0 && (
          <div className="no-print">
            <Pagination
              currentPage={currentPage}
              totalPages={totalPages}
              totalItems={totalItems}
              firstItemIndex={firstItemIndex}
              lastItemIndex={lastItemIndex}
              goToPage={goToPage}
              nextPage={nextPage}
              previousPage={previousPage}
              hasNextPage={hasNextPage}
              hasPreviousPage={hasPreviousPage}
            />
          </div>
        )}
      </div>

      <ExpenseFormDialog
        open={formOpen}
        expenseId={editId}
        business={business}
        onClose={() => {
          setFormOpen(false);
          setEditId(null);
        }}
        onSaved={handleFormSaved}
      />

      <ExpenseViewDrawer
        open={!!viewExpense}
        expense={viewExpense}
        categories={categories}
        locations={locations}
        currency={business?.currency}
        canEdit={canEdit}
        onClose={() => setViewExpense(null)}
        onEdit={(row) => openEdit(row)}
      />

      <DeleteExpenseDialog
        open={!!deleteExpense}
        expense={deleteExpense}
        categories={categories}
        deleting={deleting}
        onClose={() => !deleting && setDeleteExpense(null)}
        onConfirm={handleDelete}
      />
    </AppLayout>
  );
}