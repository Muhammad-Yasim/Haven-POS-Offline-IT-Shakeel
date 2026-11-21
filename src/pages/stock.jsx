import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AppLayout from '../components/AppLayout.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../lib/electronAPI.js';
import Pagination from '../components/Pagination.jsx';
import usePagination from '../hooks/usePagination.js';
import useDataSort from '../hooks/useDataSort.js';
import useLocationScope from '../hooks/useLocationScope.js';
import DataSearchBar from '../components/DataSearchBar.jsx';
import SortableHeader from '../components/SortableHeader.jsx';
import EmptyState from '../components/EmptyState.jsx';
import TableActions from '../components/TableActions.jsx';

export default function Stock() {
  const { business, profile, can } = useAuth();
  const { isOwner, isScopedToLocation, scopedLocationIds } = useLocationScope();
  const navigate = useNavigate();
  const [stockItems, setStockItems] = useState([]);
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [locationFilter, setLocationFilter] = useState('');
  const [editingKey, setEditingKey] = useState(null);
  const [adjustValue, setAdjustValue] = useState('');
  const [adjustCost, setAdjustCost] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const canEdit = profile?.is_owner || can('stock', 'edit');

  const load = async () => {
    if (!business?.id) return;

    setLoading(true);
    setError('');

    try {
      const [stockRes, locRes] = await Promise.all([
        api.stock.getAll({ businessId: business.id }),
        api.locations.getAll(),
      ]);

      if (stockRes?.error) {
        setError(stockRes.error);
        setStockItems([]);
      } else {
        setStockItems(stockRes?.data || []);
      }

      if (locRes?.error) {
        console.error('Failed to load locations:', locRes.error);
      } else {
        const activeLocs = (locRes?.data || []).filter(
          (l) => l.is_active !== 0 && l.is_active !== false
        );
        setLocations(activeLocs);
      }
    } catch (err) {
      setError(err.message || 'Could not load stock data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line
  }, [business?.id]);

  const rows = useMemo(() => {
    return stockItems
      .filter((r) => {
        if (isScopedToLocation) {
          // Staff: restrict to assigned locations only
          return scopedLocationIds.includes(r.location.id);
        }
        return !locationFilter || r.location.id === Number(locationFilter);
      })
      .filter((r) => {
        const q = search.toLowerCase();

        return (
          r.product.name.toLowerCase().includes(q) ||
          r.product.sku?.toLowerCase().includes(q)
        );
      });
  }, [
    stockItems,
    search,
    locationFilter,
    isScopedToLocation,
    scopedLocationIds,
  ]);

  const sort = useDataSort(
    rows,
    [
      { key: 'product', type: 'string', accessor: (r) => r.product.name },
      { key: 'sku', type: 'string', accessor: (r) => r.product.sku || '' },
      { key: 'location', type: 'string', accessor: (r) => r.location.name },
      { key: 'qty', type: 'number', accessor: (r) => r.qty },
      { key: 'alert_qty', type: 'number', accessor: (r) => r.product.alert_quantity ?? -1 },
      {
        key: 'status',
        type: 'string',
        accessor: (r) =>
          r.product.alert_quantity != null && r.qty <= Number(r.product.alert_quantity)
            ? 'Low'
            : 'OK',
      },
    ],
    { defaultKey: 'product', defaultDirection: 'asc' }
  );

  const {
    currentPage,
    totalPages,
    totalItems,
    paginatedItems,
    firstItemIndex,
    lastItemIndex,
    goToPage,
    nextPage,
    previousPage,
    hasNextPage,
    hasPreviousPage,
  } = usePagination(sort.sortedData, 20);

  const startAdjust = (row) => {
    setEditingKey(row.key);
    setAdjustValue(String(row.qty));
    setAdjustCost(String(row.product.cost_price ?? 0));
    setError('');
  };

  const saveAdjust = async (row) => {
    setError('');

    const target = Number(adjustValue);

    if (
      adjustValue === '' ||
      !Number.isInteger(target) ||
      target < 0
    ) {
      setError('Quantity must be a positive whole number.');
      return;
    }

    const delta = target - row.qty;

    if (delta === 0) {
      setEditingKey(null);
      return;
    }

    // A stock INCREASE creates a new inbound FIFO batch, so its cost is
    // whatever the person enters (defaulted from the product's current
    // cost, but editable — e.g. a correction found stock worth something
    // different).
    //
    // A DECREASE (shrinkage/write-off) doesn't create a batch, but its
    // valuation still needs to be FROZEN at the moment it happens — not
    // left to be computed later from whatever product.cost_price happens
    // to be when a report is viewed. Otherwise, exactly like the
    // unit_cost-on-sale bug already fixed elsewhere, changing a product's
    // price later silently rewrites the value of past write-offs in every
    // prior period's P&L. No extra input needed here since nothing new is
    // being priced — just record today's cost as what's being removed.
    let costForInsert = null;
    if (delta > 0) {
      const cost = Number(adjustCost);
      if (adjustCost === '' || Number.isNaN(cost) || cost < 0) {
        setError('Enter a valid unit cost for the added stock (0 or more).');
        return;
      }
      costForInsert = cost;
    } else {
      costForInsert = Number(row.product.cost_price) || 0;
    }

    setSaving(true);

    try {
      const res = await api.stock.adjust({
        businessId: business.id,
        productId: row.product.id,
        locationId: row.location.id,
        newQty: target,
        unitCost: costForInsert,
        reason: 'adjustment',
      });

      if (res?.error) {
        throw new Error(res.error);
      }

      setEditingKey(null);
      setAdjustCost('');
      await load();
    } catch (err) {
      setError(
        err.message || 'Could not save this adjustment.'
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppLayout>
      <div className="card list-panel">
        {/* ── Top bar: dark navy header matching Sales ── */}
        <div
          className="no-print"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '11px 16px',
            background: 'var(--navy-800)',
            borderRadius: 'var(--radius-md) var(--radius-md) 0 0',
            flexWrap: 'nowrap',
          }}
        >
          <h2
            style={{
              margin: 0,
              fontSize: 14,
              fontWeight: 700,
              whiteSpace: 'nowrap',
              color: '#fff',
              letterSpacing: '0.01em',
            }}
          >
            Stock on Hand
          </h2>

          <div style={{ flex: '1 1 220px', minWidth: 0 }}>
            <DataSearchBar
              query={search}
              setQuery={(q) => {
                setSearch(q);
                goToPage(1);
              }}
              clearSearch={() => {
                setSearch('');
                goToPage(1);
              }}
              placeholder="Search by product name or SKU…"
            />
          </div>

          <button
            type="button"
            className="btn btn-sm"
            style={{
              whiteSpace: 'nowrap',
              background: 'rgba(255,255,255,0.12)',
              color: '#fff',
              border: '1px solid rgba(255,255,255,0.22)',
            }}
            onClick={() => navigate('/reports/stock')}
          >
            Stock Report
          </button>
        </div>

        {/* ── Filter bar: light blue tint matching Sales ── */}
        <div
          className="no-print"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 16px',
            borderBottom: '1px solid var(--navy-border)',
            flexWrap: 'wrap',
            background: 'var(--navy-100)',
          }}
        >
          {/* {isOwner && (
            <select
              className="filter-select"
              value={locationFilter}
              onChange={(e) => {
                setLocationFilter(e.target.value);
                goToPage(1);
              }}
            >
              <option value="">All locations</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          )} */}

          {(search || locationFilter) && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              style={{ whiteSpace: 'nowrap', fontSize: 12, padding: '5px 10px' }}
              onClick={() => {
                setSearch('');
                setLocationFilter('');
                goToPage(1);
              }}
            >
              ✕ Clear
            </button>
          )}

          <div
            style={{
              marginLeft: 'auto',
              fontSize: 12,
              fontWeight: 600,
              color: 'var(--navy-900)',
            }}
          >
            Total: {rows.length} {rows.length === 1 ? 'record' : 'records'}
          </div>
        </div>

        {error && (
          <div
            className="error-text"
            style={{
              padding: '8px 16px',
            }}
          >
            {error}
          </div>
        )}

        <div style={{ overflowX: 'auto', paddingBottom: 16 }}>
          <table className="data-table table-compact" style={{ whiteSpace: 'nowrap' }}>
            <thead>
              <tr>
                <SortableHeader
                  label="Product"
                  sortKey="product"
                  currentSortKey={sort.sortKey}
                  sortDirection={sort.sortDirection}
                  toggleSortKey={sort.toggleSortKey}
                />
                {/* <SortableHeader
                  label="SKU"
                  sortKey="sku"
                  currentSortKey={sort.sortKey}
                  sortDirection={sort.sortDirection}
                  toggleSortKey={sort.toggleSortKey}
                /> */}
                {/* <SortableHeader
                  label="Location"
                  sortKey="location"
                  currentSortKey={sort.sortKey}
                  sortDirection={sort.sortDirection}
                  toggleSortKey={sort.toggleSortKey}
                /> */}
                <SortableHeader
                  label="On hand"
                  sortKey="qty"
                  currentSortKey={sort.sortKey}
                  sortDirection={sort.sortDirection}
                  toggleSortKey={sort.toggleSortKey}
                />
                <SortableHeader
                  label="Alert qty"
                  sortKey="alert_qty"
                  currentSortKey={sort.sortKey}
                  sortDirection={sort.sortDirection}
                  toggleSortKey={sort.toggleSortKey}
                />
                <SortableHeader
                  label="Status"
                  sortKey="status"
                  currentSortKey={sort.sortKey}
                  sortDirection={sort.sortDirection}
                  toggleSortKey={sort.toggleSortKey}
                />
                <th className="no-print" style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>

            <tbody>
              {loading && <EmptyState colSpan={5} message="Loading…" />}

              {!loading && rows.length === 0 && (
                <EmptyState
                  colSpan={5}
                  message={
                    search || locationFilter
                      ? 'No matching stock records found.'
                      : 'No stock activity yet — receive a purchase to get started.'
                  }
                  filtered={!!(search || locationFilter)}
                />
              )}

              {!loading &&
                paginatedItems.map((r) => {
                  const isLow =
                    r.product.alert_quantity != null &&
                    r.qty <= Number(r.product.alert_quantity);

                  return (
                    <tr key={r.key}>
                      <td style={{ fontWeight: 600 }}>{r.product.name}</td>
                      {/* <td>{r.product.sku || '—'}</td> */}
                      {/* <td>{r.location.name}</td> */}
                      <td>
                        {editingKey === r.key ? (
                          <div style={{ display: 'inline-flex', flexDirection: 'column', gap: 4 }}>
                            <input
                              type="number"
                              min="0"
                              step="1"
                              autoFocus
                              value={adjustValue}
                              onChange={(e) => setAdjustValue(e.target.value)}
                              onKeyDown={(e) => {
                                if (['e', 'E', '+', '-', '.'].includes(e.key)) {
                                  e.preventDefault();
                                }
                              }}
                              style={{
                                width: 90,
                                padding: '5px 8px',
                                border: '1px solid var(--navy-border)',
                                borderRadius: 6,
                              }}
                            />

                            {Number(adjustValue || 0) - r.qty > 0 && (
                              <div style={{ marginTop: 2 }}>
                                <label
                                  className="muted"
                                  style={{
                                    fontSize: 11,
                                    display: 'block',
                                    marginBottom: 2,
                                  }}
                                >
                                  Cost per unit added
                                </label>
                                <input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={adjustCost}
                                  onChange={(e) => setAdjustCost(e.target.value)}
                                  style={{
                                    width: 90,
                                    padding: '5px 8px',
                                    border: '1px solid var(--navy-border)',
                                    borderRadius: 6,
                                  }}
                                />
                              </div>
                            )}
                          </div>
                        ) : (
                          <span>{r.qty}</span>
                        )}
                      </td>

                      <td>{r.product.alert_quantity ?? '—'}</td>

                      <td>
                        {isLow ? (
                          <span className="badge badge-danger">Low</span>
                        ) : (
                          <span className="badge badge-success">OK</span>
                        )}
                      </td>

                      <td className="table-actions no-print">
                        {canEdit && editingKey === r.key ? (
                          <div style={{ display: 'inline-flex', gap: 6, justifyContent: 'flex-end', width: '100%' }}>
                            <button
                              type="button"
                              className="btn btn-primary btn-sm"
                              disabled={saving}
                              onClick={() => saveAdjust(r)}
                            >
                              {saving ? 'Saving…' : 'Save'}
                            </button>
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              onClick={() => {
                                setEditingKey(null);
                                setAdjustCost('');
                              }}
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <TableActions
                            actions={[
                              {
                                label: 'Adjust',
                                hidden: !canEdit,
                                onClick: () => startAdjust(r),
                              },
                            ]}
                          />
                        )}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>

        {!loading && rows.length > 0 && (
          <div className="no-print">
            <Pagination
              currentPage={currentPage}
              totalPages={totalPages}
              totalItems={totalItems}
              firstItemIndex={firstItemIndex}
              lastItemIndex={lastItemIndex}
              goToPage={goToPage}
              nextPage={nextPage}
              previousPage={previousPage}
              hasNextPage={hasNextPage}
              hasPreviousPage={hasPreviousPage}
            />
          </div>
        )}
      </div>
    </AppLayout>
  );
}
