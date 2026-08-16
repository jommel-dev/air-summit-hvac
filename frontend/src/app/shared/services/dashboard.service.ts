import { Injectable } from '@angular/core';
import { apiClient } from './api-client';
import { BranchService } from './branch.service';

export type DashboardTrend = 'up' | 'down';
export type DashboardSalesDetailMode = 'sales' | 'unpaid' | 'overdues' | 'cheques';
export type DashboardOperationDetailMode = 'receiving' | 'dispatch' | 'installation' | 'stock-alerts';
export type DashboardSettlementMode = 'partial' | 'full' | 'cheque' | 'split';
export type DashboardReceivableVerificationMode = 'bank-transfer' | 'cheque' | 'credit-card';

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

export interface DashboardSalesDetailResult {
  items: Array<{ id?: string | number; [key: string]: unknown }>;
  total: number;
  page: number;
  pageSize: number;
  receivableAmount?: number;
  receivedAmount?: number;
  overallAmount?: number;
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
    options?: { page?: number; pageSize?: number; dateFrom?: string; dateTo?: string; status?: string },
  ): Promise<DashboardSalesDetailResult> {
    const branchId = this.branchService.getActiveBranchId();
    const response = await apiClient.get<{
      success: boolean;
      items: Array<{ id?: string | number; [key: string]: unknown }>;
      total?: number;
      page?: number;
      pageSize?: number;
      receivableAmount?: number;
      receivedAmount?: number;
      overallAmount?: number;
    }>('/dashboard/sales-detail', {
      params: {
        mode,
        page: options?.page ?? 1,
        pageSize: options?.pageSize ?? 15,
        ...(options?.dateFrom ? { dateFrom: options.dateFrom } : {}),
        ...(options?.dateTo ? { dateTo: options.dateTo } : {}),
        ...(options?.status ? { status: options.status } : {}),
        ...(branchId ? { branchId } : {}),
      },
    });

    if (!response.data.success) {
      throw new Error('Unable to load sales detail');
    }

    return {
      items: response.data.items ?? [],
      total: Number(response.data.total ?? 0) || 0,
      page: Number(response.data.page ?? options?.page ?? 1) || 1,
      pageSize: Number(response.data.pageSize ?? options?.pageSize ?? 15) || 15,
      receivableAmount: Number(response.data.receivableAmount ?? 0) || 0,
      receivedAmount: Number(response.data.receivedAmount ?? 0) || 0,
      overallAmount: Number(response.data.overallAmount ?? 0) || 0,
    };
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

  async adjustReceivable(payload: {
    paymentId: number;
    method?: DashboardReceivableVerificationMode;
    password: string;
    remarks: string;
    authUsername?: string;
  }): Promise<void> {
    try {
      const response = await apiClient.post<{ success: boolean; message?: string }>('/dashboard/adjust-receivable', payload);

      if (!response.data.success) {
        throw new Error(response.data.message ?? 'Unable to adjust receivable');
      }
    } catch (error: unknown) {
      const message = this.extractErrorMessage(error, 'Unable to adjust receivable');
      throw new Error(message);
    }
  }

  private extractErrorMessage(error: unknown, fallback: string): string {
    if (error && typeof error === 'object' && 'response' in error) {
      const response = (error as { response?: { data?: { message?: unknown } } }).response;
      const message = response?.data?.message;
      if (typeof message === 'string' && message.trim()) {
        return message.trim();
      }
    }

    if (error instanceof Error && error.message.trim()) {
      return error.message.trim();
    }

    return fallback;
  }
}
