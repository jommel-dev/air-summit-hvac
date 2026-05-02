
import { Component, Input, Output, EventEmitter, ElementRef, ViewChild } from '@angular/core';
import flatpickr from 'flatpickr';
import { LabelComponent } from '../label/label.component';
import "flatpickr/dist/flatpickr.css";

@Component({
  selector: 'app-date-picker',
  imports: [LabelComponent],
  templateUrl: './date-picker.component.html',
  styles: [`
    :host ::ng-deep .flatpickr-calendar {
      position: static !important;
      width: 100% !important;
      max-width: 100% !important;
      box-shadow: none !important;
      border: 1px solid #e5e7eb !important;
      border-radius: 0.5rem !important;
      margin-top: 0.5rem;
    }
    :host ::ng-deep .flatpickr-calendar.hasWeeks {
      width: 100% !important;
    }
    :host ::ng-deep .flatpickr-months {
      padding: 0.75rem !important;
    }
    :host ::ng-deep .flatpickr-prev-month,
    :host ::ng-deep .flatpickr-next-month {
      padding: 0.5rem !important;
    }
    :host ::ng-deep .flatpickr-day {
      padding: 0.5rem !important;
      font-size: 0.875rem;
    }
    :host ::ng-deep .flatpickr-day.selected {
      background: #3b82f6 !important;
      border-color: #3b82f6 !important;
    }
    :host ::ng-deep .flatpickr-day:hover {
      background: #dbeafe !important;
      border-color: #dbeafe !important;
    }
  `]
})
export class DatePickerComponent {

  @Input() id!: string;
  @Input() mode: 'single' | 'multiple' | 'range' | 'time' = 'single';
  @Input() defaultDate?: string | Date | string[] | Date[];
  @Input() label?: string;
  @Input() placeholder?: string;
  @Input() minDate?: string | Date;
  @Output() dateChange = new EventEmitter<any>();

  @ViewChild('dateInput', { static: false }) dateInput!: ElementRef<HTMLInputElement>;
  @ViewChild('calendarWrapper', { static: false }) calendarWrapper!: ElementRef<HTMLDivElement>;

  private flatpickrInstance: flatpickr.Instance | undefined;

  ngAfterViewInit() {
    this.flatpickrInstance = flatpickr(this.dateInput.nativeElement, {
      mode: this.mode,
      monthSelectorType: 'static',
      dateFormat: 'Y-m-d',
      defaultDate: this.defaultDate,
      minDate: this.minDate,
      appendTo: this.calendarWrapper.nativeElement,
      disableMobile: true,
      onChange: (selectedDates, dateStr, instance) => {
        this.dateChange.emit({ selectedDates, dateStr, instance });
      }
    });
  }

  ngOnDestroy() {
    if (this.flatpickrInstance) {
      this.flatpickrInstance.destroy();
    }
  }
}

