import { Injectable } from '@angular/core';
import { apiClient } from './api-client';

export interface SalesCustomerOption {
  id: string;
  name: string;
  address?: string;
  contact_person?: string;
  contact_number?: string;
  email?: string;
  tin_number?: string;
}

export interface SalesCustomerPayload {
  name: string;
  address?: string;
  contact_person?: string;
  contact_number?: string;
  email?: string;
  tin_number?: string;
}

export interface SalesPaymentDetailsPayload {
  method?: string;
  amount?: number;
  terms?: string;
  termsDueDate?: string | null;
  status?: string;
  referenceNo?: string;
  paymentDate?: string | null;
  issuedBy?: string;
  ccCharge?: string;
  checkNo?: string;
  bankName?: string;
  bankAccount?: string;
  postDated?: string;
  downPayment?: number;
}

export interface SalesProductItemPayload {
  transType: 'sales' | 'purchase' | string;
  productId?: number | string;
  capacityId?: number | string;
  unitPrice?: number | string;
  sellPrice?: number | string;
  discountPrice?: number | string;
  unitTypesQty?: Array<{ unitType?: string; qty?: number; label?: string; value?: number }>;
  totalSetQty?: number;
  purchaseId?: number | null;
  salesId?: number | null;
  serialNumbers?: Record<string, unknown>;
}

export interface SalesOrderPayload {
  customer_id?: string | null;
  customer?: SalesCustomerPayload;
  paymentDetails?: SalesPaymentDetailsPayload | SalesPaymentDetailsPayload[];
  productItems: SalesProductItemPayload[];
  so_number?: string;
  totalAmount?: number;
  scheduleDate?: string | null;
  salesType?: string;
  installer?: string;
  remarks?: string;
  status?: string;
}

export interface SalesOrderApiResponse {
  success: boolean;
  message?: string;
  data?: {
    salesOrderId?: number;
    customerId?: string;
    totalAmount?: number;
    status?: string;
  };
}

export interface SalesOrderListItem {
  id: number;
  soNumber: string;
  customerId: string | null;
  customerName: string;
  totalAmount: number;
  status: string;
  salesType?: string;
  scheduleDate: string | null;
  createdAt: string | null;
  serialCount: number;
}

export interface SalesOrderDetailPayment extends SalesPaymentDetailsPayload {
  amount: number;
  method: string;
  terms: string;
  status: string;
  referenceNo: string;
  issuedBy: string;
  ccCharge: string;
  checkNo: string;
  bankName: string;
  bankAccount: string;
  postDated: string;
  downPayment: number;
}

export interface SalesOrderDetailUnitType {
  label: string;
  value: number;
}

export interface SalesOrderDetailProductItem {
  id: number;
  transType: string;
  productId: string;
  capacityId: string;
  unitPrice: number;
  sellPrice: number;
  discountPrice: number;
  unitTypesQty: SalesOrderDetailUnitType[];
  totalSetQty: number;
  purchaseId: number | null;
  salesId: number;
  status: string;
  serialNumbers: Record<string, string[]>;
}

export interface SalesOrderDetailItem {
  id: number;
  soNumber: string | null;
  customerId: string | null;
  customerName: string | null;
  customerAddress: string | null;
  customerContactPerson: string | null;
  customerContactNumber: string | null;
  customerEmail: string | null;
  customerTinNumber: string | null;
  totalAmount: number;
  status: string;
  scheduleDate: string | null;
  salesType: string;
  installer: string;
  remarks: string;
  paymentDetails: SalesOrderDetailPayment[];
  productItems: SalesOrderDetailProductItem[];
  createdAt: string | null;
}

export interface ProductCapacityOption {
  id: number;
  name: string;
  sellPrice?: number;
  unitPrice?: number;
  indoorModel?: string;
  outdoorModel?: string;
}

export interface ProductOption {
  id: number;
  name: string;
  brandName?: string;
  unit?: string;
  unitTypes?: string[];
  capacities: ProductCapacityOption[];
}

export interface SalesListMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface SalesQueryParams {
  page: number;
  limit: number;
  search?: string;
}

interface SalesOrderListApiResponse {
  success: boolean;
  items: SalesOrderListItem[];
  meta: SalesListMeta;
}

interface SalesOrderDetailResponse {
  success: boolean;
  message?: string;
  item?: SalesOrderDetailItem;
}

interface ScanSalesSerialResponse {
  success: boolean;
  message?: string;
  item?: {
    serialNumber?: string;
  };
}

@Injectable({ providedIn: 'root' })
export class SalesOrderService {
  async createSalesOrder(payload: SalesOrderPayload): Promise<SalesOrderApiResponse> {
    const response = await apiClient.post<SalesOrderApiResponse>('/sales-order', payload);
    return response.data;
  }

  async updateSalesOrder(id: number, payload: SalesOrderPayload): Promise<SalesOrderApiResponse> {
    const response = await apiClient.patch<SalesOrderApiResponse>(`/sales-order/${id}`, payload);
    return response.data;
  }

  async getDeliveries(params: SalesQueryParams): Promise<{ items: SalesOrderListItem[]; meta: SalesListMeta }> {
    const response = await apiClient.get<SalesOrderListApiResponse>('/sales-order/deliveries', { params });
    return {
      items: response.data.items ?? [],
      meta: response.data.meta,
    };
  }

  async getApprovals(params: SalesQueryParams): Promise<{ items: SalesOrderListItem[]; meta: SalesListMeta }> {
    const response = await apiClient.get<SalesOrderListApiResponse>('/sales-order/approvals', { params });
    return {
      items: response.data.items ?? [],
      meta: response.data.meta,
    };
  }

  async getMasterData(params: SalesQueryParams): Promise<{ items: SalesOrderListItem[]; meta: SalesListMeta }> {
    const response = await apiClient.get<SalesOrderListApiResponse>('/sales-order/master-data', { params });
    return {
      items: response.data.items ?? [],
      meta: response.data.meta,
    };
  }

  async getSchedules(params: SalesQueryParams): Promise<{ items: SalesOrderListItem[]; meta: SalesListMeta }> {
    const response = await apiClient.get<SalesOrderListApiResponse>('/sales-order/schedules', { params });
    return {
      items: response.data.items ?? [],
      meta: response.data.meta,
    };
  }

  async getServices(params: SalesQueryParams): Promise<{ items: SalesOrderListItem[]; meta: SalesListMeta }> {
    const response = await apiClient.get<SalesOrderListApiResponse>('/sales-order/services', { params });
    return {
      items: response.data.items ?? [],
      meta: response.data.meta,
    };
  }

  async getProjects(params: SalesQueryParams): Promise<{ items: SalesOrderListItem[]; meta: SalesListMeta }> {
    const response = await apiClient.get<SalesOrderListApiResponse>('/sales-order/projects', { params });
    return {
      items: response.data.items ?? [],
      meta: response.data.meta,
    };
  }

  async getDistribution(params: SalesQueryParams): Promise<{ items: SalesOrderListItem[]; meta: SalesListMeta }> {
    const response = await apiClient.get<SalesOrderListApiResponse>('/sales-order/distribution', { params });
    return {
      items: response.data.items ?? [],
      meta: response.data.meta,
    };
  }

  async getSalesReceivable(params: SalesQueryParams): Promise<{ items: SalesOrderListItem[]; meta: SalesListMeta }> {
    const response = await apiClient.get<SalesOrderListApiResponse>('/sales-order/sales-receivable', { params });
    return {
      items: response.data.items ?? [],
      meta: response.data.meta,
    };
  }

  async getRemittedSales(params: SalesQueryParams): Promise<{ items: SalesOrderListItem[]; meta: SalesListMeta }> {
    const response = await apiClient.get<SalesOrderListApiResponse>('/sales-order/remitted-sales', { params });
    return {
      items: response.data.items ?? [],
      meta: response.data.meta,
    };
  }

  async getSalesOrderById(id: number): Promise<SalesOrderDetailItem | null> {
    const response = await apiClient.get<SalesOrderDetailResponse>(`/sales-order/${id}`);
    if (!response.data.success) {
      return null;
    }

    return response.data.item ?? null;
  }

  async getCustomers(search?: string): Promise<SalesCustomerOption[]> {
    const response = await apiClient.get<{ success: boolean; items?: SalesCustomerOption[] }>('/sales-order/customers/list', {
      params: {
        search: search?.trim() || undefined,
      },
    });

    return response.data.items ?? [];
  }

  async getProducts(): Promise<ProductOption[]> {
    const response = await apiClient.get<{ success: boolean; items?: ProductOption[] }>('/products');
    return response.data.items ?? [];
  }

  async scanSalesSerial(payload: {
    serialNumber: string;
    salesId: number;
    expectedProductId?: number;
    expectedCapacityId?: number;
    expectedUnitType?: string;
  }): Promise<ScanSalesSerialResponse> {
    const response = await apiClient.post<ScanSalesSerialResponse>(
      '/serial-number/scan-sales-order',
      payload,
    );

    return response.data;
  }

  async removeSalesSerial(payload: {
    serialNumber: string;
    salesId: number;
    unitType?: string;
  }): Promise<{ success: boolean; message?: string }> {
    const response = await apiClient.post<{ success: boolean; message?: string }>(
      '/serial-number/remove-sales-order',
      payload,
    );

    return response.data;
  }
}
