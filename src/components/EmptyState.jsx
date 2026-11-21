/**
 * EmptyState — consistent empty / no-results message for tables.
 *
 * Renders as a full-width <tr><td> for use directly inside <tbody>.
 *
 * Usage inside a <tbody>:
 *   <EmptyState colSpan={6} message="No products yet." />
 *   <EmptyState colSpan={6} message="No matching results." filtered />
 *
 * Or outside a table (standalone card):
 *   <EmptyState standalone message="Nothing here." />
 */
import './EmptyState.css';

export default function EmptyState({
  message  = 'No data yet.',
  filtered = false,
  colSpan  = 1,
  standalone = false,
}) {
  const content = (
    <div className="empty-state">
      <span className="empty-state-icon" aria-hidden="true">
        {filtered ? '🔍' : '📋'}
      </span>
      <p className="empty-state-message">{message}</p>
      {filtered && (
        <p className="empty-state-hint">Try adjusting your search or filters.</p>
      )}
    </div>
  );

  if (standalone) {
    return <div className="empty-state-wrapper">{content}</div>;
  }

  return (
    <tr>
      <td colSpan={colSpan} className="table-empty">
        {content}
      </td>
    </tr>
  );
}
