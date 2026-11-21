import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../lib/electronAPI.js';
import AppLayout from '../components/AppLayout.jsx';
import RegisterReport from './registerReport.jsx';
import { OpenRegisterModal } from '../components/pos/RegisterModals.jsx';
import useRegister from '../hooks/useRegister.js';

/**
 * ActiveRegister — "my register, right now".
 *
 * Delegates entirely to useRegister() for the open/closed state (the same
 * hook posBilling.jsx uses), so there's exactly one place that decides
 * whether the current user has an open register — no duplicated queries
 * that can drift out of sync with each other.
 */
export default function ActiveRegister() {
  const { business, profile } = useAuth();
  const { register, loading, openRegister, refresh } = useRegister();

  const [showOpenModal, setShowOpenModal] = useState(false);
  const [locations, setLocations] = useState([]);
  const [selectedLocation, setSelectedLocation] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const prefLocationKey =
    business?.id && profile?.id
      ? `havenpos_pref_loc_${business.id}_${profile.id}`
      : null;

  useEffect(() => {
    if (!business?.id) return;

    api.locations.getAll().then(({ data }) => {
      const locs = (data || []).filter((l) => l.is_active !== 0 && l.is_active !== false);
      setLocations(locs);
      if (locs.length > 0) {
        const saved = prefLocationKey ? localStorage.getItem(prefLocationKey) : null;
        const match = locs.find((l) => String(l.id) === String(saved));
        const chosen = match ? String(match.id) : String(locs[0].id);
        setSelectedLocation(chosen);
      }
    });
  }, [business?.id, prefLocationKey]);

  const handleLocationChange = (locId) => {
    setSelectedLocation(String(locId));
    if (prefLocationKey && locId) {
      localStorage.setItem(prefLocationKey, String(locId));
    }
  };

  const handleOpenRegister = async (cash, chosenLocId) => {
    setSubmitting(true);
    setError('');
    const targetLoc = chosenLocId || selectedLocation;
    try {
      await openRegister(targetLoc, cash);
      if (prefLocationKey && targetLoc) {
        localStorage.setItem(prefLocationKey, String(targetLoc));
      }
      setShowOpenModal(false);
    } catch (err) {
      setError(err.message || 'Could not open register.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <AppLayout>
        <div className="muted" style={{ padding: '20px' }}>Loading active register…</div>
      </AppLayout>
    );
  }

  if (register) {
    return (
      <AppLayout>
        <RegisterReport
          registerId={register.id}
          hideLayout
          isSidebarView
          onRegisterClosed={refresh}
        />
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="page-header">
        <div>
          <h1>Active Register</h1>
          <p className="muted">You don't have an open register right now.</p>
        </div>
      </div>

      <div className="card" style={{ padding: '40px 20px', textAlign: 'center', maxWidth: 500, margin: '40px auto' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>📠</div>
        <h2 style={{ marginBottom: 12 }}>No open register</h2>
        <p className="muted" style={{ marginBottom: 24 }}>
          A register must be open before you can process sales and track cash.
          Registers belong to you personally — no one else's open register
          counts here.
        </p>

        {locations.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: 'block', marginBottom: 8, fontWeight: 600 }}>Location</label>
            <select
              value={selectedLocation}
              onChange={(e) => handleLocationChange(e.target.value)}
              style={{ maxWidth: 220, margin: '0 auto', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--navy-border)' }}
            >
              {locations.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          </div>
        )}

        {error && <div className="error-text" style={{ marginBottom: 16 }}>{error}</div>}

        <button
          className="btn btn-primary"
          onClick={() => setShowOpenModal(true)}
          disabled={!selectedLocation}
        >
          Open register
        </button>
      </div>

      {showOpenModal && (
        <OpenRegisterModal
          locationName={locations.find((l) => String(l.id) === String(selectedLocation))?.name || 'Selected Location'}
          locations={locations}
          selectedLocationId={selectedLocation}
          onLocationChange={handleLocationChange}
          submitting={submitting}
          onConfirm={handleOpenRegister}
          onCancel={() => setShowOpenModal(false)}
        />
      )}
    </AppLayout>
  );
}
