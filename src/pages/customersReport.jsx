import { useEffect, useMemo, useState } from 'react';
import AppLayout from '../components/AppLayout.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../lib/electronAPI.js';
import '../components/report-ui.css';
import PrintReportHeader from '../components/PrintReportHeader.jsx';
import { downloadPDF, buildPdfFilename } from '../utils/pdfGenerator.js';
import useLocationScope from '../hooks/useLocationScope.js';
import EmptyState from '../components/EmptyState.jsx';

// CSS styling for premium layout and printer-friendly reports
const CSS = `
  .cust-rep-container {
    display: flex;
    flex-direction: column;
    gap: 16px;
    margin-top: -8px;
  }
  
  .cust-rep-filters {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    align-items: center;
    background: var(--white);
    padding: 12px 16px;
    border-radius: var(--radius-md);
    border: 1px solid var(--border-light);
    box-shadow: var(--shadow-sm);
  }
  
  .cust-filter-group {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 180px;
    flex: 1;
  }
  
  .cust-filter-group label {
    font-size: 11px;
    font-weight: 600;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  
  .cust-select-input {
    padding: 8px 12px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--navy-border, #ccc);
    font-size: 13px;
    background: var(--white);
    outline: none;
    transition: border-color 0.15s ease;
  }
  
  .cust-select-input:focus {
    border-color: var(--navy-800);
  }
  
  .cust-btn-row {
    display: flex;
    gap: 8px;
    align-self: flex-end;
    margin-left: auto;
  }
  
  .cust-summary-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 12px;
  }
  
  .cust-sum-card {
    background: var(--white);
    border: 1px solid var(--border-light);
    border-radius: var(--radius-md);
    padding: 16px;
    box-shadow: var(--shadow-sm);
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  
  .cust-sum-label {
    font-size: 14px;
    font-weight: 600;
    color: var(--text-secondary);
  }
  
  .cust-sum-val {
    font-size: 24px;
    font-weight: 800;
    color: var(--navy-900);
  }
  
  .cust-sum-sub {
    font-size: 12.5px;
    color: var(--text-secondary);
  }
  
  .cust-table-card {
    background: var(--white);
    border: 1px solid var(--border-light);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-sm);
    overflow: hidden;
  }

  .cust-table-card .data-table th {
    font-size: 14px;
    font-weight: 700;
    padding: 10px 12px;
  }

  .cust-table-card .data-table td {
    font-size: 14px;
    padding: 10px 12px;
    line-height: 1.45;
  }
  
  .cust-table-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 14px 16px;
    border-bottom: 1px solid var(--border-light);
  }
  
  .cust-table-title {
    font-size: 18px;
    font-weight: 700;
    color: var(--navy-900);
  }
  
  .cust-table-count {
    font-size: 13.5px;
    background: var(--navy-50);
    color: var(--navy-800);
    padding: 3px 10px;
    border-radius: 12px;
    font-weight: 600;
  }

  .text-success { color: var(--success) !important; }
  .text-danger { color: var(--danger) !important; }

  @media (max-width: 900px) {
    .cust-summary-grid {
      grid-template-columns: repeat(2, 1fr);
    }
  }
  
  @media (max-width: 600px) {
    .cust-summary-grid {
      grid-template-columns: 1fr;
    }
    .cust-rep-filters {
      flex-direction: column;
      align-items: stretch;
    }
    .cust-btn-row {
      margin-left: 0;
      align-self: stretch;
      justify-content: flex-end;
    }
  }
  
  @media print {
    .no-print {
      display: none !important;
    }
    .cust-table-card, .cust-rep-filters, .cust-summary-grid {
      box-shadow: none !important;
      border: 1px solid #ccc !important;
    }
    .cust-table-header {
      border-bottom: 1px solid #ccc !important;
    }
    .cust-table-card .data-table th,
    .cust-table-card .data-table td {
      font-size: 14px !important;
    }
    .cust-sum-label {
      font-size: 13.5px !important;
    }
    .cust-sum-val {
      font-size: 22px !important;
    }
    .cust-sum-sub {
      font-size: 12px !important;
    }
    body {
      background: white !important;
      color: black !important;
    }
  }
`;

export default function CustomersReport() {
  const { business, profile } = useAuth();

  // Data loading states
  const [loading, setLoading] = useState(true);
  const [customers, setCustomers] = useState([]);
  const [sales, setSales] = useState([]);
  const [sellReturns, setSellReturns] = useState([]);
  const [ledger, setLedger] = useState([]);
  const [locations, setLocations] = useState([]);

  // Location and User filter state
  const [locationFilter, setLocationFilter] = useState('');
  const [users, setUsers] = useState([]);
  const [userFilter, setUserFilter] = useState('');
  const { isOwner, isScopedToLocation, scopedLocationIds } = useLocationScope();

  // Load locations, users, and customer metrics on mount / filter change
  useEffect(() => {
    if (!business?.id) return;
    setLoading(true);

    const loadData = async () => {
      try {
        const { data, error: err } = await api.reports.getCustomers({
          businessId: business.id,
          userFilter: !isOwner && profile?.id ? profile.id : userFilter || undefined,
        });
        if (err) throw new Error(err);

        setLocations((data?.locations || []).filter((l) => l.is_active !== 0 && l.is_active !== false));
        setCustomers(data?.customers || []);
        setSales(data?.sales || []);
        setSellReturns(data?.sellReturns || []);
        setUsers(data?.users || []);
        setLedger(data?.ledger || []);
      } catch (err) {
        console.error('Error fetching customers report:', err);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [business?.id]);

  // Calculate stats per customer matching filters in-memory
  const computedRows = useMemo(() => {
    // outstanding balance mapping (global value)
    const balances = {};
    customers.forEach((c) => {
      balances[c.id] = Number(c.opening_balance || 0);
    });
    ledger.forEach((l) => {
      if (l.reference_type === 'opening_balance') return;
      balances[l.contact_id] = (balances[l.contact_id] || 0) + Number(l.amount || 0);
    });

    // sale lookup for returns mapping
    const saleById = new Map();
    sales.forEach((s) => saleById.set(s.id, s));

    const returnsByCustomer = {};
    sellReturns.forEach((sr) => {
      const s = saleById.get(sr.sale_id);
      if (!s) return;
      if (isScopedToLocation) {
        if (scopedLocationIds.length === 0) return;
        if (!scopedLocationIds.includes(s.location_id)) return;
      } else if (locationFilter && s.location_id !== Number(locationFilter)) {
        return;
      }
      returnsByCustomer[s.customer_id] = (returnsByCustomer[s.customer_id] || 0) + Number(sr.total_amount || 0);
    });

    // sale activity mapping (filtered by location in-memory)
    const activity = {};
    sales.forEach((s) => {
      // Apply location filter (owners: use voluntary filter; staff: auto-scope)
      if (isScopedToLocation) {
        if (scopedLocationIds.length === 0) return;
        if (!scopedLocationIds.includes(s.location_id)) return;
      } else if (locationFilter && s.location_id !== Number(locationFilter)) {
        return;
      }

      if (!activity[s.customer_id]) {
        activity[s.customer_id] = { count: 0, total: 0, last: null };
      }
      activity[s.customer_id].count += 1;
      activity[s.customer_id].total += Number(s.grand_total || 0);

      if (!activity[s.customer_id].last || s.sale_date > activity[s.customer_id].last) {
        activity[s.customer_id].last = s.sale_date;
      }
    });

    // Subtract returns from customer total spend
    Object.keys(returnsByCustomer).forEach((custId) => {
      if (activity[custId]) {
        activity[custId].total = Math.max(0, activity[custId].total - returnsByCustomer[custId]);
      }
    });

    return customers.map((c) => ({
      customer: c,
      orders: activity[c.id]?.count || 0,
      total: activity[c.id]?.total || 0,
      last: activity[c.id]?.last || '—',
      balance: balances[c.id] || 0,
    })).sort((a, b) => b.total - a.total);
  }, [customers, sales, sellReturns, ledger, locationFilter, isScopedToLocation, scopedLocationIds]);

  // Calculate total metrics for cards
  const summary = useMemo(() => {
    const totalSales = computedRows.reduce((sum, r) => sum + r.total, 0);
    const activeCustomers = computedRows.filter((r) => r.orders > 0).length;
    const totalOwed = computedRows.reduce((sum, r) => sum + Math.max(r.balance, 0), 0);
    const totalCustomersCount = customers.length;

    return {
      count: computedRows.length,
      totalSales,
      activeCustomers,
      totalOwed,
      totalCustomersCount,
    };
  }, [computedRows, customers.length]);

  if (loading) {
    return (
      <AppLayout>
        <div style={{ padding: '40px', textAlign: 'center', color: 'var(--navy-muted)' }}>
          Loading customers report…
        </div>
      </AppLayout>
    );
  }

  const selectedUserName = userFilter
    ? ([users.find((u) => String(u.id) === String(userFilter))?.first_name, users.find((u) => String(u.id) === String(userFilter))?.last_name].filter(Boolean).join(' ') || 'Selected User')
    : 'All Users';

  const cur = business?.currency || '';
  const fmt = (n) => `${cur} ${Number(n).toFixed(2)}`;

  return (
    <AppLayout>
      <style>{CSS}</style>
      <div className="cust-rep-container">
        {/* Filter bar */}
        <div className="cust-rep-filters no-print">


          {/* User Select Dropdown — owners only */}
          {isOwner && users.length > 0 && (
            <div className="cust-filter-group" style={{ maxWidth: '240px' }}>
              <label htmlFor="filter-user">Filter by User</label>
              <select
                id="filter-user"
                className="cust-select-input"
                value={userFilter}
                onChange={(e) => setUserFilter(e.target.value)}
              >
                <option value="">All Users</option>
                {users.map((u) => {
                  const name = [u.first_name, u.last_name].filter(Boolean).join(' ') || u.username || 'Staff';
                  return (
                    <option key={u.id} value={u.id}>{name}</option>
                  );
                })}
              </select>
            </div>
          )}

          {/* Action Row */}
          <div className="cust-btn-row">
            <button className="btn btn-secondary btn-sm" onClick={() => window.print()} style={{ marginRight: '8px' }}>
              🖨️ Print
            </button>
            <button className="btn btn-primary btn-sm" onClick={() => {
              const locName = locationFilter ? (locations.find(l => String(l.id) === String(locationFilter))?.name || 'Unknown') : 'All Locations';
              downloadPDF(buildPdfFilename('Customers Report', [{ value: locName }, { value: selectedUserName }]));
            }}>
              📄 Save PDF
            </button>
          </div>
        </div>

        {/* Standardized Print Header (print-only) */}
        <PrintReportHeader
          title="Customers Report"
          filters={[
            {
              label: 'Location',
              value: locationFilter ? (locations.find(l => String(l.id) === String(locationFilter))?.name || 'Unknown') : 'All Locations',
            },
            {
              label: 'User',
              value: selectedUserName,
            },
          ]}
        />

        {/* Summary grid */}
        <div className="cust-summary-grid">
          <div className="cust-sum-card">
            <span className="cust-sum-label">Total Customers</span>
            <span className="cust-sum-val">{summary.totalCustomersCount}</span>
            <span className="cust-sum-sub">Total registered</span>
          </div>
          <div className="cust-sum-card">
            <span className="cust-sum-label">Total Sales (Revenue)</span>
            <span className="cust-sum-val text-success">{fmt(summary.totalSales)}</span>
            <span className="cust-sum-sub">Confirmed sales volume</span>
          </div>
          <div className="cust-sum-card">
            <span className="cust-sum-label">Active Customers</span>
            <span className="cust-sum-val">{summary.activeCustomers}</span>
            <span className="cust-sum-sub">With orders registered</span>
          </div>
          <div className="cust-sum-card">
            <span className="cust-sum-label">Total Owed to Business</span>
            <span className="cust-sum-val text-danger">{fmt(summary.totalOwed)}</span>
            <span className="cust-sum-sub">Outstanding balance as of now</span>
          </div>
        </div>

        {/* Detailed Customer Table */}
        <div className="cust-table-card">
          <div className="cust-table-header">
            <span className="cust-table-title">Customer Transactions &amp; Balances</span>
            <span className="cust-table-count">{computedRows.length} customers</span>
          </div>

          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Customer Name</th>
                  <th>Orders</th>
                  <th>Revenue</th>
                  <th>Last Purchase Date</th>
                  <th>Outstanding Balance</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <EmptyState colSpan={5} message="Loading report details…" />
                )}
                {!loading && computedRows.length === 0 && (
                  <EmptyState
                    colSpan={5}
                    message="No customers found."
                    filtered={Boolean(userFilter || locationFilter)}
                  />
                )}
                {!loading && computedRows.map((r) => (
                  <tr key={r.customer.id}>
                    <td>
                      <span style={{ fontWeight: 600 }}>{r.customer.name}</span>
                      {r.customer.contact_number && (
                        <div className="muted" style={{ fontSize: 13, fontWeight: 400 }}>
                          {r.customer.contact_number}
                        </div>
                      )}
                    </td>
                    <td>{r.orders}</td>
                    <td>{fmt(r.total)}</td>
                    <td>{r.last}</td>
                    <td>
                      <span className={r.balance > 0 ? 'text-danger' : r.balance < 0 ? 'text-success' : ''} style={{ fontWeight: 700 }}>
                        {fmt(r.balance)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}