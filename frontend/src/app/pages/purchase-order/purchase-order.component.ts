import { CommonModule } from '@angular/common';
import { Component, HostListener, OnDestroy, OnInit } from '@angular/core';
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
  method: 'Cash' | 'Bank Transfer' | 'Terms' | 'Terms with DP' | 'Cheque' | 'Credit Card' | 'Installment';
  amount: number;
  terms: string;
  termsDueDate: string;
  autoTermsDueDate: boolean;
  status: string;
  paymentDate: string;
  bankName: string;
  referenceNo: string;
  checkNo: string;
  chequeDate: string;
  issuedBy: string;
  downPayment: number;
}

interface QueuedPurchaseSerialScan {
  productIndex: number;
  unitLabel: string;
  serialNumber: string;
  purchaseId: number;
  productId: number;
  capacityId: number;
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
  isImportingSerials = false;
  sendingForApprovalIds = new Set<number>();
  approvingPurchaseIds = new Set<number>();
  catalogProducts: ProductOption[] = [];
  vendorOptions: VendorOption[] = [];
  vendorSearch = '';
  isVendorDropdownOpen = false;
  activeProductTabIndex = 0;
  selectedUnitTypeByProduct: Record<number, string> = {};
  readonly paymentMethodOptions: PurchasePaymentFormItem['method'][] = [
    'Cash',
    'Bank Transfer',
    'Terms',
    'Terms with DP',
    'Cheque',
    'Credit Card',
    'Installment',
  ];

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
  private readonly serialBatchSize = 20;
  private readonly serialBatchIdleMs = 1000;
  private readonly serialBatchIntervalMs = 5000;
  private serialScanTimers: Record<string, ReturnType<typeof setTimeout>> = {};
  private serialScanErrorTimers: Record<string, ReturnType<typeof setTimeout>> = {};
  isFlushingQueuedSerials = false;
  private activeSerialFlushCount = 0;
  private queuedSerialScans: QueuedPurchaseSerialScan[] = [];
  private queuedSerialFlushTimer: ReturnType<typeof setTimeout> | null = null;
  private queuedSerialIntervalTimer: ReturnType<typeof setInterval> | null = null;
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

    this.clearQueuedSerialFlushTimer();
    this.stopQueuedSerialAutoFlush();
  }

  @HostListener('window:beforeunload', ['$event'])
  onBeforeUnload(event: BeforeUnloadEvent): void {
    if (!this.isFormDrawerOpen) {
      return;
    }

    event.preventDefault();
    event.returnValue = '';
  }

  get pendingSerialScanCount(): number {
    return this.queuedSerialScans.length + this.activeSerialFlushCount;
  }

  get isFormDrawerBusy(): boolean {
    return this.isCreating || this.isImportingSerials || this.isFlushingQueuedSerials;
  }

  get formDrawerBusyMessage(): string {
    if (this.isImportingSerials) {
      return 'Uploading serial numbers from CSV...';
    }

    if (this.isFlushingQueuedSerials) {
      const count = this.pendingSerialScanCount;
      return count > 0
        ? `Saving serial numbers... ${count} item${count > 1 ? 's' : ''} remaining.`
        : 'Saving serial numbers...';
    }

    if (this.isCreating) {
      return this.drawerMode === 'create'
        ? 'Creating purchase order...'
        : 'Updating purchase order...';
    }

    return 'Processing request...';
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
      if (this.drawerMode === 'edit') {
        const flushed = await this.flushAllQueuedSerialScans();
        if (!flushed) {
          this.createError = 'Pending serial scans must finish saving before updating the purchase order.';
          return;
        }
      }

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
      await this.closeCreateDrawer();
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
      await this.closeCreateDrawer();
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
      await this.closeCreateDrawer();
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
    this.stopQueuedSerialAutoFlush();
    this.isFormDrawerOpen = true;
  }

  async openEditDrawer(item: PurchaseOrderItem): Promise<void> {
    if (!this.canOpenPurchaseDrawer()) {
      this.createError = 'You do not have permission to update purchase orders.';
      return;
    }

    this.resetCreateForm();
    this.drawerMode = 'edit';
    this.editingPurchaseId = item.id;
    this.isFormDrawerOpen = true;
    this.createError = '';
    this.createSuccess = '';
    this.startQueuedSerialAutoFlush();

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

  async closeCreateDrawer(): Promise<void> {
    if (this.drawerMode === 'edit') {
      const flushed = await this.flushAllQueuedSerialScans();
      if (!flushed) {
        this.createError = 'Pending serial scans must finish saving before closing the drawer.';
        return;
      }
    }

    this.finalizeDrawerClose();
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
      const workbook = await this.createExcelWorkbook();
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
    } catch (error) {
      console.error('PO serial Excel export failed:', error);
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

  openSerialCsvImportPicker(): void {
    if (!this.canImportPurchaseCsv()) {
      this.createError = 'You do not have permission to import CSV serial numbers.';
      return;
    }

    const input = document.getElementById('purchaseSerialCsvInput') as HTMLInputElement | null;
    if (!input) {
      this.createError = 'CSV upload input is unavailable.';
      return;
    }

    input.click();
  }

  async onSerialCsvSelected(event: Event): Promise<void> {
    if (!this.canImportPurchaseCsv()) {
      this.createError = 'You do not have permission to import CSV serial numbers.';
      return;
    }

    const input = event.target as HTMLInputElement | null;
    const file = input?.files?.[0] ?? null;

    if (!file) {
      return;
    }

    try {
      await this.importSerialsFromCsv(file);
    } finally {
      if (input) {
        input.value = '';
      }
    }
  }

  canCreateOrUpdatePurchase(): boolean {
    return this.rbacService.canAccess('purchase_order', 'canUpdate') ||
      this.rbacService.canAccess('purchase_order', 'canCreate');
  }

  canImportPurchaseCsv(): boolean {
    return (
      this.canCreateOrUpdatePurchase() ||
      this.rbacService.hasEffectivePermissionKey('purchase-order.button.import-csv')
    );
  }

  canOpenPurchaseDrawer(): boolean {
    return this.canCreateOrUpdatePurchase() || this.canImportPurchaseCsv();
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
    this.queuedSerialScans = [];
    this.activeSerialFlushCount = 0;
    this.isFlushingQueuedSerials = false;
    this.clearQueuedSerialFlushTimer();
  }

  private finalizeDrawerClose(): void {
    this.stopQueuedSerialAutoFlush();
    this.clearQueuedSerialFlushTimer();
    this.queuedSerialScans = [];
    this.activeSerialFlushCount = 0;
    this.isFlushingQueuedSerials = false;
    this.isFormDrawerOpen = false;
    this.isProcessingApprovalAction = false;
    this.isExportingSerials = false;
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

  private async importSerialsFromCsv(file: File): Promise<void> {
    if (!this.canImportPurchaseCsv()) {
      this.createError = 'You do not have permission to import CSV serial numbers.';
      return;
    }

    if (this.drawerMode !== 'edit' || !this.editingPurchaseId) {
      this.createError = 'CSV serial import is only available when editing a purchase order.';
      return;
    }

    const activeItem = this.getActiveProductItem();
    if (!activeItem) {
      this.createError = 'Select a product before importing serial numbers.';
      return;
    }

    const productId = Number(activeItem.productId);
    const capacityId = Number(activeItem.capacityId);
    if (!Number.isFinite(productId) || !Number.isFinite(capacityId)) {
      this.createError = 'Select product and capacity before importing serial numbers.';
      return;
    }

    if (this.hasPendingSerialScanWork()) {
      const flushed = await this.flushAllQueuedSerialScans();
      if (!flushed) {
        this.createError = 'Pending serial scans must finish saving before CSV import.';
        return;
      }
    }

    this.isImportingSerials = true;
    this.createError = '';
    this.createSuccess = '';

    try {
      const csvContent = await file.text();
      const rows = this.parseSerialCsvRows(csvContent);
      if (rows.length === 0) {
        this.createError = 'CSV file has no serial rows to import.';
        return;
      }

      const normalizedRows = rows.map((row) => ({
        serialNumber: this.normalizeSerial(row.serialNumber),
        unitType: this.normalizeUnitTypeLabel(row.unitType),
      }));

      const validRows = normalizedRows.filter((row) => row.serialNumber && row.unitType);
      if (validRows.length === 0) {
        this.createError = 'CSV file must contain serialNumber and unitType values.';
        return;
      }

      const uniqueRows: Array<{ serialNumber: string; unitType: string }> = [];
      const seen = new Set<string>();
      for (const row of validRows) {
        const key = `${row.unitType}::${row.serialNumber.toLowerCase()}`;
        if (seen.has(key)) {
          continue;
        }

        seen.add(key);
        uniqueRows.push(row);
      }

      const response = await this.purchaseOrderService.scanPurchaseSerialBatch({
        items: uniqueRows.map((row) => ({
          serialNumber: row.serialNumber,
          purchaseId: this.editingPurchaseId as number,
          expectedProductId: productId,
          expectedCapacityId: capacityId,
          unitType: row.unitType,
        })),
      });

      const results = Array.isArray(response.items) ? response.items : [];
      let successCount = 0;
      let failureCount = 0;

      uniqueRows.forEach((row, index) => {
        const result = results[index];
        const unitEntry = this.ensureUnitEntryForProduct(this.activeProductTabIndex, row.unitType);
        if (!unitEntry) {
          failureCount += 1;
          return;
        }

        if (!result?.success) {
          failureCount += 1;
          unitEntry.scanError = result?.message ?? 'Failed to import serial number';
          unitEntry.scanSuccess = '';
          return;
        }

        const savedSerial = this.normalizeSerial(result.item?.serialNumber ?? row.serialNumber);
        this.appendLocalSerial(unitEntry, savedSerial);
        unitEntry.scanError = '';
        unitEntry.scanSuccess = result.message ?? 'Serial number imported successfully';
        successCount += 1;
      });

      if (successCount > 0) {
        this.createSuccess = `${successCount} serial number${successCount > 1 ? 's' : ''} imported successfully.`;
      }

      if (failureCount > 0) {
        this.createError = `${failureCount} serial number${failureCount > 1 ? 's' : ''} failed to import.`;
      }
    } catch (error: unknown) {
      if (axios.isAxiosError(error)) {
        this.createError =
          (error.response?.data as { message?: string } | undefined)?.message ??
          'Failed to import CSV serial numbers.';
      } else if (error instanceof Error) {
        this.createError = error.message;
      } else {
        this.createError = 'Failed to import CSV serial numbers.';
      }
    } finally {
      this.isImportingSerials = false;
    }
  }

  private parseSerialCsvRows(csvContent: string): Array<{ serialNumber: string; unitType: string }> {
    const lines = String(csvContent ?? '')
      .replace(/^\uFEFF/, '')
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0);

    if (lines.length === 0) {
      return [];
    }

    const header = this.parseCsvLine(lines[0]).map((value) => value.trim().toLowerCase());
    const serialIndex = header.findIndex((value) => value === 'serialnumber' || value === 'serial_number');
    const unitTypeIndex = header.findIndex((value) => value === 'unittype' || value === 'unit_type');

    if (serialIndex === -1 || unitTypeIndex === -1) {
      throw new Error('CSV header must include serialNumber and unitType columns.');
    }

    return lines.slice(1).map((line) => {
      const columns = this.parseCsvLine(line);
      return {
        serialNumber: String(columns[serialIndex] ?? '').trim(),
        unitType: String(columns[unitTypeIndex] ?? '').trim(),
      };
    });
  }

  private parseCsvLine(line: string): string[] {
    const values: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let index = 0; index < line.length; index += 1) {
      const character = line[index];

      if (character === '"') {
        const nextCharacter = line[index + 1];
        if (inQuotes && nextCharacter === '"') {
          current += '"';
          index += 1;
          continue;
        }

        inQuotes = !inQuotes;
        continue;
      }

      if (character === ',' && !inQuotes) {
        values.push(current);
        current = '';
        continue;
      }

      current += character;
    }

    values.push(current);
    return values;
  }

  private async createExcelWorkbook(): Promise<{ addWorksheet: (name?: string) => any; xlsx: { writeBuffer: () => Promise<ArrayBuffer> } }> {
    const excelJsModule = await import('exceljs').catch(async () => import('exceljs/dist/exceljs.min.js'));

    const workbookConstructor =
      (excelJsModule as { Workbook?: new () => any }).Workbook ??
      (excelJsModule as { default?: { Workbook?: new () => any } }).default?.Workbook;

    if (!workbookConstructor) {
      throw new Error('Excel workbook constructor is unavailable.');
    }

    return new workbookConstructor();
  }

  private downloadBlob(blob: Blob, fileName: string): void {
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = fileName;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
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
    this.syncPaymentAmounts();
  }

  getCapacitiesByProduct(productId: string): ProductCapacityOption[] {
    const product = this.catalogProducts.find((item) => String(item.id) === String(productId));
    return product?.capacities ?? [];
  }

  addPaymentDetail(): void {
    this.createForm.paymentDetails = [...this.createForm.paymentDetails, this.createEmptyPaymentItem()];
    this.syncPaymentAmounts();
  }

  removePaymentDetail(index: number): void {
    if (this.createForm.paymentDetails.length <= 1) {
      return;
    }

    this.createForm.paymentDetails = this.createForm.paymentDetails.filter((_, itemIndex) => itemIndex !== index);
    this.syncPaymentAmounts();
  }

  onPaymentMethodChange(index: number): void {
    const payment = this.createForm.paymentDetails[index];
    if (!payment) {
      return;
    }

    payment.status = this.getAutoPaymentStatus(payment.method);

    if (payment.method !== 'Terms' && payment.method !== 'Terms with DP' && payment.method !== 'Installment') {
      payment.terms = '';
      payment.termsDueDate = '';
    }

    if (payment.method !== 'Terms with DP' && payment.method !== 'Installment') {
      payment.downPayment = 0;
    }

    if (payment.method !== 'Cash' && payment.method !== 'Credit Card') {
      payment.paymentDate = '';
    }

    if (payment.method !== 'Bank Transfer' && payment.method !== 'Cheque') {
      payment.bankName = '';
    }

    if (payment.method !== 'Bank Transfer') {
      payment.referenceNo = '';
    }

    if (payment.method !== 'Cheque') {
      payment.checkNo = '';
      payment.chequeDate = '';
      payment.issuedBy = '';
    }

    if (payment.autoTermsDueDate) {
      this.onTermsChanged(index);
    }

    this.syncPaymentAmounts();
  }

  toggleAutoTermsDueDate(index: number): void {
    const payment = this.createForm.paymentDetails[index];
    if (!payment) {
      return;
    }

    payment.autoTermsDueDate = !payment.autoTermsDueDate;
    if (payment.autoTermsDueDate) {
      this.onTermsChanged(index);
    }
  }

  isAutoTermsDueDate(index: number): boolean {
    const payment = this.createForm.paymentDetails[index];
    return payment?.autoTermsDueDate ?? true;
  }

  onTermsChanged(index: number): void {
    const payment = this.createForm.paymentDetails[index];
    if (!payment) {
      return;
    }

    const isTermsMethod =
      payment.method === 'Terms' ||
      payment.method === 'Terms with DP';

    if (!isTermsMethod) {
      payment.termsDueDate = '';
      this.syncPaymentAmounts();
      return;
    }

    if (!payment.autoTermsDueDate) {
      this.syncPaymentAmounts();
      return;
    }

    const termDays = Number(payment.terms);
    if (!Number.isFinite(termDays) || termDays <= 0) {
      payment.termsDueDate = '';
      this.syncPaymentAmounts();
      return;
    }

    payment.termsDueDate = this.calculateDueDateFromToday(Math.floor(termDays), payment.paymentDate);
    this.syncPaymentAmounts();
  }

  onPaymentDateFieldChange(): void {
    this.syncPaymentAmounts();
  }

  shouldShowPaymentField(method: PurchasePaymentFormItem['method'], field: string): boolean {
    const methodMap: Record<PurchasePaymentFormItem['method'], Set<string>> = {
      Cash: new Set(['amount', 'paymentDate']),
      'Bank Transfer': new Set(['amount', 'bankName', 'referenceNo']),
      Terms: new Set(['amount', 'terms', 'termsDueDate']),
      'Terms with DP': new Set(['amount', 'terms', 'termsDueDate', 'downPayment']),
      Cheque: new Set(['amount', 'bankName', 'checkNo', 'chequeDate', 'issuedBy']),
      'Credit Card': new Set(['amount', 'paymentDate']),
      Installment: new Set(['amount', 'terms', 'termsDueDate', 'downPayment']),
    };

    return methodMap[method]?.has(field) ?? false;
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

    const existingInCurrentUnit = unitEntry.serials.some(
      (entry) => this.normalizeSerial(entry).toLowerCase() === normalizedIncoming,
    );
    if (existingInCurrentUnit) {
      unitEntry.scanError = 'Serial number already scanned for this unit type';
      unitEntry.scanInput = '';
      this.focusSerialScanInput(productIndex, unitLabel);
      return;
    }

    unitEntry.serials = [...unitEntry.serials, serialNumber];
    unitEntry.serialInput = unitEntry.serials.join('\n');
    unitEntry.scanInput = '';
    unitEntry.scanSuccess = 'Serial number queued for saving';
    unitEntry.scanError = '';
    this.queueSerialScan({
      productIndex,
      unitLabel,
      serialNumber,
      purchaseId: this.editingPurchaseId,
      productId,
      capacityId,
    });
    this.focusSerialScanInput(productIndex, unitLabel);
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

  private queueSerialScan(scan: QueuedPurchaseSerialScan): void {
    this.queuedSerialScans = [...this.queuedSerialScans, scan];

    if (this.queuedSerialScans.length >= this.serialBatchSize) {
      void this.flushQueuedSerialScans();
      return;
    }

    this.scheduleQueuedSerialFlush();
  }

  private scheduleQueuedSerialFlush(): void {
    this.clearQueuedSerialFlushTimer();
    this.queuedSerialFlushTimer = setTimeout(() => {
      this.queuedSerialFlushTimer = null;
      void this.flushQueuedSerialScans();
    }, this.serialBatchIdleMs);
  }

  private clearQueuedSerialFlushTimer(): void {
    if (!this.queuedSerialFlushTimer) {
      return;
    }

    clearTimeout(this.queuedSerialFlushTimer);
    this.queuedSerialFlushTimer = null;
  }

  private startQueuedSerialAutoFlush(): void {
    this.stopQueuedSerialAutoFlush();
    this.queuedSerialIntervalTimer = setInterval(() => {
      if (this.queuedSerialScans.length === 0) {
        return;
      }

      void this.flushQueuedSerialScans();
    }, this.serialBatchIntervalMs);
  }

  private stopQueuedSerialAutoFlush(): void {
    if (!this.queuedSerialIntervalTimer) {
      return;
    }

    clearInterval(this.queuedSerialIntervalTimer);
    this.queuedSerialIntervalTimer = null;
  }

  private async flushAllQueuedSerialScans(): Promise<boolean> {
    this.clearQueuedSerialFlushTimer();

    while (this.queuedSerialScans.length > 0) {
      const flushed = await this.flushQueuedSerialScans();
      if (!flushed) {
        return false;
      }
    }

    return !this.isFlushingQueuedSerials;
  }

  private async flushQueuedSerialScans(): Promise<boolean> {
    if (this.isFlushingQueuedSerials) {
      return false;
    }

    if (this.queuedSerialScans.length === 0) {
      return true;
    }

    this.clearQueuedSerialFlushTimer();

    const batch = this.queuedSerialScans.splice(0, this.serialBatchSize);
    this.isFlushingQueuedSerials = true;
    this.activeSerialFlushCount = batch.length;
    this.setBatchScanningState(batch, true);

    try {
      const response = await this.purchaseOrderService.scanPurchaseSerialBatch({
        items: batch.map((entry) => ({
          serialNumber: entry.serialNumber,
          purchaseId: entry.purchaseId,
          expectedProductId: entry.productId,
          expectedCapacityId: entry.capacityId,
          unitType: entry.unitLabel,
        })),
      });

      const results = Array.isArray(response.items) ? response.items : [];
      batch.forEach((entry, index) => {
        const result = results[index];
        const unitEntry = this.getUnitEntry(entry.productIndex, entry.unitLabel);
        if (!unitEntry) {
          return;
        }

        if (!result?.success) {
          this.removeLocalSerial(unitEntry, entry.serialNumber);
          unitEntry.scanError = result?.message ?? 'Failed to save serial number';
          unitEntry.scanSuccess = '';
          return;
        }

        const normalizedSavedSerial = this.normalizeSerial(
          result.item?.serialNumber ?? entry.serialNumber,
        );
        this.replaceLocalSerial(unitEntry, entry.serialNumber, normalizedSavedSerial);
        unitEntry.scanError = '';
        unitEntry.scanSuccess =
          response.summary && response.summary.successCount > 1
            ? `${response.summary.successCount} serial numbers saved`
            : result.message ?? 'Serial number saved successfully';
      });

      if (!response.success && (response.summary?.failureCount ?? 0) > 0) {
        this.createError = response.message ?? 'Some serial numbers failed to save.';
      }

      return true;
    } catch (error: unknown) {
      this.queuedSerialScans = [...batch, ...this.queuedSerialScans];
      this.createError = 'Failed to save scanned serial numbers. Retrying automatically.';
      this.setBatchScanError(batch, 'Failed to save serial numbers. They remain queued.');

      if (axios.isAxiosError(error)) {
        this.createError =
          (error.response?.data as { message?: string } | undefined)?.message ??
          this.createError;
      }

      return false;
    } finally {
      this.isFlushingQueuedSerials = false;
      this.activeSerialFlushCount = 0;
      this.setBatchScanningState(batch, false);

      if (this.queuedSerialScans.length > 0) {
        this.scheduleQueuedSerialFlush();
      }
    }
  }

  private setBatchScanningState(batch: QueuedPurchaseSerialScan[], isScanning: boolean): void {
    const visited = new Set<string>();
    for (const entry of batch) {
      const key = `${entry.productIndex}::${entry.unitLabel}`;
      if (visited.has(key)) {
        continue;
      }

      visited.add(key);
      const unitEntry = this.getUnitEntry(entry.productIndex, entry.unitLabel);
      if (unitEntry) {
        unitEntry.isScanning = isScanning;
      }
    }
  }

  private setBatchScanError(batch: QueuedPurchaseSerialScan[], message: string): void {
    const visited = new Set<string>();
    for (const entry of batch) {
      const key = `${entry.productIndex}::${entry.unitLabel}`;
      if (visited.has(key)) {
        continue;
      }

      visited.add(key);
      const unitEntry = this.getUnitEntry(entry.productIndex, entry.unitLabel);
      if (unitEntry) {
        unitEntry.scanError = message;
        unitEntry.scanSuccess = '';
      }
    }
  }

  private getUnitEntry(productIndex: number, unitLabel: string): PurchaseUnitTypeFormItem | null {
    const item = this.createForm.productItems[productIndex];
    if (!item) {
      return null;
    }

    return item.unitTypes.find((entry) => entry.label === unitLabel) ?? null;
  }

  private ensureUnitEntryForProduct(
    productIndex: number,
    unitLabel: string,
  ): PurchaseUnitTypeFormItem | null {
    const item = this.createForm.productItems[productIndex];
    if (!item) {
      return null;
    }

    const normalizedLabel = this.normalizeUnitTypeLabel(unitLabel);
    let unitEntry = item.unitTypes.find((entry) => entry.label === normalizedLabel) ?? null;
    if (unitEntry) {
      return unitEntry;
    }

    unitEntry = this.createUnitTypeEntry(normalizedLabel, 0, []);
    item.unitTypes = [...item.unitTypes, unitEntry];
    return unitEntry;
  }

  private appendLocalSerial(unitEntry: PurchaseUnitTypeFormItem, serialNumber: string): void {
    const normalizedSerial = this.normalizeSerial(serialNumber);
    if (!normalizedSerial) {
      return;
    }

    const exists = unitEntry.serials.some(
      (entry) => this.normalizeSerial(entry).toLowerCase() === normalizedSerial.toLowerCase(),
    );
    if (exists) {
      return;
    }

    unitEntry.serials = [...unitEntry.serials, normalizedSerial];
    unitEntry.serialInput = unitEntry.serials.join('\n');
  }

  private removeLocalSerial(unitEntry: PurchaseUnitTypeFormItem, serialNumber: string): void {
    const normalizedTarget = this.normalizeSerial(serialNumber).toLowerCase();
    unitEntry.serials = unitEntry.serials.filter(
      (entry) => this.normalizeSerial(entry).toLowerCase() !== normalizedTarget,
    );
    unitEntry.serialInput = unitEntry.serials.join('\n');
  }

  private replaceLocalSerial(
    unitEntry: PurchaseUnitTypeFormItem,
    oldSerial: string,
    nextSerial: string,
  ): void {
    const normalizedOldSerial = this.normalizeSerial(oldSerial).toLowerCase();
    unitEntry.serials = unitEntry.serials.map((entry) =>
      this.normalizeSerial(entry).toLowerCase() === normalizedOldSerial ? nextSerial : entry,
    );
    unitEntry.serialInput = unitEntry.serials.join('\n');
  }

  private hasPendingSerialScanWork(): boolean {
    return this.queuedSerialScans.length > 0 || this.isFlushingQueuedSerials;
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

    const normalizedTarget = this.normalizeSerial(serialNumber).toLowerCase();
    const queuedSerialCountBefore = this.queuedSerialScans.length;
    this.queuedSerialScans = this.queuedSerialScans.filter(
      (entry) =>
        !(
          entry.productIndex === productIndex &&
          entry.unitLabel === unitLabel &&
          this.normalizeSerial(entry.serialNumber).toLowerCase() === normalizedTarget
        ),
    );

    const removedFromQueue = this.queuedSerialScans.length !== queuedSerialCountBefore;

    if (removedFromQueue) {
      this.removeLocalSerial(unitEntry, serialNumber);
      unitEntry.scanSuccess = 'Queued serial number removed';
      unitEntry.scanError = '';
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
        status: this.normalizePayloadPaymentStatus(payment.status),
        paymentDate: payment.paymentDate || null,
        bankName: payment.bankName.trim() || undefined,
        referenceNo: payment.referenceNo.trim() || undefined,
        checkNo: payment.checkNo.trim() || undefined,
        chequeDate: payment.chequeDate || null,
        issuedBy: payment.issuedBy.trim() || undefined,
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
          method: this.toPaymentMethod(payment.method),
          amount: Number(payment.amount) || 0,
          terms: payment.terms ?? '',
          termsDueDate: this.toDateInputValue(payment.termsDueDate),
          autoTermsDueDate: true,
          status: payment.status ?? 'unpaid',
          paymentDate: this.toDateInputValue(payment.paymentDate),
          bankName: payment.bankName ?? '',
          referenceNo: payment.referenceNo ?? '',
          checkNo: payment.checkNo ?? '',
          chequeDate: this.toDateInputValue(payment.chequeDate),
          issuedBy: payment.issuedBy ?? '',
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

  private getAutoPaymentStatus(method: PurchasePaymentFormItem['method']): string {
    if (method === 'Cash' || method === 'Bank Transfer') {
      return 'paid';
    }

    return 'unpaid';
  }

  private toPaymentMethod(value: unknown): PurchasePaymentFormItem['method'] {
    const normalized = String(value ?? '').trim().toLowerCase();

    if (normalized === 'cash') return 'Cash';
    if (normalized === 'bank transfer' || normalized === 'bank_transfer') return 'Bank Transfer';
    if (normalized === 'terms') return 'Terms';
    if (normalized === 'terms with dp' || normalized === 'terms_with_dp') return 'Terms with DP';
    if (normalized === 'cheque' || normalized === 'check') return 'Cheque';
    if (normalized === 'credit card' || normalized === 'credit_card') return 'Credit Card';
    if (normalized === 'installment') return 'Installment';

    return 'Cash';
  }

  private calculateDueDateFromToday(termDays: number, baseDateInput?: string): string {
    const baseDate = baseDateInput ? new Date(baseDateInput) : new Date();
    if (Number.isNaN(baseDate.getTime())) {
      return '';
    }

    baseDate.setHours(0, 0, 0, 0);
    baseDate.setDate(baseDate.getDate() + termDays);

    const year = baseDate.getFullYear();
    const month = String(baseDate.getMonth() + 1).padStart(2, '0');
    const day = String(baseDate.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private getDisplayPaymentStatus(payment: PurchasePaymentFormItem): string {
    const autoStatus = this.getAutoPaymentStatus(payment.method);
    if (autoStatus === 'paid') {
      return 'paid';
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const isOverdueDate = (rawDate: string): boolean => {
      if (!rawDate) {
        return false;
      }

      const parsed = new Date(rawDate);
      if (Number.isNaN(parsed.getTime())) {
        return false;
      }

      parsed.setHours(0, 0, 0, 0);
      return parsed < today;
    };

    if ((payment.method === 'Terms' || payment.method === 'Terms with DP') && isOverdueDate(payment.termsDueDate)) {
      return 'overdue';
    }

    if (payment.method === 'Cheque' && isOverdueDate(payment.chequeDate)) {
      return 'overdue';
    }

    return 'unpaid';
  }

  private syncPaymentAmounts(): void {
    const computedAmount = Number(this.createForm.totalAmount) || 0;
    this.createForm.paymentDetails = this.createForm.paymentDetails.map((payment: PurchasePaymentFormItem) => {
      const nextPayment: PurchasePaymentFormItem = {
        ...payment,
        amount: computedAmount,
      };

      return {
        ...nextPayment,
        status: this.getDisplayPaymentStatus(nextPayment),
      };
    });
  }

  private normalizePayloadPaymentStatus(value: unknown): 'unpaid' | 'paid' | 'partial' | 'overdue' {
    const normalized = String(value ?? '').trim().toLowerCase();
    if (normalized === 'paid') {
      return 'paid';
    }

    if (normalized === 'partial') {
      return 'partial';
    }

    if (normalized === 'overdue') {
      return 'overdue';
    }

    return 'unpaid';
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
      method: 'Cash',
      amount: 0,
      terms: '',
      termsDueDate: '',
      autoTermsDueDate: true,
      status: 'paid',
      paymentDate: '',
      bankName: '',
      referenceNo: '',
      checkNo: '',
      chequeDate: '',
      issuedBy: '',
      downPayment: 0,
    };
  }
}
