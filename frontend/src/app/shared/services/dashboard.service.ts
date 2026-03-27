import { Injectable } from '@angular/core';
import { apiClient } from './api-client';
import { BranchService } from './branch.service';

export type DashboardTrend = 'up' | 'down';
export type DashboardSalesDetailMode = 'sales' | 'unpaid' | 'overdues' | 'cheques';
export type DashboardOperationDetailMode = 'receiving' | 'dispatch' | 'installation' | 'stock-alerts';
export type DashboardSettlementMode = 'partial' | 'full' | 'cheque' | 'split';
export type DashboardReceivableVerificationMode = 'cheque' | 'credit-card';

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
  constructor(private readonly branchService: BranchService) {}

  async getOverview(): Promise<DashboardOverview> {
    const branchId = this.branchService.getActiveBranchId();
    const response = await apiClient.get<DashboardOverviewResponse>('/dashboard/overview', {
      params: branchId ? { branchId } : undefined,
    });

    if (!response.data.success || !response.data.item) {
      throw new Error(response.data.message ?? 'Unable to load dashboard overview');
    }

    return response.data.item;
  }

  async getSalesDetail(
    mode: DashboardSalesDetailMode,
  ): Promise<Array<{ id?: string | number; [key: string]: unknown }>> {
    const branchId = this.branchService.getActiveBranchId();
    const response = await apiClient.get<{
      success: boolean;
      items: Array<{ id?: string | number; [key: string]: unknown }>;
    }>('/dashboard/sales-detail', {
      params: { mode, ...(branchId ? { branchId } : {}) },
    });

    if (!response.data.success) {
      throw new Error('Unable to load sales detail');
    }

    return response.data.items ?? [];
  }

  async getOperationsDetail(
    mode: DashboardOperationDetailMode,
  ): Promise<Array<{ id?: string | number; [key: string]: unknown }>> {
    const branchId = this.branchService.getActiveBranchId();
    const response = await apiClient.get<{
      success: boolean;
      items: Array<{ id?: string | number; [key: string]: unknown }>;
    }>('/dashboard/operations-detail', {
      params: { mode, ...(branchId ? { branchId } : {}) },
    });

    if (!response.data.success) {
      throw new Error('Unable to load operations detail');
    }

    return response.data.items ?? [];
  }

  async settleSalesOrder(payload: {
    salesOrderId: number;
    mode: DashboardSettlementMode;
    amount?: number;
    bankAmount?: number;
    chequeAmount?: number;
    bankName?: string | null;
    checkNo?: string | null;
    postDated?: string | null;
  }): Promise<void> {
    const response = await apiClient.post<{ success: boolean; message?: string }>('/dashboard/settle-sales-order', payload);

    if (!response.data.success) {
      throw new Error(response.data.message ?? 'Unable to settle sales order');
    }
  }

  async verifyReceivable(payload: {
    paymentId: number;
    method?: DashboardReceivableVerificationMode;
  }): Promise<void> {
    const response = await apiClient.post<{ success: boolean; message?: string }>('/dashboard/verify-receivable', payload);

    if (!response.data.success) {
      throw new Error(response.data.message ?? 'Unable to verify receivable');
    }
  }
}
