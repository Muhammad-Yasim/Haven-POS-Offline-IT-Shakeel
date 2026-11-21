import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
} from 'react';

import { api } from '../lib/electronAPI.js';
import { clearInactivityTimestamp } from '../hooks/useInactivityLogout.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [profile, setProfile] = useState(null);
  const [business, setBusiness] = useState(null);
  const [permissions, setPermissions] = useState([]);
  const [userLocations, setUserLocations] = useState(null); // null = owner sees all locations
  const [loading, setLoading] = useState(true);
  const [profileError, setProfileError] = useState(null);
  const [isSetupRequired, setIsSetupRequired] = useState(false);

  const mountedRef = useRef(false);

  const clearUserData = useCallback(() => {
    setProfile(null);
    setBusiness(null);
    setPermissions([]);
    setUserLocations(null);
    setProfileError(null);
  }, []);

  /**
   * Loads current session from local SQLite database via Electron IPC
   */
  const loadSession = useCallback(async () => {
    try {
      if (!api?.auth) {
        throw new Error('Electron API not available');
      }

      // Check if setup is needed (no business row exists yet)
      const setupRes = await api.auth.isSetupRequired();
      if (setupRes?.data) {
        setIsSetupRequired(true);
        clearUserData();
        setLoading(false);
        return;
      }
      setIsSetupRequired(false);

      // Fetch active session
      const sessionRes = await api.auth.getSession();
      if (sessionRes?.error) {
        throw new Error(sessionRes.error);
      }

      const sessionData = sessionRes?.data;
      if (sessionData && sessionData.profile) {
        setProfile(sessionData.profile);
        setBusiness(sessionData.business);
        setPermissions(sessionData.permissions || []);
        setUserLocations(null); // Owner/Admin has unrestricted access to all locations
        setProfileError(null);
      } else {
        clearUserData();
      }
    } catch (err) {
      console.error('Failed to load session:', err);
      clearUserData();
      setProfileError(err?.message || 'Failed to initialize local session.');
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, [clearUserData]);

  useEffect(() => {
    mountedRef.current = true;
    loadSession();

    return () => {
      mountedRef.current = false;
    };
  }, [loadSession]);

  /**
   * Local Sign In
   */
  const signIn = useCallback(
    async (username, password) => {
      if (!api?.auth) throw new Error('Electron API not available');

      const res = await api.auth.signIn({ username, password });
      if (res?.error) {
        throw new Error(res.error);
      }

      const { profile: p, business: b, permissions: perms } = res.data;
      setProfile(p);
      setBusiness(b);
      setPermissions(perms || []);
      setUserLocations(null);
      setProfileError(null);
      setIsSetupRequired(false);

      if (p?.id) {
        clearInactivityTimestamp(p.id);
      }

      return res.data;
    },
    []
  );

  /**
   * Local Setup (First Launch)
   */
  const setup = useCallback(
    async ({ business: bData, admin: aData }) => {
      if (!api?.auth) throw new Error('Electron API not available');

      const res = await api.auth.setup({ business: bData, admin: aData });
      if (res?.error) {
        throw new Error(res.error);
      }

      const { profile: p, business: b, permissions: perms } = res.data;
      setProfile(p);
      setBusiness(b);
      setPermissions(perms || []);
      setUserLocations(null);
      setProfileError(null);
      setIsSetupRequired(false);

      if (p?.id) {
        clearInactivityTimestamp(p.id);
      }

      return res.data;
    },
    []
  );

  /**
   * Local Sign Out
   */
  const signOut = useCallback(async () => {
    const userId = profile?.id;
    if (api?.auth) {
      await api.auth.signOut();
    }
    clearUserData();
    if (userId) {
      clearInactivityTimestamp(userId);
    }
  }, [profile?.id, clearUserData]);

  /**
   * Refresh current profile
   */
  const refreshProfile = useCallback(async () => {
    setLoading(true);
    await loadSession();
  }, [loadSession]);

  /**
   * Permission helper
   * Admin/Owner always has full access to every module and action
   */
  const can = useCallback(
    (module, action = 'view') => {
      if (!profile) return false;
      if (profile.is_owner) return true;

      const perm = permissions.find((row) => row.module === module);
      if (!perm) return false;

      return !!perm[`can_${action}`];
    },
    [profile, permissions]
  );

  const value = {
    // Provide session object compatibility for hooks that check session?.user
    session: profile ? { user: profile } : null,
    user: profile,
    profile,
    business,
    permissions,
    userLocations, // null means unrestricted (sees all locations)
    loading,
    profileError,
    isSetupRequired,

    signIn,
    setup,
    signOut,
    refreshProfile,
    can,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
