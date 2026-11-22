import { useState, useEffect } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import './login.css';

export default function Login() {
  const { signIn, isSetupRequired, profile } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // If already logged in, redirect to dashboard
  useEffect(() => {
    if (profile) {
      navigate('/dashboard', { replace: true });
    } else if (isSetupRequired) {
      navigate('/setup', { replace: true });
    }
  }, [profile, isSetupRequired, navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (submitting) return;

    setError('');
    setSubmitting(true);

    try {
      await signIn(username.trim(), password);

      const fromPath = typeof location.state?.from === 'string' ? location.state.from : '';
      const isSafeLocalPath =
        fromPath.startsWith('/') && !fromPath.startsWith('//') && !fromPath.includes('\\');
      const redirectTo = isSafeLocalPath ? fromPath : '/dashboard';

      navigate(redirectTo, { replace: true });
    } catch (err) {
      setError(err?.message || 'Invalid username or password.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="auth-screen">
      <div className="auth-card card">
        {/* ---- LEFT: Branding Panel ---- */}
        <div className="auth-left">
          <div className="auth-blob-mid" aria-hidden="true" />

          <div className="auth-brand">
            <div className="auth-brand-icon" aria-hidden="true">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                <polyline points="9 22 9 12 15 12 15 22" />
              </svg>
            </div>

            <p className="auth-left-welcome">Haven POS</p>
            <h2 className="auth-brand-title">Welcome Back</h2>
            <p className="auth-brand-desc">
              Your offline desktop point of sale solution. Fast, secure, and always reliable.
            </p>
          </div>

          <div className="auth-features">
            <div className="auth-feature-item">
              <span className="auth-feature-dot" />
              100% Offline Desktop Mode
            </div>
            <div className="auth-feature-item">
              <span className="auth-feature-dot" />
              Fast &amp; Reliable Billing
            </div>
            <div className="auth-feature-item">
              <span className="auth-feature-dot" />
              Local Data Security &amp; Safety
            </div>
            <div className="auth-feature-item">
              <span className="auth-feature-dot" />
              Contact: 0334-4890651 | 0328-9395432
            </div>
          </div>
        </div>

        {/* ---- RIGHT: Form Panel ---- */}
        <div className="auth-right">
          <h1 className="auth-title">Sign in</h1>
          <p className="auth-subtitle muted">Enter your admin credentials</p>

          {location.state?.message && (
            <div
              className="badge badge-success"
              style={{
                padding: '10px 14px',
                marginBottom: 18,
                display: 'block',
              }}
            >
              {location.state.message}
            </div>
          )}

          <form onSubmit={handleSubmit} className="auth-form">
            {/* Username */}
            <div className="field">
              <label htmlFor="username">Username</label>
              <div className="input-icon-wrap">
                <svg
                  className="input-icon"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
                <input
                  id="username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Enter username"
                  required
                  autoFocus
                  autoComplete="username"
                />
              </div>
            </div>

            {/* Password */}
            <div className="field">
              <label htmlFor="password">Password</label>
              <div className="password-input-wrapper">
                <div className="input-icon-wrap">
                  <svg
                    className="input-icon"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter password"
                    required
                    autoComplete="current-password"
                  />
                </div>

                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? '🙈' : '👁️'}
                </button>
              </div>
            </div>

            {error && <div className="error-text">{error}</div>}

            <button
              type="submit"
              className="btn btn-primary auth-submit"
              disabled={submitting}
            >
              {submitting ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          {isSetupRequired && (
            <p className="auth-footer muted">
              First time setup required.{' '}
              <Link to="/setup" className="auth-link">
                Configure business now →
              </Link>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
