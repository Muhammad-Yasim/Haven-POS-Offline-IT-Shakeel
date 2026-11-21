import { useEffect, useMemo, useState, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import AppLayout from '../components/AppLayout.jsx';
import Pagination from '../components/Pagination.jsx';
import SortableHeader from '../components/SortableHeader.jsx';
import PrintReportHeader from '../components/PrintReportHeader.jsx';
import { downloadPDF, buildPdfFilename } from '../utils/pdfGenerator.js';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../lib/electronAPI.js';
import DataSearchBar from '../components/DataSearchBar.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import EmptyState from '../components/EmptyState.jsx';
import ConfirmDialog from '../components/ConfirmDialog.jsx';
import TableActions from '../components/TableActions.jsx';

export default function Products() {
  const { business, can, profile } = useAuth();
  const navigate = useNavigate();

  const [rows, setRows] = useState([]);
  const [printRows, setPrintRows] = useState(null);
  const [categories, setCategories] = useState({});
  const [loading, setLoading] = useState(true);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [error, setError] = useState('');
  const [confirmState, setConfirmState] = useState(null);

  // Core filters
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  // Advanced filter panel
  const [filterOpen, setFilterOpen] = useState(false);
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [minStock, setMinStock] = useState('');
  const [maxStock, setMaxStock] = useState('');
  const [lowStockOnly, setLowStockOnly] = useState(false);

  const [sortKey, setSortKey] = useState('created_at');
  const [sortDirection, setSortDirection] = useState('desc');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const itemsPerPage = 50;

  // Print page-scope
  const [printScope, setPrintScope] = useState('current');
  const [printFrom, setPrintFrom] = useState(1);
  const [printTo, setPrintTo] = useState(1);

  const canCreate = profile?.is_owner || can('products', 'create');
  const canEdit = profile?.is_owner || can('products', 'edit');
  const canDelete = profile?.is_owner || can('products', 'delete');

  const totalPages = Math.ceil(totalItems / itemsPerPage);
  const firstItemIndex = (currentPage - 1) * itemsPerPage;
  const lastItemIndex = Math.min(firstItemIndex + itemsPerPage - 1, totalItems - 1);

  // Count active advanced filters
  const advancedCount = [minPrice, maxPrice, minStock, maxStock, lowStockOnly].filter(Boolean).length;

  useEffect(() => { setPrintTo(totalPages || 1); }, [totalPages]);

  // ── Data loaders ─────────────────────────────────────────────────────────────
  const loadCategories = async () => {
    const res = await api.categories.getAll();
    if (res?.data) setCategories(Object.fromEntries(res.data.map(c => [c.id, c.name])));
  };

  const loadProducts = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.products.getAll({
        searchQuery,
        categoryFilter,
        statusFilter,
        minPrice,
        maxPrice,
        minStock,
        maxStock,
        lowStockOnly,
        sortKey,
        sortDirection,
        page: currentPage,
        limit: itemsPerPage,
      });

      if (res?.error) throw new Error(res.error);

      setRows(res.data?.rows || []);
      setTotalItems(res.data?.totalItems || 0);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [searchQuery, categoryFilter, statusFilter, minPrice, maxPrice, minStock, maxStock, lowStockOnly, sortKey, sortDirection, currentPage]);

  useEffect(() => { loadCategories(); }, []);
  useEffect(() => { loadProducts(); }, [loadProducts]);

  // ── Fetch rows for a specific page range (for print/PDF) ──────────────────
  const fetchRangeRows = useCallback(async (fromPage, toPage) => {
    const from = (Math.max(1, fromPage) - 1) * itemsPerPage;
    const to = Math.min(totalPages, toPage) * itemsPerPage;
    const limit = Math.max(0, to - from);

    const res = await api.products.getAll({
      searchQuery,
      categoryFilter,
      statusFilter,
      minPrice,
      maxPrice,
      minStock,
      maxStock,
      lowStockOnly,
      sortKey,
      sortDirection,
      offset: from,
      limit: limit,
    });

    return res?.data?.rows || [];
  }, [searchQuery, categoryFilter, statusFilter, minPrice, maxPrice, minStock, maxStock, lowStockOnly, sortKey, sortDirection, totalPages]);

  // ── Filter change handlers ────────────────────────────────────────────────
  const handleSearch = (e) => { setSearchQuery(e.target.value); setCurrentPage(1); };
  const handleCategoryChange = (e) => { setCategoryFilter(e.target.value); setCurrentPage(1); };
  const handleStatusChange = (e) => { setStatusFilter(e.target.value); setCurrentPage(1); };

  const clearAdvancedFilters = () => {
    setMinPrice(''); setMaxPrice('');
    setMinStock(''); setMaxStock('');
    setLowStockOnly(false);
    setCurrentPage(1);
  };

  const toggleSortKey = (key) => {
    if (sortKey === key) setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDirection('asc'); }
    setCurrentPage(1);
  };

  const handleDelete = async (product) => {
    setError('');
    const res = await api.products.delete(product.id);
    if (res?.error) {
      setError(res.error || `Unable to delete "${product.name}". It may already be used in stock, sales, purchases, or other records.`);
      return;
    }
    loadProducts();
  };

  // ── Active filters for print header ───────────────────────────────────────
  const activeFilters = useMemo(() => {
    const filters = [];
    if (searchQuery.trim()) filters.push({ label: 'Search', value: searchQuery.trim() });
    if (categoryFilter) filters.push({ label: 'Category', value: categories[categoryFilter] || categoryFilter });
    if (statusFilter) filters.push({ label: 'Status', value: statusFilter.charAt(0).toUpperCase() + statusFilter.slice(1) });
    if (minPrice !== '') filters.push({ label: 'Min Price', value: (business?.currency || '') + ' ' + minPrice });
    if (maxPrice !== '') filters.push({ label: 'Max Price', value: (business?.currency || '') + ' ' + maxPrice });
    if (minStock !== '') filters.push({ label: 'Min Stock', value: minStock });
    if (maxStock !== '') filters.push({ label: 'Max Stock', value: maxStock });
    if (lowStockOnly) filters.push({ label: 'Stock Alert', value: 'Low stock only' });
    if (totalPages > 1) {
      if (printScope === 'all') filters.push({ label: 'Pages', value: `All (1-${totalPages})` });
      if (printScope === 'range') filters.push({ label: 'Pages', value: `${printFrom}-${Math.min(printTo, totalPages)} of ${totalPages}` });
      if (printScope === 'current') filters.push({ label: 'Page', value: String(currentPage) });
    }
    return filters;
  }, [searchQuery, categoryFilter, statusFilter, minPrice, maxPrice, minStock, maxStock, lowStockOnly, categories, business, totalPages, printScope, printFrom, printTo, currentPage]);

  // ── Resolve which rows to print, then act ────────────────────────────────
  const resolveAndAct = useCallback(async (action) => {
    setPdfLoading(true);
    try {
      let resolved;
      if (printScope === 'current') {
        resolved = rows;
      } else if (printScope === 'all') {
        resolved = await fetchRangeRows(1, totalPages);
      } else {
        const f = Math.max(1, printFrom);
        const t = Math.min(totalPages, Math.max(f, printTo));
        resolved = await fetchRangeRows(f, t);
      }
      setPrintRows(resolved);
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      await action();
    } finally {
      setPrintRows(null);
      setPdfLoading(false);
    }
  }, [printScope, printFrom, printTo, totalPages, rows, fetchRangeRows]);

  const handlePrint = () => resolveAndAct(async () => window.print());
  const handleSavePDF = () => resolveAndAct(async () => {
    const filterParts = [
      ...activeFilters.filter(f => f.label !== 'Pages' && f.label !== 'Page').map(f => ({ value: f.value })),
      printScope === 'all' ? { value: 'All_Pages' } :
        printScope === 'range' ? { value: `Pages_${printFrom}-${Math.min(printTo, totalPages)}` } :
          { value: `Page_${currentPage}` },
    ];
    await downloadPDF(buildPdfFilename('Products', filterParts));
  });

  const displayRows = printRows !== null ? printRows : rows;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <AppLayout>
      <style>{`
        /* ── Advanced filter panel slide-down ── */
        .products-filter-panel {
          overflow: hidden;
          max-height: 0;
          opacity: 0;
          transition: max-height 0.32s ease, opacity 0.25s ease, margin-bottom 0.32s ease;
          margin-bottom: 0;
        }
        .products-filter-panel.open {
          max-height: 400px;
          opacity: 1;
          margin-bottom: 16px;
        }
        .pf-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(185px, 1fr));
          gap: 14px;
          padding: 18px 20px 14px;
        }
        .pf-field { display: flex; flex-direction: column; gap: 5px; }
        .pf-label {
          font-size: 10.5px; font-weight: 700; text-transform: uppercase;
          letter-spacing: 0.06em; color: var(--navy-500, #2d5f8a);
        }
        .pf-input {
          padding: 7px 10px; font-size: 13px;
          border: 1.5px solid var(--navy-border, #c9d6e3); border-radius: 6px;
          background: var(--card-bg, #fff); color: inherit; outline: none;
          transition: border-color 0.18s, box-shadow 0.18s;
          width: 100%; box-sizing: border-box;
        }
        .pf-input:focus { border-color: var(--navy-500, #2d6fa8); box-shadow: 0 0 0 3px rgba(45,111,168,.12); }
        .pf-toggle-row {
          display: flex; align-items: center; gap: 8px;
          padding: 8px 0; cursor: pointer; user-select: none;
        }
        .pf-toggle-track {
          width: 38px; height: 21px; border-radius: 11px;
          background: var(--navy-border, #c9d6e3);
          position: relative; transition: background 0.22s; flex-shrink: 0;
        }
        .pf-toggle-track.on { background: #22c55e; }
        .pf-toggle-thumb {
          width: 15px; height: 15px; border-radius: 50%; background: #fff;
          position: absolute; top: 3px; left: 3px;
          transition: transform 0.22s; box-shadow: 0 1px 4px rgba(0,0,0,.22);
        }
        .pf-toggle-track.on .pf-toggle-thumb { transform: translateX(17px); }
        .pf-toggle-label { font-size: 13px; font-weight: 500; }
        .pf-footer {
          display: flex; justify-content: space-between; align-items: center;
          padding: 10px 20px 14px;
          border-top: 1px solid var(--navy-border, #e5e7eb);
          margin-top: 2px;
        }
        .pf-status-text { font-size: 12px; color: var(--navy-500, #2d5f8a); font-weight: 600; }
        .filter-badge {
          display: inline-flex; align-items: center; justify-content: center;
          background: #ef4444; color: #fff; font-size: 10px; font-weight: 800;
          border-radius: 10px; min-width: 17px; height: 17px; padding: 0 4px;
          margin-left: 4px; line-height: 1; vertical-align: middle;
        }
        /* ── Print / PDF column hiding ── */
        @media print {
          .products-table .data-table th:nth-child(2),
          .products-table .data-table td:nth-child(2),
          .products-table .data-table th:nth-child(4),
          .products-table .data-table td:nth-child(4),
          .products-table .data-table th:nth-child(8),
          .products-table .data-table td:nth-child(8),
          .products-table .data-table th:nth-child(9),
          .products-table .data-table td:nth-child(9) { display: none !important; }
        }
        .pdf-export-mode .products-table .data-table th:nth-child(2),
        .pdf-export-mode .products-table .data-table td:nth-child(2),
        .pdf-export-mode .products-table .data-table th:nth-child(4),
        .pdf-export-mode .products-table .data-table td:nth-child(4),
        .pdf-export-mode .products-table .data-table th:nth-child(8),
        .pdf-export-mode .products-table .data-table td:nth-child(8),
        .pdf-export-mode .products-table .data-table th:nth-child(9),
        .pdf-export-mode .products-table .data-table td:nth-child(9) { display: none !important; }
      `}</style>

      {/* ── Products List Panel matching Sales & Purchases ── */}
      <div className="card list-panel products-table" id="products-report-content">
        <PrintReportHeader title="Products Catalog" filters={activeFilters} />

        {/* ── Top bar: dark navy header ── */}
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
            Products
          </h1>

          <div style={{ flex: '1 1 220px', minWidth: 0 }}>
            <DataSearchBar
              placeholder="Search by name or SKU"
              query={searchQuery}
              setQuery={setSearchQuery}
              clearSearch={() => { setSearchQuery(''); setCurrentPage(1); }}
            />
          </div>

          <Link
            to="/categories"
            className="btn btn-sm"
            style={{
              whiteSpace: 'nowrap',
              background: 'rgba(255,255,255,0.12)',
              color: '#fff',
              border: '1px solid rgba(255,255,255,0.22)',
            }}
          >
            Categories
          </Link>

          <Link
            to="/tax-rates"
            className="btn btn-sm"
            style={{
              whiteSpace: 'nowrap',
              background: 'rgba(255,255,255,0.12)',
              color: '#fff',
              border: '1px solid rgba(255,255,255,0.22)',
            }}
          >
            Tax rates
          </Link>

          {/* Page-range picker */}
          {totalPages > 1 && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                background: 'rgba(255,255,255,0.12)',
                border: '1px solid rgba(255,255,255,0.22)',
                borderRadius: 6,
                padding: '3px 8px',
                fontSize: 12,
                color: '#fff',
              }}
            >
              <span style={{ fontWeight: 600, color: '#fff', whiteSpace: 'nowrap' }}>
                Pages:
              </span>
              <select
                value={printScope}
                onChange={(e) => setPrintScope(e.target.value)}
                style={{
                  border: 'none',
                  borderRadius: 4,
                  padding: '2px 4px',
                  fontSize: 12,
                  background: 'rgba(255,255,255,0.95)',
                  color: 'var(--navy-800)',
                  cursor: 'pointer',
                }}
              >
                <option value="current">Current ({currentPage})</option>
                <option value="all">All ({totalPages})</option>
                <option value="range">Range</option>
              </select>
              {printScope === 'range' && (
                <>
                  <span style={{ color: 'rgba(255,255,255,0.85)', fontSize: 11 }}>From</span>
                  <input
                    type="number"
                    min={1}
                    max={totalPages}
                    value={printFrom}
                    onChange={(e) =>
                      setPrintFrom(
                        Math.max(1, Math.min(totalPages, Number(e.target.value) || 1))
                      )
                    }
                    style={{
                      width: 36,
                      textAlign: 'center',
                      border: 'none',
                      borderRadius: 4,
                      padding: '2px',
                      fontSize: 12,
                      background: '#fff',
                    }}
                  />
                  <span style={{ color: 'rgba(255,255,255,0.85)', fontSize: 11 }}>to</span>
                  <input
                    type="number"
                    min={printFrom}
                    max={totalPages}
                    value={printTo}
                    onChange={(e) =>
                      setPrintTo(
                        Math.max(
                          printFrom,
                          Math.min(totalPages, Number(e.target.value) || totalPages)
                        )
                      )
                    }
                    style={{
                      width: 36,
                      textAlign: 'center',
                      border: 'none',
                      borderRadius: 4,
                      padding: '2px',
                      fontSize: 12,
                      background: '#fff',
                    }}
                  />
                </>
              )}
            </div>
          )}

          <button
            type="button"
            className="btn btn-sm"
            style={{
              whiteSpace: 'nowrap',
              background: 'rgba(255,255,255,0.12)',
              color: '#fff',
              border: '1px solid rgba(255,255,255,0.22)',
            }}
            onClick={handlePrint}
            disabled={pdfLoading}
            title="Print products list"
          >
            {pdfLoading ? '⏳' : '🖨'} Print
          </button>

          <button
            type="button"
            className="btn btn-sm"
            style={{
              whiteSpace: 'nowrap',
              background: 'rgba(255,255,255,0.12)',
              color: '#fff',
              border: '1px solid rgba(255,255,255,0.22)',
            }}
            onClick={handleSavePDF}
            disabled={pdfLoading}
            title="Save as PDF file"
          >
            {pdfLoading ? '⏳' : '📄'} PDF
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
              onClick={() => navigate('/products/new')}
            >
              + Add Product
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
          <select
            className="filter-select"
            value={categoryFilter}
            onChange={handleCategoryChange}
          >
            <option value="">All Categories</option>
            {Object.entries(categories).map(([id, name]) => (
              <option key={id} value={id}>{name}</option>
            ))}
          </select>

          <select
            className="filter-select"
            value={statusFilter}
            onChange={handleStatusChange}
          >
            <option value="">All Statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>

          {/* Advanced filter toggle */}
          <button
            type="button"
            className={`btn btn-sm ${filterOpen ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setFilterOpen((v) => !v)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              fontSize: 12,
              padding: '5px 10px',
            }}
            title="Toggle advanced filters"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              width="13"
              height="13"
            >
              <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
            </svg>
            {filterOpen ? 'Hide Filters' : 'More Filters'}
            {advancedCount > 0 && (
              <span className="filter-badge">{advancedCount}</span>
            )}
          </button>

          {(searchQuery || categoryFilter || statusFilter || advancedCount > 0) && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              style={{ whiteSpace: 'nowrap', fontSize: 12, padding: '5px 10px' }}
              onClick={() => {
                setSearchQuery('');
                setCategoryFilter('');
                setStatusFilter('');
                clearAdvancedFilters();
                setCurrentPage(1);
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
            Total: {totalItems} {totalItems === 1 ? 'product' : 'products'}
          </div>
        </div>

        {/* ── Advanced Filter Panel (slide-down) ── */}
        <div
          className={`no-print products-filter-panel ${filterOpen ? 'open' : ''}`}
          style={{ borderBottom: '1px solid var(--navy-border)' }}
        >
          <div
            style={{
              padding: '12px 20px 8px',
              borderBottom: '1px solid var(--navy-border, #e5e7eb)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--navy-700, #1e3a5f)' }}>
              Advanced Product Filters
            </span>
            {advancedCount > 0 && (
              <span
                style={{
                  fontSize: 12,
                  background: '#fef3c7',
                  color: '#92400e',
                  borderRadius: 4,
                  padding: '2px 8px',
                  fontWeight: 600,
                }}
              >
                {advancedCount} active
              </span>
            )}
          </div>

          <div className="pf-grid">
            <div className="pf-field">
              <label className="pf-label">Min Selling Price ({business?.currency})</label>
              <input
                className="pf-input"
                type="number"
                min="0"
                step="0.01"
                placeholder="e.g. 10"
                value={minPrice}
                onChange={(e) => { setMinPrice(e.target.value); setCurrentPage(1); }}
              />
            </div>
            <div className="pf-field">
              <label className="pf-label">Max Selling Price ({business?.currency})</label>
              <input
                className="pf-input"
                type="number"
                min="0"
                step="0.01"
                placeholder="e.g. 500"
                value={maxPrice}
                onChange={(e) => { setMaxPrice(e.target.value); setCurrentPage(1); }}
              />
            </div>
            <div className="pf-field">
              <label className="pf-label">Min Stock Qty</label>
              <input
                className="pf-input"
                type="number"
                min="0"
                placeholder="e.g. 0"
                value={minStock}
                onChange={(e) => { setMinStock(e.target.value); setCurrentPage(1); }}
              />
            </div>
            <div className="pf-field">
              <label className="pf-label">Max Stock Qty</label>
              <input
                className="pf-input"
                type="number"
                min="0"
                placeholder="e.g. 100"
                value={maxStock}
                onChange={(e) => { setMaxStock(e.target.value); setCurrentPage(1); }}
              />
            </div>
            <div className="pf-field" style={{ justifyContent: 'flex-end', paddingTop: 4 }}>
              <label className="pf-label">Stock Alert Filter</label>
              <label
                className="pf-toggle-row"
                onClick={() => { setLowStockOnly((v) => !v); setCurrentPage(1); }}
              >
                <div className={`pf-toggle-track ${lowStockOnly ? 'on' : ''}`}>
                  <div className="pf-toggle-thumb" />
                </div>
                <span
                  className="pf-toggle-label"
                  style={{ color: lowStockOnly ? '#ef4444' : 'inherit' }}
                >
                  {lowStockOnly ? '⚠️ Low stock only' : 'All stock levels'}
                </span>
              </label>
            </div>
          </div>

          <div className="pf-footer">
            <span className="pf-status-text">
              {advancedCount === 0
                ? 'No advanced filters applied'
                : `${advancedCount} advanced filter${advancedCount > 1 ? 's' : ''} applied`}
            </span>
            <button
              className="btn btn-ghost btn-sm"
              onClick={clearAdvancedFilters}
              disabled={advancedCount === 0}
            >
              Clear all
            </button>
          </div>
        </div>

        {error && (
          <div className="error-text" style={{ padding: '0 16px 10px' }}>
            {error}
          </div>
        )}

        <div style={{ overflowX: 'auto', paddingBottom: 16 }}>
          <table className="data-table table-compact" style={{ whiteSpace: 'nowrap' }}>
            <thead>
              <tr>
                <SortableHeader label="Product" sortKey="name" currentSortKey={sortKey} sortDirection={sortDirection} toggleSortKey={toggleSortKey} />
                <SortableHeader label="SKU" sortKey="sku" currentSortKey={sortKey} sortDirection={sortDirection} toggleSortKey={toggleSortKey} />
                <SortableHeader label="Current stock" sortKey="current_stock" currentSortKey={sortKey} sortDirection={sortDirection} toggleSortKey={toggleSortKey} />
                <SortableHeader label="Alert quantity" sortKey="alert_quantity" currentSortKey={sortKey} sortDirection={sortDirection} toggleSortKey={toggleSortKey} />
                <SortableHeader label="Category" sortKey="category" currentSortKey={sortKey} sortDirection={sortDirection} toggleSortKey={toggleSortKey} />
                <SortableHeader label="Cost" sortKey="cost_price" currentSortKey={sortKey} sortDirection={sortDirection} toggleSortKey={toggleSortKey} />
                <SortableHeader label="Selling price" sortKey="default_selling_price" currentSortKey={sortKey} sortDirection={sortDirection} toggleSortKey={toggleSortKey} />
                <SortableHeader label="Status" sortKey="status" currentSortKey={sortKey} sortDirection={sortDirection} toggleSortKey={toggleSortKey} />
                <th className="no-print" style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && <EmptyState colSpan={9} message="Loading products…" />}
              {!loading && displayRows.length === 0 && (
                <EmptyState
                  colSpan={9}
                  message={searchQuery || categoryFilter || statusFilter || advancedCount > 0 ? 'No matching products found.' : 'No products yet.'}
                  filtered={Boolean(searchQuery || categoryFilter || statusFilter || advancedCount > 0)}
                />
              )}
              {!loading && displayRows.map((p) => {
                const currentStock = Number(p.current_stock || 0);
                const alertQuantity = Number(p.alert_quantity || 0);
                const isLowStock = p.alert_quantity !== null && p.alert_quantity !== undefined && currentStock <= alertQuantity;
                return (
                  <tr key={p.id}>
                    <td>{p.name}</td>
                    <td>{p.sku}</td>
                    <td><span className={isLowStock ? 'badge badge-danger' : ''}>{currentStock}</span></td>
                    <td>{p.alert_quantity !== null && p.alert_quantity !== undefined ? p.alert_quantity : '—'}</td>
                    <td>{categories[p.category_id] || '—'}</td>
                    <td>{business?.currency} {Number(p.cost_price).toFixed(2)}</td>
                    <td>{business?.currency} {Number(p.default_selling_price).toFixed(2)}</td>
                    <td>
                      <StatusBadge status={p.is_active ? 'active' : 'inactive'} />
                    </td>
                    <td className="table-actions no-print">
                      <TableActions
                        actions={[
                          {
                            label: 'Edit',
                            hidden: !canEdit,
                            onClick: () => navigate(`/products/${p.id}/edit`),
                          },
                          {
                            label: 'Delete',
                            hidden: !canDelete,
                            danger: true,
                            onClick: () => setConfirmState({
                              title: 'Delete product?',
                              message: `"${p.name}" will be permanently deleted.`,
                              confirmText: 'Delete',
                              danger: true,
                              onConfirm: () => handleDelete(p),
                            }),
                          },
                        ]}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {!loading && totalItems > 0 && printRows === null && (
          <div className="no-print">
            <Pagination
              currentPage={currentPage}
              totalPages={totalPages}
              totalItems={totalItems}
              firstItemIndex={firstItemIndex}
              lastItemIndex={lastItemIndex}
              goToPage={setCurrentPage}
              nextPage={() => setCurrentPage((p) => p + 1)}
              previousPage={() => setCurrentPage((p) => p - 1)}
              hasNextPage={currentPage < totalPages}
              hasPreviousPage={currentPage > 1}
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
    </AppLayout>
  );
}