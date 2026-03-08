import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { NotificationItem, NotificationService } from '../../../services/notification.service';

@Component({
  selector: 'app-notification-toast',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="pointer-events-none fixed right-4 top-4 z-[100300] flex w-full max-w-md flex-col gap-3">
      @for (item of notifications; track item.id) {
        <section
          class="pointer-events-auto rounded-xl border p-4 shadow-lg"
          [ngClass]="getTypeClasses(item.type)"
          role="alert"
          aria-live="polite"
        >
          <div class="flex items-start justify-between gap-3">
            <div>
              <p class="text-sm font-semibold">{{ item.title }}</p>
              <p class="mt-1 text-sm leading-5">{{ item.message }}</p>
            </div>
            <button
              type="button"
              (click)="dismiss(item.id)"
              class="rounded-md border border-current/20 px-2 py-1 text-xs font-medium hover:bg-black/5 dark:hover:bg-white/10"
            >
              Close
            </button>
          </div>
        </section>
      }
    </div>
  `,
})
export class NotificationToastComponent {
  notifications: NotificationItem[] = [];

  constructor(private readonly notificationService: NotificationService) {
    this.notificationService.notifications$.subscribe((items) => {
      this.notifications = items;
    });
  }

  dismiss(id: string): void {
    this.notificationService.dismiss(id);
  }

  getTypeClasses(type: NotificationItem['type']): string {
    if (type === 'success') {
      return 'border-success-300 bg-success-50 text-success-800 dark:border-success-500/30 dark:bg-success-500/10 dark:text-success-300';
    }

    if (type === 'warning') {
      return 'border-warning-300 bg-warning-50 text-warning-800 dark:border-warning-500/30 dark:bg-warning-500/10 dark:text-warning-300';
    }

    if (type === 'info') {
      return 'border-brand-300 bg-brand-50 text-brand-800 dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-brand-300';
    }

    return 'border-error-300 bg-error-50 text-error-800 dark:border-error-500/30 dark:bg-error-500/10 dark:text-error-300';
  }
}
