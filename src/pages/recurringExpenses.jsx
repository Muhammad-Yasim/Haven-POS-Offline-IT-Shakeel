import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import AppLayout from '../components/AppLayout.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../lib/electronAPI.js';
import { todayLocal } from '../lib/timezone.js';

function advanceDate(dateStr, frequency) {
  const d = new Date(dateStr + 'T12:00:00Z');
  switch (frequency) {
    case 'daily': d.setUTCDate(d.getUTCDate() + 1); break;
    case 'weekly': d.setUTCDate(d.getUTCDate() + 7); break;
    case 'yearly': d.setUTCFullYear(d.getUTCFullYear() + 1); break;
    case 'monthly':
    default: d.setUTCMonth(d.getUTCMonth() + 1); break;
  }
  return d.toISOString().slice(0, 10);
}

export default function RecurringExpenses() {
  const { business, profile, can } = useAuth();
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [categories, setCategories] = useState({});
  const [locations, setLocations] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);

  const canCreate = profile?.is_owner || can('expenses', 'create');
  const canEdit = profile?.is_owner || can('expenses', 'edit');

  const today = todayLocal(business?.time_zone);

  const load = async () => {
    if (!business?.id) return;
    setLoading(true);
    const [tmplRes, catRes, locRes] = await Promise.all([
      api.recurringExpenses.getAll(),
      api.expenseCategories.getAll(),
      api.locations.getAll(),
    ]);
    setRows(tmplRes?.data || []);
    setCategories(Object.fromEntries((catRes?.data || []).map((c) => [c.id, c.name])));
    setLocations(Object.fromEntries((locRes?.data || []).map((l) => [l.id, l.name])));
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [business?.id]);

  const toggleActive = async (row) => {
    await api.recurringExpenses.toggleActive(row.id);
    load();
  };

  const runNow = async (row) => {
    setError('');
    setBusyId(row.id);
    try {
      const res = await api.recurringExpenses.runNow(row.id);
      if (res?.error) throw new Error(res.error);
      load();
    } catch (err) {
      setError(err.message || 'Could not run this template.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <AppLayout>
      <div className="page-header">
        <div>
          <h1>Recurring expenses</h1>
          <p className="muted">Templates you run manually to generate an expense — there's no auto-scheduler yet, see note below.</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Link to="/expenses" className="btn btn-secondary">Back to expenses</Link>
          {canCreate && <button className="btn btn-primary" onClick={() => navigate('/recurring-expenses/new')}>+ New template</button>}
        </div>
      </div>

      {error && <div className="error-text" style={{ marginBottom: 12 }}>{error}</div>}

      <div className="card list-panel">
        <table className="data-table">
          <thead>
            <tr><th>Category</th><th>Location</th><th>Amount</th><th>Frequency</th><th>Next due</th><th>Status</th><th></th></tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={7} className="muted table-empty">Loading…</td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={7} className="muted table-empty">No recurring templates yet.</td></tr>}
            {!loading && rows.map((r) => (
              <tr key={r.id}>
                <td>{categories[r.category_id] || '—'}</td>
                <td>{locations[r.location_id] || '—'}</td>
                <td>{business?.currency} {Number(r.amount).toFixed(2)}</td>
                <td style={{ textTransform: 'capitalize' }}>{r.frequency}</td>
                <td>
                  {r.next_due_date}
                  {r.is_active && r.next_due_date <= today && <span className="badge badge-warning" style={{ marginLeft: 8 }}>Due</span>}
                </td>
                <td>{r.is_active ? <span className="badge badge-success">Active</span> : <span className="badge badge-danger">Paused</span>}</td>
                <td className="table-actions">
                  {canEdit && r.is_active && (
                    <button className="btn btn-secondary btn-sm" disabled={busyId === r.id} onClick={() => runNow(r)}>
                      {busyId === r.id ? 'Running…' : 'Run now'}
                    </button>
                  )}
                  {canEdit && (
                    <button className="btn btn-ghost btn-sm" onClick={() => navigate(`/recurring-expenses/${r.id}`)}>Edit</button>
                  )}
                  {canEdit && (
                    <button className="btn btn-ghost btn-sm" onClick={() => toggleActive(r)}>{r.is_active ? 'Pause' : 'Resume'}</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AppLayout>
  );
}
