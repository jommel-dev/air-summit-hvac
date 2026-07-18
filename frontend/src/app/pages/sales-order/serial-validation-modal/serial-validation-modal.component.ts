import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { formatReadableUnitTypeLabel } from '../../../shared/utils/serial-scan-errors';

/**
 * The four modal modes corresponding to validation warning types.
 */
export type SerialValidationModalMode =
  | 'mismatch-warning'
  | 'defective-warning'
  | 'reassignment-warning'
  | 'force-insert-prompt'
  | 'unit-type-mismatch';

/**
 * Contextual details displayed in the modal, populated from the backend response.
 */
export interface SerialValidationDetails {
  /** For mismatch warnings */
  expectedProductName?: string;
  expectedCapacityName?: string;
  actualProductName?: string;
  actualCapacityName?: string;
  /** For reassignment warnings */
  currentCustomerName?: string;
  currentSoNumber?: string;
  currentSalesId?: number;
  /** For unit type mismatch */
  expectedUnitType?: string;
  actualUnitType?: string;
  /** Generic */
  serialNumber?: string;
}

/**
 * Reusable serial validation warning modal following the SalesGuardDialogMode pattern.
 * Supports four modes: mismatch-warning, defective-warning, reassignment-warning, force-insert-prompt.
 */
@Component({
  selector: 'app-serial-validation-modal',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './serial-validation-modal.component.html',
})
export class SerialValidationModalComponent {
  /** The current validation status / mode determining which content to display. */
  @Input() validationStatus: SerialValidationModalMode | null = null;

  /** Contextual details from the backend scan response. */
  @Input() details: SerialValidationDetails = {};

  /** Whether the modal is visible. */
  @Input() isOpen = false;

  /** Emitted when the user confirms the action (force-assign, force-insert, force-reassign). */
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
    switch (this.validationStatus) {
      case 'mismatch-warning':
        return 'Product / Capacity Mismatch';
      case 'defective-warning':
        return 'Defective Serial Detected';
      case 'reassignment-warning':
        return 'Serial Already Assigned';
      case 'force-insert-prompt':
        return 'Serial Not Found';
      case 'unit-type-mismatch':
        return 'Wrong Unit Type Scanned';
      default:
        return 'Validation Warning';
    }
  }

  getHeaderLabel(): string {
    switch (this.validationStatus) {
      case 'mismatch-warning':
        return 'Mismatch Warning';
      case 'defective-warning':
        return 'Defective Warning';
      case 'reassignment-warning':
        return 'Reassignment Warning';
      case 'force-insert-prompt':
        return 'Force Insert';
      case 'unit-type-mismatch':
        return 'Unit Type Mismatch';
      default:
        return 'Serial Validation';
    }
  }

  getMessage(): string {
    switch (this.validationStatus) {
      case 'mismatch-warning':
        return 'The scanned serial belongs to a different product or capacity than the current SO line item. This serial cannot be assigned here.';
      case 'defective-warning':
        return 'This serial number is marked as defective. Proceeding will assign a defective unit to this sales order.';
      case 'reassignment-warning':
        return 'This serial is currently assigned to another customer/sales order. Force reassigning will remove it from the other order.';
      case 'force-insert-prompt':
        return 'This serial number does not exist in the database. You can create a new record and assign it to the current sales order.';
      case 'unit-type-mismatch':
        return this.getUnitTypeMismatchMessage();
      default:
        return '';
    }
  }

  getConfirmText(): string {
    switch (this.validationStatus) {
      case 'mismatch-warning':
        return 'Confirm Scan';
      case 'defective-warning':
        return 'Confirm Scan';
      case 'reassignment-warning':
        return 'Force Reassign';
      case 'force-insert-prompt':
        return 'Create & Assign';
      case 'unit-type-mismatch':
        return 'Correct Unit Type';
      default:
        return 'Confirm';
    }
  }

  getCancelText(): string {
    if (this.validationStatus === 'mismatch-warning' || this.validationStatus === 'unit-type-mismatch') {
      return 'Dismiss';
    }
    return 'Cancel';
  }

  formatUnitTypeLabel(value: string | undefined): string {
    return formatReadableUnitTypeLabel(value);
  }

  private getUnitTypeMismatchMessage(): string {
    const expectedLabel = formatReadableUnitTypeLabel(this.details.expectedUnitType);
    const actualLabel = formatReadableUnitTypeLabel(this.details.actualUnitType);
    const serialPart = this.details.serialNumber ? ` "${this.details.serialNumber}"` : '';

    return (
      `You are scanning on the ${expectedLabel} field, but serial${serialPart} is registered as an ${actualLabel} unit. ` +
      `You can update the serial record to ${expectedLabel}, or dismiss and scan the correct serial instead.`
    );
  }

  getConfirmButtonClasses(): string {
    if (this.validationStatus === 'defective-warning' || this.validationStatus === 'reassignment-warning') {
      return 'rounded-lg border border-error-300 bg-error-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-error-600 dark:border-error-500/50 dark:bg-error-500 dark:hover:bg-error-600';
    }
    return 'rounded-lg border border-brand-300 bg-brand-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-600 dark:border-brand-500/50 dark:bg-brand-500 dark:hover:bg-brand-600';
  }

  getAlertClasses(): string {
    switch (this.validationStatus) {
      case 'mismatch-warning':
        return 'rounded-2xl border border-amber-200 bg-amber-50/80 px-4 py-3 text-sm text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-100';
      case 'defective-warning':
        return 'rounded-2xl border border-rose-200 bg-rose-50/80 px-4 py-3 text-sm text-rose-800 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-100';
      case 'reassignment-warning':
        return 'rounded-2xl border border-rose-200 bg-rose-50/80 px-4 py-3 text-sm text-rose-800 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-100';
      case 'force-insert-prompt':
        return 'rounded-2xl border border-sky-200 bg-sky-50/80 px-4 py-3 text-sm text-sky-800 dark:border-sky-500/20 dark:bg-sky-500/10 dark:text-sky-100';
      case 'unit-type-mismatch':
        return 'rounded-2xl border border-amber-200 bg-amber-50/80 px-4 py-3 text-sm text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-100';
      default:
        return 'rounded-2xl border border-gray-200 bg-gray-50/80 px-4 py-3 text-sm text-gray-800 dark:border-gray-500/20 dark:bg-gray-500/10 dark:text-gray-100';
    }
  }

  getHeaderGradientClasses(): string {
    switch (this.validationStatus) {
      case 'mismatch-warning':
        return 'border-b border-gray-200 bg-linear-to-r from-amber-50 via-white to-orange-50 px-6 py-5 dark:border-gray-800 dark:from-amber-500/10 dark:via-gray-900 dark:to-orange-500/10';
      case 'defective-warning':
        return 'border-b border-gray-200 bg-linear-to-r from-rose-50 via-white to-pink-50 px-6 py-5 dark:border-gray-800 dark:from-rose-500/10 dark:via-gray-900 dark:to-pink-500/10';
      case 'reassignment-warning':
        return 'border-b border-gray-200 bg-linear-to-r from-rose-50 via-white to-amber-50 px-6 py-5 dark:border-gray-800 dark:from-rose-500/10 dark:via-gray-900 dark:to-amber-500/10';
      case 'force-insert-prompt':
        return 'border-b border-gray-200 bg-linear-to-r from-sky-50 via-white to-indigo-50 px-6 py-5 dark:border-gray-800 dark:from-sky-500/10 dark:via-gray-900 dark:to-indigo-500/10';
      case 'unit-type-mismatch':
        return 'border-b border-gray-200 bg-linear-to-r from-amber-50 via-white to-orange-50 px-6 py-5 dark:border-gray-800 dark:from-amber-500/10 dark:via-gray-900 dark:to-orange-500/10';
      default:
        return 'border-b border-gray-200 bg-linear-to-r from-amber-50 via-white to-sky-50 px-6 py-5 dark:border-gray-800 dark:from-amber-500/10 dark:via-gray-900 dark:to-sky-500/10';
    }
  }

  getHeaderLabelClasses(): string {
    switch (this.validationStatus) {
      case 'mismatch-warning':
        return 'text-[11px] font-semibold uppercase tracking-[0.22em] text-amber-700 dark:text-amber-300';
      case 'defective-warning':
        return 'text-[11px] font-semibold uppercase tracking-[0.22em] text-rose-700 dark:text-rose-300';
      case 'reassignment-warning':
        return 'text-[11px] font-semibold uppercase tracking-[0.22em] text-rose-700 dark:text-rose-300';
      case 'force-insert-prompt':
        return 'text-[11px] font-semibold uppercase tracking-[0.22em] text-sky-700 dark:text-sky-300';
      case 'unit-type-mismatch':
        return 'text-[11px] font-semibold uppercase tracking-[0.22em] text-amber-700 dark:text-amber-300';
      default:
        return 'text-[11px] font-semibold uppercase tracking-[0.22em] text-amber-700 dark:text-amber-300';
    }
  }
}
