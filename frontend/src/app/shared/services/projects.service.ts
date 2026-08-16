import { Injectable } from '@angular/core';
import { apiClient } from './api-client';

export interface ProjectListItem {
  id: number;
  projectCode: string;
  projectName: string;
  projectType?: string;
  projectOwner?: string;
  projectLocation?: string;
  projectStartDate?: string | null;
  projectEndDate?: string | null;
  projectManager?: string;
  projectStatus?: string;
  projectNotes?: string;
  customerId?: string;
  customerName?: string;
  pocName?: string;
  pocPhone?: string;
  pocEmail?: string;
  relatedSOCount?: number;
  totalAmount?: number;
  paidAmount?: number;
  balance?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface ProjectRelatedSalesOrder {
  id: number;
  soNumber: string;
  customerId: string;
  customerName: string;
  totalAmount: number;
  paidAmount: number;
  balance: number;
  status: string;
  scheduleDate?: string | null;
  createdAt?: string | null;
}

export interface ProjectDetail extends ProjectListItem {
  customerAddress?: string;
  customerContact?: string;
  customerPhone?: string;
  customerEmail?: string;
  relatedSalesOrders: ProjectRelatedSalesOrder[];
}

export interface ProjectBilling {
  projectId: number;
  projectCode: string;
  projectName: string;
  customerId: string;
  customerName: string;
  totalAmount: number;
  paidAmount: number;
  balance: number;
  salesOrders: ProjectRelatedSalesOrder[];
}

export interface ProjectSoaItem {
  id: number;
  soaNumber: string;
  periodFrom?: string | null;
  periodTo?: string | null;
  openingBalance: number;
  totalCharges: number;
  totalPayments: number;
  closingBalance: number;
  soaStatus: string;
  dueDate?: string | null;
  notes?: string;
  generatedAt?: string | null;
}

export interface CreateProjectPayload {
  projectCode: string;
  projectName: string;
  customerId: string;
  projectType?: string;
  projectOwner?: string;
  projectLocation?: string;
  projectStartDate?: string | null;
  projectEndDate?: string | null;
  projectManager?: string;
  projectStatus?: string;
  projectNotes?: string;
  pocName?: string;
  pocPhone?: string;
  pocEmail?: string;
}

export interface ProjectListMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

@Injectable({ providedIn: 'root' })
export class ProjectsService {
  async search(params: {
    search?: string;
    status?: string;
    page?: number;
    limit?: number;
  }): Promise<{ items: ProjectListItem[]; meta: ProjectListMeta }> {
    const response = await apiClient.get<{
      success: boolean;
      items?: ProjectListItem[];
      meta?: ProjectListMeta;
    }>('/projects', { params });

    return {
      items: response.data.items ?? [],
      meta: response.data.meta ?? { page: 1, limit: 20, total: 0, totalPages: 1 },
    };
  }

  async getById(projectId: number): Promise<ProjectDetail | null> {
    const response = await apiClient.get<{ success: boolean; data?: ProjectDetail }>(
      `/projects/${projectId}`,
    );
    return response.data.data ?? null;
  }

  async create(payload: CreateProjectPayload): Promise<ProjectDetail | null> {
    const response = await apiClient.post<{ success: boolean; data?: ProjectDetail }>(
      '/projects',
      payload,
    );
    return response.data.data ?? null;
  }

  async update(
    projectId: number,
    payload: Partial<CreateProjectPayload>,
  ): Promise<ProjectDetail | null> {
    const response = await apiClient.patch<{ success: boolean; data?: ProjectDetail }>(
      `/projects/${projectId}`,
      payload,
    );
    return response.data.data ?? null;
  }

  async remove(projectId: number): Promise<{ success: boolean; message?: string }> {
    const response = await apiClient.delete<{ success: boolean; message?: string }>(
      `/projects/${projectId}`,
    );
    return response.data;
  }

  async getBilling(projectId: number): Promise<ProjectBilling | null> {
    const response = await apiClient.get<{ success: boolean; data?: ProjectBilling }>(
      `/projects/${projectId}/billing`,
    );
    return response.data.data ?? null;
  }

  async listStatements(projectId: number): Promise<ProjectSoaItem[]> {
    const response = await apiClient.get<{ success: boolean; items?: ProjectSoaItem[] }>(
      `/projects/${projectId}/statement-of-account`,
    );
    return response.data.items ?? [];
  }

  async createStatement(
    projectId: number,
    payload: { periodFrom: string; periodTo: string; dueDate?: string; notes?: string },
  ): Promise<ProjectSoaItem | null> {
    const response = await apiClient.post<{ success: boolean; data?: ProjectSoaItem }>(
      `/projects/${projectId}/statement-of-account`,
      payload,
    );
    return response.data.data ?? null;
  }

  async markStatementSent(
    projectId: number,
    soaId: number,
  ): Promise<{ success: boolean; message?: string; data?: { id: number; soaNumber: string; soaStatus: string } }> {
    const response = await apiClient.patch<{
      success: boolean;
      message?: string;
      data?: { id: number; soaNumber: string; soaStatus: string };
    }>(`/projects/${projectId}/statement-of-account/${soaId}/send`);
    return response.data;
  }

  async createSettlement(
    projectId: number,
    payload: {
      amount?: number;
      mode?: 'partial' | 'full' | 'cheque' | 'split';
      method?: string;
      salesOrderId?: number;
      bankAmount?: number;
      chequeAmount?: number;
      bankName?: string | null;
      checkNo?: string | null;
      postDated?: string | null;
      notes?: string;
    },
  ): Promise<{ success: boolean; message?: string; billing?: ProjectBilling }> {
    const response = await apiClient.post<{
      success: boolean;
      message?: string;
      billing?: ProjectBilling;
    }>(`/projects/${projectId}/settlements`, payload);
    return response.data;
  }
}
