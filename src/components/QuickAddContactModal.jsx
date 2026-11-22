import React, { useState } from 'react';
import { api } from '../lib/electronAPI.js';

export default function QuickAddContactModal({
  isOpen,
  onClose,
  contactType = 'customer',
  onContactAdded,
  businessId,
}) {
  const [name, setName] = useState('');
  const [contactNumber, setContactNumber] = useState('');
  const [address, setAddress] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const isCustomer = contactType === 'customer';
  const title = isCustomer ? 'Add New Customer' : 'Add New Supplier';

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    const trimmedName = name.trim();
    const trimmedNumber = contactNumber.trim();

    if (!trimmedName) {
      setError('Name is required.');
      return;
    }
    if (!trimmedNumber) {
      setError('Mobile number is required.');
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        business_id: businessId,
        contact_type: contactType,
        name: trimmedName,
        contact_number: trimmedNumber,
        address: address.trim() || null,
        opening_balance: 0,
        is_active: true,
      };

      const res = await api.contacts.create(payload);
      if (res?.error) throw new Error(res.error);

      const created = {
        id: res?.data?.id,
        name: trimmedName,
        contact_number: trimmedNumber,
        address: address.trim() || '',
      };

      onContactAdded?.(created);
      onClose();
      setName('');
      setContactNumber('');
      setAddress('');
    } catch (err) {
      setError(err.message || `Failed to create ${isCustomer ? 'customer' : 'supplier'}.`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0, 0, 0, 0.5)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      onClick={() => !submitting && onClose()}
    >
      <div
        className="card"
        style={{
          width: '420px',
          maxWidth: '92%',
          background: '#fff',
          borderRadius: '8px',
          boxShadow: '0 8px 30px rgba(0,0,0,0.25)',
          padding: '20px 24px',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h2 style={{ fontSize: '18px', fontWeight: 'bold', margin: 0, color: 'var(--navy-900)' }}>
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            style={{
              background: 'none',
              border: 'none',
              fontSize: '20px',
              cursor: 'pointer',
              color: '#666',
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>

        {error && (
          <div
            style={{
              padding: '8px 12px',
              background: '#fef2f2',
              color: '#b91c1c',
              border: '1px solid #f87171',
              borderRadius: '4px',
              fontSize: '13px',
              marginBottom: '14px',
            }}
          >
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px', color: '#374151' }}>
              Name <span style={{ color: '#ef4444' }}>*</span>
            </label>
            <input
              type="text"
              autoFocus
              className="compact-input"
              style={{ width: '100%', boxSizing: 'border-box' }}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={isCustomer ? "Customer name" : "Supplier / Company name"}
              disabled={submitting}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px', color: '#374151' }}>
              Mobile Number <span style={{ color: '#ef4444' }}>*</span>
            </label>
            <input
              type="text"
              className="compact-input"
              style={{ width: '100%', boxSizing: 'border-box' }}
              value={contactNumber}
              onChange={(e) => setContactNumber(e.target.value)}
              placeholder="e.g. 0300-1234567"
              disabled={submitting}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px', color: '#374151' }}>
              Address
            </label>
            <input
              type="text"
              className="compact-input"
              style={{ width: '100%', boxSizing: 'border-box' }}
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Street / City address"
              disabled={submitting}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '8px' }}>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={onClose}
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary btn-sm"
              disabled={submitting}
            >
              {submitting ? 'Saving…' : isCustomer ? 'Save Customer' : 'Save Supplier'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

