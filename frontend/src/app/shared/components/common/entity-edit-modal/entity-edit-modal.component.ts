import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ModalComponent } from '../../ui/modal/modal.component';

export type EntityEditFieldType = 'text' | 'number' | 'textarea';

export interface EntityEditFieldConfig {
  key: string;
  label: string;
  type?: EntityEditFieldType;
  placeholder?: string;
  required?: boolean;
  min?: number;
  step?: number;
  helpText?: string;
}

@Component({
  selector: 'app-entity-edit-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, ModalComponent],
  templateUrl: './entity-edit-modal.component.html',
})
export class EntityEditModalComponent implements OnChanges {
  @Input() isOpen = false;
  @Input() title = 'Edit Details';
  @Input() description = '';
  @Input() fields: EntityEditFieldConfig[] = [];
  @Input() initialValues: Record<string, unknown> = {};
  @Input() submitLabel = 'Save Changes';
  @Input() cancelLabel = 'Cancel';
  @Input() isSubmitting = false;

  @Output() close = new EventEmitter<void>();
  @Output() save = new EventEmitter<Record<string, unknown>>();

  formValues: Record<string, string> = {};
  formError = '';

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['initialValues'] || (changes['isOpen'] && this.isOpen)) {
      this.syncFormValues();
      this.formError = '';
    }
  }

  onClose(): void {
    if (this.isSubmitting) {
      return;
    }

    this.formError = '';
    this.close.emit();
  }

  onSubmit(): void {
    if (this.isSubmitting) {
      return;
    }

    this.formError = '';

    for (const field of this.fields) {
      const currentValue = String(this.formValues[field.key] ?? '').trim();
      if (field.required && !currentValue) {
        this.formError = `${field.label} is required`;
        return;
      }
    }

    const payload: Record<string, unknown> = {};
    for (const field of this.fields) {
      const rawValue = String(this.formValues[field.key] ?? '').trim();
      const normalizedType = field.type ?? 'text';

      if (normalizedType === 'number') {
        payload[field.key] = rawValue === '' ? null : Number(rawValue);
        continue;
      }

      payload[field.key] = rawValue;
    }

    this.save.emit(payload);
  }

  private syncFormValues(): void {
    this.formValues = this.fields.reduce<Record<string, string>>((accumulator, field) => {
      const value = this.initialValues[field.key];
      accumulator[field.key] = value === null || value === undefined ? '' : String(value);
      return accumulator;
    }, {});
  }
}
