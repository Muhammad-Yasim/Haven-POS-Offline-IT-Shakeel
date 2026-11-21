import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/electronAPI.js';
import { useAuth } from '../context/AuthContext.jsx';

/**
 * useRegister — tracks the CURRENT USER's single open register.
 */
export default function useRegister() {
  const { business, profile } = useAuth();
  const [register, setRegister] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    if (!business?.id || !profile?.id) {
      setRegister(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');

    try {
      const res = await api.registers.getOpen({
        business_id: business.id,
        user_id: profile.id,
      });

      if (res?.error) {
        setError(res.error);
        setRegister(null);
      } else {
        setRegister(res?.data || null);
      }
    } catch (err) {
      setError(err.message || 'Failed to load register state.');
      setRegister(null);
    } finally {
      setLoading(false);
    }
  }, [business?.id, profile?.id]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const openRegister = useCallback(
    async (locationId, openingCash) => {
      if (!business?.id || !locationId || !profile?.id) {
        throw new Error('Missing business, location, or user — cannot open a register.');
      }

      const res = await api.registers.open({
        business_id: business.id,
        location_id: locationId,
        user_id: profile.id,
        opening_cash: Number(openingCash) || 0,
      });

      if (res?.error) {
        await refresh();
        throw new Error(res.error);
      }

      setRegister(res.data);
      return res.data;
    },
    [business?.id, profile?.id, refresh]
  );

  const closeRegister = useCallback(
    async (closingCash) => {
      if (!register?.id) throw new Error('No open register to close.');

      const res = await api.registers.close({
        id: register.id,
        closing_cash: Number(closingCash) || 0,
      });

      if (res?.error) throw new Error(res.error);

      setRegister(null);
      return res.data;
    },
    [register?.id]
  );

  return { register, loading, error, refresh, openRegister, closeRegister };
}
