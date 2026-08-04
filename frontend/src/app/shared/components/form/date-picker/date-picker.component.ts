
import { Component, Input, Output, EventEmitter, ElementRef, ViewChild } from '@angular/core';
import flatpickr from 'flatpickr';
import 'flatpickr/dist/flatpickr.css';
import { LabelComponent } from '../label/label.component';

@Component({
  selector: 'app-date-picker',
  imports: [LabelComponent],
  templateUrl: './date-picker.component.html',
  styles: ``
})
export class DatePickerComponent {

  @Input() id!: string;
  @Input() mode: 'single' | 'multiple' | 'range' | 'time' = 'single';
  @Input() defaultDate?: string | Date | string[] | Date[];
  @Input() label?: string;
  @Input() placeholder?: string;
  /** When true, calendar is always shown inline. When false, opens as a popup. */
  @Input() staticCalendar = true;
  @Output() dateChange = new EventEmitter<any>();

  @ViewChild('dateInput', { static: false }) dateInput!: ElementRef<HTMLInputElement>;

  private flatpickrInstance: flatpickr.Instance | undefined;

  ngAfterViewInit() {
    this.flatpickrInstance = flatpickr(this.dateInput.nativeElement, {
      mode: this.mode,
      static: this.staticCalendar,
      monthSelectorType: 'static',
      dateFormat: 'Y-m-d',
      defaultDate: this.defaultDate,
      onChange: (selectedDates, dateStr, instance) => {
        this.dateChange.emit({ selectedDates, dateStr, instance });
      }
    });
  }

  clear(): void {
    this.flatpickrInstance?.clear(true);
  }

  ngOnDestroy() {
    if (this.flatpickrInstance) {
      this.flatpickrInstance.destroy();
    }
  }
}
