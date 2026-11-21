import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import './signup.css';

const TIME_ZONES = Intl.supportedValuesOf ? Intl.supportedValuesOf('timeZone') : ['UTC'];

const initialForm = {
  // Business Details
  business_name: '',
  currency: 'PKR',
  contact_number: '',
  alternate_contact: '',
  country: 'Pakistan',
  state: '',
  city: '',
  zip_code: '',
  landmark: '',
  website_link: '',
  time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Karachi',
  business_start_date: new Date().toISOString().slice(0, 10),

  // Admin Account Details
  first_name: '',
  last_name: '',
  username: '',
  mobile_number: '',
  password: '',
  confirm_password: '',
};

export default function Setup() {
  const { setup } = useAuth();
  const navigate = useNavigate();

  const [step, setStep] = useState(1);
  const [form, setForm] = useState(initialForm);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const update = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const validateStep1 = () => {
    if (
      !form.business_name.trim() ||
      !form.currency.trim() ||
      !form.contact_number.trim() ||
      !form.country.trim() ||
      !form.city.trim() ||
      !form.time_zone.trim()
    ) {
      setError('Please fill in all required business fields (*).');
      return false;
    }
    setError('');
    return true;
  };

  const validateStep2 = () => {
    if (!form.first_name.trim() || !form.username.trim() || !form.password) {
      setError('Please fill in all required admin fields (*).');
      return false;
    }
    if (form.password.length < 6) {
      setError('Password must be at least 6 characters.');
      return false;
    }
    if (form.password !== form.confirm_password) {
      setError('Passwords do not match.');
      return false;
    }
    setError('');
    return true;
  };

  const goNext = () => {
    if (validateStep1()) {
      setStep(2);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validateStep2()) return;

    setSubmitting(true);
    setError('');

    try {
      await setup({
        business: {
          business_name: form.business_name.trim(),
          currency: form.currency.trim(),
          contact_number: form.contact_number.trim(),
          alternate_contact: form.alternate_contact.trim() || null,
          country: form.country.trim(),
          state: form.state.trim() || null,
          city: form.city.trim(),
          zip_code: form.zip_code.trim() || null,
          landmark: form.landmark.trim() || null,
          website_link: form.website_link.trim() || null,
          time_zone: form.time_zone.trim(),
          business_start_date: form.business_start_date || null,
        },
        admin: {
          first_name: form.first_name.trim(),
          last_name: form.last_name.trim() || null,
          username: form.username.trim(),
          mobile_number: form.mobile_number.trim() || null,
          password: form.password,
        },
      });

      navigate('/dashboard', { replace: true });
    } catch (err) {
      setError(err?.message || 'Failed to complete setup. Please check your inputs.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="auth-screen">
      <div className="auth-card card signup-card">
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
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <line x1="19" y1="8" x2="19" y2="14" />
                <line x1="22" y1="11" x2="16" y2="11" />
              </svg>
            </div>

            <p className="auth-left-welcome">Haven POS</p>
            <h2 className="auth-brand-title">Initial Setup</h2>
            <p className="auth-brand-desc">
              Configure your business and admin credentials. This is a one-time offline setup.
            </p>

            <div className="auth-features signup-features-inline">
              <div className="auth-feature-item">
                <span className="auth-feature-dot" />
                Single Business &amp; Location
              </div>
              <div className="auth-feature-item">
                <span className="auth-feature-dot" />
                Secure Local SQLite Storage
              </div>
              <div className="auth-feature-item">
                <span className="auth-feature-dot" />
                No Internet Required
              </div>
            </div>
          </div>
        </div>

        {/* ---- RIGHT: Form Panel ---- */}
        <div className="auth-right">
          <h1 className="auth-title">Setup Haven POS</h1>
          <p className="auth-subtitle muted">
            {step === 1 ? 'Step 1: Enter your business details' : 'Step 2: Create your admin account'}
          </p>

          {/* Step indicator pills */}
          <div className="signup-steps">
            <div
              className={`signup-step ${step === 1 ? 'signup-step-active' : ''}`}
              onClick={() => setStep(1)}
            >
              <span className="signup-step-num">1</span>
              Business Details
            </div>
            <div
              className={`signup-step ${step === 2 ? 'signup-step-active' : ''}`}
              onClick={() => {
                if (validateStep1()) setStep(2);
              }}
            >
              <span className="signup-step-num">2</span>
              Admin Account
            </div>
          </div>

          <form onSubmit={handleSubmit} className="auth-form">
            {step === 1 && (
              <>
                <div className="form-grid">
                  {/* Business Name */}
                  <div className="field">
                    <label htmlFor="business_name">Business name *</label>
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
                        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                        <polyline points="9 22 9 12 15 12 15 22" />
                      </svg>
                      <input
                        id="business_name"
                        value={form.business_name}
                        onChange={update('business_name')}
                        placeholder="My Store / Business"
                        required
                        autoFocus
                      />
                    </div>
                  </div>

                  {/* Currency */}
                  <div className="field">
                    <label htmlFor="currency">Currency *</label>
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
                        <circle cx="12" cy="12" r="10" />
                        <path d="M12 6v12M15 9.5H10.5a2.5 2.5 0 0 0 0 5H14a2.5 2.5 0 0 1 0 5H9" />
                      </svg>
                      <input
                        id="currency"
                        value={form.currency}
                        onChange={update('currency')}
                        placeholder="PKR, USD, EUR..."
                        required
                      />
                    </div>
                  </div>

                  {/* Contact Number */}
                  <div className="field">
                    <label htmlFor="contact_number">Contact number *</label>
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
                        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                      </svg>
                      <input
                        id="contact_number"
                        value={form.contact_number}
                        onChange={update('contact_number')}
                        placeholder="+92 300 1234567"
                        required
                      />
                    </div>
                  </div>

                  {/* Alternate Contact */}
                  <div className="field">
                    <label htmlFor="alternate_contact">Alternate contact</label>
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
                        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                      </svg>
                      <input
                        id="alternate_contact"
                        value={form.alternate_contact}
                        onChange={update('alternate_contact')}
                        placeholder="Secondary number"
                      />
                    </div>
                  </div>

                  {/* Country */}
                  <div className="field">
                    <label htmlFor="country">Country *</label>
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
                        <circle cx="12" cy="12" r="10" />
                        <line x1="2" y1="12" x2="22" y2="12" />
                        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                      </svg>
                      <input
                        id="country"
                        value={form.country}
                        onChange={update('country')}
                        placeholder="Pakistan"
                        required
                      />
                    </div>
                  </div>

                  {/* State */}
                  <div className="field">
                    <label htmlFor="state">State / Province</label>
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
                        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                        <circle cx="12" cy="10" r="3" />
                      </svg>
                      <input
                        id="state"
                        value={form.state}
                        onChange={update('state')}
                        placeholder="Punjab"
                      />
                    </div>
                  </div>

                  {/* City */}
                  <div className="field">
                    <label htmlFor="city">City *</label>
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
                        <rect x="4" y="2" width="16" height="20" rx="2" ry="2" />
                        <path d="M9 22v-4h6v4M8 6h.01M16 6h.01M8 10h.01M16 10h.01M8 14h.01M16 14h.01" />
                      </svg>
                      <input
                        id="city"
                        value={form.city}
                        onChange={update('city')}
                        placeholder="Lahore"
                        required
                      />
                    </div>
                  </div>

                  {/* ZIP Code */}
                  <div className="field">
                    <label htmlFor="zip_code">ZIP code</label>
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
                        <rect x="2" y="4" width="20" height="16" rx="2" />
                        <path d="M22 7l-10 7L2 7" />
                      </svg>
                      <input
                        id="zip_code"
                        value={form.zip_code}
                        onChange={update('zip_code')}
                        placeholder="54000"
                      />
                    </div>
                  </div>

                  {/* Landmark */}
                  <div className="field">
                    <label htmlFor="landmark">Landmark</label>
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
                        <path d="M12 22s-8-4.5-8-11.8A8 8 0 0 1 12 2a8 8 0 0 1 8 8.2c0 7.3-8 11.8-8 11.8z" />
                        <circle cx="12" cy="10" r="3" />
                      </svg>
                      <input
                        id="landmark"
                        value={form.landmark}
                        onChange={update('landmark')}
                        placeholder="Near Main Plaza"
                      />
                    </div>
                  </div>

                  {/* Website */}
                  <div className="field">
                    <label htmlFor="website_link">Website</label>
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
                        <circle cx="12" cy="12" r="10" />
                        <line x1="2" y1="12" x2="22" y2="12" />
                        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                      </svg>
                      <input
                        id="website_link"
                        value={form.website_link}
                        onChange={update('website_link')}
                        placeholder="https://example.com"
                      />
                    </div>
                  </div>

                  {/* Time Zone */}
                  <div className="field">
                    <label htmlFor="time_zone">Time zone *</label>
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
                        <circle cx="12" cy="12" r="10" />
                        <polyline points="12 6 12 12 16 14" />
                      </svg>
                      <select
                        id="time_zone"
                        value={form.time_zone}
                        onChange={update('time_zone')}
                        className="select-input"
                        required
                      >
                        {TIME_ZONES.map((tz) => (
                          <option key={tz} value={tz}>
                            {tz}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Business Start Date */}
                  <div className="field">
                    <label htmlFor="business_start_date">Business start date</label>
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
                        <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                        <line x1="16" y1="2" x2="16" y2="6" />
                        <line x1="8" y1="2" x2="8" y2="6" />
                        <line x1="3" y1="10" x2="21" y2="10" />
                      </svg>
                      <input
                        id="business_start_date"
                        type="date"
                        value={form.business_start_date}
                        onChange={update('business_start_date')}
                      />
                    </div>
                  </div>
                </div>

                {error && <div className="error-text">{error}</div>}

                <button type="button" className="btn btn-primary auth-submit" onClick={goNext}>
                  Continue to Admin Setup →
                </button>
              </>
            )}

            {step === 2 && (
              <>
                <div className="form-grid">
                  {/* First Name */}
                  <div className="field">
                    <label htmlFor="first_name">First name *</label>
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
                        id="first_name"
                        value={form.first_name}
                        onChange={update('first_name')}
                        placeholder="Admin First name"
                        required
                        autoFocus
                      />
                    </div>
                  </div>

                  {/* Last Name */}
                  <div className="field">
                    <label htmlFor="last_name">Last name</label>
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
                        id="last_name"
                        value={form.last_name}
                        onChange={update('last_name')}
                        placeholder="Last name"
                      />
                    </div>
                  </div>

                  {/* Username */}
                  <div className="field">
                    <label htmlFor="username">Username *</label>
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
                        <circle cx="12" cy="12" r="4" />
                        <path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.92 7.94" />
                      </svg>
                      <input
                        id="username"
                        value={form.username}
                        onChange={update('username')}
                        placeholder="admin"
                        required
                      />
                    </div>
                  </div>

                  {/* Mobile Number */}
                  <div className="field">
                    <label htmlFor="mobile_number">Mobile number</label>
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
                        <rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
                        <line x1="12" y1="18" x2="12.01" y2="18" />
                      </svg>
                      <input
                        id="mobile_number"
                        value={form.mobile_number}
                        onChange={update('mobile_number')}
                        placeholder="+92 300 1234567"
                      />
                    </div>
                  </div>

                  {/* Password */}
                  <div className="field">
                    <label htmlFor="password">Password *</label>
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
                          value={form.password}
                          onChange={update('password')}
                          placeholder="At least 6 chars"
                          required
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

                  {/* Confirm Password */}
                  <div className="field">
                    <label htmlFor="confirm_password">Confirm password *</label>
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
                          id="confirm_password"
                          type={showConfirmPassword ? 'text' : 'password'}
                          value={form.confirm_password}
                          onChange={update('confirm_password')}
                          placeholder="Confirm password"
                          required
                        />
                      </div>
                      <button
                        type="button"
                        className="password-toggle"
                        onClick={() => setShowConfirmPassword((prev) => !prev)}
                        aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                      >
                        {showConfirmPassword ? '🙈' : '👁️'}
                      </button>
                    </div>
                  </div>
                </div>

                {error && <div className="error-text">{error}</div>}

                <div className="signup-actions">
                  <button
                    type="button"
                    className="btn btn-secondary signup-back-btn"
                    onClick={() => setStep(1)}
                  >
                    ← Back
                  </button>
                  <button
                    type="submit"
                    className="btn btn-primary auth-submit signup-submit-btn"
                    disabled={submitting}
                  >
                    {submitting ? 'Setting up POS…' : 'Complete Setup & Launch POS'}
                  </button>
                </div>
              </>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}
