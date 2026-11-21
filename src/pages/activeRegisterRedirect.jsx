import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../lib/electronAPI.js';
import AppLayout from '../components/AppLayout.jsx';

export default function ActiveRegisterRedirect() {
  const { business } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!business?.id) return;

    api.registers
      .getOpen({ business_id: business.id })
      .then(({ data, error }) => {
        if (!error && data?.id) {
          navigate(`/registers/${data.id}`, { replace: true });
        } else {
          // If no register is currently open, fallback to the list
          navigate('/registers', { replace: true });
        }
      });
  }, [business?.id, navigate]);

  return (
    <AppLayout>
      <div className="muted" style={{ padding: '20px' }}>
        Finding active register…
      </div>
    </AppLayout>
  );
}
