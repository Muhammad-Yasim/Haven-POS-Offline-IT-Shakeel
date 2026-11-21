import { useEffect, useState } from 'react';
import SettingsLayout from '../components/SettingsLayout.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../lib/electronAPI.js';
import Pagination from '../components/Pagination.jsx';
import usePagination from '../hooks/usePagination.js';
import EmptyState from '../components/EmptyState.jsx';
import ConfirmDialog from '../components/ConfirmDialog.jsx';
import TableActions from '../components/TableActions.jsx';

export default function Categories() {
  const { business } = useAuth();
  const [rows, setRows] = useState([]);
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [confirmState, setConfirmState] = useState(null);

  const load = async () => {
    setLoading(true);
    const res = await api.categories.getAll();
    if (res?.error) setError(res.error);
    else setRows(res?.data || []);
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [business?.id]);

  const add = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setError('');
    const res = await api.categories.create({ name: name.trim() });
    if (res?.error) setError(res.error);
    else { setName(''); load(); }
  };

  const remove = async (id) => {
    const res = await api.categories.delete(id);
    if (res?.error) setError(res.error);
    else load();
  };

  const { currentPage, totalPages, totalItems, paginatedItems, firstItemIndex, lastItemIndex, goToPage, nextPage, previousPage, hasNextPage, hasPreviousPage } = usePagination(rows, 20);

  return (
    <SettingsLayout title="Product Categories" subtitle="Organize your product catalog into groups.">
      <div className="settings-card">
        <div className="settings-card-header">
          <form onSubmit={add} style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
            <input 
              className="settings-input" 
              placeholder="New category name" 
              value={name} 
              onChange={(e) => setName(e.target.value)} 
              style={{ maxWidth: '300px' }}
            />
            <button className="btn btn-primary" type="submit" style={{ whiteSpace: 'nowrap' }}>Add Category</button>
          </form>
          {error && <div className="error-text" style={{ marginTop: '12px' }}>{error}</div>}
        </div>
        
        <div style={{ overflowX: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th style={{ width: '100px' }}></th>
              </tr>
            </thead>
            <tbody>
              {loading && <EmptyState colSpan={2} message="Loading…" />}
              {!loading && rows.length === 0 && (
                <EmptyState colSpan={2} message="No categories yet. Add your first one above." />
              )}
              {!loading && paginatedItems.map((r) => (
                <tr key={r.id}>
                  <td>{r.name}</td>
                  <td>
                    <TableActions
                      actions={[
                        {
                          label: 'Delete',
                          danger: true,
                          onClick: () => setConfirmState({
                            title: 'Delete category?',
                            message: `"${r.name}" will be permanently deleted. Products using it will lose their category.`,
                            confirmText: 'Delete',
                            danger: true,
                            onConfirm: () => remove(r.id),
                          }),
                        },
                      ]}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {!loading && rows.length > 0 && (
          <div style={{ padding: '16px 20px', borderTop: '1px solid var(--border-light)' }}>
            <Pagination
              currentPage={currentPage} totalPages={totalPages} totalItems={totalItems}
              firstItemIndex={firstItemIndex} lastItemIndex={lastItemIndex}
              goToPage={goToPage} nextPage={nextPage} previousPage={previousPage}
              hasNextPage={hasNextPage} hasPreviousPage={hasPreviousPage}
            />
          </div>
        )}
      </div>

      {confirmState && (
        <ConfirmDialog
          {...confirmState}
          onClose={() => setConfirmState(null)}
        />
      )}
    </SettingsLayout>
  );
}
