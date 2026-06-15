import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';

export type BackupConfirmMode = 'create' | 'delete';

@Component({
  selector: 'app-backup-confirm-modal',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './backup-confirm-modal.component.html',
})
export class BackupConfirmModalComponent {
  /** Whether the modal is visible. */
  @Input() isOpen = false;

  /** The mode: 'create' for backup creation, 'delete' for backup deletion. */
  @Input() mode: BackupConfirmMode = 'create';

  /** The backup type label to display in the modal body. */
  @Input() backupTypeLabel = '';

  /** The file name for delete mode. */
  @Input() fileName = '';

  /** Emitted when the user confirms the action. */
  @Output() confirm = new EventEmitter<void>();

  /** Emitted when the user cancels / dismisses the modal. */
  @Output() cancel = new EventEmitter<void>();

  onConfirm(): void {
    this.confirm.emit();
  }

  onCancel(): void {
    this.cancel.emit();
  }

  getTitle(): string {
    return this.mode === 'create' ? 'Create Database Backup' : 'Delete Backup';
  }

  getHeaderLabel(): string {
    return this.mode === 'create' ? 'Confirm Backup' : 'Confirm Deletion';
  }

  getMessage(): string {
    if (this.mode === 'create') {
      return `You are about to create a database backup (${this.backupTypeLabel}). This may take a moment depending on the database size.`;
    }
    return `You are about to permanently delete this backup record and its associated file. This action cannot be undone.`;
  }

  getConfirmText(): string {
    return this.mode === 'create' ? 'Create Backup' : 'Delete Backup';
  }

  getConfirmButtonClasses(): string {
    if (this.mode === 'delete') {
      return 'rounded-lg border border-error-300 bg-error-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-error-600 dark:border-error-500/50 dark:bg-error-500 dark:hover:bg-error-600';
    }
    return 'rounded-lg border border-brand-300 bg-brand-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-600 dark:border-brand-500/50 dark:bg-brand-500 dark:hover:bg-brand-600';
  }

  getHeaderGradientClasses(): string {
    if (this.mode === 'delete') {
      return 'border-b border-gray-200 bg-linear-to-r from-rose-50 via-white to-pink-50 px-6 py-5 dark:border-gray-800 dark:from-rose-500/10 dark:via-gray-900 dark:to-pink-500/10';
    }
    return 'border-b border-gray-200 bg-linear-to-r from-sky-50 via-white to-indigo-50 px-6 py-5 dark:border-gray-800 dark:from-sky-500/10 dark:via-gray-900 dark:to-indigo-500/10';
  }

  getHeaderLabelClasses(): string {
    if (this.mode === 'delete') {
      return 'text-[11px] font-semibold uppercase tracking-[0.22em] text-rose-700 dark:text-rose-300';
    }
    return 'text-[11px] font-semibold uppercase tracking-[0.22em] text-sky-700 dark:text-sky-300';
  }

  getAlertClasses(): string {
    if (this.mode === 'delete') {
      return 'rounded-2xl border border-rose-200 bg-rose-50/80 px-4 py-3 text-sm text-rose-800 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-100';
    }
    return 'rounded-2xl border border-sky-200 bg-sky-50/80 px-4 py-3 text-sm text-sky-800 dark:border-sky-500/20 dark:bg-sky-500/10 dark:text-sky-100';
  }

  getIconClasses(): string {
    if (this.mode === 'delete') {
      return 'h-5 w-5 shrink-0 text-rose-500';
    }
    return 'h-5 w-5 shrink-0 text-sky-500';
  }
}
