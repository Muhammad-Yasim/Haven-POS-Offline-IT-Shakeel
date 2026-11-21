import './FilterToolbar.css';

/**
 * FilterToolbar — standardized toolbar for list pages.
 *
 * Uses .list-toolbar styling already defined in index.css.
 * PURE LAYOUT: wraps children in a flex row with consistent
 * spacing, padding and border. All filter logic stays in the page.
 *
 * Usage:
 *   <FilterToolbar>
 *     <DataSearchBar query={search.query} setQuery={search.setQuery} clearSearch={search.clearSearch} placeholder="Search..." />
 *
 *     <select className="filter-select" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
 *       <option value="">All Statuses</option>
 *       <option value="active">Active</option>
 *       <option value="inactive">Inactive</option>
 *     </select>
 *
 *     <button className="btn btn-secondary btn-sm">Filters</button>
 *   </FilterToolbar>
 *
 * The .filter-select class (from ReportFilters.css) gives selects a
 * consistent height and border to match the search bar.
 */
export default function FilterToolbar({ children, className = '' }) {
  return (
    <div className={`list-toolbar filter-toolbar no-print ${className}`}>
      {children}
    </div>
  );
}
