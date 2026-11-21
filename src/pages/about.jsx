import { useEffect, useState } from 'react';
import SettingsLayout from '../components/SettingsLayout.jsx';
import { api } from '../lib/electronAPI.js';

export default function About() {
  const [deviceInfo, setDeviceInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        if (api?.system?.getDeviceInfo) {
          const res = await api.system.getDeviceInfo();
          if (res?.data) {
            setDeviceInfo(res.data);
          }
        }
      } catch (err) {
        console.error('Failed to load device info:', err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const handleCopyId = () => {
    if (!deviceInfo?.deviceId) return;
    navigator.clipboard.writeText(deviceInfo.deviceId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <SettingsLayout
      title="About & Device Information"
      subtitle="System hardware identity, licensing status, and software version."
    >
      <div className="settings-form" style={{ maxWidth: 800 }}>
        {/* Device Authentication & Hardware ID */}
        <section className="settings-card" style={{ borderLeft: '4px solid var(--navy-800)' }}>
          <div className="settings-card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2>Device Identity & Licensing</h2>
            {deviceInfo?.isAuthorized ? (
              <span className="badge badge-success" style={{ fontSize: 13, padding: '4px 10px' }}>
                ✓ Authorized Device
              </span>
            ) : (
              <span className="badge badge-danger" style={{ fontSize: 13, padding: '4px 10px' }}>
                ⚠ Unauthorized Device
              </span>
            )}
          </div>
          <div className="settings-card-body">
            <p className="muted" style={{ fontSize: 13, marginBottom: 16 }}>
              This unique Device ID is bound to this computer's hardware. The application checks this ID upon launch to ensure only authorized devices can run this software.
            </p>

            <div style={{
              background: 'var(--navy-100, #f0f4f9)',
              border: '1px solid var(--navy-border, #d2dbe8)',
              borderRadius: 8,
              padding: '16px 20px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 16,
              flexWrap: 'wrap',
            }}>
              <div style={{ flex: '1 1 300px' }}>
                <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-secondary, #6b7280)', fontWeight: 700, marginBottom: 4 }}>
                  System Device ID
                </div>
                <div style={{
                  fontFamily: 'Consolas, Monaco, monospace',
                  fontSize: 16,
                  fontWeight: 700,
                  color: 'var(--navy-900, #1D2545)',
                  wordBreak: 'break-all',
                }}>
                  {loading ? 'Detecting device...' : (deviceInfo?.deviceId || 'Unknown')}
                </div>
              </div>

              <button
                type="button"
                className={`btn ${copied ? 'btn-success' : 'btn-primary'}`}
                style={{ padding: '8px 16px', fontSize: 13, whiteSpace: 'nowrap' }}
                onClick={handleCopyId}
                disabled={loading || !deviceInfo?.deviceId}
              >
                {copied ? '✓ Copied to Clipboard!' : '📋 Copy Device ID'}
              </button>
            </div>

            {deviceInfo?.isDevBypass && (
              <p className="muted" style={{ fontSize: 12, marginTop: 12, color: '#b45309' }}>
                ℹ Running in development mode with developer bypass enabled.
              </p>
            )}
          </div>
        </section>

        {/* Software & System Specifications */}
        <section className="settings-card">
          <div className="settings-card-header">
            <h2>Application & Platform Info</h2>
          </div>
          <div className="settings-card-body">
            <div className="settings-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
              <div className="settings-field">
                <label>Software Name</label>
                <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>Haven POS (Offline)</div>
              </div>

              <div className="settings-field">
                <label>Version</label>
                <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>v{deviceInfo?.appVersion || '0.1.0'}</div>
              </div>

              <div className="settings-field">
                <label>Operating System</label>
                <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                  {deviceInfo?.platform || 'Windows'} ({deviceInfo?.arch || 'x64'})
                </div>
              </div>

              <div className="settings-field">
                <label>Computer Name</label>
                <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{deviceInfo?.hostname || 'Localhost'}</div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </SettingsLayout>
  );
}

