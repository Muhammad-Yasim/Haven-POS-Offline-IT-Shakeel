import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AppLayout from '../components/AppLayout.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../lib/electronAPI.js';
import usePagination from '../hooks/usePagination.js';
import Pagination from '../components/Pagination.jsx';
import useDataSearch from '../hooks/useDataSearch.js';
import useDataSort from '../hooks/useDataSort.js';
import DataSearchBar from '../components/DataSearchBar.jsx';
import SortableHeader from '../components/SortableHeader.jsx';
import useLocationScope from '../hooks/useLocationScope.js';
import EmptyState from '../components/EmptyState.jsx';
import ConfirmDialog from '../components/ConfirmDialog.jsx';
import { INVOICE_HEADER_DATA_URL } from '../lib/invoiceAssets.js';
import { downloadPDF } from '../utils/pdfGenerator.js';

export default function Contacts() {
  const { business, can, profile } = useAuth();
  const { isOwner, isScopedToLocation, scopedLocationIds } = useLocationScope();
  const navigate = useNavigate();

  const [tab, setTab] = useState('customer');
  const [rows, setRows] = useState([]);
  const [locations, setLocations] = useState([]);
  const [locationFilter, setLocationFilter] = useState('');
  const [usersMap, setUsersMap] = useState({});
  const [usersList, setUsersList] = useState([]);
  const [userFilter, setUserFilter] = useState('');
  const [balances, setBalances] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedAddress, setSelectedAddress] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [confirmState, setConfirmState] = useState(null);
  const [khataModal, setKhataModal] = useState(null);
  const [ledgerModal, setLedgerModal] = useState(null);

  const openKhataModal = async (contact) => {
    setKhataModal({
      contact,
      amount: '',
      paymentMethod: 'Cash',
      note: '',
      submitting: false,
      error: '',
      loading: true,
      dueRecords: [],
    });

    try {
      if (tab === 'customer') {
        const res = await api.salesDue.getAll({ business_id: business?.id });
        const allDues = res?.data || [];
        const contactDues = allDues.filter(
          (d) => Number(d.customer_id) === Number(contact.id) || Number(d.contacts?.id) === Number(contact.id)
        );
        setKhataModal((prev) => prev ? { ...prev, dueRecords: contactDues, loading: false } : null);
      } else {
        const res = await api.purchaseDue.getAll({ business_id: business?.id });
        const allDues = res?.data || [];
        const contactDues = allDues.filter(
          (d) => Number(d.supplier_id) === Number(contact.id) || Number(d.contacts?.id) === Number(contact.id)
        );
        setKhataModal((prev) => prev ? { ...prev, dueRecords: contactDues, loading: false } : null);
      }
    } catch (_err) {
      setKhataModal((prev) => prev ? { ...prev, loading: false, error: 'Could not load dues list.' } : null);
    }
  };

  const handleRecordKhata = async (e) => {
    e.preventDefault();
    if (!khataModal) return;

    const payAmt = Number(khataModal.amount);
    if (!payAmt || payAmt <= 0) {
      setKhataModal((prev) => ({ ...prev, error: 'Please enter a valid amount greater than zero.' }));
      return;
    }

    // ── Max cap: use the full ledger balance as the source of truth ──
    // Math.abs because for suppliers the balance may be stored as negative (they are owed money).
    // Remove the `outstanding > 0 &&` guard so a 0-balance contact is ALWAYS blocked.
    const outstanding = Math.round(Math.abs(Number(balances[khataModal.contact.id] || 0)) * 100) / 100;

    if (payAmt > outstanding) {
      if (outstanding <= 0) {
        setKhataModal((prev) => ({
          ...prev,
          error: `No outstanding balance. There is nothing to ${tab === 'customer' ? 'receive' : 'pay'} right now.`,
        }));
      } else {
        setKhataModal((prev) => ({
          ...prev,
          error: `Amount cannot exceed the outstanding balance of ${business?.currency || ''} ${outstanding.toFixed(2)}. You cannot ${tab === 'customer' ? 'receive' : 'pay'} more than what is owed.`,
        }));
      }
      return;
    }

    setKhataModal((prev) => ({ ...prev, submitting: true, error: '' }));

    try {
      let remaining = payAmt;
      const contact = khataModal.contact;

      if (tab === 'customer') {
        const sortedDues = [...(khataModal.dueRecords || [])].sort((a, b) => a.id - b.id);

        for (const sale of sortedDues) {
          if (remaining <= 0) break;
          const saleDue = Number(sale.due_amount || 0);
          if (saleDue <= 0) continue;

          const toPay = Math.min(saleDue, remaining);
          const res = await api.salesDue.recordPayment({
            saleId: sale.id,
            amount: toPay,
            paymentMethod: khataModal.paymentMethod || 'Cash',
            businessId: business?.id,
            customerId: contact.id,
          });
          if (res?.error) throw new Error(res.error);
          remaining = Math.round((remaining - toPay) * 100) / 100;
        }

        if (remaining > 0) {
          const res = await api.contacts.recordPayment({
            contactId: contact.id,
            amount: remaining,
            paymentMethod: khataModal.paymentMethod || 'Cash',
            note: khataModal.note || 'Khata Payment Adjustment',
            businessId: business?.id,
          });
          if (res?.error) throw new Error(res.error);
        }
      } else {
        const sortedDues = [...(khataModal.dueRecords || [])].sort((a, b) => a.id - b.id);

        for (const purchase of sortedDues) {
          if (remaining <= 0) break;
          const pDue = Number(purchase.due_amount || 0);
          if (pDue <= 0) continue;

          const toPay = Math.min(pDue, remaining);
          const res = await api.purchaseDue.recordPayment({
            purchaseId: purchase.id,
            amount: toPay,
            paymentMethod: khataModal.paymentMethod || 'Cash',
            paidOn: new Date().toISOString().slice(0, 10),
          });
          if (res?.error) throw new Error(res.error);
          remaining = Math.round((remaining - toPay) * 100) / 100;
        }

        if (remaining > 0) {
          const res = await api.contacts.recordPayment({
            contactId: contact.id,
            amount: remaining,
            paymentMethod: khataModal.paymentMethod || 'Cash',
            note: khataModal.note || 'Supplier Khata Payment',
            businessId: business?.id,
          });
          if (res?.error) throw new Error(res.error);
        }
      }

      setKhataModal(null);
      await load();
    } catch (err) {
      setKhataModal((prev) => ({ ...prev, submitting: false, error: err.message || 'Payment adjustment failed.' }));
    }
  };

  const openLedgerModal = async (contact) => {
    setLedgerModal({
      contact,
      loading: true,
      sales: [],
      purchases: [],
      ledgerRows: [],
      productSummary: [],
      summary: { totalSales: 0, totalSalesPaid: 0, totalPurchases: 0, totalPurchasesPaid: 0, balance: 0 },
      error: '',
    });

    try {
      const [salesRes, purchasesRes, ledgerRes] = await Promise.all([
        api.sales.getAll({ business_id: business?.id, customer_id: contact.id }),
        api.purchases.getAll({ business_id: business?.id, supplier_id: contact.id }),
        api.contacts.getLedger(contact.id),
      ]);

      const salesList = (salesRes?.data || []).filter(
        (s) => Number(s.customer_id) === Number(contact.id)
      );
      const purchasesList = (purchasesRes?.data || []).filter(
        (p) => Number(p.supplier_id) === Number(contact.id)
      );
      const ledgerRows = ledgerRes?.data || [];

      // Fetch line items for each transaction in parallel
      const [salesWithItems, purchasesWithItems] = await Promise.all([
        Promise.all(
          salesList.map(async (sale) => {
            try {
              const itemRes = await api.sales.getItems(sale.id);
              return { ...sale, items: itemRes?.data || [] };
            } catch {
              return { ...sale, items: [] };
            }
          })
        ),
        Promise.all(
          purchasesList.map(async (pur) => {
            try {
              const itemRes = await api.purchases.getItems(pur.id);
              return { ...pur, items: itemRes?.data || [] };
            } catch {
              return { ...pur, items: [] };
            }
          })
        ),
      ]);

      // Aggregate products bought/supplied
      const prodMap = {};
      salesWithItems.forEach((sale) => {
        (sale.items || []).forEach((item) => {
          const pName = item.products?.name || item.product_name || `Product #${item.product_id}`;
          if (!prodMap[pName]) {
            prodMap[pName] = { name: pName, saleQty: 0, purchaseQty: 0, saleAmount: 0, purchaseAmount: 0 };
          }
          const qty = Number(item.quantity) || 0;
          const amt = Number(item.subtotal || item.total || (qty * (Number(item.unit_price) || 0)));
          prodMap[pName].saleQty += qty;
          prodMap[pName].saleAmount += amt;
        });
      });

      purchasesWithItems.forEach((pur) => {
        (pur.items || []).forEach((item) => {
          const pName = item.products?.name || item.product_name || `Product #${item.product_id}`;
          if (!prodMap[pName]) {
            prodMap[pName] = { name: pName, saleQty: 0, purchaseQty: 0, saleAmount: 0, purchaseAmount: 0 };
          }
          const qty = Number(item.quantity) || 0;
          const amt = Number(item.line_total || (qty * (Number(item.unit_cost) || 0)));
          prodMap[pName].purchaseQty += qty;
          prodMap[pName].purchaseAmount += amt;
        });
      });

      const productSummary = Object.values(prodMap).sort(
        (a, b) => (b.saleQty + b.purchaseQty) - (a.saleQty + a.purchaseQty)
      );

      const totalSales = salesWithItems.reduce((acc, s) => acc + (Number(s.grand_total) || 0), 0);
      const totalSalesPaid = salesWithItems.reduce((acc, s) => acc + (Number(s.paid_amount) || 0), 0);
      const totalPurchases = purchasesWithItems.reduce((acc, p) => acc + (Number(p.grand_total) || 0), 0);
      const totalPurchasesPaid = purchasesWithItems.reduce((acc, p) => acc + (Number(p.advance_payment) || 0), 0);

      const currentBal = Number(balances[contact.id] || contact.balance || 0);

      setLedgerModal({
        contact,
        loading: false,
        sales: salesWithItems,
        purchases: purchasesWithItems,
        ledgerRows,
        productSummary,
        summary: {
          totalSales,
          totalSalesPaid,
          totalPurchases,
          totalPurchasesPaid,
          balance: currentBal,
        },
        error: '',
      });
    } catch (err) {
      setLedgerModal((prev) => ({
        ...prev,
        loading: false,
        error: err.message || 'Could not load complete ledger history.',
      }));
    }
  };

  const canCreate =
    profile?.is_owner || can('contacts', 'create');

  const canEdit =
    profile?.is_owner || can('contacts', 'edit');

  const load = async () => {
    setLoading(true);
    setError('');

    try {
      const [contactRes, locRes] = await Promise.all([
        api.contacts.getAll({
          contact_type: tab,
          location_id: locationFilter || undefined,
        }),
        api.locations.getAll(),
      ]);

      if (locRes?.data) {
        setLocations(locRes.data.filter((l) => l.is_active));
      }

      const uMap = {};
      if (profile) {
        const displayName =
          [profile.first_name, profile.last_name]
            .filter(Boolean)
            .join(' ') ||
          profile.username ||
          'Admin';
        uMap[profile.id] = displayName;
      }
      setUsersMap(uMap);

      if (contactRes?.error) {
        setError(contactRes.error);
        setRows([]);
        setBalances({});
        setLoading(false);
        return;
      }

      const data = contactRes?.data || [];
      setRows(data);

      const totals = {};
      data.forEach((c) => {
        totals[c.id] = Number(c.balance || 0);
      });
      setBalances(totals);
    } catch (err) {
      setError(err?.message || 'Failed to load contacts.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, locationFilter]);

  const handleSoftDelete = async (contact) => {
    setDeletingId(contact.id);
    setError('');

    const res = await api.contacts.softDelete(contact.id);
    if (res?.error) {
      setError(res.error);
    } else {
      setRows((currentRows) =>
        currentRows.filter((row) => row.id !== contact.id)
      );
    }

    setDeletingId(null);
  };

  /*
   * SEARCH
   * Only:
   * - Name
   * - Contact number
   * - Business name
   */

  const search = useDataSearch(rows, [
    'name',
    'contact_number',
    'business_name',
  ]);

  /*
   * SORTING
   * Every visible data field is sortable.
   * Actions column is intentionally not sortable.
   */

  const sortFields = [
    {
      key: 'id',
      label: 'ID',
      type: 'number',
    },

    {
      key: 'name',
      label: 'Name',
      type: 'text',
    },

    {
      key: 'balance',
      label: 'Balance',
      type: 'number',
      getValue: (contact) =>
        balances[contact.id] || 0,
    },

    {
      key: 'contact_number',
      label: 'Contact',
      type: 'text',
    },

    {
      key: 'address',
      label: 'Address',
      type: 'text',
    },

    {
      key: 'created_by',
      label: 'Created by',
      type: 'text',
      getValue: (c) =>
        usersMap[c.created_by] || '—',
    },

    {
      key: 'created_at',
      label: 'Added on',
      type: 'date',
    },

    {
      key: 'email',
      label: 'Email',
      type: 'text',
    },

    ...(tab === 'supplier'
      ? [
        {
          key: 'tax_ntn_number',
          label: 'NTN',
          type: 'text',
        },
        {
          key: 'business_name',
          label: 'Business',
          type: 'text',
        },
      ]
      : []),
  ];

  const sort = useDataSort(
    search.filteredData,
    sortFields
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

  const currentPageBalanceTotal =
    paginatedItems.reduce(
      (total, contact) =>
        total +
        Number(balances[contact.id] || 0),
      0
    );

  const formatDate = (date) => {
    if (!date) return '—';

    return new Date(date).toLocaleDateString(
      'en-US',
      {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      }
    );
  };

  // columns:
  // ID | Actions | Name | Balance | Contact | Address |
  // CreatedBy | AddedOn | Email [| NTN | Business]

  const tableColumnCount =
    tab === 'supplier' ? 11 : 9;

  return (
    <AppLayout>
      <div className="card list-panel">
        {/* ── Top bar: dark navy header matching Sales & Purchases ── */}
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
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
              Parties
            </h1>

            <div
              style={{
                display: 'flex',
                background: 'rgba(255,255,255,0.12)',
                borderRadius: 6,
                padding: 2,
              }}
            >
              <button
                type="button"
                style={{
                  background: tab === 'customer' ? '#fff' : 'transparent',
                  color: tab === 'customer' ? 'var(--navy-800)' : '#fff',
                  border: 'none',
                  borderRadius: 4,
                  padding: '4px 12px',
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                  whiteSpace: 'nowrap',
                }}
                onClick={() => setTab('customer')}
              >
                Customers
              </button>
              <button
                type="button"
                style={{
                  background: tab === 'supplier' ? '#fff' : 'transparent',
                  color: tab === 'supplier' ? 'var(--navy-800)' : '#fff',
                  border: 'none',
                  borderRadius: 4,
                  padding: '4px 12px',
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                  whiteSpace: 'nowrap',
                }}
                onClick={() => setTab('supplier')}
              >
                Suppliers
              </button>
            </div>
          </div>

          <div style={{ flex: '1 1 220px', minWidth: 0 }}>
            <DataSearchBar
              query={search.query}
              setQuery={search.setQuery}
              clearSearch={search.clearSearch}
              placeholder={`Search ${tab}s by name, number, or business…`}
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
            onClick={() => navigate(`/reports/${tab}s`)}
          >
            {tab === 'customer' ? 'Customers Report' : 'Suppliers Report'}
          </button>

          {canCreate && (
            <button
              type="button"
              className="btn btn-sm"
              style={{
                whiteSpace: 'nowrap',
                background: '#fff',
                color: 'var(--navy-800)',
                fontWeight: 700,
                border: 'none',
              }}
              onClick={() => navigate(`/contacts/new?type=${tab}`)}
            >
              + Add {tab === 'customer' ? 'Customer' : 'Supplier'}
            </button>
          )}
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
          {/* {isOwner && locations.length > 0 && (
            <select
              className="filter-select"
              value={locationFilter}
              onChange={(e) => setLocationFilter(e.target.value)}
              style={{ maxWidth: 200 }}
            >
              <option value="">All locations</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          )} */}

          {(locationFilter || search.query) && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              style={{ whiteSpace: 'nowrap', fontSize: 12, padding: '5px 10px' }}
              onClick={() => {
                setLocationFilter('');
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
            Total: {totalItems} {tab}{totalItems === 1 ? '' : 's'}
          </div>
        </div>

        {error && (
          <div
            className="error-text"
            style={{
              padding: '0 16px 10px',
            }}
          >
            {error}
          </div>
        )}

        <div className="table-scroll">
          <table
            className="data-table"
            style={{
              fontSize: '13px',
              tableLayout: 'fixed',
              width: '100%',
            }}
          >
            <colgroup>
              <col
                style={{ width: '52px' }}
              />
              {/* ID */}

              <col
                style={{ width: '220px' }}
              />
              {/* Actions */}

              <col
                style={{ width: '160px' }}
              />
              {/* Name */}

              <col
                style={{ width: '110px' }}
              />
              {/* Balance */}

              <col
                style={{ width: '130px' }}
              />
              {/* Contact */}

              <col
                style={{ width: '70px' }}
              />
              {/* Address */}

              <col
                style={{ width: '110px' }}
              />
              {/* Created by */}

              <col
                style={{ width: '100px' }}
              />
              {/* Added on */}

              <col />
              {/* Email — takes remaining space */}

              {tab === 'supplier' && (
                <col
                  style={{ width: '110px' }}
                />
              )}
              {/* NTN */}

              {tab === 'supplier' && (
                <col
                  style={{ width: '130px' }}
                />
              )}
              {/* Business */}
            </colgroup>

            <thead>
              <tr>
                <SortableHeader
                  label="ID"
                  sortKey="id"
                  currentSortKey={
                    sort.sortKey
                  }
                  sortDirection={
                    sort.sortDirection
                  }
                  toggleSortKey={
                    sort.toggleSortKey
                  }
                />

                {/* Fixed actions header */}
                <th
                  className="no-print"
                  style={{
                    padding: '8px 12px',
                    width: '220px',
                  }}
                >
                  Actions
                </th>

                <SortableHeader
                  label="Name"
                  sortKey="name"
                  currentSortKey={
                    sort.sortKey
                  }
                  sortDirection={
                    sort.sortDirection
                  }
                  toggleSortKey={
                    sort.toggleSortKey
                  }
                />

                <SortableHeader
                  label="Balance"
                  sortKey="balance"
                  currentSortKey={
                    sort.sortKey
                  }
                  sortDirection={
                    sort.sortDirection
                  }
                  toggleSortKey={
                    sort.toggleSortKey
                  }
                />

                {/* <SortableHeader
                  label="Contact"
                  sortKey="contact_number"
                  currentSortKey={
                    sort.sortKey
                  }
                  sortDirection={
                    sort.sortDirection
                  }
                  toggleSortKey={
                    sort.toggleSortKey
                  }
                /> */}

                {/* <SortableHeader
                  label="Addr"
                  sortKey="address"
                  currentSortKey={
                    sort.sortKey
                  }
                  sortDirection={
                    sort.sortDirection
                  }
                  toggleSortKey={
                    sort.toggleSortKey
                  }
                /> */}

                {/* <SortableHeader
                  label="Created by"
                  sortKey="created_by"
                  currentSortKey={
                    sort.sortKey
                  }
                  sortDirection={
                    sort.sortDirection
                  }
                  toggleSortKey={
                    sort.toggleSortKey
                  } */}
                {/* /> */}

                {/* <SortableHeader
                  label="Added on"
                  sortKey="created_at"
                  currentSortKey={
                    sort.sortKey
                  }
                  sortDirection={
                    sort.sortDirection
                  }
                  toggleSortKey={
                    sort.toggleSortKey
                  }
                /> */}

                {/* <SortableHeader
                  label="Email"
                  sortKey="email"
                  currentSortKey={
                    sort.sortKey
                  }
                  sortDirection={
                    sort.sortDirection
                  }
                  toggleSortKey={
                    sort.toggleSortKey
                  }
                /> */}

                {tab === 'supplier' && (
                  <>
                    {/* <SortableHeader
                      label="NTN"
                      sortKey="tax_ntn_number"
                      currentSortKey={
                        sort.sortKey
                      }
                      sortDirection={
                        sort.sortDirection
                      }
                      toggleSortKey={
                        sort.toggleSortKey
                      }
                    /> */}

                    {/* <SortableHeader
                      label="Business"
                      sortKey="business_name"
                      currentSortKey={
                        sort.sortKey
                      }
                      sortDirection={
                        sort.sortDirection
                      }
                      toggleSortKey={
                        sort.toggleSortKey
                      }
                    /> */}
                  </>
                )}
              </tr>
            </thead>

            <tbody>
              {loading && (
                <EmptyState
                  colSpan={tableColumnCount}
                  message="Loading…"
                />
              )}

              {!loading &&
                paginatedItems.length ===
                0 && (
                  <EmptyState
                    colSpan={tableColumnCount}
                    message={
                      search.query
                        ? `No matching ${tab}s found.`
                        : `No ${tab}s yet.`
                    }
                    filtered={Boolean(search.query)}
                  />
                )}

              {!loading &&
                paginatedItems.map(
                  (contact) => (
                    <tr
                      key={contact.id}
                      style={{
                        verticalAlign:
                          'middle',
                      }}
                    >
                      {/* ID */}
                      <td
                        style={{
                          whiteSpace:
                            'nowrap',
                          overflow:
                            'hidden',
                          textOverflow:
                            'ellipsis',
                        }}
                      >
                        <span
                          style={{
                            fontWeight: 600,
                            color:
                              'var(--navy-muted)',
                            fontSize:
                              '12px',
                          }}
                        >
                          #{contact.id}
                        </span>
                      </td>

                      {/* Actions */}
                      <td
                        className="no-print"
                        style={{
                          whiteSpace: 'nowrap',
                          overflow: 'visible',
                        }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <button
                            type="button"
                            className="btn btn-sm"
                            style={{
                              background: tab === 'customer' ? '#10b981' : '#2563eb',
                              color: '#fff',
                              border: 'none',
                              fontWeight: 700,
                              fontSize: '11px',
                              padding: '5px 9px',
                              borderRadius: '4px',
                              cursor: 'pointer',
                              whiteSpace: 'nowrap',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px',
                              boxShadow: '0 1px 2px rgba(0,0,0,0.08)',
                            }}
                            onClick={() => {
                              if (tab === 'customer') {
                                navigate(`/sales/due?customer=${encodeURIComponent(contact.name)}`);
                              } else {
                                navigate(`/purchases/due?supplier=${encodeURIComponent(contact.name)}`);
                              }
                            }}
                            title={tab === 'customer' ? 'Receive Payment / Settle Sales Dues' : 'Pay Supplier / Settle Purchase Dues'}
                          >
                            💰 {tab === 'customer' ? 'Receive' : 'Pay'}
                          </button>

                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            style={{
                              fontSize: '11px',
                              padding: '5px 8px',
                              whiteSpace: 'nowrap',
                              cursor: 'pointer',
                            }}
                            onClick={() => openLedgerModal(contact)}
                            title="View Khata Statement / History"
                          >
                            📜 Ledger
                          </button>

                          {canEdit && (
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              style={{
                                fontSize: '11px',
                                padding: '5px 7px',
                                whiteSpace: 'nowrap',
                                cursor: 'pointer',
                              }}
                              onClick={() => navigate(`/contacts/${contact.id}`)}
                              title="Edit Details"
                            >
                              ✏️ Info
                            </button>
                          )}
                        </div>
                      </td>

                      {/* Name */}
                      <td>
                        <span
                          style={{
                            fontWeight: 500,
                          }}
                        >
                          {contact.name}
                        </span>
                      </td>

                      {/* Balance */}
                      <td
                        style={{
                          whiteSpace: 'nowrap',
                          textAlign: 'right',
                          fontVariantNumeric: 'tabular-nums',
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            if (tab === 'customer') {
                              navigate(`/sales/due?customer=${encodeURIComponent(contact.name)}`);
                            } else {
                              navigate(`/purchases/due?supplier=${encodeURIComponent(contact.name)}`);
                            }
                          }}
                          title={tab === 'customer' ? 'Click to navigate to remaining dues & pending payments for this customer' : 'Click to navigate to remaining dues & pending payments for this supplier'}
                          style={{
                            background: (balances[contact.id] || 0) !== 0 ? 'rgba(16, 185, 129, 0.08)' : 'transparent',
                            border: (balances[contact.id] || 0) !== 0 ? '1px dashed #10b981' : 'none',
                            cursor: 'pointer',
                            padding: '3px 8px',
                            borderRadius: '4px',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            transition: 'all 0.15s ease',
                          }}
                        >
                          <span
                            style={{
                              fontWeight: 700,
                              fontSize: '13px',
                              color:
                                (balances[contact.id] || 0) < 0
                                  ? 'var(--error-color, #e05252)'
                                  : (balances[contact.id] || 0) > 0
                                    ? 'var(--success-color, #36b37e)'
                                    : 'inherit',
                            }}
                          >
                            {business?.currency}{' '}
                            {(balances[contact.id] || 0).toFixed(2)}
                          </span>
                        </button>
                      </td>

                      {/* Contact number
                      <td
                        style={{
                          whiteSpace:
                            'nowrap',
                          fontVariantNumeric:
                            'tabular-nums',
                        }}
                      >
                        {contact.contact_number ||
                          '—'}
                      </td>

                      {/* Address */}
                      {/* <td>
                        {contact.address ? (
                          <button
                            type="button"
                            className="contact-link-btn"
                            onClick={() =>
                              setSelectedAddress(
                                contact
                              )
                            }\
                          >
                            View
                          </button>
                        ) : (
                          <span
                            style={{
                              color:
                                'var(--navy-muted)',
                            }}
                          >
                            —
                          </span>
                        )}
                      </td> */}

                      {/* Created by */}
                      {/* <td
                        style={{
                          color:
                            'var(--navy-muted)',
                          fontSize:
                            '12px',
                        }}
                      >
                        {usersMap[
                          contact.created_by
                        ] || '—'}
                      </td> */}

                      {/* Added on */}
                      {/* <td
                        style={{
                          whiteSpace:
                            'nowrap',
                          color:
                            'var(--navy-muted)',
                          fontSize:
                            '12px',
                        }}
                      >
                        {formatDate(
                          contact.created_at
                        )}
                      </td> */}

                      {/* Email */}
                      {/* <td
                        style={{
                          fontSize:
                            '12px',
                          maxWidth:
                            '160px',
                          overflow:
                            'hidden',
                          textOverflow:
                            'ellipsis',
                          whiteSpace:
                            'nowrap',
                        }}
                      >
                        {contact.email ? (
                          <a
                            href={`mailto:${contact.email}`}
                            style={{
                              color:
                                'inherit',
                              textDecoration:
                                'underline',
                              textDecorationStyle:
                                'dotted',
                            }}
                          >
                            {contact.email}
                          </a>
                        ) : (
                          <span
                            style={{
                              color:
                                'var(--navy-muted)',
                            }}
                          >
                            —
                          </span>
                        )}
                      </td> */}

                      {/* Supplier-only columns */}
                      {tab ===
                        'supplier' && (
                          <>
                            {/* <td
                              style={{
                                fontSize:
                                  '12px',
                              }}
                            >
                              {contact.tax_ntn_number || (
                                <span
                                  style={{
                                    color:
                                      'var(--navy-muted)',
                                  }}
                                >
                                  —
                                </span>
                              )}
                            </td> */}

                            {/* <td
                              style={{
                                fontSize:
                                  '12px',
                                color:
                                  'var(--navy-muted)',
                              }}
                            >
                              {contact.business_name ||
                                '—'}
                            </td> */}
                          </>
                        )}
                    </tr>
                  )
                )}

              {!loading &&
                paginatedItems.length >
                0 && (
                  <tr className="table-total-row">
                    <td colSpan={3}>
                      <strong>
                        Total for current
                        page
                      </strong>
                    </td>

                    <td
                      style={{
                        textAlign:
                          'right',
                        whiteSpace:
                          'nowrap',
                        fontVariantNumeric:
                          'tabular-nums',
                      }}
                    >
                      <strong>
                        {business?.currency}{' '}
                        {currentPageBalanceTotal.toFixed(
                          2
                        )}
                      </strong>
                    </td>

                    <td
                      colSpan={
                        tab === 'supplier'
                          ? 7
                          : 5
                      }
                    ></td>
                  </tr>
                )}
            </tbody>
          </table>

          <style>{`
            .contact-link-btn {
              background: none;
              border: none;
              cursor: pointer;
              font-size: 11.5px;
              font-weight: 500;
              padding: 1px 3px;
              border-radius: 3px;
              color: var(--primary-color, #4f6ef7);
              transition: background 0.15s, color 0.15s;
              line-height: 1.5;
            }

            .contact-link-btn:hover {
              background: rgba(79,110,247,0.1);
              color: var(--primary-color, #4f6ef7);
            }

            .contact-link-btn--danger {
              color: var(--error-color, #e05252);
            }

            .contact-link-btn--danger:hover {
              background: rgba(224,82,82,0.1);
              color: var(--error-color, #e05252);
            }

            .contact-link-btn:disabled {
              opacity: 0.45;
              cursor: not-allowed;
            }

            .data-table td,
            .data-table th {
              padding: 8px 12px;
              line-height: 1.4;
            }
          `}</style>
        </div>

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
      </div>

      {selectedAddress && (
        <div
          className="modal-backdrop"
          onClick={() =>
            setSelectedAddress(null)
          }
          style={{
            position: 'fixed',
            inset: 0,
            background:
              'rgba(19, 26, 51, 0.6)',
            backdropFilter:
              'blur(2px)',
            display: 'flex',
            alignItems:
              'center',
            justifyContent:
              'center',
            zIndex: 9999,
            padding: '20px',
          }}
        >
          <div
            className="card"
            onClick={(e) =>
              e.stopPropagation()
            }
            style={{
              width:
                'min(560px, 92vw)',
              padding: '24px',
            }}
          >
            <div
              style={{
                display:
                  'flex',
                justifyContent:
                  'space-between',
                alignItems:
                  'center',
                gap: '16px',
                marginBottom:
                  '16px',
              }}
            >
              <div>
                <h2
                  style={{
                    margin: 0,
                  }}
                >
                  Address
                </h2>

                <p
                  className="muted"
                  style={{
                    margin:
                      '4px 0 0',
                  }}
                >
                  {
                    selectedAddress.name
                  }
                </p>
              </div>

              <button
                type="button"
                className="btn btn-secondary"
                onClick={() =>
                  setSelectedAddress(
                    null
                  )
                }
              >
                Close
              </button>
            </div>

            <div
              style={{
                whiteSpace:
                  'pre-wrap',
                lineHeight: 1.6,
                wordBreak:
                  'break-word',
              }}
            >
              {
                selectedAddress.address
              }
            </div>
          </div>
        </div>
      )}
      {khataModal && (
        <div
          className="modal-backdrop"
          onClick={() => !khataModal.submitting && setKhataModal(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(19, 26, 51, 0.6)',
            backdropFilter: 'blur(2px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: '20px',
          }}
        >
          <div
            className="card"
            onClick={(e) => e.stopPropagation()}
            style={{ width: 'min(580px, 94vw)', maxHeight: '90vh', overflowY: 'auto', padding: '24px' }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                marginBottom: '16px',
                borderBottom: '1px solid var(--navy-border)',
                paddingBottom: '12px',
              }}
            >
              <div>
                <h2 style={{ margin: 0, fontSize: 18, color: 'var(--navy-900)' }}>
                  {tab === 'customer' ? 'Receive Payment / Adjust Khata' : 'Pay Supplier / Adjust Khata'}
                </h2>
                <p className="muted" style={{ margin: '4px 0 0', fontSize: 13 }}>
                  Party: <strong>{khataModal.contact.name}</strong> ({khataModal.contact.contact_number || 'No phone'})
                </p>
              </div>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => !khataModal.submitting && setKhataModal(null)}
              >
                ✕ Close
              </button>
            </div>

            <div
              style={{
                background: 'var(--navy-100)',
                padding: '12px 16px',
                borderRadius: '8px',
                marginBottom: '16px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--navy-900)' }}>
                Current Outstanding Balance:
              </span>
              <span
                style={{
                  fontSize: 16,
                  fontWeight: 700,
                  color: (balances[khataModal.contact.id] || 0) > 0 ? 'var(--error-color, #e05252)' : 'var(--success-color, #36b37e)',
                }}
              >
                {business?.currency} {Number(balances[khataModal.contact.id] || 0).toFixed(2)}
              </span>
            </div>

            {khataModal.dueRecords?.length > 0 && (
              <div style={{ marginBottom: '16px' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--navy-700)', marginBottom: '6px' }}>
                  Unsettled Invoices / Dues:
                </div>
                <div style={{ maxHeight: '140px', overflowY: 'auto', border: '1px solid var(--navy-border)', borderRadius: '6px' }}>
                  <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ background: '#f8fafc', borderBottom: '1px solid var(--navy-border)', textAlign: 'left' }}>
                        <th style={{ padding: '6px 8px' }}>Ref / Invoice</th>
                        <th style={{ padding: '6px 8px' }}>Date</th>
                        <th style={{ padding: '6px 8px', textAlign: 'right' }}>Total</th>
                        <th style={{ padding: '6px 8px', textAlign: 'right' }}>Due</th>
                      </tr>
                    </thead>
                    <tbody>
                      {khataModal.dueRecords.map((r) => (
                        <tr key={r.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                          <td style={{ padding: '6px 8px', fontWeight: 600 }}>#{r.id}</td>
                          <td style={{ padding: '6px 8px' }}>{r.sale_date || r.purchase_date || '—'}</td>
                          <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                            {business?.currency} {Number(r.grand_total || 0).toFixed(2)}
                          </td>
                          <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 700, color: '#e05252' }}>
                            {business?.currency} {Number(r.due_amount || 0).toFixed(2)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <form onSubmit={handleRecordKhata}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                    Amount to {tab === 'customer' ? 'Receive' : 'Pay'} ({business?.currency || 'PKR'}) *
                    {(() => {
                      const outstanding = Math.round(Math.abs(Number(balances[khataModal.contact.id] || 0)) * 100) / 100;
                      return outstanding > 0 ? (
                        <span style={{ fontWeight: 400, color: 'var(--navy-muted)', marginLeft: 6 }}>
                          Max: {business?.currency} {outstanding.toFixed(2)}
                        </span>
                      ) : (
                        <span style={{ fontWeight: 400, color: '#e05252', marginLeft: 6 }}>
                          No outstanding balance
                        </span>
                      );
                    })()}
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    max={Math.round(Math.abs(Number(balances[khataModal.contact.id] || 0)) * 100) / 100 || 0}
                    required
                    autoFocus
                    placeholder="Enter payment amount"
                    value={khataModal.amount}
                    onChange={(e) => {
                      const val = e.target.value;
                      const outstanding = Math.round(Math.abs(Number(balances[khataModal.contact.id] || 0)) * 100) / 100;
                      // Clamp to outstanding max (also blocks entry when outstanding = 0)
                      if (Number(val) > outstanding) {
                        setKhataModal((prev) => ({ ...prev, amount: outstanding > 0 ? String(outstanding) : '' }));
                      } else {
                        setKhataModal((prev) => ({ ...prev, amount: val }));
                      }
                    }}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      fontSize: 14,
                      border: '1px solid var(--navy-border)',
                      borderRadius: 6,
                    }}
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                      Payment Method
                    </label>
                    <select
                      value={khataModal.paymentMethod}
                      onChange={(e) => setKhataModal((prev) => ({ ...prev, paymentMethod: e.target.value }))}
                      style={{
                        width: '100%',
                        padding: '8px 10px',
                        fontSize: 13,
                        border: '1px solid var(--navy-border)',
                        borderRadius: 6,
                      }}
                    >
                      <option value="Cash">Cash</option>
                      <option value="Bank Transfer">Bank Transfer</option>
                      <option value="Card">Card</option>
                      <option value="Cheque">Cheque</option>
                      <option value="Other">Other</option>
                    </select>
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                      Note / Reference
                    </label>
                    <input
                      placeholder="e.g. Cleared dues"
                      value={khataModal.note}
                      onChange={(e) => setKhataModal((prev) => ({ ...prev, note: e.target.value }))}
                      style={{
                        width: '100%',
                        padding: '8px 10px',
                        fontSize: 13,
                        border: '1px solid var(--navy-border)',
                        borderRadius: 6,
                      }}
                    />
                  </div>
                </div>

                {khataModal.error && (
                  <div style={{ color: '#e05252', fontSize: 12.5, padding: '6px 10px', background: '#fff1f2', borderRadius: 4 }}>
                    {khataModal.error}
                  </div>
                )}

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={khataModal.submitting}
                    onClick={() => setKhataModal(null)}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn btn-primary btn-sm"
                    disabled={khataModal.submitting}
                  >
                    {khataModal.submitting ? 'Saving...' : 'Confirm & Adjust Balance'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {ledgerModal && (
        <div
          className="modal-backdrop"
          onClick={() => setLedgerModal(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(19, 26, 51, 0.65)',
            backdropFilter: 'blur(2px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: '16px',
          }}
        >
          <div
            className="card khata-printable-card"
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 'min(920px, 96vw)',
              maxHeight: '94vh',
              overflowY: 'auto',
              padding: '24px',
              background: '#fff',
              borderRadius: '8px',
              boxShadow: '0 10px 25px rgba(0,0,0,0.2)',
            }}
          >
            {/* ── Modal Controls Bar (Hidden during print) ── */}
            <div
              className="no-print"
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '16px',
                borderBottom: '1px solid var(--navy-border)',
                paddingBottom: '12px',
                gap: 10,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--navy-900)' }}>
                  📜 {ledgerModal.contact.contact_type === 'supplier' ? 'Supplier Khata & Ledger' : 'Customer Khata & Ledger'}
                </span>
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    padding: '2px 8px',
                    borderRadius: 12,
                    background: ledgerModal.contact.contact_type === 'supplier' ? '#eff6ff' : '#ecfdf5',
                    color: ledgerModal.contact.contact_type === 'supplier' ? '#2563eb' : '#059669',
                    textTransform: 'capitalize',
                  }}
                >
                  {ledgerModal.contact.contact_type || tab}
                </span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                  onClick={() => {
                    const safeName = (ledgerModal.contact.name || 'Party')
                      .replace(/[&/\\?%*:|"<>]/g, '-')
                      .replace(/\s+/g, '_');
                    const element = document.querySelector('.khata-printable-content');
                    if (element) {
                      downloadPDF(element, `${safeName}_Ledger.pdf`);
                    }
                  }}
                >
                  💾 Save to Computer
                </button>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                  onClick={() => window.print()}
                >
                  🖨️ Print Statement
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    const cName = ledgerModal.contact.name;
                    setLedgerModal(null);
                    if (ledgerModal.contact.contact_type === 'supplier') {
                      navigate(`/purchases/due?supplier=${encodeURIComponent(cName)}`);
                    } else {
                      navigate(`/sales/due?customer=${encodeURIComponent(cName)}`);
                    }
                  }}
                >
                  💰 Settle Dues
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setLedgerModal(null)}
                >
                  ✕ Close
                </button>
              </div>
            </div>

            {/* ── Printable Statement Body (Exact Receipt Header Format) ── */}
            <div className="khata-printable-content">
              {/* Receipt Header Banner Image */}
              <div className="khata-header-banner" style={{ width: '100%', marginBottom: 8 }}>
                <img
                  src={INVOICE_HEADER_DATA_URL}
                  alt="Earth iT Center"
                  style={{ width: '100%', height: 'auto', display: 'block', borderRadius: 4 }}
                />
              </div>

              {/* Document Title matching SALE ORDER format */}
              <div
                style={{
                  textAlign: 'center',
                  fontSize: 18,
                  fontWeight: 800,
                  letterSpacing: '0.06em',
                  color: '#000',
                  textTransform: 'uppercase',
                  margin: '8px 0 16px 0',
                  fontFamily: 'Arial, sans-serif',
                }}
              >
                {ledgerModal.contact.contact_type === 'supplier'
                  ? 'SUPPLIER KHATA & TRANSACTION STATEMENT'
                  : 'CUSTOMER KHATA & TRANSACTION STATEMENT'}
              </div>

              {/* Bill To & Metadata Row matching Receipt Format */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  marginBottom: 16,
                  paddingBottom: 12,
                  borderBottom: '1.5px solid #000',
                  fontFamily: 'Arial, sans-serif',
                  fontSize: 13,
                  lineHeight: '1.45',
                }}
              >
                {/* Left: Party info */}
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13.5, color: '#333' }}>
                    {ledgerModal.contact.contact_type === 'supplier' ? 'Supplier Details' : 'Bill To'}
                  </div>
                  <div style={{ fontSize: 15, fontWeight: 800, color: '#000', marginTop: 2 }}>
                    {ledgerModal.contact.name}
                  </div>
                  {ledgerModal.contact.business_name && (
                    <div style={{ color: '#444' }}>{ledgerModal.contact.business_name}</div>
                  )}
                  <div style={{ color: '#444' }}>
                    {ledgerModal.contact.address || 'Mandar Road Bhalwal'}
                  </div>
                  <div style={{ color: '#444' }}>
                    {ledgerModal.contact.contact_number || '—'}
                  </div>
                </div>

                {/* Right: Statement metadata */}
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 17, fontWeight: 800, color: '#000', letterSpacing: '0.02em' }}>
                    KHATA #{ledgerModal.contact.id}
                  </div>
                  <div style={{ marginTop: 4, color: '#333' }}>
                    <strong>Date:</strong> {new Date().toLocaleDateString('en-GB')}
                  </div>
                  <div style={{ marginTop: 2, color: '#333' }}>
                    <strong>Account:</strong>{' '}
                    <span style={{ textTransform: 'capitalize' }}>
                      {ledgerModal.contact.contact_type || 'Customer'}
                    </span>
                  </div>
                  <div style={{ marginTop: 4 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: '#444' }}>
                      Current Balance:{' '}
                    </span>
                    <span
                      style={{
                        fontSize: 15,
                        fontWeight: 800,
                        color: (balances[ledgerModal.contact.id] || 0) > 0 ? '#b91c1c' : '#047857',
                      }}
                    >
                      {business?.currency} {Math.abs(Number(balances[ledgerModal.contact.id] || 0)).toFixed(2)}
                      {(balances[ledgerModal.contact.id] || 0) > 0 ? ' (Due)' : (balances[ledgerModal.contact.id] || 0) < 0 ? ' (Advance)' : ' (Settled)'}
                    </span>
                  </div>
                </div>
              </div>

              {/* ── Summary Overview Cards ── */}
              <div
                className="no-print"
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(4, 1fr)',
                  gap: 10,
                  marginBottom: 16,
                }}
              >
                {/* <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, padding: '10px 12px' }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase' }}>
                    Total Transactionsss
                  </div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: '#1e293b', marginTop: 4 }}>
                    {(ledgerModal.sales?.length || 0) + (ledgerModal.purchases?.length || 0)}
                  </div>
                </div> */}

                {/* <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, padding: '10px 12px' }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase' }}>
                    {ledgerModal.contact.contact_type === 'supplier' ? 'Total Purchased' : 'Total Billed (Sales)'}
                  </div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: '#1e293b', marginTop: 4 }}>
                    {business?.currency}{' '}
                    {(
                      (ledgerModal.summary?.totalSales || 0) + (ledgerModal.summary?.totalPurchases || 0)
                    ).toFixed(2)}
                  </div>
                </div> */}

                {/* <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, padding: '10px 12px' }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase' }}>
                    Total Paid
                  </div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: '#10b981', marginTop: 4 }}>
                    {business?.currency}{' '}
                    {(
                      (ledgerModal.summary?.totalSalesPaid || 0) + (ledgerModal.summary?.totalPurchasesPaid || 0)
                    ).toFixed(2)}
                  </div>
                </div> */}

                {/* <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, padding: '10px 12px' }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase' }}>
                    Net Outstanding
                  </div>
                  <div
                    style={{
                      fontSize: 18,
                      fontWeight: 700,
                      color: (balances[ledgerModal.contact.id] || 0) > 0 ? '#ef4444' : '#10b981',
                      marginTop: 4,
                    }}
                  >
                    {business?.currency} {Math.abs(Number(balances[ledgerModal.contact.id] || 0)).toFixed(2)}
                  </div>
                </div> */}
              </div>

              {ledgerModal.loading ? (
                <div style={{ padding: 40, textAlign: 'center', color: 'var(--navy-muted)', fontSize: 14 }}>
                  Loading complete purchase and sale history with product breakdown...
                </div>
              ) : (
                <>
                  {/* ── Transaction History Table (Matching Receipt Table Style) ── */}
                  <div style={{ marginBottom: 20 }}>
                    <div
                      style={{
                        fontSize: 14,
                        fontWeight: 700,
                        color: '#000',
                        marginBottom: 8,
                        textTransform: 'uppercase',
                        letterSpacing: '0.04em',
                      }}
                    >
                      Complete Sales & Purchases History (With Products & Quantity)
                    </div>

                    <table
                      style={{
                        width: '100%',
                        fontSize: 12.5,
                        borderCollapse: 'collapse',
                        fontFamily: 'Arial, sans-serif',
                      }}
                    >
                      <thead>
                        <tr style={{ background: '#000', color: '#fff', textAlign: 'left' }}>
                          <th style={{ padding: '8px 8px', width: '45px' }}>Sr No.</th>
                          <th style={{ padding: '8px 8px', width: '85px' }}>Date</th>
                          <th style={{ padding: '8px 8px', width: '100px' }}>Type / Ref</th>
                          <th style={{ padding: '8px 8px' }}>Product Names, Quantity & Rate</th>
                          <th style={{ padding: '8px 8px', textAlign: 'right', width: '90px' }}>Total</th>
                          <th style={{ padding: '8px 8px', textAlign: 'right', width: '90px' }}>Paid</th>
                          <th style={{ padding: '8px 8px', textAlign: 'right', width: '90px' }}>Due</th>
                        </tr>
                      </thead>
                      <tbody>
                        {/* Render Sales */}
                        {(ledgerModal.sales || []).map((sale, sIdx) => {
                          const saleDue = Math.max(0, (Number(sale.grand_total) || 0) - (Number(sale.paid_amount) || 0));
                          return (
                            <tr
                              key={`sale-${sale.id}`}
                              style={{
                                borderBottom: '1px solid #cbd5e1',
                                background: sIdx % 2 === 0 ? '#fff' : '#f8fafc',
                                verticalAlign: 'top',
                              }}
                            >
                              <td style={{ padding: '8px 8px', fontWeight: 600 }}>{sIdx + 1}</td>
                              <td style={{ padding: '8px 8px', whiteSpace: 'nowrap' }}>
                                {sale.sale_date || (sale.created_at ? sale.created_at.slice(0, 10) : '—')}
                              </td>
                              <td style={{ padding: '8px 8px' }}>
                                <span style={{ fontWeight: 700, color: '#047857' }}>SALE #{sale.id}</span>
                                <div style={{ fontSize: 11, color: '#64748b' }}>
                                  {sale.status || 'Confirmed'}
                                </div>
                              </td>
                              <td style={{ padding: '8px 8px' }}>
                                {sale.items && sale.items.length > 0 ? (
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                                    {sale.items.map((it, iIdx) => (
                                      <div key={iIdx} style={{ fontSize: 12 }}>
                                        <strong>{it.products?.name || it.product_name || `Product #${it.product_id}`}</strong>
                                        <span style={{ color: '#475569', marginLeft: 6 }}>
                                          — Qty: <strong>{Number(it.quantity).toFixed(2)}</strong> @ {business?.currency} {Number(it.unit_price).toFixed(2)}
                                          {' '}= {business?.currency} {Number(it.subtotal || it.total || (it.quantity * it.unit_price)).toFixed(2)}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <span style={{ color: '#64748b', fontStyle: 'italic' }}>
                                    No line items recorded
                                  </span>
                                )}
                              </td>
                              <td style={{ padding: '8px 8px', textAlign: 'right', fontWeight: 700 }}>
                                {business?.currency} {Number(sale.grand_total || 0).toFixed(2)}
                              </td>
                              <td style={{ padding: '8px 8px', textAlign: 'right', color: '#059669', fontWeight: 600 }}>
                                {business?.currency} {Number(sale.paid_amount || 0).toFixed(2)}
                              </td>
                              <td
                                style={{
                                  padding: '8px 8px',
                                  textAlign: 'right',
                                  fontWeight: 700,
                                  color: saleDue > 0 ? '#b91c1c' : '#64748b',
                                }}
                              >
                                {business?.currency} {saleDue.toFixed(2)}
                              </td>
                            </tr>
                          );
                        })}

                        {/* Render Purchases */}
                        {(ledgerModal.purchases || []).map((pur, pIdx) => {
                          const pDue = Math.max(0, (Number(pur.grand_total) || 0) - (Number(pur.advance_payment) || 0));
                          const baseIdx = (ledgerModal.sales?.length || 0) + pIdx + 1;
                          return (
                            <tr
                              key={`pur-${pur.id}`}
                              style={{
                                borderBottom: '1px solid #cbd5e1',
                                background: (baseIdx % 2 === 0) ? '#fff' : '#f8fafc',
                                verticalAlign: 'top',
                              }}
                            >
                              <td style={{ padding: '8px 8px', fontWeight: 600 }}>{baseIdx}</td>
                              <td style={{ padding: '8px 8px', whiteSpace: 'nowrap' }}>
                                {pur.purchase_date || (pur.created_at ? pur.created_at.slice(0, 10) : '—')}
                              </td>
                              <td style={{ padding: '8px 8px' }}>
                                <span style={{ fontWeight: 700, color: '#2563eb' }}>PURCHASE #{pur.id}</span>
                                {pur.supplier_invoice && (
                                  <div style={{ fontSize: 11, color: '#64748b' }}>
                                    Inv #{pur.supplier_invoice}
                                  </div>
                                )}
                              </td>
                              <td style={{ padding: '8px 8px' }}>
                                {pur.items && pur.items.length > 0 ? (
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                                    {pur.items.map((it, iIdx) => (
                                      <div key={iIdx} style={{ fontSize: 12 }}>
                                        <strong>{it.products?.name || it.product_name || `Product #${it.product_id}`}</strong>
                                        <span style={{ color: '#475569', marginLeft: 6 }}>
                                          — Qty: <strong>{Number(it.quantity).toFixed(2)}</strong> @ {business?.currency} {Number(it.unit_cost).toFixed(2)}
                                          {' '}= {business?.currency} {Number(it.line_total || (it.quantity * it.unit_cost)).toFixed(2)}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <span style={{ color: '#64748b', fontStyle: 'italic' }}>
                                    No line items recorded
                                  </span>
                                )}
                              </td>
                              <td style={{ padding: '8px 8px', textAlign: 'right', fontWeight: 700 }}>
                                {business?.currency} {Number(pur.grand_total || 0).toFixed(2)}
                              </td>
                              <td style={{ padding: '8px 8px', textAlign: 'right', color: '#059669', fontWeight: 600 }}>
                                {business?.currency} {Number(pur.advance_payment || 0).toFixed(2)}
                              </td>
                              <td
                                style={{
                                  padding: '8px 8px',
                                  textAlign: 'right',
                                  fontWeight: 700,
                                  color: pDue > 0 ? '#b91c1c' : '#64748b',
                                }}
                              >
                                {business?.currency} {pDue.toFixed(2)}
                              </td>
                            </tr>
                          );
                        })}

                        {/* If no sales or purchases */}
                        {(!ledgerModal.sales || ledgerModal.sales.length === 0) &&
                          (!ledgerModal.purchases || ledgerModal.purchases.length === 0) && (
                            <tr>
                              <td colSpan={7} style={{ padding: '24px 8px', textAlign: 'center', color: '#64748b' }}>
                                No sales or purchase transactions recorded for this party.
                              </td>
                            </tr>
                          )}
                      </tbody>
                    </table>
                  </div>

                  {/* ── Product Quantity & Item Summary Section ── */}
                  {ledgerModal.productSummary && ledgerModal.productSummary.length > 0 && (
                    <div style={{ marginBottom: 20 }}>
                      <div
                        style={{
                          fontSize: 13.5,
                          fontWeight: 700,
                          color: '#000',
                          marginBottom: 8,
                          textTransform: 'uppercase',
                          letterSpacing: '0.04em',
                        }}
                      >
                        Total Products Bought / Supplied Summary
                      </div>
                      <table
                        style={{
                          width: '100%',
                          fontSize: 12,
                          borderCollapse: 'collapse',
                          border: '1px solid #e2e8f0',
                        }}
                      >
                        <thead>
                          <tr style={{ background: '#f1f5f9', borderBottom: '1px solid #cbd5e1', textAlign: 'left' }}>
                            <th style={{ padding: '6px 8px' }}>Product Name</th>
                            <th style={{ padding: '6px 8px', textAlign: 'center', width: '130px' }}>Total Quantity</th>
                            <th style={{ padding: '6px 8px', textAlign: 'right', width: '140px' }}>Total Value</th>
                          </tr>
                        </thead>
                        <tbody>
                          {ledgerModal.productSummary.map((p, pIdx) => (
                            <tr key={pIdx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                              <td style={{ padding: '6px 8px', fontWeight: 600 }}>{p.name}</td>
                              <td style={{ padding: '6px 8px', textAlign: 'center', fontWeight: 700 }}>
                                {(p.saleQty + p.purchaseQty).toFixed(2)}
                              </td>
                              <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 600 }}>
                                {business?.currency} {(p.saleAmount + p.purchaseAmount).toFixed(2)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* ── Receipt Totals Bar & Note / Signature Section ── */}
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'flex-start',
                      marginTop: 16,
                      paddingTop: 12,
                      borderTop: '1px solid #000',
                      fontFamily: 'Arial, sans-serif',
                    }}
                  >
                    {/* Left: Please Note terms */}
                    <div style={{ maxWidth: '450px', fontSize: 11, color: '#333' }}>
                      <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 4 }}>Please Note</div>
                      <ul style={{ margin: 0, paddingLeft: 16, lineHeight: '1.5' }}>
                        <li>All goods and services are recorded in Khata ledger records.</li>
                        <li>Payments and settled dues are reflected in real-time.</li>
                        <li>Received above items in good order and condition.</li>
                      </ul>
                    </div>

                    {/* Right: Subtotal, Grand Total & Signature */}
                    <div style={{ minWidth: '260px' }}>
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          padding: '3px 0',
                          fontSize: 13,
                        }}
                      >
                        <span style={{ fontWeight: 600 }}>Total Billed:</span>
                        <span style={{ fontWeight: 700 }}>
                          {business?.currency}{' '}
                          {(
                            (ledgerModal.summary?.totalSales || 0) + (ledgerModal.summary?.totalPurchases || 0)
                          ).toFixed(2)}
                        </span>
                      </div>

                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          padding: '3px 0',
                          fontSize: 13,
                        }}
                      >
                        <span style={{ fontWeight: 600 }}>Total Paid:</span>
                        <span style={{ fontWeight: 700, color: '#047857' }}>
                          {business?.currency}{' '}
                          {(
                            (ledgerModal.summary?.totalSalesPaid || 0) + (ledgerModal.summary?.totalPurchasesPaid || 0)
                          ).toFixed(2)}
                        </span>
                      </div>

                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          padding: '6px 10px',
                          background: '#000',
                          color: '#fff',
                          fontWeight: 800,
                          fontSize: 14,
                          marginTop: 6,
                          borderRadius: 3,
                        }}
                      >
                        <span>Grand Balance:</span>
                        <span>
                          {business?.currency} {Math.abs(Number(balances[ledgerModal.contact.id] || 0)).toFixed(2)}
                        </span>
                      </div>

                      {/* Abdul Qayyuam Signature block */}
                      <div style={{ marginTop: 28, textAlign: 'right' }}>
                        <div
                          style={{
                            fontFamily: 'cursive, "Brush Script MT", Georgia, serif',
                            fontSize: 22,
                            fontWeight: 700,
                            color: '#000',
                          }}
                        >
                          Raja Shakeel
                        </div>
                        <div style={{ fontSize: 11, color: '#333', marginTop: 2 }}>
                          Raja Shakeel
                        </div>
                        <div style={{ fontSize: 11, fontWeight: 700, color: '#000' }}>
                          Authorized Signature
                        </div>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Print CSS rule to ensure clean full page printout */}
      <style>{`
        @media print {
          body * {
            visibility: hidden !important;
          }
          .khata-printable-card, .khata-printable-card * {
            visibility: visible !important;
          }
          .khata-printable-card {
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: 100% !important;
            max-width: 100% !important;
            margin: 0 !important;
            padding: 8px !important;
            box-shadow: none !important;
            border: none !important;
            background: #fff !important;
          }
          .no-print {
            display: none !important;
          }
        }
      `}</style>

      {confirmState && (
        <ConfirmDialog
          {...confirmState}
          onClose={() => setConfirmState(null)}
        />
      )}
    </AppLayout>
  );
}
