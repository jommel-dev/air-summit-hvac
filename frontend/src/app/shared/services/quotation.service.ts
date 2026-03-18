import { Injectable } from '@angular/core';
import { apiClient } from './api-client';
import { ProductOption, SalesCustomerOption } from './sales-order.service';

export interface QuotationTermsConditions {
  warrantyException?: string;
  validity?: string;
  note?: string;
  penaltyFee?: string;
  warranty?: string;
}

export interface QuotationProductItemPayload {
  productId?: number | string;
  capacityId?: number | string;
  unitPrice?: number | string;
  sellPrice?: number | string;
  discountPrice?: number | string;
  unitTypesQty?: Array<{ unitType?: string; qty?: number; label?: string; value?: string | number }>;
  totalSetQty?: number;
  remarks?: string;
}

export interface QuotationPayload {
  quoteNo?: string;
  quoteDate?: string;
  customer_id?: string | null;
  customer?: {
    name: string;
    address?: string;
    contact_person?: string;
    contact_number?: string;
    email?: string;
    tin_number?: string;
  };
  productItems: QuotationProductItemPayload[];
  totalAmount?: number;
  remarks?: string;
  status?: string;
  termsConditions?: QuotationTermsConditions;
}

export interface QuotationListItem {
  id: number;
  quoteNo: string;
  quoteDate: string | null;
  customerId: string | null;
  customerName: string;
  totalAmount: number;
  status: string;
  remarks?: string;
  convertedSalesId?: number | null;
  createdAt?: string | null;
}

export interface QuotationDetailItem extends QuotationListItem {
  customerAddress: string;
  customerContactPerson: string;
  customerContactNumber: string;
  customerEmail: string;
  customerTinNumber: string;
  termsConditions?: QuotationTermsConditions;
  productItems: Array<{
    id: number;
    productId: string | null;
    capacityId: string | null;
    productName: string;
    capacityName: string;
    unitPrice: number;
    sellPrice: number;
    discountPrice: number;
    unitTypesQty: Array<{ unitType?: string; qty?: number; label?: string; value?: string | number }>;
    totalSetQty: number;
    lineTotal: number;
    remarks: string;
  }>;
}

export interface QuotationListMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

interface QuotationListApiResponse {
  success: boolean;
  items: QuotationListItem[];
  meta: QuotationListMeta;
  message?: string;
}

interface QuotationDetailApiResponse {
  success: boolean;
  item?: QuotationDetailItem;
  message?: string;
}

interface QuotationMutationResponse {
  success: boolean;
  message?: string;
  data?: {
    quotationId?: number;
    salesOrderId?: number;
    alreadyConverted?: boolean;
  };
}

@Injectable({ providedIn: 'root' })
export class QuotationService {
  async createQuotation(payload: QuotationPayload): Promise<QuotationMutationResponse> {
    const response = await apiClient.post<QuotationMutationResponse>('/quotation', payload);
    return response.data;
  }

  async updateQuotation(id: number, payload: QuotationPayload): Promise<QuotationMutationResponse> {
    const response = await apiClient.patch<QuotationMutationResponse>(`/quotation/${id}`, payload);
    return response.data;
  }

  async listQuotations(params: {
    page: number;
    limit: number;
    search?: string;
    status?: string;
  }): Promise<{ items: QuotationListItem[]; meta: QuotationListMeta }> {
    const response = await apiClient.get<QuotationListApiResponse>('/quotation', { params });
    return {
      items: response.data.items ?? [],
      meta: response.data.meta,
    };
  }

  async getQuotationById(id: number): Promise<QuotationDetailItem | null> {
    const response = await apiClient.get<QuotationDetailApiResponse>(`/quotation/${id}`);
    if (!response.data.success) {
      return null;
    }

    return response.data.item ?? null;
  }

  async finalizeQuotation(id: number): Promise<QuotationMutationResponse> {
    const response = await apiClient.patch<QuotationMutationResponse>(`/quotation/${id}/finalize`, {});
    return response.data;
  }

  async convertToSalesOrder(id: number): Promise<QuotationMutationResponse> {
    const response = await apiClient.post<QuotationMutationResponse>(`/quotation/${id}/convert-to-sales-order`, {});
    return response.data;
  }

  async getCustomers(search?: string): Promise<SalesCustomerOption[]> {
    const response = await apiClient.get<{ success: boolean; items?: SalesCustomerOption[] }>('/sales-order/customers/list', {
      params: { search: search?.trim() || undefined },
    });

    return response.data.items ?? [];
  }

  async getProducts(): Promise<ProductOption[]> {
    const response = await apiClient.get<{ success: boolean; items?: ProductOption[] }>('/products');
    return response.data.items ?? [];
  }
}
