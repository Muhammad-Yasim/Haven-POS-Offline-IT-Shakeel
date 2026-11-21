import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import AppLayout from '../components/AppLayout.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../lib/electronAPI.js';
import useLocationScope from '../hooks/useLocationScope.js';
import './userForm.css';

const emptyForm = {
  contact_type: 'customer',
  name: '',
  contact_number: '',
  alternate_number: '',
  email: '',
  landline: '',
  opening_balance: '0',
  address: '',
  city: '',
  country: '',
  tax_ntn_number: '',
  is_active: true,
  business_name: '',
  location_id: '',
};

export default function ContactForm() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const isEdit = !!id;
  const navigate = useNavigate();
  const { business, profile } = useAuth();
  const { isOwner, isScopedToLocation, scopedLocationIds } = useLocationScope();

  const [locations, setLocations] = useState([]);
  const [form, setForm] = useState({
    ...emptyForm,
    contact_type: searchParams.get('type') || 'customer',
  });

  const [loading, setLoading] = useState(isEdit);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function init() {
      const locRes = await api.locations.getAll();
      if (cancelled) return;

      let locs = (locRes?.data || []).filter((l) => l.is_active);
      if (isScopedToLocation) {
        locs = locs.filter((l) => scopedLocationIds.includes(l.id));
      }
      setLocations(locs);
      if (locs.length > 0 && !isEdit) {
        setForm((f) => ({
          ...f,
          location_id: f.location_id || String(locs[0].id),
        }));
      }

      if (!isEdit) {
        setLoading(false);
        return;
      }

      const contactRes = await api.contacts.getById(id);
      if (cancelled) return;

      if (contactRes?.error) {
        setError(contactRes.error);
      } else if (contactRes?.data) {
        const data = contactRes.data;
        setForm({
          ...emptyForm,
          ...data,
          name: data.name || '',
          contact_number: data.contact_number || '',
          alternate_number: data.alternate_number || '',
          email: data.email || '',
          landline: data.landline || '',
          city: data.city || '',
          country: data.country || '',
          opening_balance: String(data.opening_balance ?? 0),
          address: data.address || '',
          tax_ntn_number: data.tax_ntn_number || '',
          business_name: data.business_name || '',
          location_id: data.location_id ? String(data.location_id) : '',
        });
      }
      setLoading(false);
    }

    init();

    return () => {
      cancelled = true;
    };
  }, [isEdit, id]);

  const update = (key) => (e) => {
    const value =
      e.target.type === 'checkbox'
        ? e.target.checked
        : e.target.value;

    setForm((current) => ({
      ...current,
      [key]: value,
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    const trimmedName = form.name.trim();
    const trimmedNumber = form.contact_number.trim();

    if (!trimmedName || !trimmedNumber) {
      setError('Name and contact number are required.');
      return;
    }

    setSubmitting(true);

    try {
      const targetLocationId = form.location_id
        ? Number(form.location_id)
        : isScopedToLocation && scopedLocationIds[0]
        ? scopedLocationIds[0]
        : null;

      const payload = {
        contact_type: form.contact_type,
        name: trimmedName,
        contact_number: trimmedNumber,
        alternate_number: form.alternate_number.trim() || null,
        email: form.email.trim() || null,
        landline: form.landline.trim() || null,
        opening_balance: Number(form.opening_balance || 0),
        address: form.address.trim() || null,
        city: form.city.trim() || null,
        country: form.country.trim() || null,
        location_id: targetLocationId,
        tax_ntn_number:
          form.contact_type === 'supplier'
            ? form.tax_ntn_number.trim() || null
            : null,
        is_active: form.is_active,
        business_name: form.business_name.trim() || null,
      };

      if (isEdit) {
        const res = await api.contacts.update({ id, ...payload });
        if (res?.error) throw new Error(res.error);
      } else {
        const res = await api.contacts.create(payload);
        if (res?.error) throw new Error(res.error);
      }

      navigate('/contacts');
    } catch (err) {
      setError(err?.message || 'Could not save this contact.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <AppLayout>
        <div className="muted" style={{ padding: 20 }}>
          Loading contact details…
        </div>
      </AppLayout>
    );
  }

  const isSupplier = form.contact_type === 'supplier';

  return (
    <AppLayout>
      <div className="compact-page-header">
        <div>
          <h1>
            {isEdit
              ? `Edit ${isSupplier ? 'Supplier' : 'Customer'}`
              : `Add New ${isSupplier ? 'Supplier' : 'Customer'}`}
            <span
              className={`badge ${isSupplier ? 'badge-warning' : 'badge-info'}`}
              style={{ fontSize: 11, padding: '2px 8px', textTransform: 'capitalize' }}
            >
              {form.contact_type}
            </span>
          </h1>
          <p>
            Contacts are shared across sales, purchases, payments, and account ledgers.
          </p>
        </div>

        <div className="compact-header-actions">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => navigate('/contacts')}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={submitting}
            onClick={handleSubmit}
          >
            {submitting
              ? 'Saving…'
              : isEdit
              ? 'Save Changes'
              : `Create ${isSupplier ? 'Supplier' : 'Customer'}`}
          </button>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="form-shell">
        <div className="form-layout-2col">
          {/* LEFT COLUMN: Primary & Business Details + Address */}
          <div>
            {/* BASIC & BUSINESS DETAILS */}
            <div className="form-section-compact">
              <div className="form-section-header">
                <span className="form-section-title">Primary & Business Details</span>
                <span className="form-section-subtitle">* Required</span>
              </div>

              <div className="form-grid-4">
                <div className="compact-field">
                  <label className="compact-label">Contact Type</label>
                  <select
                    className="compact-select"
                    value={form.contact_type}
                    onChange={update('contact_type')}
                    disabled={isEdit}
                  >
                    <option value="customer">Customer</option>
                    <option value="supplier">Supplier</option>
                  </select>
                </div>

                {/* Assigned Location field hidden — not needed for simple add form */}
                {/* {locations.length > 0 && (
                  <div className="compact-field">
                    <label className="compact-label">Assigned Location</label>
                    <select
                      className="compact-select"
                      value={form.location_id}
                      onChange={update('location_id')}
                      disabled={isScopedToLocation}
                    >
                      {isOwner && <option value="">Global / All Locations</option>}
                      {locations.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )} */}

                <div className="compact-field">
                  <label className="compact-label">
                    Contact Name <span className="req">*</span>
                  </label>
                  <input
                    className="compact-input"
                    value={form.name}
                    onChange={update('name')}
                    placeholder={isSupplier ? 'Company / Rep name' : 'Customer full name'}
                    required
                  />
                </div>

                <div className="compact-field">
                  <label className="compact-label">
                    Mobile Number <span className="req">*</span>
                  </label>
                  <input
                    className="compact-input"
                    value={form.contact_number}
                    onChange={update('contact_number')}
                    placeholder="e.g. 03001234567"
                    required
                  />
                </div>

                {/* Business / Company Name — hidden for simple form */}
                {/* <div className="compact-field col-span-2">
                  <label className="compact-label">Business / Company Name</label>
                  <input
                    className="compact-input"
                    value={form.business_name}
                    onChange={update('business_name')}
                    placeholder="Trade or business title"
                  />
                </div> */}

                {/* Alternate Number — hidden for simple form */}
                {/* <div className="compact-field">
                  <label className="compact-label">Alternate Number</label>
                  <input
                    className="compact-input"
                    value={form.alternate_number}
                    onChange={update('alternate_number')}
                    placeholder="Secondary phone"
                  />
                </div> */}

                {/* Landline Phone — hidden for simple form */}
                {/* <div className="compact-field">
                  <label className="compact-label">Landline Phone</label>
                  <input
                    className="compact-input"
                    value={form.landline}
                    onChange={update('landline')}
                    placeholder="Office or landline #"
                  />
                </div> */}

                {/* Email Address — hidden for simple form */}
                {/* <div className="compact-field col-span-4">
                  <label className="compact-label">Email Address</label>
                  <input
                    type="email"
                    className="compact-input"
                    value={form.email}
                    onChange={update('email')}
                    placeholder="contact@email.com"
                  />
                </div> */}
              </div>
            </div>

            {/* LOCATION & ADDRESS — section header + City/Country hidden; street address kept */}
            <div className="form-section-compact">
              {/* <div className="form-section-header">
                <span className="form-section-title">Address & Region</span>
              </div> */}

              <div className="form-grid-4">
                {/* City — hidden for simple form */}
                {/* <div className="compact-field">
                  <label className="compact-label">City</label>
                  <input
                    className="compact-input"
                    value={form.city}
                    onChange={update('city')}
                    placeholder="City name"
                  />
                </div> */}

                {/* Country — hidden for simple form */}
                {/* <div className="compact-field">
                  <label className="compact-label">Country</label>
                  <input
                    className="compact-input"
                    value={form.country}
                    onChange={update('country')}
                    placeholder="Country"
                  />
                </div> */}

                <div className="compact-field col-span-2">
                  <label className="compact-label">Complete Street Address</label>
                  <input
                    className="compact-input"
                    value={form.address}
                    onChange={update('address')}
                    placeholder="Street address, shop #, area"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* RIGHT COLUMN: Hidden for simple form (only Name, Contact Number, Address needed) */}
          {/* <div>
            <div className="form-section-compact">
              <div className="form-section-header">
                <span className="form-section-title">Financial & Account Status</span>
              </div>

              <div className="form-grid-2">
                <div className="compact-field">
                  <label className="compact-label">
                    Opening Balance ({business?.currency || 'PKR'})
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    className="compact-input num-align"
                    value={form.opening_balance}
                    onChange={update('opening_balance')}
                    placeholder="0.00"
                  />
                </div>
              </div>
            </div>
          </div> */}
        </div>

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

        {/* BOTTOM ACTION BAR */}
        <div className="compact-summary-bar">
          <div className="compact-stat-group">
            <div className="compact-stat-item">
              <span className="stat-label">Type:</span>
              <span className="stat-val" style={{ textTransform: 'capitalize' }}>
                {form.contact_type}
              </span>
            </div>
            {/* <div className="compact-stat-item">
              <span className="stat-label">Opening Balance:</span>
              <span className="stat-val">
                {business?.currency} {Number(form.opening_balance || 0).toFixed(2)}
              </span>
            </div> */}
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => navigate('/contacts')}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary btn-sm"
              disabled={submitting}
            >
              {submitting
                ? 'Saving…'
                : isEdit
                ? 'Save Changes'
                : `Create ${isSupplier ? 'Supplier' : 'Customer'}`}
            </button>
          </div>
        </div>
      </form>
    </AppLayout>
  );
}
