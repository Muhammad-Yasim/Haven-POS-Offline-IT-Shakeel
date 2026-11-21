import {
  Navigate,
  useLocation,
} from 'react-router-dom';

import { useAuth } from '../context/AuthContext.jsx';
import Loader from './Loader.jsx';

export default function ProtectedRoute({
  children,
  module,
  action = 'view',
}) {
  const {
    profile,
    loading,
    profileError,
    isSetupRequired,
    refreshProfile,
    can,
  } = useAuth();

  const location = useLocation();

  /*
   * AuthContext is still resolving local session.
   * NEVER redirect while loading is true.
   */
  if (loading) {
    return <Loader fullScreen={true} text="Starting application..." />;
  }

  /*
   * If first-launch setup has not been completed, redirect to setup wizard.
   */
  if (isSetupRequired) {
    return <Navigate to="/setup" replace />;
  }

  /*
   * No active local session -> redirect to login.
   */
  if (!profile) {
    return (
      <Navigate
        to="/login"
        replace
        state={{
          from: location.pathname + location.search,
        }}
      />
    );
  }

  /*
   * If there's a fatal profile error.
   */
  if (profileError) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          gap: 16,
          padding: 24,
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: 40 }}>⚠️</div>
        <h2 style={{ margin: 0, fontSize: 20 }}>Unable to load your profile</h2>
        <p style={{ margin: 0, color: 'var(--text-secondary)', maxWidth: 420, fontSize: 14 }}>
          {profileError}
        </p>
        <button
          className="btn btn-primary"
          onClick={refreshProfile}
          style={{ minWidth: 120 }}
        >
          Retry
        </button>
      </div>
    );
  }

  /*
   * User account disabled.
   */
  if (profile.is_active === false) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          gap: 16,
          padding: 24,
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: 40 }}>🔒</div>
        <h2 style={{ margin: 0, fontSize: 20 }}>Account Disabled</h2>
        <p style={{ margin: 0, color: 'var(--text-secondary)', maxWidth: 420, fontSize: 14 }}>
          Your account has been deactivated.
        </p>
      </div>
    );
  }

  /*
   * Permission check.
   */
  if (module && !can(module, action)) {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
}
