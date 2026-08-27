import { Component, input, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import axios from 'axios';
import { API_BASE_URL as API_BASE } from '../../core/config/api-base';

export interface SerialEvent {
  id: number;
  eventType: string;
  previousStatus: string | null;
  newStatus: string | null;
  previousPurchaseId: number | null;
  newPurchaseId: number | null;
  previousSalesId: number | null;
  newSalesId: number | null;
  previousBranchId: number | null;
  newBranchId: number | null;
  performedByUsername: string | null;
  reason: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

@Component({
  selector: 'app-serial-history',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './serial-history.component.html',
})
export class SerialHistoryComponent implements OnInit {
  serialId = input<number | null>(null);
  serialNumber = input<string | null>(null);

  events = signal<SerialEvent[]>([]);
  loading = signal<boolean>(false);
  error = signal<string>('');
  searchQuery = signal<string>('');

  private getAuthHeaders(): Record<string, string> {
    const token = localStorage.getItem('token');
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  ngOnInit() {
    if (this.serialId() || this.serialNumber()) {
      this.loadHistory();
    }
  }

  async loadHistory(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    this.events.set([]);

    try {
      let response;
      const headers = this.getAuthHeaders();

      if (this.serialId()) {
        response = await axios.get(
          `${API_BASE}/serial-numbers/${this.serialId()}/history`,
          { headers }
        );
      } else if (this.serialNumber()) {
        response = await axios.get(
          `${API_BASE}/serial-numbers/search-history`,
          { params: { serialNumber: this.serialNumber() }, headers }
        );
      } else {
        this.loading.set(false);
        return;
      }

      if (response.data.success) {
        this.events.set(response.data.items ?? []);
      } else {
        this.error.set(response.data.message ?? 'Failed to load history.');
      }
    } catch (err: any) {
      this.error.set(
        err?.response?.data?.message ?? 'Failed to load serial number history. Please try again.'
      );
    } finally {
      this.loading.set(false);
    }
  }

  async searchBySerial(): Promise<void> {
    const query = this.searchQuery().trim();
    if (!query) return;

    this.loading.set(true);
    this.error.set('');
    this.events.set([]);

    try {
      const headers = this.getAuthHeaders();
      const response = await axios.get(
        `${API_BASE}/serial-numbers/search-history`,
        { params: { serialNumber: query }, headers }
      );

      if (response.data.success) {
        this.events.set(response.data.items ?? []);
      } else {
        this.error.set(response.data.message ?? 'Failed to search history.');
      }
    } catch (err: any) {
      this.error.set(
        err?.response?.data?.message ?? 'Failed to search serial number history. Please try again.'
      );
    } finally {
      this.loading.set(false);
    }
  }

  getEventBadgeClasses(eventType: string): string {
    const colorMap: Record<string, string> = {
      'SCANNED_IN_PO': 'bg-green-100 text-green-800',
      'REMOVED_FROM_PO': 'bg-red-100 text-red-800',
      'ASSIGNED_TO_SO': 'bg-blue-100 text-blue-800',
      'REMOVED_FROM_SO': 'bg-orange-100 text-orange-800',
      'TRANSFERRED': 'bg-purple-100 text-purple-800',
      'DELIVERED': 'bg-green-100 text-green-800',
      'RETURNED': 'bg-yellow-100 text-yellow-800',
      'MARKED_DEFECTIVE': 'bg-red-100 text-red-800',
      'STATUS_CHANGED': 'bg-gray-100 text-gray-800',
      'BRANCH_CHANGED': 'bg-indigo-100 text-indigo-800',
      'CUSTOMER_CHANGED': 'bg-teal-100 text-teal-800',
    };
    return colorMap[eventType] ?? 'bg-gray-100 text-gray-800';
  }

  getEventDotClasses(eventType: string): string {
    const colorMap: Record<string, string> = {
      'SCANNED_IN_PO': 'bg-green-500',
      'REMOVED_FROM_PO': 'bg-red-500',
      'ASSIGNED_TO_SO': 'bg-blue-500',
      'REMOVED_FROM_SO': 'bg-orange-500',
      'TRANSFERRED': 'bg-purple-500',
      'DELIVERED': 'bg-green-500',
      'RETURNED': 'bg-yellow-500',
      'MARKED_DEFECTIVE': 'bg-red-500',
      'STATUS_CHANGED': 'bg-gray-500',
      'BRANCH_CHANGED': 'bg-indigo-500',
      'CUSTOMER_CHANGED': 'bg-teal-500',
    };
    return colorMap[eventType] ?? 'bg-gray-500';
  }

  formatEventType(eventType: string): string {
    return eventType.replace(/_/g, ' ');
  }

  formatTimestamp(dateStr: string): string {
    const date = new Date(dateStr);
    return date.toLocaleString();
  }

  getEventContext(event: SerialEvent): string {
    const parts: string[] = [];
    if (event.newPurchaseId) parts.push(`PO #${event.newPurchaseId}`);
    if (event.previousPurchaseId && !event.newPurchaseId) parts.push(`PO #${event.previousPurchaseId}`);
    if (event.newSalesId) parts.push(`SO #${event.newSalesId}`);
    if (event.previousSalesId && !event.newSalesId) parts.push(`SO #${event.previousSalesId}`);
    if (event.previousStatus && event.newStatus) {
      parts.push(`${event.previousStatus} → ${event.newStatus}`);
    }
    return parts.join(' · ');
  }
}
