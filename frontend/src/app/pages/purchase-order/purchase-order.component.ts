import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PageBreadcrumbComponent } from '../../shared/components/common/page-breadcrumb/page-breadcrumb.component';
import {
  CreatePurchaseRequestPayload,
  PurchaseOrderDetailItem,
  PurchaseOrderDetailProductItem,
  ProductCapacityOption,
  ProductOption,
  PurchaseOrderItem,
  PurchaseOrderService,
  VendorOption,
} from '../../shared/services/purchase-order.service';
import { RbacService } from '../../shared/services/rbac.service';
import axios from 'axios';

type PurchaseTab = 'deliveries' | 'approvals' | 'master-data';

interface PurchaseProductFormItem {
  productId: string;
  capacityId: string;
  unitPrice: number;
  sellPrice: number | '';
  discountPrice: number | '';
  unitTypes: PurchaseUnitTypeFormItem[];
  totalSetQty: number;
}

interface PurchaseUnitTypeFormItem {
  label: string;
  value: number;
  serials: string[];
  serialInput: string;
  scanInput: string;
  scanError: string;
  scanSuccess: string;
  isScanning: boolean;
}

interface PurchasePaymentFormItem {
  method: string;
  amount: number;
  terms: string;
  termsDueDate: string;
  paymentDate: string;
  downPayment: number;
}

@Component({
  selector: 'app-purchase-order',
  imports: [CommonModule, FormsModule, PageBreadcrumbComponent],
  templateUrl: './purchase-order.component.html',
  styles: ``,
})
export class PurchaseOrderComponent implements OnInit, OnDestroy {
  activeTab: PurchaseTab = 'deliveries';
  isFormDrawerOpen = false;
  drawerMode: 'create' | 'edit' = 'create';
  editingPurchaseId: number | null = null;
  editingPoNumber = '';
  editingPurchaseStatus = '';
  vendorMode: 'existing' | 'new' = 'existing';
  isLoading = false;
  errorMessage = '';
  purchaseOrders: PurchaseOrderItem[] = [];
  search = '';
  page = 1;
  limit = 10;
  total = 0;
  totalPages = 1;
  isCreating = false;
  isProcessingApprovalAction = false;
  createError = '';
  createSuccess = '';
  isExportingSerials = false;
  sendingForApprovalIds = new Set<number>();
  approvingPurchaseIds = new Set<number>();
  catalogProducts: ProductOption[] = [];
  vendorOptions: VendorOption[] = [];
  vendorSearch = '';
  isVendorDropdownOpen = false;
  activeProductTabIndex = 0;
  selectedUnitTypeByProduct: Record<number, string> = {};

  createForm = {
    vendorId: '',
    vendorName: '',
    vendorAddress: '',
    vendorContactPerson: '',
    vendorContactNumber: '',
    paymentDetails: [this.createEmptyPaymentItem()],
    productItems: [this.createEmptyProductItem()],
    totalAmount: 0,
  };
  private readonly searchDebounceMs = 300;
  private searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private vendorDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly serialScanDebounceMs = 120;
  private serialScanTimers: Record<string, ReturnType<typeof setTimeout>> = {};
  private serialScanErrorTimers: Record<string, ReturnType<typeof setTimeout>> = {};
  private readonly purchaseTabPermissionKeyMap: Record<PurchaseTab, string[]> = {
    deliveries: ['purchase-order.tab.deliveries', 'purchase-order.tab.local'],
    approvals: ['purchase-order.tab.approvals'],
    'master-data': ['purchase-order.tab.master-data', 'purchase-order.tab.imported'],
  };

  constructor(
    private readonly purchaseOrderService: PurchaseOrderService,
    private readonly rbacService: RbacService,
  ) {}

  ngOnInit(): void {
    const availableTabs = this.getVisibleTabs();
    if (availableTabs.length > 0) {
      this.activeTab = availableTabs[0];
    }

    void this.loadTabData(this.activeTab);
    void this.loadReferenceData();
    void this.loadVendorOptions();
  }

  ngOnDestroy(): void {
    if (this.searchDebounceTimer) {
      clearTimeout(this.searchDebounceTimer);
      this.searchDebounceTimer = null;
    }

    if (this.vendorDebounceTimer) {
      clearTimeout(this.vendorDebounceTimer);
      this.vendorDebounceTimer = null;
    }

    for (const timer of Object.values(this.serialScanTimers)) {
      clearTimeout(timer);
    }
    this.serialScanTimers = {};

    for (const timer of Object.values(this.serialScanErrorTimers)) {
      clearTimeout(timer);
    }
    this.serialScanErrorTimers = {};
  }

  onVendorSearchChange(value: string): void {
    this.vendorSearch = value;
    this.createForm.vendorId = '';
    this.isVendorDropdownOpen = true;

    // Keep name editable for selected existing vendor payload details.
    this.createForm.vendorName = String(value ?? '').trim();
    this.createForm.vendorAddress = '';
    this.createForm.vendorContactPerson = '';
    this.createForm.vendorContactNumber = '';

    const normalized = String(value ?? '').trim().toLowerCase();
    if (normalized) {
      const exactMatch = this.vendorOptions.find(
        (item) => String(item.name ?? '').trim().toLowerCase() === normalized,
      );

      if (exactMatch) {
        this.createForm.vendorId = exactMatch.id;
        this.createForm.vendorName = exactMatch.name ?? '';
        this.createForm.vendorAddress = exactMatch.address ?? '';
        this.createForm.vendorContactPerson = exactMatch.contact_person ?? '';
        this.createForm.vendorContactNumber = exactMatch.contact_number ?? '';
      }
    }

    if (this.vendorDebounceTimer) {
      clearTimeout(this.vendorDebounceTimer);
    }

    this.vendorDebounceTimer = setTimeout(() => {
      void this.loadVendorOptions(this.vendorSearch);
      this.vendorDebounceTimer = null;
    }, this.searchDebounceMs);
  }

  selectVendor(vendorId: string): void {
    this.createForm.vendorId = vendorId;
    const selected = this.vendorOptions.find((item) => item.id === vendorId);
    if (selected) {
      this.vendorSearch = selected.name;
      this.createForm.vendorName = selected.name ?? '';
      this.createForm.vendorAddress = selected.address ?? '';
      this.createForm.vendorContactPerson = selected.contact_person ?? '';
      this.createForm.vendorContactNumber = selected.contact_number ?? '';
    }

    this.isVendorDropdownOpen = false;
  }

  onVendorComboboxFocus(): void {
    if (this.isMasterDataDrawerMode()) {
      return;
    }

    this.isVendorDropdownOpen = true;
    if (this.vendorOptions.length === 0) {
      void this.loadVendorOptions(this.vendorSearch);
    }
  }

  onVendorComboboxBlur(): void {
    setTimeout(() => {
      this.isVendorDropdownOpen = false;
    }, 150);
  }

  getFilteredVendorOptions(): VendorOption[] {
    const normalizedQuery = String(this.vendorSearch ?? '').trim().toLowerCase();
    if (!normalizedQuery) {
      return this.vendorOptions;
    }

    return this.vendorOptions.filter((item) =>
      String(item.name ?? '').toLowerCase().includes(normalizedQuery),
    );
  }

  async setTab(tab: PurchaseTab): Promise<void> {
    if (!this.canAccessPurchaseTab(tab)) {
      return;
    }

    if (this.activeTab === tab) {
      return;
    }

    this.activeTab = tab;
    this.page = 1;
    await this.loadTabData(tab);
  }

  onSearchChange(value: string): void {
    this.search = value;
    this.page = 1;

    if (this.searchDebounceTimer) {
      clearTimeout(this.searchDebounceTimer);
    }

    this.searchDebounceTimer = setTimeout(() => {
      void this.loadTabData(this.activeTab);
      this.searchDebounceTimer = null;
    }, this.searchDebounceMs);
  }

  onPageChange(nextPage: number): void {
    if (nextPage < 1 || nextPage > this.totalPages || nextPage === this.page) {
      return;
    }

    this.page = nextPage;
    void this.loadTabData(this.activeTab);
  }

  async submitCreatePurchase(): Promise<void> {
    if (!this.canCreateOrUpdatePurchase()) {
      this.createError = 'You do not have permission to save purchase orders.';
      return;
    }

    if (this.isCreating) {
      return;
    }

    this.isCreating = true;
    this.createError = '';
    this.createSuccess = '';

    try {
      const payload = this.buildPurchasePayload();
      const response =
        this.drawerMode === 'edit' && this.editingPurchaseId
          ? await this.purchaseOrderService.updatePurchase(this.editingPurchaseId, payload)
          : await this.purchaseOrderService.createPurchase(payload);

      if (!response.success) {
        this.createError =
          response.message ??
          (this.drawerMode === 'edit'
            ? 'Failed to update purchase request'
            : 'Failed to create purchase request');
        return;
      }

      this.createSuccess =
        response.message ??
        (this.drawerMode === 'edit'
          ? 'Purchase request updated successfully'
          : 'Purchase request created successfully');
      this.resetCreateForm();
      this.closeCreateDrawer();
      this.page = 1;
      await this.loadTabData(this.activeTab);
    } catch (error: unknown) {
      if (axios.isAxiosError(error)) {
        this.createError =
          (error.response?.data as { message?: string } | undefined)?.message ??
          'Failed to create purchase request';
      } else {
        this.createError = 'Failed to create purchase request';
      }
    } finally {
      this.isCreating = false;
    }
  }

  private async loadTabData(tab: PurchaseTab): Promise<void> {
    if (!this.canAccessPurchaseTab(tab)) {
      this.purchaseOrders = [];
      this.total = 0;
      this.totalPages = 1;
      this.errorMessage = 'You do not have access to this purchase tab.';
      return;
    }

    this.isLoading = true;
    this.errorMessage = '';
    const query = {
      page: this.page,
      limit: this.limit,
      search: this.search.trim() || undefined,
    };

    try {
      if (tab === 'deliveries') {
        const result = await this.purchaseOrderService.getDeliveries(query);
        this.purchaseOrders = result.items;
        this.applyMeta(result.meta);
      } else if (tab === 'approvals') {
        const result = await this.purchaseOrderService.getApprovals(query);
        this.purchaseOrders = result.items;
        this.applyMeta(result.meta);
      } else {
        const result = await this.purchaseOrderService.getMasterData(query);
        this.purchaseOrders = result.items;
        this.applyMeta(result.meta);
      }
    } catch (error: unknown) {
      if (axios.isAxiosError(error)) {
        this.errorMessage =
          (error.response?.data as { message?: string } | undefined)?.message ??
          'Unable to load purchase orders';
      } else {
        this.errorMessage = 'Unable to load purchase orders';
      }
      this.purchaseOrders = [];
      this.total = 0;
      this.totalPages = 1;
    } finally {
      this.isLoading = false;
    }
  }

  formatDate(value: string | null): string {
    if (!value) {
      return '-';
    }

    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
  }

  formatAmount(value: number): string {
    return new Intl.NumberFormat('en-PH', {
      style: 'currency',
      currency: 'PHP',
      minimumFractionDigits: 2,
    }).format(value ?? 0);
  }

  isMasterDataDrawerMode(): boolean {
    return this.activeTab === 'master-data' && this.drawerMode === 'edit';
  }

  getRowActionLabel(): 'View' | 'Edit' {
    return this.activeTab === 'approvals' || this.activeTab === 'master-data'
      ? 'View'
      : 'Edit';
  }

  canSendForApproval(status: string | null | undefined): boolean {
    const normalized = String(status ?? '').trim().toLowerCase();
    if (!normalized) {
      return true;
    }

    return ![
      'for_approval',
      'for approval',
      'approval',
      'pending_approval',
      'pending approval',
      'approved',
      'completed',
      'cancelled',
      'rejected',
    ].includes(normalized);
  }

  canApproveFromTable(status: string | null | undefined): boolean {
    return (
      this.activeTab === 'approvals' &&
      this.canApprovePurchaseOrder() &&
      this.isApprovalStageStatus(status)
    );
  }

  async sendForApproval(item: PurchaseOrderItem): Promise<void> {
    if (!this.canCreateOrUpdatePurchase()) {
      this.createError = 'You do not have permission to update purchase orders.';
      return;
    }

    if (this.sendingForApprovalIds.has(item.id) || !this.canSendForApproval(item.status)) {
      return;
    }

    this.sendingForApprovalIds.add(item.id);
    this.createError = '';
    this.createSuccess = '';

    try {
      const response = await this.purchaseOrderService.updatePurchase(item.id, {
        status: 'for_approval',
        productItems: [],
      });

      if (!response.success) {
        this.createError = response.message ?? 'Failed to send purchase order for approval';
        return;
      }

      this.createSuccess = response.message ?? 'Purchase order sent for approval';
      await this.loadTabData(this.activeTab);
    } catch (error: unknown) {
      if (axios.isAxiosError(error)) {
        this.createError =
          (error.response?.data as { message?: string } | undefined)?.message ??
          'Failed to send purchase order for approval';
      } else {
        this.createError = 'Failed to send purchase order for approval';
      }
    } finally {
      this.sendingForApprovalIds.delete(item.id);
    }
  }

  private isApprovalStageStatus(status: string | null | undefined): boolean {
    const normalized = String(status ?? '').trim().toLowerCase();
    return [
      'for_approval',
      'for approval',
      'approval',
      'pending_approval',
      'pending approval',
    ].includes(normalized);
  }

  canShowApprovalDrawerActions(): boolean {
    return (
      this.activeTab === 'approvals' &&
      this.drawerMode === 'edit' &&
      this.editingPurchaseId !== null &&
      this.isApprovalStageStatus(this.editingPurchaseStatus)
    );
  }

  async revertToInProgress(): Promise<void> {
    if (!this.canApprovePurchaseOrder()) {
      this.createError = 'You do not have permission to approve purchase orders.';
      return;
    }

    if (!this.editingPurchaseId || this.isProcessingApprovalAction || !this.canShowApprovalDrawerActions()) {
      return;
    }

    this.isProcessingApprovalAction = true;
    this.createError = '';
    this.createSuccess = '';

    try {
      const response = await this.purchaseOrderService.revertPurchaseToInProgress(this.editingPurchaseId);
      if (!response.success) {
        this.createError = response.message ?? 'Failed to revert purchase order';
        return;
      }

      this.createSuccess = response.message ?? 'Purchase order reverted to in-progress';
      this.closeCreateDrawer();
      await this.loadTabData(this.activeTab);
    } catch (error: unknown) {
      if (axios.isAxiosError(error)) {
        this.createError =
          (error.response?.data as { message?: string } | undefined)?.message ??
          'Failed to revert purchase order';
      } else {
        this.createError = 'Failed to revert purchase order';
      }
    } finally {
      this.isProcessingApprovalAction = false;
    }
  }

  async approvePurchaseOrder(): Promise<void> {
    if (!this.canApprovePurchaseOrder()) {
      this.createError = 'You do not have permission to approve purchase orders.';
      return;
    }

    if (!this.editingPurchaseId || this.isProcessingApprovalAction || !this.canShowApprovalDrawerActions()) {
      return;
    }

    this.isProcessingApprovalAction = true;
    this.createError = '';
    this.createSuccess = '';

    try {
      const response = await this.purchaseOrderService.approvePurchase(this.editingPurchaseId);
      if (!response.success) {
        this.createError = response.message ?? 'Failed to approve purchase order';
        return;
      }

      this.createSuccess = response.message ?? 'Purchase order approved successfully';
      this.closeCreateDrawer();
      await this.loadTabData(this.activeTab);
    } catch (error: unknown) {
      if (axios.isAxiosError(error)) {
        this.createError =
          (error.response?.data as { message?: string } | undefined)?.message ??
          'Failed to approve purchase order';
      } else {
        this.createError = 'Failed to approve purchase order';
      }
    } finally {
      this.isProcessingApprovalAction = false;
    }
  }

  async approvePurchaseOrderFromTable(item: PurchaseOrderItem): Promise<void> {
    if (!this.canApproveFromTable(item.status)) {
      return;
    }

    if (this.approvingPurchaseIds.has(item.id)) {
      return;
    }

    this.approvingPurchaseIds.add(item.id);
    this.createError = '';
    this.createSuccess = '';

    try {
      const response = await this.purchaseOrderService.approvePurchase(item.id);
      if (!response.success) {
        this.createError = response.message ?? 'Failed to approve purchase order';
        return;
      }

      this.createSuccess = response.message ?? 'Purchase order approved successfully';
      await this.loadTabData(this.activeTab);
    } catch (error: unknown) {
      if (axios.isAxiosError(error)) {
        this.createError =
          (error.response?.data as { message?: string } | undefined)?.message ??
          'Failed to approve purchase order';
      } else {
        this.createError = 'Failed to approve purchase order';
      }
    } finally {
      this.approvingPurchaseIds.delete(item.id);
    }
  }

  openCreateDrawer(): void {
    if (!this.canCreateOrUpdatePurchase()) {
      this.createError = 'You do not have permission to create purchase orders.';
      return;
    }

    this.resetCreateForm();
    this.drawerMode = 'create';
    this.editingPurchaseId = null;
    this.createError = '';
    this.createSuccess = '';
    this.isFormDrawerOpen = true;
  }

  async openEditDrawer(item: PurchaseOrderItem): Promise<void> {
    if (!this.canCreateOrUpdatePurchase()) {
      this.createError = 'You do not have permission to update purchase orders.';
      return;
    }

    this.resetCreateForm();
    this.drawerMode = 'edit';
    this.editingPurchaseId = item.id;
    this.isFormDrawerOpen = true;
    this.createError = '';
    this.createSuccess = '';

    try {
      const detail = await this.purchaseOrderService.getPurchaseById(item.id);

      if (!detail) {
        this.createError = 'Failed to load purchase order details';
        return;
      }

      this.applyDetailToForm(detail, item);
      this.editingPoNumber = String(detail.poNumber ?? item.poNumber ?? '').trim();
      this.editingPurchaseStatus = String(detail.status ?? item.status ?? '').trim();
    } catch (error: unknown) {
      if (axios.isAxiosError(error)) {
        this.createError =
          (error.response?.data as { message?: string } | undefined)?.message ??
          'Failed to load purchase order details';
      } else {
        this.createError = 'Failed to load purchase order details';
      }
    }
  }

  closeCreateDrawer(): void {
    this.isFormDrawerOpen = false;
    this.isProcessingApprovalAction = false;
    this.isExportingSerials = false;
  }

  hasAnyScannedSerials(): boolean {
    const activeItem = this.getActiveProductItem();
    if (!activeItem) {
      return false;
    }

    return activeItem.unitTypes.some((unitType) => unitType.serials.length > 0);
  }

  async exportScannedSerialsAsExcel(): Promise<void> {
    const rows = this.buildScannedSerialExportRows();
    if (rows.length === 0) {
      this.createError = 'No scanned serial numbers available to export.';
      return;
    }

    this.isExportingSerials = true;
    this.createError = '';

    try {
      const excelJs = await import('exceljs');
      const workbook = new excelJs.Workbook();
      const worksheet = workbook.addWorksheet('Scanned Serials');

      worksheet.columns = [
        { header: 'Unit Type', key: 'unitType', width: 14 },
        { header: 'Serial Number', key: 'serialNumber', width: 28 },
      ];

      rows.forEach((row) => worksheet.addRow(row));
      const headerRow = worksheet.getRow(1);
      headerRow.font = { bold: true };

      const buffer = await workbook.xlsx.writeBuffer();
      const fileName = `${this.buildSerialExportFileBaseName()}.xlsx`;
      this.downloadBlob(
        new Blob([buffer], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }),
        fileName,
      );
    } catch {
      this.createError = 'Failed to export serial numbers to Excel.';
    } finally {
      this.isExportingSerials = false;
    }
  }

  exportScannedSerialsAsCsv(): void {
    const rows = this.buildScannedSerialExportRows();
    if (rows.length === 0) {
      this.createError = 'No scanned serial numbers available to export.';
      return;
    }

    const headers = ['Unit Type', 'Serial Number'];
    const csvLines = [headers.map((value) => this.escapeCsvValue(value)).join(',')];

    for (const row of rows) {
      csvLines.push(
        [
          row.unitType,
          row.serialNumber,
        ]
          .map((value) => this.escapeCsvValue(value))
          .join(','),
      );
    }

    const fileName = `${this.buildSerialExportFileBaseName()}.csv`;
    this.downloadBlob(new Blob([csvLines.join('\r\n')], { type: 'text/csv;charset=utf-8;' }), fileName);
  }

  canCreateOrUpdatePurchase(): boolean {
    return this.rbacService.canAccess('purchase_order', 'canUpdate') ||
      this.rbacService.canAccess('purchase_order', 'canCreate');
  }

  canApprovePurchaseOrder(): boolean {
    return this.rbacService.canAccess('purchase_order', 'canUpdate');
  }

  canAccessPurchaseTab(tab: PurchaseTab): boolean {
    if (!this.rbacService.canAccess('purchase_order', 'canRead')) {
      return false;
    }

    const acceptedKeys = this.purchaseTabPermissionKeyMap[tab] ?? [];
    const isTabExplicitlyDenied = acceptedKeys.some((permissionKey) =>
      this.rbacService.hasDeniedPermissionKey(permissionKey),
    );
    if (isTabExplicitlyDenied) {
      return false;
    }

    const hasAnyAllowedTabRules =
      this.rbacService.hasAnyEffectivePermissionWithPrefix('purchase-order.tab.');
    const hasAnyDeniedTabRules =
      this.rbacService.hasAnyDeniedPermissionWithPrefix('purchase-order.tab.');
    const hasExplicitTabRules = hasAnyAllowedTabRules || hasAnyDeniedTabRules;
    if (!hasExplicitTabRules) {
      return true;
    }

    if (acceptedKeys.length === 0) {
      return true;
    }

    const isTabExplicitlyAllowed = acceptedKeys.some((permissionKey) =>
      this.rbacService.hasEffectivePermissionKey(permissionKey),
    );
    if (isTabExplicitlyAllowed) {
      return true;
    }

    // Deny-list mode: if no tab allow keys exist, treat un-denied tabs as allowed.
    if (!hasAnyAllowedTabRules && hasAnyDeniedTabRules) {
      return true;
    }

    return false;
  }

  getVisibleTabs(): PurchaseTab[] {
    const allTabs: PurchaseTab[] = ['deliveries', 'approvals', 'master-data'];
    return allTabs.filter((tab) => this.canAccessPurchaseTab(tab));
  }

  private applyMeta(meta?: { page: number; limit: number; total: number; totalPages: number }): void {
    if (!meta) {
      this.total = this.purchaseOrders.length;
      this.totalPages = 1;
      return;
    }

    this.page = meta.page;
    this.limit = meta.limit;
    this.total = meta.total;
    this.totalPages = Math.max(1, meta.totalPages || 1);
  }

  private resetCreateForm(): void {
    this.drawerMode = 'create';
    this.editingPurchaseId = null;
    this.editingPoNumber = '';
    this.editingPurchaseStatus = '';
    this.vendorMode = 'existing';
    this.createForm = {
      vendorId: '',
      vendorName: '',
      vendorAddress: '',
      vendorContactPerson: '',
      vendorContactNumber: '',
      paymentDetails: [this.createEmptyPaymentItem()],
      productItems: [this.createEmptyProductItem()],
      totalAmount: 0,
    };
    this.vendorSearch = '';
    this.activeProductTabIndex = 0;
    this.selectedUnitTypeByProduct = {};
  }

  private buildScannedSerialExportRows(): Array<{
    unitType: string;
    serialNumber: string;
  }> {
    const activeItem = this.getActiveProductItem();
    if (!activeItem) {
      return [];
    }

    const rows: Array<{
      unitType: string;
      serialNumber: string;
    }> = [];

    for (const unitType of activeItem.unitTypes) {
      for (const serialNumber of unitType.serials) {
        rows.push({
          unitType: unitType.label,
          serialNumber,
        });
      }
    }

    return rows;
  }

  private getProductNameById(productId: string): string {
    const matched = this.catalogProducts.find((item) => String(item.id) === String(productId));
    return matched?.name ?? String(productId || '-');
  }

  private getCapacityNameByProductAndCapacity(productId: string, capacityId: string): string {
    const capacities = this.getCapacitiesByProduct(productId);
    const matched = capacities.find((item) => String(item.id) === String(capacityId));
    return matched?.name ?? String(capacityId || '-');
  }

  private buildSerialExportFileBaseName(): string {
    const activeItem = this.getActiveProductItem();
    const poNumber = this.toFileNamePart(this.editingPoNumber || `po-${this.editingPurchaseId ?? 'request'}`);
    const productName = this.toFileNamePart(
      activeItem ? this.getProductNameById(activeItem.productId) : 'product',
    );
    const capacityName = this.toFileNamePart(
      activeItem
        ? this.getCapacityNameByProductAndCapacity(activeItem.productId, activeItem.capacityId)
        : 'capacity',
    );

    return `${poNumber}_${productName}_${capacityName}`;
  }

  private toFileNamePart(value: unknown): string {
    const normalized = String(value ?? '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');

    return normalized || 'na';
  }

  private escapeCsvValue(value: unknown): string {
    const normalized = String(value ?? '').replace(/"/g, '""');
    return `"${normalized}"`;
  }

  private downloadBlob(blob: Blob, fileName: string): void {
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = fileName;
    anchor.click();
    URL.revokeObjectURL(objectUrl);
  }

  addProductItem(): void {
    this.createForm.productItems = [...this.createForm.productItems, this.createEmptyProductItem()];
    this.activeProductTabIndex = this.createForm.productItems.length - 1;
    this.ensureSelectedUnitType(this.activeProductTabIndex);
    this.recalculateTotalAmount();
  }

  removeProductItem(index: number): void {
    if (this.createForm.productItems.length <= 1) {
      return;
    }

    this.createForm.productItems = this.createForm.productItems.filter((_, itemIndex) => itemIndex !== index);
    delete this.selectedUnitTypeByProduct[index];
    this.selectedUnitTypeByProduct = Object.fromEntries(
      Object.entries(this.selectedUnitTypeByProduct).map(([itemIndex, label]) => {
        const numericIndex = Number(itemIndex);
        if (numericIndex > index) {
          return [String(numericIndex - 1), label];
        }

        return [itemIndex, label];
      }),
    );
    this.activeProductTabIndex = Math.max(0, Math.min(this.activeProductTabIndex, this.createForm.productItems.length - 1));
    this.ensureSelectedUnitType(this.activeProductTabIndex);
    this.recalculateTotalAmount();
  }

  onProductChanged(index: number): void {
    const nextItems = [...this.createForm.productItems];
    nextItems[index] = {
      ...nextItems[index],
      capacityId: '',
    };
    this.createForm.productItems = nextItems;
    this.recalculateTotalAmount();
  }

  recalculateTotalAmount(): void {
    const total = this.createForm.productItems.reduce((sum, item) => {
      const unitPrice = Number(item.unitPrice) || 0;
      const discountPrice = Number(item.discountPrice) || 0;
      const qty = Math.max(0, Number(item.totalSetQty) || 0);
      const priceToUse = discountPrice > 0 ? discountPrice : unitPrice;
      return sum + priceToUse * qty;
    }, 0);

    this.createForm.totalAmount = total;
  }

  getCapacitiesByProduct(productId: string): ProductCapacityOption[] {
    const product = this.catalogProducts.find((item) => String(item.id) === String(productId));
    return product?.capacities ?? [];
  }

  addPaymentDetail(): void {
    this.createForm.paymentDetails = [...this.createForm.paymentDetails, this.createEmptyPaymentItem()];
  }

  removePaymentDetail(index: number): void {
    if (this.createForm.paymentDetails.length <= 1) {
      return;
    }

    this.createForm.paymentDetails = this.createForm.paymentDetails.filter((_, itemIndex) => itemIndex !== index);
  }

  setActiveProductTab(index: number): void {
    this.activeProductTabIndex = index;
    this.ensureSelectedUnitType(index);
    if (this.drawerMode === 'edit') {
      const selectedUnit = this.getSelectedUnitTypeLabel(index);
      this.focusSerialScanInput(index, selectedUnit);
    }
  }

  getActiveProductItem(): PurchaseProductFormItem | null {
    return this.createForm.productItems[this.activeProductTabIndex] ?? null;
  }

  getSelectedUnitTypeLabel(productIndex: number): string {
    const selected = this.selectedUnitTypeByProduct[productIndex];
    if (selected) {
      return selected;
    }

    const fallback = this.createForm.productItems[productIndex]?.unitTypes[0]?.label ?? 'set';
    this.selectedUnitTypeByProduct[productIndex] = fallback;
    return fallback;
  }

  selectUnitType(productIndex: number, unitLabel: string): void {
    this.selectedUnitTypeByProduct[productIndex] = unitLabel;
    if (this.drawerMode === 'edit') {
      this.focusSerialScanInput(productIndex, unitLabel);
    }
  }

  onUnitTypeQtyChange(productIndex: number): void {
    const item = this.createForm.productItems[productIndex];
    if (!item) {
      return;
    }

    const maxQtyFromUnitTypes = item.unitTypes.reduce((maxQty, entry) => {
      const parsed = Number(entry.value) || 0;
      return parsed > maxQty ? parsed : maxQty;
    }, 0);

    if (maxQtyFromUnitTypes > 0) {
      item.totalSetQty = maxQtyFromUnitTypes;
      item.unitTypes.forEach((entry) => {
        entry.value = maxQtyFromUnitTypes;
      });
    }

    this.recalculateTotalAmount();
  }

  onTotalSetQtyChange(productIndex: number): void {
    const item = this.createForm.productItems[productIndex];
    if (!item) {
      return;
    }

    const parsedTotalSetQty = Math.max(0, Number(item.totalSetQty) || 0);
    item.totalSetQty = parsedTotalSetQty;
    item.unitTypes.forEach((entry) => {
      entry.value = parsedTotalSetQty;
    });

    this.recalculateTotalAmount();
  }

  async scanSerialForSelectedUnit(productIndex: number): Promise<void> {
    if (this.drawerMode !== 'edit' || !this.editingPurchaseId) {
      return;
    }

    const item = this.createForm.productItems[productIndex];
    if (!item) {
      return;
    }

    const unitLabel = this.getSelectedUnitTypeLabel(productIndex);
    const unitEntry = item.unitTypes.find((entry) => entry.label === unitLabel);
    if (!unitEntry) {
      return;
    }

    const serialNumber = this.normalizeSerial(unitEntry.scanInput);
    unitEntry.scanError = '';
    unitEntry.scanSuccess = '';

    if (!serialNumber) {
      unitEntry.scanError = 'Enter serial number before scanning';
      return;
    }

    const productId = Number(item.productId);
    const capacityId = Number(item.capacityId);

    if (!Number.isFinite(productId) || !Number.isFinite(capacityId)) {
      unitEntry.scanError = 'Select product and capacity before scanning serial numbers';
      return;
    }

    const allowedQty = Number(unitEntry.value) || 0;
    if (allowedQty > 0 && unitEntry.serials.length >= allowedQty) {
      this.setTransientScanError(
        productIndex,
        unitLabel,
        `Limit reached. ${unitLabel} allows only ${allowedQty} serial number${allowedQty > 1 ? 's' : ''}`,
      );
      unitEntry.scanInput = '';
      this.focusSerialScanInput(productIndex, unitLabel);
      return;
    }

    const normalizedIncoming = serialNumber.toLowerCase();
    const existsInOtherUnitType = item.unitTypes.some((entry) => {
      if (entry.label === unitLabel) {
        return false;
      }

      return entry.serials.some(
        (serial) => this.normalizeSerial(serial).toLowerCase() === normalizedIncoming,
      );
    });

    if (existsInOtherUnitType) {
      unitEntry.scanError = 'Serial number already exists in another unit type for this product';
      return;
    }

    unitEntry.isScanning = true;

    try {
      const response = await this.purchaseOrderService.scanPurchaseSerial({
        serialNumber,
        purchaseId: this.editingPurchaseId,
        expectedProductId: productId,
        expectedCapacityId: capacityId,
        unitType: unitLabel,
      });

      if (!response.success) {
        unitEntry.scanError = response.message ?? 'Failed to scan serial number';
        return;
      }

      const normalizedSerial = this.normalizeSerial(response.item?.serialNumber ?? serialNumber);
      const existingSerialsLower = new Set(
        unitEntry.serials.map((entry) => this.normalizeSerial(entry).toLowerCase()),
      );

      if (!existingSerialsLower.has(normalizedSerial.toLowerCase())) {
        unitEntry.serials = [...unitEntry.serials, normalizedSerial];
      }
      unitEntry.scanInput = '';
      unitEntry.scanSuccess = response.message ?? 'Serial number scanned successfully';
      unitEntry.scanError = '';
      unitEntry.serialInput = unitEntry.serials.join('\n');
      this.focusSerialScanInput(productIndex, unitLabel);
    } catch (error: unknown) {
      if (axios.isAxiosError(error)) {
        unitEntry.scanError =
          (error.response?.data as { message?: string } | undefined)?.message ??
          'Failed to scan serial number';
      } else {
        unitEntry.scanError = 'Failed to scan serial number';
      }
    } finally {
      unitEntry.isScanning = false;
    }
  }

  onSerialScanInputChange(productIndex: number, unitLabel: string, value: string): void {
    const item = this.createForm.productItems[productIndex];
    if (!item) {
      return;
    }

    const unitEntry = item.unitTypes.find((entry) => entry.label === unitLabel);
    if (!unitEntry) {
      return;
    }

    unitEntry.scanInput = value;
    unitEntry.scanError = '';
    unitEntry.scanSuccess = '';

    const normalizedSerial = this.normalizeSerial(value);
    if (!normalizedSerial) {
      return;
    }

    const timerKey = `${productIndex}::${unitLabel}`;
    const existingTimer = this.serialScanTimers[timerKey];
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    this.serialScanTimers[timerKey] = setTimeout(() => {
      void this.scanSerialForSelectedUnit(productIndex);
      delete this.serialScanTimers[timerKey];
    }, this.serialScanDebounceMs);
  }

  private setTransientScanError(productIndex: number, unitLabel: string, message: string): void {
    const item = this.createForm.productItems[productIndex];
    if (!item) {
      return;
    }

    const unitEntry = item.unitTypes.find((entry) => entry.label === unitLabel);
    if (!unitEntry) {
      return;
    }

    const timerKey = `${productIndex}::${unitLabel}`;
    const existingTimer = this.serialScanErrorTimers[timerKey];
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    unitEntry.scanError = message;
    unitEntry.scanSuccess = '';

    this.serialScanErrorTimers[timerKey] = setTimeout(() => {
      const currentItem = this.createForm.productItems[productIndex];
      const currentUnit = currentItem?.unitTypes.find((entry) => entry.label === unitLabel);
      if (currentUnit && currentUnit.scanError === message) {
        currentUnit.scanError = '';
      }

      delete this.serialScanErrorTimers[timerKey];
    }, 3000);
  }

  private focusSerialScanInput(productIndex: number, unitLabel: string): void {
    setTimeout(() => {
      const inputId = `scanInput_${productIndex}_${unitLabel}`;
      const element = document.getElementById(inputId) as HTMLInputElement | null;
      if (!element) {
        return;
      }

      element.focus();
      element.select();
    }, 0);
  }

  async removeScannedSerial(
    productIndex: number,
    unitLabel: string,
    serialNumber: string,
  ): Promise<void> {
    if (!this.editingPurchaseId) {
      return;
    }

    const item = this.createForm.productItems[productIndex];
    if (!item) {
      return;
    }

    const unitEntry = item.unitTypes.find((entry) => entry.label === unitLabel);
    if (!unitEntry) {
      return;
    }

    unitEntry.scanError = '';
    unitEntry.scanSuccess = '';
    unitEntry.isScanning = true;

    try {
      const response = await this.purchaseOrderService.removePurchaseSerial({
        serialNumber,
        purchaseId: this.editingPurchaseId,
        unitType: unitLabel,
      });

      if (!response.success) {
        unitEntry.scanError = response.message ?? 'Failed to delete serial number';
        return;
      }

      const normalizedTarget = this.normalizeSerial(serialNumber).toLowerCase();
      unitEntry.serials = unitEntry.serials.filter(
        (entry) => this.normalizeSerial(entry).toLowerCase() !== normalizedTarget,
      );

      const parsedInput = this.parseSerials(unitEntry.serialInput).filter(
        (entry) => this.normalizeSerial(entry).toLowerCase() !== normalizedTarget,
      );

      unitEntry.serialInput = parsedInput.join('\n');
      unitEntry.scanSuccess = response.message ?? 'Serial number deleted successfully';
      unitEntry.scanError = '';
    } catch (error: unknown) {
      if (axios.isAxiosError(error)) {
        unitEntry.scanError =
          (error.response?.data as { message?: string } | undefined)?.message ??
          'Failed to delete serial number';
      } else {
        unitEntry.scanError = 'Failed to delete serial number';
      }
    } finally {
      unitEntry.isScanning = false;
    }
  }

  private buildPurchasePayload(): CreatePurchaseRequestPayload {
    const vendorId = this.createForm.vendorId.trim();
    const vendorName = this.createForm.vendorName.trim();
    const useExistingVendor = this.vendorMode === 'existing';
    const vendorPayload = vendorName
      ? {
          name: vendorName,
          address: this.createForm.vendorAddress.trim() || undefined,
          contact_person: this.createForm.vendorContactPerson.trim() || undefined,
          contact_number: this.createForm.vendorContactNumber.trim() || undefined,
        }
      : undefined;

    return {
      vendorId: useExistingVendor ? vendorId || undefined : undefined,
      vendor: vendorPayload,
      paymentDetails: this.createForm.paymentDetails.map((payment) => ({
        amount: Number(payment.amount) || 0,
        method: payment.method.trim() || undefined,
        terms: payment.terms.trim() || undefined,
        termsDueDate: payment.termsDueDate || null,
        status: 'unpaid' as const,
        paymentDate: payment.paymentDate || null,
        downPayment: Number(payment.downPayment) || 0,
      })),
      productItems: this.createForm.productItems.map((item) => ({
        transType: 'purchase',
        productId: item.productId ? Number(item.productId) : undefined,
        capacityId: item.capacityId ? Number(item.capacityId) : undefined,
        unitPrice: Number(item.unitPrice) || 0,
        sellPrice: item.sellPrice === '' ? '' : Number(item.sellPrice) || '',
        discountPrice: item.discountPrice === '' ? '' : Number(item.discountPrice) || '',
        unitTypesQty: item.unitTypes.map((entry) => ({
          label: entry.label,
          value: Number(entry.value) || 0,
        })),
        totalSetQty: Number(item.totalSetQty) || 0,
        purchaseId: null,
        salesId: null,
        ...(this.drawerMode === 'edit'
          ? {
              serialNumbers: this.buildSerialNumbersPayload(item),
            }
          : {}),
      })),
      totalAmount: Number(this.createForm.totalAmount) || 0,
    };
  }

  private async loadReferenceData(): Promise<void> {
    try {
      const products = await this.purchaseOrderService.getProducts();
      this.catalogProducts = Array.isArray(products) ? products : [];
    } catch {
      this.catalogProducts = [];
    }
  }

  private async loadVendorOptions(search?: string): Promise<void> {
    try {
      const vendors = await this.purchaseOrderService.getVendors(search);
      this.vendorOptions = Array.isArray(vendors) ? vendors : [];
    } catch {
      this.vendorOptions = [];
    }
  }

  private parseSerials(rawValue: string): string[] {
    return String(rawValue ?? '')
      .split(/\r?\n|,/)
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
  }

  private normalizeSerial(rawValue: unknown): string {
    return String(rawValue ?? '')
      .trim()
      .replace(/\s+/g, ' ');
  }

  private buildSerialNumbersPayload(item: PurchaseProductFormItem): Record<string, string[]> {
    const globalSeen = new Set<string>();

    return item.unitTypes.reduce<Record<string, string[]>>((accumulator, unitType) => {
      const typed = this.parseSerials(unitType.serialInput);
      const scanned = unitType.serials.map((entry) => this.normalizeSerial(entry));
      const mergedMap = new Map<string, string>();
      for (const entry of [...scanned, ...typed]) {
        const normalized = this.normalizeSerial(entry);
        if (!normalized) {
          continue;
        }

        const key = normalized.toLowerCase();
        if (!mergedMap.has(key)) {
          mergedMap.set(key, normalized);
        }
      }

      const merged = [...mergedMap.values()].filter((entry) => {
        const key = entry.toLowerCase();
        if (globalSeen.has(key)) {
          return false;
        }

        globalSeen.add(key);
        return true;
      });

      if (merged.length > 0) {
        accumulator[unitType.label] = merged;
      }

      return accumulator;
    }, {});
  }

  private applyDetailToForm(detail: PurchaseOrderDetailItem, fallbackItem: PurchaseOrderItem): void {
    this.vendorMode = detail.vendorId ? 'existing' : 'new';

    const paymentDetails = detail.paymentDetails.length > 0
      ? detail.paymentDetails.map((payment) => ({
          method: payment.method ?? '',
          amount: Number(payment.amount) || 0,
          terms: payment.terms ?? '',
          termsDueDate: this.toDateInputValue(payment.termsDueDate),
          paymentDate: this.toDateInputValue(payment.paymentDate),
          downPayment: Number(payment.downPayment) || 0,
        }))
      : [this.createEmptyPaymentItem()];

    const productItems = detail.productItems.length > 0
      ? detail.productItems.map((product) => this.mapDetailProductItem(product))
      : [this.createEmptyProductItem()];

    this.createForm = {
      vendorId: detail.vendorId ?? '',
      vendorName: detail.vendorName ?? fallbackItem.vendorName ?? '',
      vendorAddress: detail.vendorAddress ?? '',
      vendorContactPerson: detail.vendorContactPerson ?? '',
      vendorContactNumber: detail.vendorContactNumber ?? '',
      paymentDetails,
      productItems,
      totalAmount: Number(detail.totalAmount) || Number(fallbackItem.totalAmount) || 0,
    };

    this.vendorSearch = detail.vendorName ?? fallbackItem.vendorName ?? '';
    if (detail.vendorId && !this.vendorOptions.some((vendor) => vendor.id === detail.vendorId)) {
      this.vendorOptions = [
        { id: detail.vendorId, name: detail.vendorName || detail.vendorId },
        ...this.vendorOptions,
      ];
    }

    this.activeProductTabIndex = 0;
    this.selectedUnitTypeByProduct = {};
    this.createForm.productItems.forEach((_, index) => this.ensureSelectedUnitType(index));
    this.recalculateTotalAmount();
  }

  private mapDetailProductItem(product: PurchaseOrderDetailProductItem): PurchaseProductFormItem {
    const unitTypesFromPayload = Array.isArray(product.unitTypesQty) ? product.unitTypesQty : [];
    const serialNumbers = this.normalizeSerialNumbersByUnitType(product.serialNumbers);

    let normalizedUnitTypes: PurchaseUnitTypeFormItem[] = [];
    if (unitTypesFromPayload.length > 0) {
      const mergedByLabel = new Map<string, PurchaseUnitTypeFormItem>();

      for (const entry of unitTypesFromPayload) {
        const label = this.normalizeUnitTypeLabel(entry.label);
        const serials = Array.isArray(serialNumbers[label]) ? serialNumbers[label] : [];
        const nextEntry = this.createUnitTypeEntry(label, Number(entry.value) || 0, serials);
        const existing = mergedByLabel.get(label);

        if (!existing) {
          mergedByLabel.set(label, nextEntry);
          continue;
        }

        existing.value = Math.max(Number(existing.value) || 0, Number(nextEntry.value) || 0);
        const mergedSerials = [...new Set([...existing.serials, ...nextEntry.serials])];
        existing.serials = mergedSerials;
        existing.serialInput = mergedSerials.join('\n');
      }

      for (const [label, serials] of Object.entries(serialNumbers)) {
        if (mergedByLabel.has(label) || serials.length === 0) {
          continue;
        }

        mergedByLabel.set(label, this.createUnitTypeEntry(label, Number(serials.length) || 0, serials));
      }

      normalizedUnitTypes = [...mergedByLabel.values()];
    } else {
      normalizedUnitTypes = this.buildUnitTypesFromSerialMap(serialNumbers);
    }

    const unitTypes = normalizedUnitTypes.length > 0
      ? normalizedUnitTypes
      : [this.createUnitTypeEntry('set', Number(product.totalSetQty) || 0, [])];

    const totalSetQtyFromUnitTypes = unitTypes.reduce((maxQty, entry) => {
      const parsed = Number(entry.value) || 0;
      return parsed > maxQty ? parsed : maxQty;
    }, 0);
    const totalSetQty = totalSetQtyFromUnitTypes > 0
      ? totalSetQtyFromUnitTypes
      : Number(product.totalSetQty) || 0;

    return {
      productId: String(product.productId ?? ''),
      capacityId: String(product.capacityId ?? ''),
      unitPrice: Number(product.unitPrice) || 0,
      sellPrice: Number(product.sellPrice) || 0,
      discountPrice: Number(product.discountPrice) || 0,
      unitTypes,
      totalSetQty,
    };
  }

  private buildUnitTypesFromSerialMap(serialMap: Record<string, string[]>): PurchaseUnitTypeFormItem[] {
    const entries = Object.entries(serialMap)
      .filter(([label]) => label.trim().length > 0)
      .map(([label, serials]) => this.createUnitTypeEntry(label, Number(serials.length) || 0, serials));

    return entries;
  }

  private createUnitTypeEntry(label: string, value = 0, serials: string[] = []): PurchaseUnitTypeFormItem {
    const normalizedLabel = this.normalizeUnitTypeLabel(label);
    const normalizedSerials = [...new Set((serials ?? []).map((entry) => this.normalizeSerial(entry)).filter((entry) => entry.length > 0))];

    return {
      label: normalizedLabel,
      value: Number(value) || 0,
      serials: normalizedSerials,
      serialInput: normalizedSerials.join('\n'),
      scanInput: '',
      scanError: '',
      scanSuccess: '',
      isScanning: false,
    };
  }

  private normalizeSerialNumbersByUnitType(
    serialMap: Record<string, string[]> | null | undefined,
  ): Record<string, string[]> {
    const normalized: Record<string, string[]> = {};

    if (!serialMap || typeof serialMap !== 'object') {
      return normalized;
    }

    for (const [label, serials] of Object.entries(serialMap)) {
      const normalizedLabel = this.normalizeUnitTypeLabel(label);
      if (!Array.isArray(serials)) {
        continue;
      }

      if (!Array.isArray(normalized[normalizedLabel])) {
        normalized[normalizedLabel] = [];
      }

      for (const serial of serials) {
        const normalizedSerial = this.normalizeSerial(serial);
        if (!normalizedSerial) {
          continue;
        }

        if (!normalized[normalizedLabel].includes(normalizedSerial)) {
          normalized[normalizedLabel].push(normalizedSerial);
        }
      }
    }

    return normalized;
  }

  private normalizeUnitTypeLabel(label: unknown): string {
    const normalized = String(label ?? 'set')
      .trim()
      .toLowerCase()
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/[\s_-]*qty$/i, '')
      .replace(/quantity$/i, '')
      .trim();

    return normalized || 'set';
  }

  private ensureSelectedUnitType(productIndex: number): void {
    const item = this.createForm.productItems[productIndex];
    if (!item || item.unitTypes.length === 0) {
      return;
    }

    const current = this.selectedUnitTypeByProduct[productIndex];
    const exists = item.unitTypes.some((entry) => entry.label === current);
    if (!exists) {
      this.selectedUnitTypeByProduct[productIndex] = item.unitTypes[0].label;
    }
  }

  private toDateInputValue(value: string | null | undefined): string {
    if (!value) {
      return '';
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return '';
    }

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private createEmptyProductItem(): PurchaseProductFormItem {
    return {
      productId: '',
      capacityId: '',
      unitPrice: 0,
      sellPrice: '',
      discountPrice: '',
      unitTypes: [
        this.createUnitTypeEntry('indoor', 0, []),
        this.createUnitTypeEntry('outdoor', 0, []),
      ],
      totalSetQty: 1,
    };
  }

  private createEmptyPaymentItem(): PurchasePaymentFormItem {
    return {
      method: '',
      amount: 0,
      terms: '',
      termsDueDate: '',
      paymentDate: '',
      downPayment: 0,
    };
  }
}
