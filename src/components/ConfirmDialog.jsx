import { useEffect, useRef } from 'react';
import './ConfirmDialog.css';

/**
 * ConfirmDialog — replaces window.confirm() with a branded modal.
 *
 * PURE UI: receives callbacks, executes them. Zero business logic inside.
 *
 * Usage:
 *   const [confirmState, setConfirmState] = useState(null);
 *
 *   // Open:
 *   setConfirmState({
 *     title:   'Delete product?',
 *     message: `"${product.name}" will be permanently deleted.`,
 *     danger:  true,            // red confirm button
 *     onConfirm: () => handleDelete(product),
 *   });
 *
 *   // In JSX:
 *   {confirmState && (
 *     <ConfirmDialog
 *       {...confirmState}
 *       onClose={() => setConfirmState(null)}
 *     />
 *   )}
 *
 * Props:
 *   title       string   — dialog heading
 *   message     string   — body text
 *   confirmText string   — confirm button label (default: "Confirm")
 *   cancelText  string   — cancel button label  (default: "Cancel")
 *   danger      bool     — use .btn-danger for the confirm button
 *   onConfirm   fn       — called when user confirms
 *   onClose     fn       — called when user cancels or closes
 */
export default function ConfirmDialog({
  title       = 'Are you sure?',
  message     = '',
  confirmText = 'Confirm',
  cancelText  = 'Cancel',
  danger      = false,
  onConfirm,
  onClose,
}) {
  const dialogRef = useRef(null);

  // Close on Escape
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  // Auto-focus confirm button for keyboard users
  useEffect(() => {
    dialogRef.current?.querySelector('.confirm-dialog-confirm')?.focus();
  }, []);

  const handleConfirm = () => {
    onConfirm?.();
    onClose?.();
  };

  return (
    <div className="confirm-dialog-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div
        className="confirm-dialog card"
        ref={dialogRef}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="confirm-dialog-body">
          <h3 className="confirm-dialog-title">{title}</h3>
          {message && <p className="confirm-dialog-message">{message}</p>}
        </div>

        <div className="confirm-dialog-footer">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onClose}
          >
            {cancelText}
          </button>
          <button
            type="button"
            className={`btn confirm-dialog-confirm ${danger ? 'btn-danger' : 'btn-primary'}`}
            onClick={handleConfirm}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
