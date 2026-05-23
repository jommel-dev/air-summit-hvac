import { Injectable } from '@angular/core';
import { apiClient } from './api-client';
import { MaterialTransactionItem } from './sales-order-material.service';

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
  customer_type?: 'regular' | 'sub_dealer';
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

export interface SalesOrderServiceItemPayload {
  serviceName?: string;
  unitPrice?: number;
  qty?: number;
  total?: number;
}

export interface SalesOrderTransferDetailsPayload {
  fromBranchId?: number;
  toBranchId?: number;
  transferDate?: string | null;
  expectedDeliveryDate?: string | null;
  actualDeliveryDate?: string | null;
  transferStatus?: string;
  transferNotes?: string;
}

export interface SalesOrderConcernDetailsPayload {
  concernType?: string;
  concernSubject?: string;
  concernDescription?: string;
  concernStatus?: string;
  priority?: string;
  resolutionNotes?: string;
  resolvedAt?: string | null;
  warrantySerials?: string;
}

export interface SalesOrderReturnedSerialDetailsPayload {
  isDefective?: boolean;
  defectReason?: string;
  defectDate?: string | null;
  serialNumbers?: string[];
}

export interface SalesOrderExpenseDetailsPayload {
  expenseType?: string;
  expenseDescription?: string;
  amount?: number;
  expenseDate?: string | null;
  paidTo?: string;
  paymentMethod?: string;
  referenceNo?: string;
}

export interface SalesOrderPayload {
  customer_id?: string | null;
  customer?: SalesCustomerPayload;
  paymentDetails?: SalesPaymentDetailsPayload | SalesPaymentDetailsPayload[];
  productItems: SalesProductItemPayload[];
  serviceItems?: SalesOrderServiceItemPayload[];
  expenseDetails?: SalesOrderExpenseDetailsPayload[];
  so_number?: string;
  totalAmount?: number;
  scheduleDate?: string | null;
  salesType?: string;
  projectId?: number;
  projectName?: string;
  projectCode?: string;
  installer?: string;
  remarks?: string;
  transferDetails?: SalesOrderTransferDetailsPayload;
  concernDetails?: SalesOrderConcernDetailsPayload;
  returnedSerialDetails?: SalesOrderReturnedSerialDetailsPayload;
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

export interface SalesOrderMigrationPreviewItem {
  rowNumber: number;
  mergedRowNumbers?: number[];
  raw: Record<string, unknown>;
  extracted: {
    capacityKey?: string;
    productHint?: string;
    customerId?: string | null;
    salesType?: string;
    inferredPaymentMethod?: string;
    unitTypeLabel?: string;
  };
  matchedCatalog: {
    productId: number;
    capacityId: number;
    brandName: string;
    productName: string;
    capacity: string;
  } | null;
  matchedCatalogs?: Array<{
    productId: number;
    capacityId: number;
    brandName: string;
    productName: string;
    capacity: string;
  }>;
  confidence: 'high' | 'medium' | 'rejected';
  issues: string[];
  mappedPayload: Record<string, unknown> | null;
}

export interface SalesOrderMigrationPreviewResponse {
  success: boolean;
  message?: string;
  summary: {
    total: number;
    highConfidence: number;
    reviewNeeded: number;
    rejected: number;
    matchedCustomers: number;
    newCustomers: number;
  } | null;
  items: SalesOrderMigrationPreviewItem[];
}

export interface SalesOrderMigrationImportResponse {
  success: boolean;
  batchFailed?: boolean;
  message?: string;
  summary: {
    total: number;
    created: number;
    failed: number;
    blocked: number;
    aborted: number;
    skippedReview: number;
  } | null;
  items: Array<{ rowNumber: number; status: string; salesOrderId?: number | null; message: string }>;
}

export interface SalesOrderListItem {
  id: number;
  soNumber: string;
  customerId: string | null;
  customerName: string;
  totalAmount: number;
  paymentMethod: string;
  status: string;
  salesType?: string;
  projectName?: string;
  projectCode?: string;
  scheduleDate: string | null;
  createdAt: string | null;
  serialCount: number;
  concernStatus?: string;
}

export interface SalesOrderRow {
  id: number;
  soNumber: string;
  customerName: string;
  totalAmount: number;
  paymentMethod: string;
  status: string;
  salesType?: string;
  projectCode?: string;
  projectName?: string;
  scheduleDate?: string | null;
  serialCount: number;
  createdAt?: string | null;
  concernStatus?: string;
}

export type SalesTab =
  | 'schedules'
  | 'services'
  | 'projects'
  | 'distribution'
  | 'sales-receivable'
  | 'remitted-sales';

export interface SalesReturnSerialOptionGroup {
  unitLabel: string;
  serials: string[];
}

export interface SalesCustomerDetail {
  id: string;
  name: string;
  customer_type: 'regular' | 'sub_dealer' | 'dealer';
  current_balance: number;
  credit_limit?: number;
  payment_terms: number;
  address: string;
  contact_person: string;
  contact_number: string;
  email: string;
  tin_number: string;
  created_at: string | null;
  updated_at: string | null;
}

export interface SalesCustomerOrder {
  id: number;
  soNumber: string;
  totalAmount: number;
  status: string;
  salesType: string;
  scheduleDate: string | null;
  createdAt: string | null;
  payments: Array<{
    method: string;
    amount: number;
    status: string;
    terms: string | null;
    termsDueDate: string | null;
    downPayment: number;
    checkNo: string | null;
    postDated: string | null;
    paymentDate: string | null;
    bankName: string | null;
    referenceNo: string | null;
  }>;
  productItems: Array<{
    productName: string;
    capacity: string;
    qty: number;
    unitPrice: number;
    discountPrice: number;
  }>;
}

export interface SalesCustomerPaymentSummary {
  totalCharges: number;
  totalManualPayments: number;
  outstandingBalance: number;
}

export interface SalesCustomerSoPayment {
  id: string;
  type: 'so_payment';
  soId: string;
  soNumber: string;
  method: string;
  amount: number;
  downPayment: number;
  status: string;
  termsDueDate: string | null;
  postDated: string | null;
  paymentDate: string | null;
  referenceNo: string | null;
  checkNo: string | null;
  bankName: string | null;
  notes: string | null;
  appliedToBalance: number;
  date: string | null;
}

export interface SalesCustomerSettlement {
  id: string;
  type: 'settlement';
  soId: string | null;
  soNumber: string | null;
  method: string;
  amount: number;
  downPayment: number;
  status: string;
  termsDueDate: string | null;
  postDated: string | null;
  paymentDate: string | null;
  referenceNo: string | null;
  checkNo: string | null;
  bankName: string | null;
  notes: string | null;
  appliedToBalance: number;
  date: string | null;
}

// Keep backward compat alias
export type SalesCustomerPayment = SalesCustomerSoPayment | SalesCustomerSettlement;

export interface SalesCustomerConcern {
  id: number;
  salesId: number;
  soNumber: string;
  salesType: string;
  status: string;
  scheduleDate: string | null;
  createdAt: string | null;
  concernType: string;
  concernSubject: string;
  concernDescription: string;
  concernStatus: string;
  priority: string;
  resolutionNotes: string;
  resolvedAt: string | null;
  serviceName: string;
  serviceType: string;
  serviceStatus: string;
  serviceDate: string | null;
  serviceCost: number;
}

export interface SalesStatementOfAccountItem {
  id: number;
  soaNumber: string;
  periodFrom: string | null;
  periodTo: string | null;
  openingBalance: number;
  totalCharges: number;
  totalPayments: number;
  closingBalance: number;
  status: string;
  dueDate: string | null;
  notes: string;
  generatedAt: string | null;
}

export interface SalesCustomerCreatePayload {
  name: string;
  address?: string;
  contactPerson?: string;
  contactNumber?: string;
  email?: string;
  tinNumber?: string;
  customerType?: 'regular' | 'sub_dealer';
  paymentTerms?: number;
}

export interface SalesCustomerUpdatePayload extends Partial<SalesCustomerCreatePayload> {}

export interface CustomerQueryParams {
  page?: number;
  limit?: number;
  search?: string;
  type?: 'regular' | 'sub_dealer';
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
export interface SalesOrderDetailServiceItem {
  id: number;
  serviceName: string;
  unitPrice: number;
  qty: number;
  total: number;
}

export interface BranchOption {
  id: number;
  branchName: string;
  branchAddress?: string;
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
  projectId?: number;
  projectName: string;
  projectCode: string;
  installer: string;
  remarks: string;
  paymentDetails: SalesOrderDetailPayment[];
  productItems: SalesOrderDetailProductItem[];
  serviceItems: SalesOrderDetailServiceItem[];
  transferDetails?: SalesOrderTransferDetailsPayload | null;
  concernDetails?: SalesOrderConcernDetailsPayload | null;
  expenseDetails?: SalesOrderExpenseDetailsPayload[];
  materialItems?: MaterialTransactionItem[];
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
  brandType?: string;
  unit?: string;
  unitTypes?: string[];
  capacities: ProductCapacityOption[];
}

export interface ProjectMasterOption {
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
  relatedSOCount?: number;
  createdBy?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ProjectWithRelatedSOs extends ProjectMasterOption {
  relatedSalesOrders: Array<{
    id: number;
    soNumber: string;
    customerId: string;
    customerName: string;
    totalAmount: number;
    status: string;
    scheduleDate?: string | null;
    createdAt?: string | null;
  }>;
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

interface ScanSalesSerialBatchResponse {
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
    };
  }>;
}

@Injectable({ providedIn: 'root' })
export class SalesOrderService {
  private mapBranchOption(item: BranchOption | Record<string, unknown> | null | undefined): BranchOption {
    return {
      id: Number((item as { id?: unknown } | null | undefined)?.id ?? 0),
      branchName: String((item as { branchName?: unknown } | null | undefined)?.branchName ?? '').trim(),
      branchAddress: String((item as { branchAddress?: unknown } | null | undefined)?.branchAddress ?? '').trim(),
    };
  }

  private mapBranchOptions(items?: Array<BranchOption | Record<string, unknown>>): BranchOption[] {
    return (items ?? [])
      .map((item) => this.mapBranchOption(item))
      .filter((item) => Number.isFinite(item.id) && item.id > 0);
  }

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

  async previewDailyReleaseMigration(rows: Array<Record<string, unknown>>): Promise<SalesOrderMigrationPreviewResponse> {
    const response = await apiClient.post<SalesOrderMigrationPreviewResponse>('/sales-order/migration/preview', { rows });
    return response.data;
  }

  async importDailyReleaseMigration(
    rows: Array<Record<string, unknown>>,
    selectedMediumRowNumbers: number[] = [],
    editedPayloads: Array<{ rowNumber: number; payload: SalesOrderPayload }> = [],
  ): Promise<SalesOrderMigrationImportResponse> {
    const response = await apiClient.post<SalesOrderMigrationImportResponse>('/sales-order/migration/import', {
      rows,
      selectedMediumRowNumbers,
      editedPayloads,
    });
    return response.data;
  }

  async getSalesOrderById(id: number): Promise<SalesOrderDetailItem> {
    const response = await apiClient.get<SalesOrderDetailResponse>(`/sales-order/${id}`);
    if (!response.data.success) {
      throw new Error(response.data.message || 'Failed to load sales order detail');
    }

    if (!response.data.item) {
      throw new Error('Sales order not found');
    }

    return response.data.item;
  }

  async getCustomers(search?: string): Promise<SalesCustomerOption[]> {
    const response = await apiClient.get<{ success: boolean; items?: SalesCustomerOption[] }>('/sales-order/customers/list', {
      params: {
        search: search?.trim() || undefined,
      },
    });

    return response.data.items ?? [];
  }

  async listCustomers(
    params: CustomerQueryParams,
  ): Promise<{ items: SalesCustomerDetail[]; meta: SalesListMeta }> {
    const response = await apiClient.get<{ success: boolean; items?: SalesCustomerDetail[]; meta?: SalesListMeta }>(
      '/sales-order/customers',
      { params },
    );

    return {
      items: response.data.items ?? [],
      meta: response.data.meta ?? { page: params.page ?? 1, limit: params.limit ?? 50, total: 0, totalPages: 1 },
    };
  }

  async getCustomer(id: string): Promise<SalesCustomerDetail> {
    const response = await apiClient.get<{ success: boolean; message?: string; data?: SalesCustomerDetail }>(
      `/sales-order/customers/${id}`,
    );

    if (!response.data.success || !response.data.data) {
      throw new Error(response.data?.message || 'Failed to load customer');
    }

    return response.data.data;
  }

  async createCustomer(
    payload: SalesCustomerCreatePayload,
  ): Promise<{ success: boolean; message?: string; data?: { id?: string } }> {
    const response = await apiClient.post<{ success: boolean; message?: string; data?: { id?: string } }>(
      '/sales-order/customers',
      payload,
    );

    return response.data;
  }

  async updateCustomer(
    id: string,
    payload: SalesCustomerUpdatePayload,
  ): Promise<{ success: boolean; message?: string; data?: any }> {
    const response = await apiClient.patch<{ success: boolean; message?: string; data?: any }>(
      `/sales-order/customers/${id}`,
      payload,
    );

    return response.data;
  }

  async deleteCustomer(id: string): Promise<{ success: boolean; message?: string; data?: any }> {
    const response = await apiClient.delete<{ success: boolean; message?: string; data?: any }>(
      `/sales-order/customers/${id}`,
    );

    return response.data;
  }

  async getCustomerOrders(
    id: string,
    params: SalesQueryParams,
  ): Promise<{ items: SalesCustomerOrder[]; meta: SalesListMeta }> {
    const response = await apiClient.get<{ success: boolean; items?: SalesCustomerOrder[]; meta?: SalesListMeta }>(
      `/sales-order/customers/${id}/orders`,
      { params },
    );

    return {
      items: response.data.items ?? [],
      meta: response.data.meta ?? { page: params.page ?? 1, limit: params.limit ?? 50, total: 0, totalPages: 1 },
    };
  }

  async getCustomerPayments(id: string): Promise<{
    success: boolean;
    summary?: { totalCharges: number; totalManualPayments: number; outstandingBalance: number };
    soPayments?: SalesCustomerSoPayment[];
    settlements?: SalesCustomerSettlement[];
    message?: string;
  }> {
    const response = await apiClient.get<{
      success: boolean;
      summary?: { totalCharges: number; totalManualPayments: number; outstandingBalance: number };
      soPayments?: SalesCustomerSoPayment[];
      settlements?: SalesCustomerSettlement[];
      message?: string;
    }>(`/sales-order/customers/${id}/payments`);
    return response.data;
  }
  async getCustomerConcerns(id: string): Promise<{ success: boolean; items?: SalesCustomerConcern[]; message?: string }> {
    const response = await apiClient.get<{ success: boolean; items?: SalesCustomerConcern[]; message?: string }>(
      `/sales-order/customers/${id}/concerns`,
    );

    return response.data;
  }

  async getCustomerStatementOfAccounts(
    id: string,
    params: SalesQueryParams,
  ): Promise<{ items: SalesStatementOfAccountItem[]; meta: SalesListMeta }> {
    const response = await apiClient.get<{ success: boolean; items?: SalesStatementOfAccountItem[]; meta?: SalesListMeta }>(
      `/sales-order/customers/${id}/statement-of-account`,
      { params },
    );

    return {
      items: response.data.items ?? [],
      meta: response.data.meta ?? { page: params.page ?? 1, limit: params.limit ?? 50, total: 0, totalPages: 1 },
    };
  }

  async createCustomerStatementOfAccount(
    id: string,
    payload: { periodFrom: string; periodTo: string; dueDate?: string; notes?: string },
  ): Promise<{ success: boolean; message?: string; data?: { statementOfAccountId?: number; periodFrom?: string; periodTo?: string } }> {
    const response = await apiClient.post<{ success: boolean; message?: string; data?: { statementOfAccountId?: number; periodFrom?: string; periodTo?: string } }>(
      `/sales-order/customers/${id}/statement-of-account`,
      payload,
    );

    return response.data;
  }

  async getBranches(): Promise<BranchOption[]> {
    const response = await apiClient.get<{ success: boolean; items?: BranchOption[] }>('/sales-order/branches');
    return this.mapBranchOptions(response.data.items);
  }

  async createBranch(
    payload: { branchName: string; branchAddress?: string | null },
  ): Promise<{ success: boolean; message?: string; items?: BranchOption[] }> {
    const response = await apiClient.post<{ success: boolean; message?: string; items?: BranchOption[] }>(
      '/sales-order/branches',
      payload,
    );
    return {
      ...response.data,
      items: this.mapBranchOptions(response.data.items),
    };
  }

  async updateBranch(
    branchId: number,
    payload: { branchName: string; branchAddress?: string | null },
  ): Promise<{ success: boolean; message?: string; items?: BranchOption[] }> {
    const response = await apiClient.put<{ success: boolean; message?: string; items?: BranchOption[] }>(
      `/sales-order/branches/${branchId}`,
      payload,
    );
    return {
      ...response.data,
      items: this.mapBranchOptions(response.data.items),
    };
  }

  async deleteBranch(branchId: number): Promise<{ success: boolean; message?: string; items?: BranchOption[] }> {
    const response = await apiClient.delete<{ success: boolean; message?: string; items?: BranchOption[] }>(
      `/sales-order/branches/${branchId}`,
    );
    return {
      ...response.data,
      items: this.mapBranchOptions(response.data.items),
    };
  }

  async createStatementOfAccount(
    salesOrderId: number,
    payload: { periodFrom: string; periodTo: string; dueDate?: string; notes?: string },
  ): Promise<{ success: boolean; message?: string; data?: { statementOfAccountId?: number; periodFrom?: string; periodTo?: string } }> {
    const response = await apiClient.post<{ success: boolean; message?: string; data?: { statementOfAccountId?: number; periodFrom?: string; periodTo?: string } }>(
      `/sales-order/${salesOrderId}/statement-of-account`,
      payload,
    );

    return response.data;
  }

  async searchProjects(params: {
    search?: string;
    status?: string;
    page?: number;
    limit?: number;
    branchId?: number;
  }): Promise<{ items: ProjectMasterOption[]; meta: SalesListMeta }> {
    const response = await apiClient.get<{ success: boolean; items?: ProjectMasterOption[]; meta?: SalesListMeta }>(
      '/sales-order/projects/search',
      { params },
    );

    return {
      items: response.data.items ?? [],
      meta: response.data.meta ?? { page: params.page ?? 1, limit: params.limit ?? 10, total: 0, totalPages: 1 },
    };
  }

  async getProjectWithRelatedSOs(projectId: number): Promise<ProjectWithRelatedSOs | null> {
    const response = await apiClient.get<{
      success: boolean;
      message?: string;
      data?: ProjectWithRelatedSOs;
    }>(`/sales-order/projects/${projectId}/related-orders`);

    if (!response.data.success || !response.data.data) {
      return null;
    }

    return response.data.data;
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

  async scanSalesSerialBatch(payload: {
    items: Array<{
      serialNumber: string;
      salesId: number;
      expectedProductId?: number;
      expectedCapacityId?: number;
      expectedUnitType?: string;
    }>;
  }): Promise<ScanSalesSerialBatchResponse> {
    const response = await apiClient.post<ScanSalesSerialBatchResponse>(
      '/serial-number/scan-sales-order/batch',
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

  async bulkUpdateSerialStatus(serialNumbers: string[], status: string): Promise<{ success: boolean; message?: string; updated?: number }> {
    const response = await apiClient.post<{ success: boolean; message?: string; updated?: number }>(
      '/serial-number/bulk-update-status',
      { serialNumbers, status },
    );
    return response.data;
  }

  async insertBulkSerials(serials: Array<{ serialNumber: string; unitType?: string; status?: string; productId?: number; capacityId?: number }>): Promise<{ success: boolean; message?: string; inserted?: number; skipped?: number }> {
    const response = await apiClient.post('/serial-number/insert-bulk', { serials });
    return response.data;
  }

  async previewCsvSerials(rows: Array<{ serialNumber: string; unitType?: string; status: string }>, productId?: number, capacityId?: number): Promise<{
    success: boolean;
    message?: string;
    summary?: {
      total: number; toInstall: number; alreadyInstalled: number; installedInDb?: number; notFound: number; otherStatus: number; notInCsv?: number;
      totalSets: number; unitTypeCounts: Record<string, number>; remainingStocks: number;
    };
    toInstall?: Array<{ serialNumber: string; csvStatus: string; csvUnitType: string; unitType: string; productName: string; capacityName: string }>;
    alreadyInstalled?: Array<{ serialNumber: string; unitType: string; productName: string; capacityName: string }>;
    installedInDb?: Array<{ serialNumber: string; csvStatus: string; csvUnitType: string; unitType: string; productName: string; capacityName: string }>;
    notFound?: Array<{ serialNumber: string; csvStatus: string; csvUnitType: string }>;
    otherStatus?: Array<{ serialNumber: string; csvStatus: string; dbStatus: string; unitType: string; productName: string; capacityName: string }>;
    notInCsv?: Array<{ serialNumber: string; dbStatus: string; unitType: string; productName: string; capacityName: string }>;
  }> {
    const response = await apiClient.post('/serial-number/csv-preview', { rows, productId, capacityId });
    return response.data;
  }
}
