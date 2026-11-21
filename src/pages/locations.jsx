import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import SettingsLayout from '../components/SettingsLayout.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../lib/electronAPI.js';

export default function Locations() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.locations.getAll();
      setRows(res?.data || []);
    } catch (err) {
      setError(err.message || 'Failed to load locations.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const toggleActive = async (row) => {
    setError('');
    if (row.is_active) {
      if (!window.confirm('This location may have stock history. Deactivating hides it from new sales/purchases but keeps past records. Continue?')) {
        return;
      }
    }
    try {
      await api.locations.toggleActive(row.id);
      load();
    } catch (err) {
      setError(err.message || 'Could not update location.');
    }
  };

  return (
    <SettingsLayout title="Business Locations" subtitle="Manage places where you stock and sell products.">
      
      {error && <div className="error-text" style={{ marginBottom: 12 }}>{error}</div>}

      <div className="settings-card">
        <div className="settings-card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2>All Locations</h2>
          {profile?.is_owner && <button className="btn btn-primary btn-sm" onClick={() => navigate('/settings/locations/new')}>+ Add location</button>}
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="data-table">
            <thead><tr><th>Name</th><th>Address</th><th>City</th><th>Country</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {loading && <tr><td colSpan={6} className="muted table-empty">Loading…</td></tr>}
              {!loading && rows.length === 0 && <tr><td colSpan={6} className="muted table-empty">No locations yet.</td></tr>}
              {!loading && rows.map((l) => (
                <tr key={l.id}>
                  <td>{l.name}</td>
                  <td>{l.address || '—'}</td>
                  <td>{l.city || '—'}</td>
                  <td>{l.country || '—'}</td>
                  <td>{l.is_active ? <span className="badge badge-success">Active</span> : <span className="badge badge-danger">Inactive</span>}</td>
                  <td className="table-actions">
                    {profile?.is_owner && <button className="btn btn-ghost btn-sm" onClick={() => navigate(`/settings/locations/${l.id}`)}>Edit</button>}
                    {profile?.is_owner && <button className="btn btn-ghost btn-sm" onClick={() => toggleActive(l)}>{l.is_active ? 'Deactivate' : 'Activate'}</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </SettingsLayout>
  );
}
