import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';

export type NotificationType = 'success' | 'error' | 'warning' | 'info';

export interface NotificationItem {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  durationMs: number;
}

@Injectable({
  providedIn: 'root',
})
export class NotificationService {
  private readonly notificationsSubject = new BehaviorSubject<NotificationItem[]>([]);

  get notifications$(): Observable<NotificationItem[]> {
    return this.notificationsSubject.asObservable();
  }

  success(title: string, message: string, durationMs = 4500): void {
    this.push('success', title, message, durationMs);
  }

  error(title: string, message: string, durationMs = 5500): void {
    this.push('error', title, message, durationMs);
  }

  warning(title: string, message: string, durationMs = 5000): void {
    this.push('warning', title, message, durationMs);
  }

  info(title: string, message: string, durationMs = 4500): void {
    this.push('info', title, message, durationMs);
  }

  dismiss(id: string): void {
    const nextItems = this.notificationsSubject.value.filter((item) => item.id !== id);
    this.notificationsSubject.next(nextItems);
  }

  private push(type: NotificationType, title: string, message: string, durationMs: number): void {
    const id = this.generateId();
    const item: NotificationItem = {
      id,
      type,
      title,
      message,
      durationMs,
    };

    this.notificationsSubject.next([...this.notificationsSubject.value, item]);

    setTimeout(() => {
      this.dismiss(id);
    }, durationMs);
  }

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
}
