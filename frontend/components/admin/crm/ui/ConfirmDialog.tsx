'use client';

import * as React from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from './Button';

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Consequence copy — say exactly what happens and whether it is reversible. */
  description: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** `danger` for destructive/financial actions; `trust` for compliance actions. */
  variant?: 'primary' | 'danger' | 'trust';
  /** When set, a reason textarea is required before confirm enables. */
  requireReason?: boolean;
  reasonMinLength?: number;
  reasonPlaceholder?: string;
  /** Await-able — the dialog shows a busy state and closes on resolve. A throw keeps it open. */
  onConfirm: (reason: string) => void | Promise<void>;
  'data-testid'?: string;
}

/**
 * Kit confirmation dialog for irreversible / financial / bulk actions.
 * Human-in-the-loop contract: explicit consequence copy, optional required
 * reason (forwarded to the audit trail), busy state while the action runs.
 * Composes the Radix a11y contract from components/ui/dialog.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'primary',
  requireReason = false,
  reasonMinLength = 10,
  reasonPlaceholder = 'Reason (recorded in the audit log)…',
  onConfirm,
  'data-testid': testId,
}: ConfirmDialogProps) {
  const [reason, setReason] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const reasonOk = !requireReason || reason.trim().length >= reasonMinLength;

  // Reset transient state whenever the dialog is (re)opened.
  React.useEffect(() => {
    if (open) {
      setReason('');
      setBusy(false);
    }
  }, [open]);

  async function handleConfirm() {
    if (!reasonOk || busy) return;
    setBusy(true);
    try {
      await onConfirm(reason.trim());
      onOpenChange(false);
    } catch {
      // The caller surfaces its own error (toast/inline); keep the dialog open.
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="max-w-md" data-testid={testId}>
        <div className="flex items-start gap-3">
          {variant === 'danger' && (
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--crm-danger-subtle)]">
              <AlertTriangle className="h-4 w-4 text-[var(--crm-danger)]" aria-hidden />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-[15px] font-semibold text-[var(--crm-text-primary)]">
              {title}
            </DialogTitle>
            <DialogDescription className="mt-1 text-[13px] leading-relaxed text-[var(--crm-text-secondary)]">
              {description}
            </DialogDescription>
          </div>
        </div>

        {requireReason && (
          <div className="mt-4">
            <label
              htmlFor="confirm-dialog-reason"
              className="mb-1 block text-[12px] font-medium text-[var(--crm-text-secondary)]"
            >
              Reason <span aria-hidden>*</span>
            </label>
            <textarea
              id="confirm-dialog-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={reasonPlaceholder}
              rows={3}
              disabled={busy}
              data-testid={testId ? `${testId}-reason` : undefined}
              className="w-full rounded-[var(--crm-radius-sm)] border border-[var(--crm-border-strong)] bg-[var(--crm-bg-primary)] px-2.5 py-2 text-[13px] text-[var(--crm-text-primary)] outline-none placeholder:text-[var(--crm-text-tertiary)] focus-visible:ring-2 focus-visible:ring-[var(--crm-ring)] disabled:opacity-50"
            />
            {requireReason && reason.trim().length > 0 && !reasonOk && (
              <p className="mt-1 text-[12px] text-[var(--crm-danger)]">
                Please provide at least {reasonMinLength} characters.
              </p>
            )}
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <Button
            variant="secondary"
            onClick={() => onOpenChange(false)}
            disabled={busy}
            data-testid={testId ? `${testId}-cancel` : undefined}
          >
            {cancelLabel}
          </Button>
          <Button
            variant={variant === 'primary' ? 'primary' : variant}
            onClick={handleConfirm}
            disabled={!reasonOk || busy}
            data-testid={testId ? `${testId}-confirm` : undefined}
          >
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
            {confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
