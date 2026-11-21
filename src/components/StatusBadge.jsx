/**
 * StatusBadge — maps a status string to the right .badge-* class.
 *
 * Usage:
 *   <StatusBadge status="active" />
 *   <StatusBadge status="paid" />
 *   <StatusBadge status="overdue" />
 *
 * Extend the STATUS_MAP below to add new statuses without touching pages.
 * This is a PURE DISPLAY component — no logic, no data fetching.
 */

const STATUS_MAP = {
  // Active / Inactive
  active:    { label: 'Active',    cls: 'badge-success' },
  inactive:  { label: 'Inactive',  cls: 'badge-danger'  },

  // Sale / Purchase statuses
  completed:   { label: 'Completed',   cls: 'badge-success' },
  pending:     { label: 'Pending',     cls: 'badge-warning' },
  draft:       { label: 'Draft',       cls: 'badge-info'    },
  cancelled:   { label: 'Cancelled',   cls: 'badge-danger'  },
  received:    { label: 'Received',    cls: 'badge-success' },
  partial:     { label: 'Partial',     cls: 'badge-warning' },
  ordered:     { label: 'Ordered',     cls: 'badge-info'    },
  returned:    { label: 'Returned',    cls: 'badge-danger'  },

  // Payment statuses
  paid:        { label: 'Paid',        cls: 'badge-success' },
  unpaid:      { label: 'Unpaid',      cls: 'badge-danger'  },
  overdue:     { label: 'Overdue',     cls: 'badge-danger'  },
  'partially paid': { label: 'Partially Paid', cls: 'badge-warning' },

  // Expense statuses
  approved:    { label: 'Approved',    cls: 'badge-success' },
  rejected:    { label: 'Rejected',    cls: 'badge-danger'  },
};

export default function StatusBadge({ status, label: labelOverride }) {
  if (!status) return null;

  const key = String(status).toLowerCase();
  const config = STATUS_MAP[key];

  const label = labelOverride ?? (config?.label ?? (status.charAt(0).toUpperCase() + status.slice(1)));
  const cls   = config?.cls ?? 'badge-info';

  return (
    <span className={`badge ${cls}`}>
      {label}
    </span>
  );
}
