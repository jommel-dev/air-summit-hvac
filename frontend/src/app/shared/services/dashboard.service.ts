import { Injectable } from '@angular/core';
import { apiClient } from './api-client';

export type DashboardTrend = 'up' | 'down';

export interface DashboardKpiCard {
  label: string;
  value: string;
  change: string;
  trend: DashboardTrend;
}

export interface DashboardOpsItem {
  label: string;
  value: string;
  hint: string;
  level: 'normal' | 'warning' | 'critical';
}

export interface DashboardMarginItem {
  label: string;
  margin: number;
}

export interface DashboardActivityItem {
  time: string;
  text: string;
  status: 'received' | 'dispatch' | 'install' | 'payment';
}

export interface DashboardOverview {
  generatedAt: string;
  topKpis: DashboardKpiCard[];
  operations: DashboardOpsItem[];
  salesSummary: DashboardKpiCard[];
  topCustomers: Array<{ name: string; orders: number; balance: string }>;
  topCapacities: Array<{ label: string; units: number; sellThrough: number }>;
  marginByBrand: DashboardMarginItem[];
  marginByVendor: DashboardMarginItem[];
  activityFeed: DashboardActivityItem[];
  todayFocus: string;
}

interface DashboardOverviewResponse {
  success: boolean;
  message?: string;
  item?: DashboardOverview;
}

@Injectable({ providedIn: 'root' })
export class DashboardService {
  async getOverview(): Promise<DashboardOverview> {
    const response = await apiClient.get<DashboardOverviewResponse>('/dashboard/overview');

    if (!response.data.success || !response.data.item) {
      throw new Error(response.data.message ?? 'Unable to load dashboard overview');
    }

    return response.data.item;
  }
}
