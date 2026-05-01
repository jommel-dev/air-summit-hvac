import { Injectable } from '@angular/core';
import { apiClient } from './api-client';

export interface PurchaseOrderItem {
  id: number;
  poNumber: string;
  vendorId: string | null;
  vendorName: string;
  totalAmount: number;
  status: string;
  createdAt: string | null;
  serialCount: number;
  productItems?: Array<{
    id: string | number | null;
    productId: string | null;
    capacityId: string | null;
    salesId?: string | null;
    product?: {
      id: string | number | null;
      productName: string | null;
    } | null;
    capacity?: {
      id: string | number | null;
      capacity: string | null;
    } | null;
  }>;
  isTransferPO?: boolean;
  originatingSalesOrder?: { id: number } | null;
}

export interface PurchaseOrderDetailPayment {
  method: string;
  amount: number;
  terms: string;
  termsDueDate: string | null;
  status: string;
  paymentDate: string | null;
  bankName: string;
  referenceNo: string;
  checkNo: string;
  chequeDate: string | null;
  issuedBy: string;
  downPayment: number;
}

export interface PurchaseOrderDetailUnitType {
  label: string;
  value: number;
}

export interface PurchaseOrderDetailProductItem {
  id: number;
  transType: string;
  productId: string;
  capacityId: string;
  unitPrice: number;
  sellPrice: number;
  discountPrice: number;
  unitTypesQty: PurchaseOrderDetailUnitType[];
  totalSetQty: number;
  purchaseId: number;
  salesId: number | null;
  status: string;
  serialNumbers: Record<string, string[]>;
}

export interface PurchaseOrderDetailItem {
  id: number;
  poNumber: string | null;
  vendorId: string | null;
  vendorName: string | null;
  vendorAddress: string | null;
  vendorContactPerson: string | null;
  vendorContactNumber: string | null;
  totalAmount: number;
  status: string;
  paymentDetails: PurchaseOrderDetailPayment[];
  productItems: PurchaseOrderDetailProductItem[];
  serialStatuses?: Record<string, string>;
  poLinkedSerialNumbers?: Record<string, string[]>;
  unresolvedLinkedSerialNumbers?: Record<string, string[]>;
  createdAt: string | null;
  isTransferPO?: boolean;
  originatingSalesOrder?: {
    id: number;
    soNumber: string | null;
    branchId?: string | null;
    branchName?: string | null;
    productItems?: any[];
    transferDetails?: {
      id: number;
      fromBranchId: string | null;
      fromBranchName: string | null;
      toBranchId: string | null;
      toBranchName: string | null;
      transferDate: string | null;
      expectedDeliveryDate: string | null;
      actualDeliveryDate: string | null;
      transferStatus: string | null;
      transferNotes: string | null;
    } | null;
  } | null;
}

interface PurchaseOrderDetailResponse {
  success: boolean;
  message?: string;
  item?: PurchaseOrderDetailItem;
}

interface ScanPurchaseSerialResponse {
  success: boolean;
  message?: string;
  item?: {
    serialNumber?: string;
  };
}

interface ScanPurchaseSerialBatchResponse {
  success: boolean;
  message?: string;
  summary?: {
    total: number;
    successCount: number;
    failureCount: number;
  };
  items?: Array<{
    serialNumber: string;
    success: boolean;
    message?: string;
    item?: {
      serialNumber?: string | null;
      unitType?: string | null;
    };
  }>;
}

export interface PurchaseListMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

interface VendorListResponse {
  success: boolean;
  items?: VendorDetail[];
  meta?: PurchaseListMeta;
  message?: string;
}

export interface PurchaseQueryParams {
  page: number;
  limit: number;
  search?: string;
}

interface PurchaseOrderApiResponse {
  success: boolean;
  items: PurchaseOrderItem[];
  meta: PurchaseListMeta;
}

export interface PurchaseOrderListResult {
  items: PurchaseOrderItem[];
  meta: PurchaseListMeta;
}

export interface CreatePurchaseRequestPayload {
  poNumber?: string;
  vendorId?: string;
  vendor?: {
    name: string;
    address?: string;
    contact_person?: string;
    contact_number?: string;
  };
  paymentDetails?:
    | {
        amount?: number;
        method?: string;
        terms?: string;
        termsDueDate?: string | null;
        status?: 'unpaid' | 'paid' | 'partial' | 'overdue';
        paymentDate?: string | null;
        bankName?: string;
        referenceNo?: string;
        checkNo?: string;
        chequeDate?: string | null;
        issuedBy?: string;
        downPayment?: number;
      }
    | Array<{
        amount?: number;
        method?: string;
        terms?: string;
        termsDueDate?: string | null;
        status?: 'unpaid' | 'paid' | 'partial' | 'overdue';
        paymentDate?: string | null;
        bankName?: string;
        referenceNo?: string;
        checkNo?: string;
        chequeDate?: string | null;
        issuedBy?: string;
        downPayment?: number;
      }>;
  productItems: Array<{
    transType: 'purchase' | 'sales' | string;
    productId?: string | number;
    capacityId?: string | number;
    unitPrice?: number;
    sellPrice?: number | string;
    discountPrice?: number | string;
    unitTypesQty?: Array<{
      unitType?: string;
      qty?: number;
      label?: string;
      value?: number;
    }>;
    serialNumbers?: Record<string, unknown>;
    totalSetQty?: number;
    purchaseId?: number | null;
    salesId?: number | null;
  }>;
  totalAmount?: number;
  status?: string;
}

export interface CreatePurchaseResponse {
  success: boolean;
  message?: string;
  data?: {
    purchaseOrderId: number;
    poNumber?: string;
    vendorId?: string;
    computedTotalAmount?: number;
  };
}

export type UpdatePurchaseResponse = CreatePurchaseResponse;
export type PurchaseActionResponse = CreatePurchaseResponse;

export interface DeletePurchaseAuthPayload {
  password: string;
  authUsername?: string;
}

export interface VendorOption {
  id: string;
  name: string;
  address?: string;
  contact_person?: string;
  contact_number?: string;
}

export interface VendorDetail {
  id: string;
  name: string;
  address?: string;
  contact_person?: string;
  contact_number?: string;
  email?: string;
  tin_number?: string;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface VendorPayload {
  name: string;
  address?: string;
  contactPerson?: string;
  contactNumber?: string;
  email?: string;
  tinNumber?: string;
}

export interface ProductCapacityOption {
  id: number;
  name: string;
}

export interface ProductOption {
  id: number;
  name: string;
  brandName?: string;
  unit?: string;
  unitTypes?: string[];
  capacities: ProductCapacityOption[];
}

@Injectable({ providedIn: 'root' })
export class PurchaseOrderService {
  async getPurchasesByVendor(
    vendorId: string,
    params: { page?: number; limit?: number } = {},
  ): Promise<PurchaseOrderListResult> {
    const response = await apiClient.get<PurchaseOrderApiResponse>('/purchase/master-data', {
      params: { vendorId, page: params.page ?? 1, limit: params.limit ?? 100 },
    });
    return {
      items: response.data.items ?? [],
      meta: response.data.meta,
    };
  }

  async createPurchase(payload: CreatePurchaseRequestPayload): Promise<CreatePurchaseResponse> {
    const response = await apiClient.post<CreatePurchaseResponse>('/purchase', payload);
    return response.data;
  }

  async getDeliveries(params: PurchaseQueryParams): Promise<PurchaseOrderListResult> {
    const response = await apiClient.get<PurchaseOrderApiResponse>('/purchase/deliveries', { params });
    return {
      items: response.data.items ?? [],
      meta: response.data.meta,
    };
  }

  async getApprovals(params: PurchaseQueryParams): Promise<PurchaseOrderListResult> {
    const response = await apiClient.get<PurchaseOrderApiResponse>('/purchase/approvals', { params });
    return {
      items: response.data.items ?? [],
      meta: response.data.meta,
    };
  }

  async getMasterData(params: PurchaseQueryParams): Promise<PurchaseOrderListResult> {
    const response = await apiClient.get<PurchaseOrderApiResponse>('/purchase/master-data', { params });
    return {
      items: response.data.items ?? [],
      meta: response.data.meta,
    };
  }

  async updatePurchase(id: number, payload: CreatePurchaseRequestPayload): Promise<UpdatePurchaseResponse> {
    const response = await apiClient.patch<UpdatePurchaseResponse>(`/purchase/${id}`, payload);
    return response.data;
  }

  async revertPurchaseToInProgress(id: number): Promise<PurchaseActionResponse> {
    const response = await apiClient.patch<PurchaseActionResponse>(`/purchase/${id}/revert-in-progress`, {});
    return response.data;
  }

  async revertPurchaseToDeliveries(id: number): Promise<PurchaseActionResponse> {
    const response = await apiClient.patch<PurchaseActionResponse>(`/purchase/${id}/revert-deliveries`, {});
    return response.data;
  }

  async approvePurchase(id: number): Promise<PurchaseActionResponse> {
    const response = await apiClient.patch<PurchaseActionResponse>(`/purchase/${id}/approve`, {});
    return response.data;
  }

  async verifyAndReceivePurchase(id: number): Promise<PurchaseActionResponse> {
    const response = await apiClient.patch<PurchaseActionResponse>(`/purchase/${id}/verify-receive`, {});
    return response.data;
  }

  async getPurchaseById(
    id: number,
    options?: {
      includeInstalled?: boolean;
      preferPoLinkedSerials?: boolean;
    },
  ): Promise<PurchaseOrderDetailItem | null> {
    const response = await apiClient.get<PurchaseOrderDetailResponse>(`/purchase/${id}`, {
      params: {
        includeInstalled: options?.includeInstalled === true ? 'true' : undefined,
        preferPoLinkedSerials: options?.preferPoLinkedSerials === true ? 'true' : undefined,
      },
    });
    if (!response.data.success) {
      return null;
    }
    // Pass through isTransferPO and originatingSalesOrder if present
    return response.data.item ?? null;
  }

  async getVendors(search?: string): Promise<VendorOption[]> {
    const response = await apiClient.get<{ success: boolean; items?: VendorOption[] }>('/purchase/vendors/list', {
      params: {
        search: search?.trim() || undefined,
      },
    });

    return response.data.items ?? [];
  }

  async listVendorStakeholders(
    params: { page?: number; limit?: number; search?: string },
  ): Promise<{ items: VendorDetail[]; meta: PurchaseListMeta }> {
    const response = await apiClient.get<VendorListResponse>('/vendor', { params });
    if (!response.data.success) {
      throw new Error(response.data.message || 'Failed to load vendors');
    }
    return {
      items: response.data.items ?? [],
      meta: response.data.meta ?? {
        page: params.page ?? 1,
        limit: params.limit ?? 20,
        total: 0,
        totalPages: 1,
      },
    };
  }

  async getVendorById(id: string): Promise<VendorDetail> {
    const response = await apiClient.get<{ success: boolean; data?: VendorDetail; message?: string }>(`/vendor/${id}`);
    if (!response.data.success || !response.data.data) {
      throw new Error(response.data.message || 'Failed to load vendor');
    }
    return response.data.data;
  }

  async createVendor(payload: VendorPayload): Promise<{ success: boolean; message?: string; data?: { id?: string } }> {
    const response = await apiClient.post<{ success: boolean; message?: string; data?: { id?: string } }>('/vendor', payload);
    if (!response.data.success) {
      throw new Error(response.data.message || 'Failed to create vendor');
    }
    return response.data;
  }

  async updateVendor(id: string, payload: VendorPayload): Promise<{ success: boolean; message?: string }> {
    const response = await apiClient.patch<{ success: boolean; message?: string }>(`/vendor/${id}`, payload);
    if (!response.data.success) {
      throw new Error(response.data.message || 'Failed to update vendor');
    }
    return response.data;
  }

  async deleteVendor(id: string): Promise<{ success: boolean; message?: string }> {
    const response = await apiClient.delete<{ success: boolean; message?: string }>(`/vendor/${id}`);
    if (!response.data.success) {
      throw new Error(response.data.message || 'Failed to delete vendor');
    }
    return response.data;
  }

  async getProducts(): Promise<ProductOption[]> {
    const response = await apiClient.get<{ success: boolean; items?: ProductOption[] }>('/products');
    return response.data.items ?? [];
  }

  async scanPurchaseSerial(payload: {
    serialNumber: string;
    purchaseId: number;
    expectedProductId?: number;
    expectedCapacityId?: number;
    unitType?: string;
  }): Promise<ScanPurchaseSerialResponse> {
    const response = await apiClient.post<ScanPurchaseSerialResponse>(
      '/serial-number/scan-purchase-order',
      payload,
    );

    return response.data;
  }

  async scanPurchaseSerialBatch(payload: {
    items: Array<{
      serialNumber: string;
      purchaseId: number;
      expectedProductId?: number;
      expectedCapacityId?: number;
      unitType?: string;
    }>;
  }): Promise<ScanPurchaseSerialBatchResponse> {
    const response = await apiClient.post<ScanPurchaseSerialBatchResponse>(
      '/serial-number/scan-purchase-order/batch',
      payload,
    );

    return response.data;
  }

  async removePurchaseSerial(payload: {
    serialNumber: string;
    purchaseId: number;
    unitType?: string;
  }): Promise<{ success: boolean; message?: string }> {
    const response = await apiClient.post<{ success: boolean; message?: string }>(
      '/serial-number/remove-purchase-order',
      payload,
    );

    return response.data;
  }

  async cancelPurchase(id: number): Promise<PurchaseActionResponse> {
    const response = await apiClient.patch<PurchaseActionResponse>(`/purchase/${id}/cancel`, {});
    return response.data;
  }

  async deletePurchase(
    id: number,
    payload: DeletePurchaseAuthPayload,
  ): Promise<PurchaseActionResponse> {
    const response = await apiClient.post<PurchaseActionResponse>(
      `/purchase/${id}/delete-authorized`,
      payload,
    );
    return response.data;
  }
}
