import { useEffect, useMemo, useState, Fragment } from 'react';
import { Link } from 'react-router-dom';

import AppLayout from '../components/AppLayout.jsx';
import Pagination from '../components/Pagination.jsx';
import SortableHeader from '../components/SortableHeader.jsx';
import DataSearchBar from '../components/DataSearchBar.jsx';

import usePagination from '../hooks/usePagination.js';
import useDataSearch from '../hooks/useDataSearch.js';
import useDataSort from '../hooks/useDataSort.js';

import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../lib/electronAPI.js';

export default function SellReturns() {
  const { business } = useAuth();

  const [rows, setRows] = useState([]);
  const [sales, setSales] = useState({});
  const [users, setUsers] = useState({});
  const [items, setItems] = useState({});
  const [expanded, setExpanded] = useState(null);
  const [loading, setLoading] = useState(true);

  /*
   * FILTER STATE
   */

  const [invoiceFilter, setInvoiceFilter] = useState('');
  const [customerFilter, setCustomerFilter] = useState('');
  const [createdByFilter, setCreatedByFilter] = useState('');

  const load = async () => {
    if (!business?.id) return;

    setLoading(true);

    const [returnsRes, salesRes] = await Promise.all([
      api.sellReturns.getAll({ business_id: business.id }),
      api.sales.getAll({ business_id: business.id }),
    ]);

    if (returnsRes?.error) {
      console.error('Error loading returns:', returnsRes.error);
    }

    if (salesRes?.error) {
      console.error('Error loading sales:', salesRes.error);
    }

    const returnRows = returnsRes?.data || [];
    const saleRows = salesRes?.data || [];

    setRows(returnRows);

    setSales(
      Object.fromEntries(
        saleRows.map((sale) => [
          sale.id,
          {
            id: sale.id,
            customer_id: sale.customer_id,
            contacts: { name: sale.customer_name },
          },
        ])
      )
    );

    setUsers({
      [profile?.id || 'admin']: {
        id: profile?.id,
        first_name: profile?.first_name || profile?.username || 'Admin',
      },
    });

    setLoading(false);
  };

  useEffect(() => {
    load();

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [business?.id]);

  const toggleExpand = async (returnId) => {
    if (expanded === returnId) {
      setExpanded(null);
      return;
    }

    setExpanded(returnId);

    if (!items[returnId]) {
      const { data, error } = await api.sellReturns.getItems(returnId);

      if (error) {
        console.error(
          'Error loading return items:',
          error
        );
      }

      setItems((prev) => ({
        ...prev,
        [returnId]: data || [],
      }));
    }
  };

  /*
   * =====================================================
   * SEARCH
   *
   * ONLY:
   * - Invoice
   * - Customer
   * - Amount
   * =====================================================
   */

  const searchFields = useMemo(
    () => [
      (row) => row.sale_id,

      (row) =>
        sales[row.sale_id]?.contacts?.name,

      (row) => row.total_amount,
    ],
    [sales]
  );

  const search = useDataSearch(
    rows,
    searchFields
  );

  /*
   * =====================================================
   * DROPDOWN FILTER OPTIONS
   * =====================================================
   */

  const invoiceOptions = useMemo(() => {
    return [
      ...new Set(
        rows
          .map((row) => row.sale_id)
          .filter(Boolean)
      ),
    ];
  }, [rows]);

  const customerOptions = useMemo(() => {
    return [
      ...new Set(
        rows
          .map(
            (row) =>
              sales[row.sale_id]?.contacts?.name ||
              'Walk-in'
          )
          .filter(Boolean)
      ),
    ];
  }, [rows, sales]);

  const createdByOptions = useMemo(() => {
    return [
      ...new Set(
        rows
          .map(
            (row) =>
              users[row.created_by]?.first_name
          )
          .filter(Boolean)
      ),
    ];
  }, [rows, users]);

  /*
   * =====================================================
   * APPLY DROPDOWN FILTERS
   * =====================================================
   */

  const filteredRows = useMemo(() => {
    return search.filteredData.filter((row) => {
      const invoice = String(
        row.sale_id || ''
      );

      const customer =
        sales[row.sale_id]?.contacts?.name ||
        'Walk-in';

      const createdBy =
        users[row.created_by]?.first_name ||
        '';

      const matchesInvoice =
        !invoiceFilter ||
        invoice === invoiceFilter;

      const matchesCustomer =
        !customerFilter ||
        customer === customerFilter;

      const matchesCreatedBy =
        !createdByFilter ||
        createdBy === createdByFilter;

      return (
        matchesInvoice &&
        matchesCustomer &&
        matchesCreatedBy
      );
    });
  }, [
    search.filteredData,
    invoiceFilter,
    customerFilter,
    createdByFilter,
    sales,
    users,
  ]);

  /*
   * =====================================================
   * SORTING
   *
   * EVERY MAIN TABLE FIELD
   * =====================================================
   */

  const sortFields = useMemo(
    () => [
      {
        key: 'date',
        label: 'Date',
        type: 'date',
        getValue: (row) =>
          row.return_date,
      },

      {
        key: 'invoice',
        label: 'Invoice #',
        type: 'number',
        getValue: (row) =>
          row.sale_id,
      },

      {
        key: 'customer',
        label: 'Customer',
        type: 'text',
        getValue: (row) =>
          sales[row.sale_id]?.contacts?.name ||
          'Walk-in',
      },

      {
        key: 'reason',
        label: 'Reason',
        type: 'text',
        getValue: (row) =>
          row.reason || '',
      },

      {
        key: 'amount',
        label: 'Amount',
        type: 'number',
        getValue: (row) =>
          Number(row.total_amount || 0),
      },

      {
        key: 'created_by',
        label: 'Created By',
        type: 'text',
        getValue: (row) =>
          users[row.created_by]?.first_name ||
          '',
      },
    ],
    [sales, users]
  );

  const sort = useDataSort(
    filteredRows,
    sortFields
  );

  /*
   * =====================================================
   * PAGINATION
   * =====================================================
   */

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
  } = usePagination(
    sort.sortedData,
    20
  );

  /*
   * =====================================================
   * TOTAL
   * =====================================================
   */

  const currentPageTotal = paginatedItems.reduce(
    (total, row) =>
      total + Number(row.total_amount || 0),
    0
  );

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
          <h1
            style={{
              margin: 0,
              fontSize: 15,
              fontWeight: 700,
              whiteSpace: 'nowrap',
              color: '#fff',
              letterSpacing: '0.01em',
            }}
          >
            Sales Returns
          </h1>

          <div style={{ flex: '1 1 220px', minWidth: 0 }}>
            <DataSearchBar
              {...search}
              placeholder="Search invoice, customer, or amount…"
            />
          </div>

          <Link
            to="/sales"
            className="btn btn-sm"
            style={{
              whiteSpace: 'nowrap',
              background: 'rgba(255,255,255,0.12)',
              color: '#fff',
              border: '1px solid rgba(255,255,255,0.22)',
            }}
          >
            ← Back to Sales
          </Link>

          <Link
            to="/sales/returns/new"
            className="btn btn-sm"
            style={{
              whiteSpace: 'nowrap',
              background: '#fff',
              color: 'var(--navy-800)',
              fontWeight: 700,
              border: 'none',
            }}
          >
            + New Return
          </Link>
        </div>

        {/* ── Filter bar: light blue tint matching Sales ── */}
        <div
          className="no-print"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '8px 16px',
            borderBottom: '1px solid var(--navy-border)',
            flexWrap: 'wrap',
            background: 'var(--navy-100)',
          }}
        >
          {/* INVOICE FILTER */}
          <select
            className="filter-select"
            value={invoiceFilter}
            onChange={(e) => setInvoiceFilter(e.target.value)}
          >
            <option value="">All invoices</option>
            {invoiceOptions.map((invoice) => (
              <option key={invoice} value={invoice}>
                #{invoice}
              </option>
            ))}
          </select>

          {/* CUSTOMER FILTER */}
          <select
            className="filter-select"
            value={customerFilter}
            onChange={(e) => setCustomerFilter(e.target.value)}
          >
            <option value="">All customers</option>
            {customerOptions.map((customer) => (
              <option key={customer} value={customer}>
                {customer}
              </option>
            ))}
          </select>

          {/* CREATED BY FILTER */}
          <select
            className="filter-select"
            value={createdByFilter}
            onChange={(e) => setCreatedByFilter(e.target.value)}
          >
            <option value="">All created by</option>
            {createdByOptions.map((user) => (
              <option key={user} value={user}>
                {user}
              </option>
            ))}
          </select>

          {(invoiceFilter || customerFilter || createdByFilter || search.query) && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              style={{ whiteSpace: 'nowrap', fontSize: 12, padding: '5px 10px' }}
              onClick={() => {
                setInvoiceFilter('');
                setCustomerFilter('');
                setCreatedByFilter('');
                search.clearSearch();
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
            Total: {totalItems} {totalItems === 1 ? 'return' : 'returns'}
          </div>
        </div>

        <div style={{ overflowX: 'auto', paddingBottom: 16 }}>
          <table className="data-table table-compact" style={{ whiteSpace: 'nowrap' }}>
            <thead>
              <tr>
                <th style={{ width: 40 }}></th>

                <SortableHeader
                  label="Date"
                  sortKey="date"
                  currentSortKey={sort.sortKey}
                  sortDirection={sort.sortDirection}
                  toggleSortKey={sort.toggleSortKey}
                />

                <SortableHeader
                  label="Invoice #"
                  sortKey="invoice"
                  currentSortKey={sort.sortKey}
                  sortDirection={sort.sortDirection}
                  toggleSortKey={sort.toggleSortKey}
                />

                <SortableHeader
                  label="Customer"
                  sortKey="customer"
                  currentSortKey={sort.sortKey}
                  sortDirection={sort.sortDirection}
                  toggleSortKey={sort.toggleSortKey}
                />

                <SortableHeader
                  label="Reason"
                  sortKey="reason"
                  currentSortKey={sort.sortKey}
                  sortDirection={sort.sortDirection}
                  toggleSortKey={sort.toggleSortKey}
                />

                <SortableHeader
                  label="Amount"
                  sortKey="amount"
                  currentSortKey={sort.sortKey}
                  sortDirection={sort.sortDirection}
                  toggleSortKey={sort.toggleSortKey}
                />

                <SortableHeader
                  label="Created By"
                  sortKey="created_by"
                  currentSortKey={sort.sortKey}
                  sortDirection={sort.sortDirection}
                  toggleSortKey={sort.toggleSortKey}
                />
              </tr>
            </thead>

            <tbody>
              {loading && (
                <tr>
                  <td colSpan={7} className="muted table-empty">
                    Loading…
                  </td>
                </tr>
              )}

              {!loading && sort.sortedData.length === 0 && (
                <tr>
                  <td colSpan={7} className="muted table-empty">
                    {search.isActive || invoiceFilter || customerFilter || createdByFilter
                      ? 'No sales returns match your filters.'
                      : 'No sales returns yet.'}
                  </td>
                </tr>
              )}

              {!loading &&
                paginatedItems.map((row) => (
                  <Fragment key={row.id}>
                    <tr
                      onClick={() => toggleExpand(row.id)}
                      style={{ cursor: 'pointer' }}
                    >
                      <td>{expanded === row.id ? '▾' : '▸'}</td>
                      <td>{row.return_date}</td>
                      <td style={{ fontWeight: 600 }}>#{row.sale_id}</td>
                      <td>{sales[row.sale_id]?.contacts?.name || 'Walk-in'}</td>
                      <td>{row.reason || '—'}</td>
                      <td style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                        {business?.currency} {Number(row.total_amount).toFixed(2)}
                      </td>
                      <td>{users[row.created_by]?.first_name || '—'}</td>
                    </tr>

                    {expanded === row.id && (
                      <tr>
                        <td
                          colSpan={7}
                          style={{
                            background: 'var(--navy-50)',
                            padding: 0,
                          }}
                        >
                          <table
                            className="data-table"
                            style={{
                              margin: '4px 24px 12px',
                            }}
                          >
                            <thead>
                              <tr>
                                <th>Product</th>
                                <th>Qty returned</th>
                                <th>Amount</th>
                              </tr>
                            </thead>

                            <tbody>
                              {(items[row.id] || []).map((item) => (
                                <tr key={item.id}>
                                  <td>{item.sale_items?.products?.name || '—'}</td>
                                  <td>{Number(item.quantity_returned)}</td>
                                  <td>
                                    {business?.currency} {Number(item.amount).toFixed(2)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}

              {!loading && paginatedItems.length > 0 && (
                <tr>
                  <td
                    colSpan={5}
                    style={{
                      fontWeight: 700,
                      textAlign: 'right',
                    }}
                  >
                    TOTAL (PAGE)
                  </td>

                  <td
                    style={{
                      fontWeight: 700,
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {business?.currency} {currentPageTotal.toFixed(2)}
                  </td>

                  <td></td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {!loading && sort.sortedData.length > 0 && (
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