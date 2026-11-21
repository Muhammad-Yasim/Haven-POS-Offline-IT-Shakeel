import { useEffect, useRef } from 'react';
import './TableActions.css';

/**
 * TableActions — standard row-action component.
 *
 * TWO MODES:
 *
 * 1. INLINE (default, 1-2 actions):
 *    <TableActions actions={[{ label: 'Edit', onClick }, { label: 'Delete', danger: true, onClick }]} />
 *
 * 2. DROPDOWN (3+ actions):
 *    <TableActions
 *      dropdown
 *      openId={openActionId}
 *      rowId={row.id}
 *      setOpenId={setOpenActionId}
 *      actions={[{ label: '✏️ Edit', onClick }, ...]}
 *    />
 */
export default function TableActions({
  actions = [],
  dropdown = false,
  openId,
  rowId,
  setOpenId,
}) {
  const ref = useRef(null);
  const isOpen = Boolean(dropdown && openId !== null && openId !== undefined && openId === rowId);

  // Close on outside click ONLY when THIS specific dropdown is open
  useEffect(() => {
    if (!dropdown || !isOpen) return;

    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) {
        setOpenId(null);
      }
    };

    const timer = setTimeout(() => {
      document.addEventListener('click', handler);
    }, 0);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('click', handler);
    };
  }, [dropdown, isOpen, setOpenId]);

  const visible = actions.filter((a) => !a.hidden);

  if (dropdown) {
    return (
      <div
        className="ta-dropdown-wrap"
        ref={ref}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="btn btn-secondary btn-sm ta-dropdown-trigger"
          onClick={(e) => {
            e.stopPropagation();
            setOpenId(isOpen ? null : rowId);
          }}
        >
          Actions ▾
        </button>
        {isOpen && (
          <div className="ta-dropdown-menu">
            {visible.map((action, i) => (
              <button
                key={i}
                type="button"
                className={`ta-dropdown-item${action.danger ? ' ta-dropdown-item--danger' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setOpenId(null);
                  if (typeof action.onClick === 'function') {
                    action.onClick(e);
                  }
                }}
                disabled={!!action.disabled}
              >
                {action.label}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Inline mode
  const buttons = visible.map((action, i) => (
    <button
      key={i}
      type="button"
      className={`btn btn-ghost btn-sm table-action-btn${action.danger ? ' table-action-danger' : ''}`}
      onClick={action.onClick}
      disabled={!!action.disabled}
      title={action.title ?? action.label}
    >
      {action.label}
    </button>
  ));

  return <div className="table-actions-cell">{buttons}</div>;
}
