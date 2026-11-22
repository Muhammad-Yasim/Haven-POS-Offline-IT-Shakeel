import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import AppLayout from '../components/AppLayout.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../lib/electronAPI.js';
import { todayLocal } from '../lib/timezone.js';
import useLocationScope from '../hooks/useLocationScope.js';
import './userForm.css';

const emptyForm = (tz) => ({
  location_id: '', category_id: '', amount: '', frequency: 'monthly',
  next_due_date: todayLocal(tz), is_active: true,
});

export default function RecurringExpenseForm() {
  const { id } = useParams();
  const isEdit = !!id;
  const navigate = useNavigate();
  const { business } = useAuth();
  const { isScopedToLocation, scopedLocationIds } = useLocationScope();

  const [form, setForm] = useState(emptyForm(business?.time_zone));
  const [locations, setLocations] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(isEdit);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!business?.id) return;
    Promise.all([
      api.locations.getAll(),
      api.expenseCategories.getAll(),
    ]).then(([locRes, catRes]) => {
      let loadedLocs = (locRes?.data || []).filter((l) => l.is_active !== 0 && l.is_active !== false);
      if (isScopedToLocation) {
        loadedLocs = loadedLocs.filter((l) => scopedLocationIds.includes(l.id));
      }
      setLocations(loadedLocs);
      setCategories(catRes?.data || []);
      if (loadedLocs.length > 0 && !isEdit) setForm((f) => ({ ...f, location_id: f.location_id || loadedLocs[0].id }));
    });
  }, [business?.id, isEdit]);

  useEffect(() => {
    if (!isEdit) return;
    api.recurringExpenses.getById(id).then(({ data }) => {
      if (data) setForm({ ...emptyForm(business?.time_zone), ...data, amount: String(data.amount) });
      setLoading(false);
    });
  }, [isEdit, id]);

  const update = (key) => (e) => {
    const val = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setForm((f) => ({ ...f, [key]: val }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    const locId = form.location_id || locations[0]?.id || 1;
    if (!form.category_id || !form.amount || !form.next_due_date) {
      setError('Category, amount, and next due date are required.');
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        business_id: business.id,
        location_id: locId,
        category_id: form.category_id,
        amount: Number(form.amount),
        frequency: form.frequency,
        next_due_date: form.next_due_date,
        is_active: form.is_active,
      };
      if (isEdit) {
        const res = await api.recurringExpenses.update({ id, ...payload });
        if (res?.error) throw new Error(res.error);
      } else {
        const res = await api.recurringExpenses.create(payload);
        if (res?.error) throw new Error(res.error);
      }
      navigate('/recurring-expenses');
    } catch (err) {
      setError(err.message || 'Could not save this template.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <AppLayout><div className="muted">Loading…</div></AppLayout>;

  return (
    <AppLayout>
      <div className="page-header">
        <div>
          <h1>{isEdit ? 'Edit recurring template' : 'New recurring template'}</h1>
          <p className="muted">You'll still need to hit "Run now" when it's due, unless automation is set up.</p>
        </div>
        <button className="btn btn-secondary" onClick={() => navigate('/recurring-expenses')}>Cancel</button>
      </div>

      <form onSubmit={handleSubmit} className="user-form">
        <section className="card form-section">
          <h2>Details</h2>
          <div className="form-grid">

            <div className="field"><label>Category *</label>
              <select value={form.category_id} onChange={update('category_id')} required>
                <option value="">Select…</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="field"><label>Amount *</label><input type="number" min="0" step="0.01" value={form.amount} onChange={update('amount')} required /></div>
            <div className="field"><label>Frequency</label>
              <select value={form.frequency} onChange={update('frequency')}>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="yearly">Yearly</option>
              </select>
            </div>
            <div className="field"><label>Next due date *</label><input type="date" value={form.next_due_date} onChange={update('next_due_date')} required /></div>
            <div className="field checkbox-field">
              <label><input type="checkbox" checked={form.is_active} onChange={update('is_active')} /> Active</label>
            </div>
          </div>
        </section>

        {error && <div className="error-text">{error}</div>}

        <div className="form-actions">
          <button type="button" className="btn btn-secondary" onClick={() => navigate('/recurring-expenses')}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={submitting}>{submitting ? 'Saving…' : isEdit ? 'Save changes' : 'Create template'}</button>
        </div>
      </form>
    </AppLayout>
  );
}
