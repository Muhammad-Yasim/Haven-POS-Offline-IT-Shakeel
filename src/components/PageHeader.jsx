/**
 * PageHeader — standard page header layout.
 *
 * Uses the .page-header class already defined in index.css.
 * PURE LAYOUT: no logic inside, no data fetching.
 *
 * Usage:
 *   <PageHeader
 *     title="Products"
 *     subtitle="Catalog for Acme Store"       // optional
 *     actions={                                // optional
 *       <>
 *         <button className="btn btn-secondary">Export</button>
 *         <button className="btn btn-primary">+ Add Product</button>
 *       </>
 *     }
 *   />
 *
 * The subtitle typically shows business name, record count, etc.
 * The actions slot is a flex row — pass any buttons/links directly.
 */
export default function PageHeader({ title, subtitle, actions, className = '' }) {
  return (
    <div className={`page-header no-print ${className}`}>
      <div>
        <h1>{title}</h1>
        {subtitle && (
          <p style={{ margin: '2px 0 0', fontSize: 13, color: 'var(--text-secondary)' }}>
            {subtitle}
          </p>
        )}
      </div>

      {actions && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {actions}
        </div>
      )}
    </div>
  );
}
