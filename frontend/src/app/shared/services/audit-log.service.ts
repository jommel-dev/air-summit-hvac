import { Injectable } from '@angular/core';
import { apiClient } from './api-client';

export interface AuditFieldChange {
  field: string;
  oldValue: unknown;
  newValue: unknown;
}

export interface AuditLogMetadata {
  description?: string;
  requestBody?: Record<string, unknown> | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  changes?: AuditFieldChange[];
  [key: string]: unknown;
}

export interface AuditLogListItem {
  id: number;
  action: string;
  entityType: string;
  entityId: string;
  userId: number | null;
  username: string;
  roleName: string;
  branchId: number | null;
  ipAddress: string;
  description: string;
  metadata: AuditLogMetadata | null;
  createdAt: string | null;
}

export interface AuditLogListResponse {
  success: boolean;
  message?: string;
  items?: AuditLogListItem[];
  meta?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface AuditLogDetailResponse {
  success: boolean;
  item?: AuditLogListItem;
  message?: string;
}

export interface AuditLogEntry {
  action: string;
  entityType: string;
  entityId?: string | number | null;
  userId?: number | null;
  username?: string | null;
  roleName?: string | null;
  branchId?: number | null;
  ipAddress?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface AuditLogCreateResponse {
  success: boolean;
  message?: string;
  id?: number;
}

@Injectable({ providedIn: 'root' })
export class AuditLogFrontendService {
  async createAuditLog(entry: AuditLogEntry): Promise<AuditLogCreateResponse> {
    const response = await apiClient.post<AuditLogCreateResponse>('/audit-logs', entry);
    return response.data;
  }
  async getAuditLogs(params?: {
    page?: number;
    limit?: number;
    search?: string;
    action?: string;
    entityType?: string;
  }): Promise<AuditLogListResponse> {
    const response = await apiClient.get<AuditLogListResponse>('/audit-logs', { params });
    return response.data;
  }

  async getAuditLog(id: number): Promise<AuditLogDetailResponse> {
    const response = await apiClient.get<AuditLogDetailResponse>(`/audit-logs/${id}`);
    return response.data;
  }
}
