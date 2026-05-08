// Removed accidental top-level getter definition. The correct getter is inside the class.
import { CommonModule } from '@angular/common';
import { Component, HostListener, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PageBreadcrumbComponent } from '../../shared/components/common/page-breadcrumb/page-breadcrumb.component';
import {
  CreatePurchaseRequestPayload,
  DeletePurchaseAuthPayload,
  PurchaseOrderDetailItem,
  PurchaseOrderDetailProductItem,
  ProductCapacityOption,
  ProductOption,
  PurchaseOrderItem,
  PurchaseOrderService,
  VendorOption,
} from '../../shared/services/purchase-order.service';
import { RbacService } from '../../shared/services/rbac.service';
import { AuditLogFrontendService } from '../../shared/services/audit-log.service';
import { ModalComponent } from '../../shared/components/ui/modal/modal.component';
import axios from 'axios';

type PurchaseTab = 'deliveries' | 'approvals' | 'master-data';
type PurchaseOrderGuardDialogMode =
  | 'idle-warning'
  | 'session-timeout'
  | 'close-confirm'
  | 'refresh-confirm'
  | 'remove-serial-confirm';

type PurchaseActionDialogMode = 'cancel-confirm' | 'delete-confirm';

type PendingSerialRemoval = {
  productIndex: number;
  unitLabel: string;
  serialNumber: string;
};

type ManualSerialDialogState = {
  productIndex: number;
  unitLabel: string;
};

type CsvImportStep = 'upload' | 'summary' | 'importing';

interface CsvImportRow {
  serialNumber: string;
  unitType: string;
  status: 'valid' | 'invalid' | 'duplicate' | 'exists-current-po' | 'reassign';
  reason?: string;
  currentPoNumber?: string;
  currentPurchaseId?: number;
}

interface CsvImportState {
  step: CsvImportStep;
  file: File | null;
  rows: CsvImportRow[];
  totalCount: number;
  validCount: number;
  invalidCount: number;
  duplicateCount: number;
  existsCurrentPoCount: number;
  reassignCount: number;
  parseError: string | null;
  importError: string | null;
}

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
  imports: [CommonModule, FormsModule, PageBreadcrumbComponent, ModalComponent],
  templateUrl: './purchase-order.component.html',
  styles: ``,
})
export class PurchaseOrderComponent implements OnInit, OnDestroy {
  activeTab: PurchaseTab = 'deliveries';
  isFormDrawerOpen = false;
  drawerMode: 'create' | 'edit' | 'view' = 'create';
  editingPurchaseId: number | null = null;
  editingPoNumber = '';
  editingPurchaseStatus = '';
  isTransferPO: boolean = false;
  serialStatusByNumber: Record<string, string> = {};
  poLinkedSerialNumbersByUnitType: Record<string, string[]> = {};
  unresolvedLinkedSerialNumbersByUnitType: Record<string, string[]> = {};
  originatingSalesOrder: {
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
  } | null = null;
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
  isVerifyingReceive = false;
  createError = '';
  createSuccess = '';
  isExportingSerials = false;
  poGuardDialogMode: PurchaseOrderGuardDialogMode | null = null;
  csvImportDialogMode: boolean = false;
  csvImportState: CsvImportState = {
    step: 'upload',
    file: null,
    rows: [],
    totalCount: 0,
    validCount: 0,
    invalidCount: 0,
    duplicateCount: 0,
    existsCurrentPoCount: 0,
    reassignCount: 0,
    parseError: null,
    importError: null,
  };
  poIdleCountdownSeconds = 0;
  pendingSerialRemoval: PendingSerialRemoval | null = null;
  manualSerialDialogState: ManualSerialDialogState | null = null;
  manualSerialInput = '';
  manualSerialError = '';
  sendingForApprovalIds = new Set<number>();
  approvingPurchaseIds = new Set<number>();
  cancellingPurchaseIds = new Set<number>();
  deletingPurchaseIds = new Set<number>();
  poActionDialogMode: PurchaseActionDialogMode | null = null;
  errorModal = {
    isOpen: false,
    title: '',
    message: '',
  };

  private openErrorModal(title: string, message: string): void {
    this.errorModal = {
      isOpen: true,
      title,
      message,
    };
  }

  closeErrorModal(): void {
    this.errorModal.isOpen = false;
  }
  poActionTargetItem: PurchaseOrderItem | null = null;
  deleteAuthPassword = '';
  deleteAuthUsername = '';
  catalogProducts: ProductOption[] = [];
  vendorOptions: VendorOption[] = [];
  vendorSearch = '';
  isVendorDropdownOpen = false;
  productSearchByItem: Record<number, string> = {};
  isProductDropdownOpenByItem: Record<number, boolean> = {};
  activeProductTabIndex = 0;
  selectedUnitTypeByProduct: Record<number, string> = {};
  scannedSerialTablePageByKey: Record<string, number> = {};
  readonly scannedSerialTablePageSize = 10;
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
  private readonly poIdleWarningMs = 12 * 60 * 1000;
  private readonly poSessionTimeoutMs = 15 * 60 * 1000;
  private serialScanTimers: Record<string, ReturnType<typeof setTimeout>> = {};
  private serialScanErrorTimers: Record<string, ReturnType<typeof setTimeout>> = {};
  isFlushingQueuedSerials = false;
  private activeSerialFlushCount = 0;
  private serialFlushFailureCount = 0;
  private isSerialAutoRetryPaused = false;
  private readonly serialFlushMaxAutoRetryFailures = 2;
  private queuedSerialScans: QueuedPurchaseSerialScan[] = [];
  private queuedSerialFlushTimer: ReturnType<typeof setTimeout> | null = null;
  private queuedSerialIntervalTimer: ReturnType<typeof setInterval> | null = null;
  private poIdleWarningTimer: ReturnType<typeof setTimeout> | null = null;
  private poSessionTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
  private poIdleCountdownTimer: ReturnType<typeof setInterval> | null = null;
  private suppressBeforeUnloadPrompt = false;
  private drawerInitialStateSnapshot = '';
  private readonly purchaseTabPermissionKeyMap: Record<PurchaseTab, string[]> = {
      deliveries: ['purchase-order.tab.deliveries', 'purchase-order.tab.local'],
      approvals: ['purchase-order.tab.approvals'],
      'master-data': ['purchase-order.tab.master-data', 'purchase-order.tab.imported'],
    };

  constructor(
    private readonly purchaseOrderService: PurchaseOrderService,
    private readonly rbacService: RbacService,
    private readonly auditLogService: AuditLogFrontendService,
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
    this.stopPoSessionGuard();
  }

  @HostListener('window:beforeunload', ['$event'])
  onBeforeUnload(event: BeforeUnloadEvent): void {
    if (!this.shouldBlockNavigationPrompt() || this.suppressBeforeUnloadPrompt) {
      return;
    }

    event.preventDefault();
    event.returnValue = '';
  }

  @HostListener('document:mousemove')
  @HostListener('document:keydown')
  @HostListener('document:click')
  @HostListener('document:touchstart')
  onPurchaseOrderActivity(): void {
    this.registerPoActivity();
  }

  @HostListener('window:keydown', ['$event'])
  onWindowRefreshShortcut(event: KeyboardEvent): void {
    if (!this.isFormDrawerOpen || !this.shouldBlockNavigationPrompt()) {
      return;
    }

    const key = String(event.key ?? '').toLowerCase();
    const isF5 = key === 'f5';
    const isReloadShortcut = key === 'r' && (event.ctrlKey || event.metaKey);

    if (!isF5 && !isReloadShortcut) {
      return;
    }

    event.preventDefault();
    this.openRefreshConfirmDialog();
  }

  get pendingSerialScanCount(): number {
    return this.queuedSerialScans.length + this.activeSerialFlushCount;
  }

  get isFormDrawerBusy(): boolean {
    return this.isCreating;
  }

  get formDrawerBusyMessage(): string {
    if (this.isCreating) {
      return this.drawerMode === 'create'
        ? 'Creating purchase order...'
        : 'Updating purchase order...';
    }

    return 'Processing request...';
  }

  get isPoGuardDialogOpen(): boolean {
    return this.poGuardDialogMode !== null;
  }

  get isManualSerialDialogOpen(): boolean {
    return this.manualSerialDialogState !== null;
  }

  get manualSerialDialogUnitLabel(): string {
    return this.manualSerialDialogState?.unitLabel ?? '';
  }

  get poGuardDialogTitle(): string {
    switch (this.poGuardDialogMode) {
      case 'idle-warning':
        return 'Still working on this purchase order?';
      case 'session-timeout':
        return 'Session timed out for this PO';
      case 'close-confirm':
        return 'Close purchase order?';
      case 'refresh-confirm':
        return 'Refresh this page?';
      case 'remove-serial-confirm':
        return 'Remove serial number?';
      default:
        return '';
    }
  }

  get poGuardDialogMessage(): string {
    switch (this.poGuardDialogMode) {
      case 'idle-warning':
        return 'You have been idle in the PO drawer. Continue this session to keep scanning and editing without losing your place.';
      case 'session-timeout':
        return 'This PO was locked after extended inactivity. Refresh the page to re-establish the session, or close the drawer if you want to leave it for now.';
      case 'close-confirm':
        return 'Closing this PO drawer will discard the current on-screen editing context. Browser refresh and tab close are also guarded while this drawer is open.';
      case 'refresh-confirm':
        return 'Refreshing now may lose unsaved PO form changes and queued serial scans. Continue only if you want to reload this page.';
      case 'remove-serial-confirm': {
        const serialNumber = String(this.pendingSerialRemoval?.serialNumber ?? '').trim();
        return serialNumber
          ? `Are you sure you want to remove serial '${serialNumber}' from this PO item?`
          : 'Are you sure you want to remove this serial from this PO item?';
      }
      default:
        return '';
    }
  }

  get poIdleCountdownLabel(): string {
    const totalSeconds = Math.max(0, this.poIdleCountdownSeconds);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
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

  onProductComboboxFocus(index: number): void {
    if (this.isMasterDataDrawerMode() || this.isTransferPOViewOnly) {
      return;
    }

    this.isProductDropdownOpenByItem[index] = true;
    this.productSearchByItem[index] = this.getProductSearchValue(index);
  }

  onProductComboboxBlur(index: number): void {
    setTimeout(() => {
      this.isProductDropdownOpenByItem[index] = false;
      this.productSearchByItem[index] = this.getProductSearchValue(index);
    }, 150);
  }

  onProductSearchChange(index: number, value: string): void {
    this.productSearchByItem[index] = String(value ?? '');
    this.isProductDropdownOpenByItem[index] = true;
  }

  selectProduct(index: number, productId: string | number): void {
    const item = this.createForm.productItems[index];
    if (!item) {
      return;
    }

    item.productId = String(productId ?? '').trim();
    this.productSearchByItem[index] = this.getProductDisplayLabel(item.productId);
    this.isProductDropdownOpenByItem[index] = false;
    this.onProductChanged(index);
  }

  getProductSearchValue(index: number): string {
    const typedValue = this.productSearchByItem[index];
    if (typedValue !== undefined) {
      return typedValue;
    }

    const item = this.createForm.productItems[index];
    if (!item?.productId) {
      return '';
    }

    return this.getProductDisplayLabel(item.productId);
  }

  getFilteredProductOptions(index: number): ProductOption[] {
    const normalizedQuery = String(this.productSearchByItem[index] ?? '').trim().toLowerCase();
    if (!normalizedQuery) {
      return this.catalogProducts;
    }

    return this.catalogProducts.filter((item) => {
      const name = String(item.name ?? '').trim().toLowerCase();
      const brandName = String(item.brandName ?? '').trim().toLowerCase();
      const combined = `${name} ${brandName}`.trim();
      return name.includes(normalizedQuery) || brandName.includes(normalizedQuery) || combined.includes(normalizedQuery);
    });
  }

  getProductDisplayLabel(productId: string): string {
    const product = this.catalogProducts.find((item) => String(item.id) === String(productId));
    if (!product) {
      return '';
    }

    return `${product.name}${product.brandName ? ` (${product.brandName})` : ''}`;
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
      const validationError = this.validatePurchaseForm();
      if (validationError) {
        this.createError = validationError;
        return;
      }

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
      console.log('submitCreatePurchase response', response);
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
        console.error('submitCreatePurchase error', error);
        this.createError = 'Failed to create purchase request';
      }
    } finally {
      this.isCreating = false;
    }
  }

  async loadTabData(tab: PurchaseTab): Promise<void> {
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

  getPurchaseTableProductLabels(item: PurchaseOrderItem): string[] {
    const productItems = Array.isArray(item.productItems) ? item.productItems : [];
    const seen = new Set<string>();
    const labels: string[] = [];

    for (const productItem of productItems) {
      const label = String(productItem?.product?.productName ?? '').trim();
      if (!label) {
        continue;
      }

      const key = label.toLowerCase();
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      labels.push(label);
    }

    return labels;
  }

  getPurchaseTableVisibleProductLabels(item: PurchaseOrderItem, limit = 2): string[] {
    return this.getPurchaseTableProductLabels(item).slice(0, limit);
  }

  getPurchaseTableHiddenProductCount(item: PurchaseOrderItem, limit = 2): number {
    return Math.max(0, this.getPurchaseTableProductLabels(item).length - limit);
  }

  getPurchaseTableHiddenProductTooltip(item: PurchaseOrderItem, limit = 2): string {
    const hidden = this.getPurchaseTableProductLabels(item).slice(limit);
    return hidden.join(', ');
  }

  isMasterDataDrawerMode(): boolean {
    return this.activeTab === 'master-data' && this.drawerMode === 'edit';
  }

  getRowActionLabel(item?: PurchaseOrderItem): 'View' | 'Edit' {
    if (item && item.isTransferPO) return 'View';
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
      // Load full PO details for validation
      const poDetails = await this.purchaseOrderService.getPurchaseById(item.id);
      if (!poDetails) {
        this.createError = 'Failed to load purchase order details for validation';
        return;
      }

      // Validate loaded details
      const validationError = this.validatePODetailsBeforeSendingForApproval(poDetails);
      if (validationError) {
        this.createError = validationError;
        return;
      }

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

  async revertToDeliveries(): Promise<void> {
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
      const response = await this.purchaseOrderService.revertPurchaseToDeliveries(this.editingPurchaseId);
      if (!response.success) {
        this.createError = response.message ?? 'Failed to revert purchase order to deliveries';
        return;
      }

      this.createSuccess = response.message ?? 'Purchase order reverted to deliveries';
      await this.closeCreateDrawer();
      await this.loadTabData(this.activeTab);
    } catch (error: unknown) {
      if (axios.isAxiosError(error)) {
        this.createError =
          (error.response?.data as { message?: string } | undefined)?.message ??
          'Failed to revert purchase order to deliveries';
      } else {
        this.createError = 'Failed to revert purchase order to deliveries';
      }
    } finally {
      this.isProcessingApprovalAction = false;
    }
  }

  private validateBeforeSendingForApproval(purchaseId: number): string | null {
    // Check if drawer is open with edit data
    if (this.isFormDrawerOpen && this.drawerMode === 'edit' && this.editingPurchaseId === purchaseId) {
      // Validate form data when in edit drawer
      return this.validateFormBeforeSendingForApproval();
    }

    // Fallback: Check PO list item
    const po = this.purchaseOrders.find(p => p.id === purchaseId);
    if (!po) {
      return 'Purchase order not found';
    }

    if (po.serialCount === undefined || po.serialCount <= 0) {
      return 'At least one product must have scanned serial numbers before sending for approval';
    }

    return null;
  }

  private validatePODetailsBeforeSendingForApproval(poDetails: PurchaseOrderDetailItem): string | null {
    // Check if any product item exists
    if (!poDetails.productItems || poDetails.productItems.length === 0) {
      return 'At least one product must be added to the purchase order';
    }

    // Validate each product item
    for (let i = 0; i < poDetails.productItems.length; i++) {
      const product = poDetails.productItems[i];

      // Check if there's at least one unit type with scanned serials
      const hasScannedSerials = product.serialNumbers && Object.keys(product.serialNumbers).some(
        key => product.serialNumbers[key] && product.serialNumbers[key].length > 0
      );
      if (!hasScannedSerials) {
        return `Product ${i + 1}: At least one unit type must have scanned serial numbers`;
      }

      // Validate each unit type: scanned count should match expected quantity
      if (product.unitTypesQty) {
        for (const unitType of product.unitTypesQty) {
          const scannedSerials = product.serialNumbers?.[unitType.label] ?? [];
          const scannedCount = scannedSerials.length;
          const expectedQty = unitType.value ?? 0;

          // If quantity is set, scanned count must match exactly
          if (expectedQty > 0) {
            if (scannedCount < expectedQty) {
              return `Product ${i + 1}, ${unitType.label}: ${scannedCount} serial(s) scanned but ${expectedQty} expected (${expectedQty - scannedCount} missing)`;
            }

            if (scannedCount > expectedQty) {
              return `Product ${i + 1}, ${unitType.label}: ${scannedCount} serial(s) scanned exceeds expected ${expectedQty}`;
            }
          }
        }
      }
    }

    return null;
  }

  private validateFormBeforeSendingForApproval(): string | null {
    // Check if any product item exists
    if (!this.createForm.productItems || this.createForm.productItems.length === 0) {
      return 'At least one product must be added to the purchase order';
    }

    // Validate each product item
    for (let i = 0; i < this.createForm.productItems.length; i++) {
      const product = this.createForm.productItems[i];

      // Check if product is selected
      if (!product.productId) {
        return `Product ${i + 1}: Product must be selected`;
      }

      // Check if capacity is selected
      if (!product.capacityId) {
        return `Product ${i + 1}: Capacity must be selected`;
      }

      // Check if there's at least one unit type with scanned serials
      const hasScannedSerials = product.unitTypes.some(ut => ut.serials && ut.serials.length > 0);
      if (!hasScannedSerials) {
        return `Product ${i + 1}: At least one unit type must have scanned serial numbers`;
      }

      // Validate each unit type: scanned count should match or exceed quantity
      for (const unitType of product.unitTypes) {
        const scannedCount = unitType.serials?.length ?? 0;
        const expectedQty = unitType.value ?? 0;

        if (expectedQty > 0 && scannedCount < expectedQty) {
          return `Product ${i + 1}, ${unitType.label}: ${scannedCount} serial(s) scanned but ${expectedQty} expected (${expectedQty - scannedCount} missing)`;
        }

        if (scannedCount > expectedQty && expectedQty > 0) {
          return `Product ${i + 1}, ${unitType.label}: ${scannedCount} serial(s) scanned exceeds expected ${expectedQty}`;
        }
      }
    }

    return null;
  }

  canRevertToDeliveries(): boolean {
    return (
      this.activeTab === 'approvals' &&
      this.drawerMode === 'edit' &&
      this.editingPurchaseId !== null &&
      this.isApprovalStageStatus(this.editingPurchaseStatus) &&
      this.canApprovePurchaseOrder()
    );
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

  async verifyAndReceive(): Promise<void> {
    if (!this.editingPurchaseId || this.isVerifyingReceive || this.isCreating) {
      return;
    }

    this.isVerifyingReceive = true;
    this.createError = '';
    this.createSuccess = '';

    try {
      const response = await this.purchaseOrderService.verifyAndReceivePurchase(this.editingPurchaseId);
      if (!response.success) {
        this.createError = response.message ?? 'Failed to verify and receive transfer PO';
        return;
      }

      this.createSuccess = response.message ?? 'Transfer PO verified and received successfully';
      await this.closeCreateDrawer();
      await this.loadTabData(this.activeTab);
    } catch (error: unknown) {
      if (axios.isAxiosError(error)) {
        this.createError =
          (error.response?.data as { message?: string } | undefined)?.message ??
          'Failed to verify and receive transfer PO';
      } else {
        this.createError = 'Failed to verify and receive transfer PO';
      }
    } finally {
      this.isVerifyingReceive = false;
    }
  }

  // ── Cancel / Delete ────────────────────────────────────────────────

  canCancelPurchase(status: string | null | undefined): boolean {
    const normalized = String(status ?? '').trim().toLowerCase();
    return !['approved', 'completed', 'cancelled', 'rejected'].includes(normalized);
  }

  canDeletePurchase(status: string | null | undefined): boolean {
    const normalized = String(status ?? '').trim().toLowerCase();
    return !['approved', 'completed'].includes(normalized);
  }

  requestCancelPurchase(item: PurchaseOrderItem): void {
    if (!this.canCancelPurchase(item.status)) {
      return;
    }
    this.poActionTargetItem = item;
    this.poActionDialogMode = 'cancel-confirm';
  }

  requestDeletePurchase(item: PurchaseOrderItem): void {
    if (!this.canDeletePurchase(item.status)) {
      return;
    }
    this.deleteAuthPassword = '';
    this.deleteAuthUsername = '';
    this.poActionTargetItem = item;
    this.poActionDialogMode = 'delete-confirm';
  }

  dismissPoActionDialog(): void {
    this.poActionDialogMode = null;
    this.poActionTargetItem = null;
    this.deleteAuthPassword = '';
    this.deleteAuthUsername = '';
  }

  get requiresAdminCredentialsForDelete(): boolean {
    const roleName = String(this.rbacService.getPayload()?.roleName ?? '')
      .trim()
      .toLowerCase();
    return (
      !roleName.includes('admin') &&
      !roleName.includes('super') &&
      !roleName.includes('owner')
    );
  }

  async confirmCancelPurchase(): Promise<void> {
    const item = this.poActionTargetItem;
    this.dismissPoActionDialog();

    if (!item) {
      return;
    }

    if (this.cancellingPurchaseIds.has(item.id)) {
      return;
    }

    this.cancellingPurchaseIds.add(item.id);
    this.createError = '';
    this.createSuccess = '';

    try {
      const response = await this.purchaseOrderService.cancelPurchase(item.id);
      if (!response.success) {
        this.createError = response.message ?? 'Failed to cancel purchase order';
        return;
      }

      this.createSuccess = response.message ?? 'Purchase order cancelled successfully';
      await this.loadTabData(this.activeTab);
    } catch (error: unknown) {
      if (axios.isAxiosError(error)) {
        this.createError =
          (error.response?.data as { message?: string } | undefined)?.message ??
          'Failed to cancel purchase order';
      } else {
        this.createError = 'Failed to cancel purchase order';
      }
    } finally {
      this.cancellingPurchaseIds.delete(item.id);
    }
  }

  async confirmDeletePurchase(): Promise<void> {
    const item = this.poActionTargetItem;

    if (!item) {
      return;
    }

    const normalizedPassword = this.deleteAuthPassword.trim();
    const normalizedAuthUsername = this.deleteAuthUsername.trim();

    if (this.requiresAdminCredentialsForDelete) {
      if (!normalizedAuthUsername || !normalizedPassword) {
        this.createError = 'Admin username and password are required to authorize deletion.';
        return;
      }
    } else if (!normalizedPassword) {
      this.createError = 'Your password is required to delete this purchase order.';
      return;
    }

    if (this.deletingPurchaseIds.has(item.id)) {
      return;
    }

    this.deletingPurchaseIds.add(item.id);
    this.createError = '';
    this.createSuccess = '';

    try {
      const payload: DeletePurchaseAuthPayload = {
        password: normalizedPassword,
        ...(this.requiresAdminCredentialsForDelete
          ? { authUsername: normalizedAuthUsername }
          : {}),
      };

      const response = await this.purchaseOrderService.deletePurchase(item.id, payload);
      if (!response.success) {
        this.createError = response.message ?? 'Failed to delete purchase order';
        return;
      }

      this.createSuccess = response.message ?? 'Purchase order deleted successfully';
      this.dismissPoActionDialog();
      // If we deleted the last item on this page, go back one page
      if (this.purchaseOrders.length === 1 && this.page > 1) {
        this.page -= 1;
      }
      await this.loadTabData(this.activeTab);
    } catch (error: unknown) {
      if (axios.isAxiosError(error)) {
        this.createError =
          (error.response?.data as { message?: string } | undefined)?.message ??
          'Failed to delete purchase order';
      } else {
        this.createError = 'Failed to delete purchase order';
      }
    } finally {
      this.deletingPurchaseIds.delete(item.id);
    }
  }

  // ──────────────────────────────────────────────────────────────────

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
    this.captureDrawerInitialSnapshot();
    this.startPoSessionGuard();
  }

  async openEditDrawer(item: PurchaseOrderItem): Promise<void> {
    if (!this.canOpenPurchaseDrawer()) {
      this.createError = 'You do not have permission to update purchase orders.';
      return;
    }

    this.resetCreateForm();
    this.editingPurchaseId = item.id;
    this.isFormDrawerOpen = true;
    this.createError = '';
    this.createSuccess = '';
    this.startQueuedSerialAutoFlush();
    this.startPoSessionGuard();

    try {
      const detail = await this.purchaseOrderService.getPurchaseById(item.id, {
        includeInstalled: this.activeTab === 'master-data',
        preferPoLinkedSerials: this.activeTab === 'master-data',
      });

      if (!detail) {
        this.createError = 'Failed to load purchase order details';
        return;
      }

      this.isTransferPO = !!detail.isTransferPO;
      this.originatingSalesOrder = detail.originatingSalesOrder || null;

      // Set drawerMode after isTransferPO is known
      this.drawerMode = this.isTransferPO ? 'view' : 'edit';

      this.applyDetailToForm(detail, item);
      this.editingPoNumber = String(detail.poNumber ?? item.poNumber ?? '').trim();
      this.editingPurchaseStatus = String(detail.status ?? item.status ?? '').trim();
      this.captureDrawerInitialSnapshot();
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

  /**
   * Returns true if this PO is a transfer PO and should be view-only in the receiver branch.
   * You may want to enhance this logic to check if the current user is in the receiver branch.
   */

  get isTransferPOViewOnly(): boolean {
    return this.isTransferPO;
    // Optionally: check if user branch matches receiver branch
    // return this.isTransferPO && this.rbacService.getPayload()?.branchId === this.editingBranchId;
  }

  get isDrawerViewMode(): boolean {
    return this.drawerMode === 'view';
  }

  /**
   * For transfer POs, get serials from originatingSalesOrder if present.
   */
  getDisplayUnitTypeSerials(unitType: any): string[] {
    if (this.isMasterDataDrawerMode() && this.createForm.productItems.length === 1) {
      const normalizedLabel = String(unitType?.label ?? '').trim().toLowerCase();
      const allocations = this.getAllocatedFallbackSerialsByProductKey();
      const allocated = allocations[`0::${normalizedLabel}`] ?? [];
      for (const [entryLabel, serials] of Object.entries(this.poLinkedSerialNumbersByUnitType)) {
        if (String(entryLabel ?? '').trim().toLowerCase() === normalizedLabel) {
          const baseSerials = Array.isArray(serials) ? serials : [];
          const merged = [...baseSerials];
          const seen = new Set(merged.map((serial) => this.normalizeSerial(serial).toLowerCase()));

          for (const serial of allocated) {
            const normalizedSerial = this.normalizeSerial(serial).toLowerCase();
            if (!normalizedSerial || seen.has(normalizedSerial)) {
              continue;
            }

            seen.add(normalizedSerial);
            merged.push(serial);
          }

          return merged;
        }
      }

      return allocated;
    }

    if (this.isMasterDataDrawerMode()) {
      const normalizedLabel = String(unitType?.label ?? '').trim().toLowerCase();
      const allocations = this.getAllocatedFallbackSerialsByProductKey();
      const allocated = allocations[`${this.activeProductTabIndex}::${normalizedLabel}`] ?? [];
      if (allocated.length > 0) {
        const baseSerials = Array.isArray(unitType?.serials) ? unitType.serials : [];
        const merged = [...baseSerials];
        const seen = new Set(merged.map((serial) => this.normalizeSerial(serial).toLowerCase()));

        for (const serial of allocated) {
          const normalizedSerial = this.normalizeSerial(serial).toLowerCase();
          if (!normalizedSerial || seen.has(normalizedSerial)) {
            continue;
          }

          seen.add(normalizedSerial);
          merged.push(serial);
        }

        return merged;
      }
    }

    if (this.isTransferPOViewOnly && this.originatingSalesOrder && Array.isArray(this.originatingSalesOrder.productItems)) {
      const poProduct = this.createForm.productItems[this.activeProductTabIndex];
      // Try to match by productId/capacityId and check both salesId and previousSalesId
      const soProduct = this.originatingSalesOrder.productItems.find((p: any) => {
        // Match by productId/capacityId
        const matchProduct = String(p.productId) === String(poProduct.productId) && String(p.capacityId) === String(poProduct.capacityId);
        if (!matchProduct) return false;
        // If SO product has previousSalesId, prefer that
        if (p.previousSalesId) {
          // If PO has a reference to previousSalesId, you could add logic here if needed
          return true;
        }
        // Otherwise, match on salesId if present
        if (p.salesId) {
          return true;
        }
        // Fallback: match if no salesId/previousSalesId info
        return true;
      });
      if (soProduct && soProduct.serialNumbers && unitType.label in soProduct.serialNumbers) {
        return soProduct.serialNumbers[unitType.label] || [];
      }
    }
    return unitType.serials;
  }

  private getBaseUnresolvedLinkedSerialEntries(): Array<{ unitType: string; serials: string[] }> {
    return Object.entries(this.unresolvedLinkedSerialNumbersByUnitType)
      .filter(([_, serials]) => Array.isArray(serials) && serials.length > 0)
      .map(([unitType, serials]) => ({ unitType, serials: [...serials] }));
  }

  private getFallbackPoolEntries(): Array<{ unitType: string; serials: string[] }> {
    const merged = new Map<string, string[]>();

    for (const entry of this.getBaseUnresolvedLinkedSerialEntries()) {
      merged.set(entry.unitType, [...entry.serials]);
    }

    for (const entry of this.additionalPoLinkedSerialEntries) {
      const existing = merged.get(entry.unitType) ?? [];
      const seen = new Set(existing.map((serial) => this.normalizeSerial(serial).toLowerCase()));

      for (const serial of entry.serials) {
        const normalizedSerial = this.normalizeSerial(serial).toLowerCase();
        if (!normalizedSerial || seen.has(normalizedSerial)) {
          continue;
        }

        seen.add(normalizedSerial);
        existing.push(serial);
      }

      if (existing.length > 0) {
        merged.set(entry.unitType, existing);
      }
    }

    return [...merged.entries()].map(([unitType, serials]) => ({ unitType, serials }));
  }

  private getAllocatedFallbackSerialsByProductKey(): Record<string, string[]> {
    const pools = new Map<string, string[]>();
    for (const entry of this.getFallbackPoolEntries()) {
      pools.set(String(entry.unitType ?? '').trim().toLowerCase(), [...entry.serials]);
    }

    const allocations: Record<string, string[]> = {};

    this.createForm.productItems.forEach((item, productIndex) => {
      for (const unitType of item.unitTypes) {
        const unitLabel = String(unitType.label ?? '').trim().toLowerCase();
        if (!unitLabel) {
          continue;
        }

        const pool = pools.get(unitLabel) ?? [];
        if (pool.length === 0) {
          continue;
        }

        const expectedQty = Math.max(0, Number(unitType.value) || 0);
        const currentQty = Array.isArray(unitType.serials) ? unitType.serials.length : 0;
        const missingQty = Math.max(0, expectedQty - currentQty);
        if (missingQty <= 0) {
          continue;
        }

        const allocated = pool.splice(0, missingQty);
        if (allocated.length > 0) {
          allocations[`${productIndex}::${unitLabel}`] = allocated;
        }

        pools.set(unitLabel, pool);
      }
    });

    return allocations;
  }

  get unresolvedLinkedSerialEntries(): Array<{ unitType: string; serials: string[] }> {
    const allocations = this.getAllocatedFallbackSerialsByProductKey();

    return this.getFallbackPoolEntries()
      .map((entry) => {
        const unitLabel = String(entry.unitType ?? '').trim().toLowerCase();
        const allocatedSerials = Object.entries(allocations)
          .filter(([key]) => key.endsWith(`::${unitLabel}`))
          .flatMap(([, serials]) => serials);
        const allocatedSet = new Set(
          allocatedSerials.map((serial) => this.normalizeSerial(serial).toLowerCase()),
        );
        const remaining = entry.serials.filter((serial) => {
          const normalizedSerial = this.normalizeSerial(serial).toLowerCase();
          return normalizedSerial && !allocatedSet.has(normalizedSerial);
        });

        return { unitType: entry.unitType, serials: remaining };
      })
      .filter((entry) => entry.serials.length > 0);
  }

  get poLinkedSerialEntries(): Array<{ unitType: string; serials: string[] }> {
    return Object.entries(this.poLinkedSerialNumbersByUnitType)
      .filter(([_, serials]) => Array.isArray(serials) && serials.length > 0)
      .map(([unitType, serials]) => ({ unitType, serials }));
  }

  getSerialStatus(serialNumber: string): string {
    const normalizedSerial = this.normalizeSerial(serialNumber).toLowerCase();
    if (!normalizedSerial) {
      return 'in_stock';
    }

    return String(this.serialStatusByNumber[normalizedSerial] ?? 'in_stock').trim().toLowerCase() || 'in_stock';
  }

  isInstalledSerial(serialNumber: string): boolean {
    return this.getSerialStatus(serialNumber) === 'installed';
  }

  get additionalPoLinkedSerialEntries(): Array<{ unitType: string; serials: string[] }> {
    const displayedSerialsByUnitType = new Map<string, Set<string>>();

    for (const item of this.createForm.productItems) {
      for (const unitType of item.unitTypes) {
        const unitLabel = String(unitType.label ?? '').trim().toLowerCase();
        if (!unitLabel) {
          continue;
        }

        const existing = displayedSerialsByUnitType.get(unitLabel) ?? new Set<string>();
        for (const serial of unitType.serials) {
          const normalizedSerial = this.normalizeSerial(serial).toLowerCase();
          if (normalizedSerial) {
            existing.add(normalizedSerial);
          }
        }
        displayedSerialsByUnitType.set(unitLabel, existing);
      }
    }

    for (const entry of this.getBaseUnresolvedLinkedSerialEntries()) {
      const unitLabel = String(entry.unitType ?? '').trim().toLowerCase();
      if (!unitLabel) {
        continue;
      }

      const existing = displayedSerialsByUnitType.get(unitLabel) ?? new Set<string>();
      for (const serial of entry.serials) {
        const normalizedSerial = this.normalizeSerial(serial).toLowerCase();
        if (normalizedSerial) {
          existing.add(normalizedSerial);
        }
      }
      displayedSerialsByUnitType.set(unitLabel, existing);
    }

    return this.poLinkedSerialEntries
      .map((entry) => {
        const unitLabel = String(entry.unitType ?? '').trim().toLowerCase();
        const displayed = displayedSerialsByUnitType.get(unitLabel) ?? new Set<string>();
        const remaining = entry.serials.filter((serial) => {
          const normalizedSerial = this.normalizeSerial(serial).toLowerCase();
          return normalizedSerial && !displayed.has(normalizedSerial);
        });

        return {
          unitType: entry.unitType,
          serials: remaining,
        };
      })
      .filter((entry) => entry.serials.length > 0);
  }

  get totalPoLinkedSerialCount(): number {
    return this.poLinkedSerialEntries.reduce(
      (total, entry) => total + entry.serials.length,
      0,
    );
  }

  get totalUnresolvedLinkedSerialCount(): number {
    return this.unresolvedLinkedSerialEntries.reduce(
      (total, entry) => total + entry.serials.length,
      0,
    );
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

  requestCloseDrawer(): void {
    if (!this.isFormDrawerOpen || this.isFormDrawerBusy) {
      return;
    }

    if (!this.shouldBlockNavigationPrompt()) {
      void this.closeCreateDrawer();
      return;
    }

    this.clearPoSessionGuardTimers();
    this.poGuardDialogMode = 'close-confirm';
  }

  continuePoSession(): void {
    if (this.poGuardDialogMode !== 'idle-warning') {
      return;
    }

    this.poGuardDialogMode = null;
    this.poIdleCountdownSeconds = 0;
    this.startPoSessionGuard();
  }

  keepEditingPo(): void {
    if (
      this.poGuardDialogMode !== 'close-confirm' &&
      this.poGuardDialogMode !== 'refresh-confirm' &&
      this.poGuardDialogMode !== 'remove-serial-confirm'
    ) {
      return;
    }

    this.poGuardDialogMode = null;
    this.pendingSerialRemoval = null;
    this.startPoSessionGuard();
  }

  async confirmCloseDrawer(): Promise<void> {
    this.poGuardDialogMode = null;
    await this.closeCreateDrawer();
  }

  requestRemoveScannedSerial(
    productIndex: number,
    unitLabel: string,
    serialNumber: string,
  ): void {
    if (this.isFormDrawerBusy) {
      return;
    }

    this.pendingSerialRemoval = {
      productIndex,
      unitLabel,
      serialNumber,
    };

    this.clearPoSessionGuardTimers();
    this.poGuardDialogMode = 'remove-serial-confirm';
  }

  openManualSerialDialog(productIndex: number, unitLabel: string): void {
    if (this.isFormDrawerBusy || this.drawerMode !== 'edit') {
      return;
    }

    const unitEntry = this.getUnitEntry(productIndex, unitLabel);
    if (!unitEntry) {
      return;
    }

    this.manualSerialDialogState = {
      productIndex,
      unitLabel,
    };
    this.manualSerialInput = '';
    this.manualSerialError = '';
  }

  closeManualSerialDialog(focusScanInput = true): void {
    const dialogState = this.manualSerialDialogState;

    this.manualSerialDialogState = null;
    this.manualSerialInput = '';
    this.manualSerialError = '';

    if (focusScanInput && dialogState) {
      this.focusSerialScanInput(dialogState.productIndex, dialogState.unitLabel);
    }
  }

  async confirmManualSerialDialog(): Promise<void> {
    const dialogState = this.manualSerialDialogState;
    if (!dialogState) {
      return;
    }

    const unitEntry = this.getUnitEntry(dialogState.productIndex, dialogState.unitLabel);
    if (!unitEntry) {
      this.closeManualSerialDialog(false);
      return;
    }

    unitEntry.scanError = '';
    unitEntry.scanSuccess = '';
    const manualSerialValue = this.manualSerialInput;
    this.closeManualSerialDialog(false);
    this.processSerialForUnit(
      dialogState.productIndex,
      dialogState.unitLabel,
      manualSerialValue,
      'Enter serial number before adding',
      false,
    );
  }

  async confirmRemoveScannedSerial(): Promise<void> {
    const pendingRemoval = this.pendingSerialRemoval;
    this.poGuardDialogMode = null;

    if (!pendingRemoval) {
      this.startPoSessionGuard();
      return;
    }

    this.pendingSerialRemoval = null;
    await this.removeScannedSerial(
      pendingRemoval.productIndex,
      pendingRemoval.unitLabel,
      pendingRemoval.serialNumber,
    );

    if (this.isFormDrawerOpen) {
      this.startPoSessionGuard();
    }
  }

  closeTimedOutPo(): void {
    this.poGuardDialogMode = null;
    this.createError = 'PO session timed out because of inactivity. Reopen the drawer to continue.';
    this.finalizeDrawerClose();
  }

  refreshPoSession(): void {
    this.suppressBeforeUnloadPrompt = true;
    globalThis.location.reload();
  }

  hasAnyScannedSerials(): boolean {
    return this.buildScannedSerialExportRows().length > 0;
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

  downloadCsvTemplate(): void {
    const bom = '\uFEFF';
    const header = 'serialNumber,unitType\n';
    const blob = new Blob([bom + header], { type: 'text/csv;charset=utf-8;' });
    this.downloadBlob(blob, 'serial_import_template.csv');
  }

  onCsvFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    const file = input?.files?.[0] ?? null;

    if (!file) {
      return;
    }

    // Reset previous error
    this.csvImportState.parseError = null;

    // Validate file size (reject > 10MB)
    const maxSizeBytes = 10 * 1024 * 1024;
    if (file.size > maxSizeBytes) {
      this.csvImportState.parseError = 'File too large. Maximum file size is 10MB.';
      this.csvImportState.file = null;
      if (input) {
        input.value = '';
      }
      return;
    }

    this.csvImportState.file = file;

    // Reset the input so the same file can be re-selected if needed
    if (input) {
      input.value = '';
    }

    // Automatically trigger parsing after file selection
    this.parseCsvForImport();
  }

  async parseCsvForImport(): Promise<void> {
    const file = this.csvImportState.file;
    if (!file) {
      this.csvImportState.parseError = 'No file selected.';
      return;
    }

    // Reset state before parsing
    this.csvImportState.parseError = null;
    this.csvImportState.rows = [];
    this.csvImportState.totalCount = 0;
    this.csvImportState.validCount = 0;
    this.csvImportState.invalidCount = 0;
    this.csvImportState.duplicateCount = 0;
    this.csvImportState.existsCurrentPoCount = 0;
    this.csvImportState.reassignCount = 0;

    try {
      const csvContent = await file.text();

      // Strip BOM and split into non-empty lines
      const lines = String(csvContent ?? '')
        .replace(/^\uFEFF/, '')
        .split(/\r?\n/)
        .filter((line) => line.trim().length > 0);

      if (lines.length === 0) {
        this.csvImportState.parseError = 'CSV file is empty.';
        return;
      }

      // Validate required headers
      const header = this.parseCsvLine(lines[0]).map((value) => value.trim().toLowerCase());
      const serialIndex = header.findIndex((value) => value === 'serialnumber' || value === 'serial_number');
      const unitTypeIndex = header.findIndex((value) => value === 'unittype' || value === 'unit_type');

      if (serialIndex === -1) {
        this.csvImportState.parseError = 'Missing required header: serialNumber';
        return;
      }

      if (unitTypeIndex === -1) {
        this.csvImportState.parseError = 'Missing required header: unitType';
        return;
      }

      // Validate at least one data row exists
      if (lines.length < 2) {
        this.csvImportState.parseError = 'CSV file contains no data rows.';
        return;
      }

      // Parse data rows, normalize, and build CsvImportRow entries
      const rows: CsvImportRow[] = lines.slice(1).map((line) => {
        const columns = this.parseCsvLine(line);
        const rawSerial = String(columns[serialIndex] ?? '').trim();
        const rawUnitType = String(columns[unitTypeIndex] ?? '').trim();

        const serialNumber = this.normalizeSerial(rawSerial);
        const unitType = this.normalizeUnitTypeLabel(rawUnitType);

        return {
          serialNumber,
          unitType,
          status: 'valid' as const,
        };
      });

      // Classify rows: invalid, duplicate, or valid
      const seenSerials = new Set<string>();

      for (const row of rows) {
        // Check for invalid rows (missing required fields)
        if (!row.serialNumber) {
          row.status = 'invalid';
          row.reason = 'Missing serial number';
          continue;
        }
        if (!row.unitType) {
          row.status = 'invalid';
          row.reason = 'Missing unit type';
          continue;
        }

        // Check for duplicates among non-invalid rows
        const normalizedKey = row.serialNumber.toLowerCase();
        if (seenSerials.has(normalizedKey)) {
          row.status = 'duplicate';
          row.reason = 'Duplicate serial number';
          continue;
        }

        seenSerials.add(normalizedKey);
        row.status = 'valid';
      }

      // Compute initial summary counts
      const totalCount = rows.length;
      const invalidCount = rows.filter((r) => r.status === 'invalid').length;
      const duplicateCount = rows.filter((r) => r.status === 'duplicate').length;

      this.csvImportState.rows = rows;
      this.csvImportState.totalCount = totalCount;
      this.csvImportState.invalidCount = invalidCount;
      this.csvImportState.duplicateCount = duplicateCount;

      // Collect valid rows for ownership check
      const validRows = rows.filter((r) => r.status === 'valid');

      if (validRows.length > 0 && this.editingPurchaseId) {
        try {
          const checkResponse = await this.purchaseOrderService.checkSerials({
            serialNumbers: validRows.map((r) => r.serialNumber),
            purchaseId: this.editingPurchaseId,
          });

          // Map check-serials response back to rows
          const resultMap = new Map(
            checkResponse.results.map((r) => [r.serialNumber.toLowerCase(), r]),
          );

          for (const row of validRows) {
            const result = resultMap.get(row.serialNumber.toLowerCase());
            if (!result) {
              // No result from backend — keep as valid
              continue;
            }

            if (result.exists) {
              row.status = 'exists-current-po';
              row.reason = result.isSamePoAssignment
                ? 'Already assigned to this PO'
                : `Already assigned to ${result.currentPoNumber ?? 'another PO'}`;
              row.currentPoNumber = result.currentPoNumber ?? undefined;
              row.currentPurchaseId = result.currentPurchaseId ?? undefined;
            }
            // If exists === false, keep status as 'valid' (will be imported)
          }
        } catch (networkError: unknown) {
          const errMsg = networkError instanceof Error ? networkError.message : 'Network error checking serial ownership.';
          this.csvImportState.parseError = `Failed to verify serial ownership: ${errMsg}. Please try again.`;
          return;
        }
      }

      // Recompute counts after ownership classification
      const finalValidCount = rows.filter((r) => r.status === 'valid').length;
      const existsCurrentPoCount = rows.filter((r) => r.status === 'exists-current-po').length;
      const reassignCount = rows.filter((r) => r.status === 'reassign').length;

      this.csvImportState.validCount = finalValidCount;
      this.csvImportState.existsCurrentPoCount = existsCurrentPoCount;
      this.csvImportState.reassignCount = reassignCount;

      // Transition to summary step
      this.csvImportState.step = 'summary';
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to parse CSV file.';
      this.csvImportState.parseError = message;
    }
  }

  async confirmCsvImport(): Promise<void> {
    if (this.csvImportState.validCount === 0) {
      return;
    }

    this.csvImportState.step = 'importing';
    this.csvImportState.importError = null;

    // Collect rows that are importable (only valid — non-existing serials)
    const importableRows = this.csvImportState.rows.filter(
      (row) => row.status === 'valid',
    );

    if (importableRows.length === 0) {
      this.csvImportState.importError = 'No importable rows found.';
      this.csvImportState.step = 'summary';
      return;
    }

    // Build a lookup from normalized unit type label -> { productId, capacityId }
    const unitTypeProductMap = new Map<string, { productId: number; capacityId: number }>();
    for (const item of this.createForm.productItems) {
      const productId = Number(item.productId) || 0;
      const capacityId = Number(item.capacityId) || 0;
      if (!productId) continue;
      for (const unitType of item.unitTypes) {
        const normalizedLabel = this.normalizeUnitTypeLabel(unitType.label);
        if (normalizedLabel && !unitTypeProductMap.has(normalizedLabel)) {
          unitTypeProductMap.set(normalizedLabel, { productId, capacityId });
        }
      }
    }

    try {
      const response = await this.purchaseOrderService.scanPurchaseSerialBatch({
        items: importableRows.map((row) => {
          const normalizedUnitType = this.normalizeUnitTypeLabel(row.unitType);
          const productInfo = unitTypeProductMap.get(normalizedUnitType);
          return {
            serialNumber: row.serialNumber,
            purchaseId: this.editingPurchaseId as number,
            expectedProductId: productInfo?.productId,
            expectedCapacityId: productInfo?.capacityId,
            unitType: row.unitType,
          };
        }),
      });

      const results = Array.isArray(response.items) ? response.items : [];
      let successCount = 0;
      let failureCount = 0;
      const failedSerials: Array<{ serialNumber: string; reason: string }> = [];

      results.forEach((result, index) => {
        if (result?.success) {
          successCount += 1;
        } else {
          failureCount += 1;
          failedSerials.push({
            serialNumber: importableRows[index]?.serialNumber ?? 'Unknown',
            reason: result?.message ?? 'Failed to import serial number',
          });
        }
      });

      if (failureCount === 0) {
        // Full success — close modal, show success message, refresh serial list
        this.csvImportDialogMode = false;
        this.createSuccess = `${successCount} serial number${successCount > 1 ? 's' : ''} imported successfully.`;
        this.resetCsvImportState();

        // Refresh the PO detail to update the serial list
        if (this.editingPurchaseId) {
          const detail = await this.purchaseOrderService.getPurchaseById(this.editingPurchaseId, {
            includeInstalled: this.activeTab === 'master-data',
            preferPoLinkedSerials: this.activeTab === 'master-data',
          });
          if (detail) {
            this.applySerialDataFromDetail(detail);
          }
        }
      } else {
        // Partial or full failure — show error in modal, stay on importing step with error
        const errorMsg = failureCount === importableRows.length
          ? `All ${failureCount} serial number${failureCount > 1 ? 's' : ''} failed to import.`
          : `${successCount} imported successfully, ${failureCount} failed.`;
        this.csvImportState.importError = errorMsg;
        this.csvImportState.step = 'summary';
      }
    } catch (error: unknown) {
      let errorMessage = 'Failed to import CSV serial numbers.';
      if (axios.isAxiosError(error)) {
        errorMessage =
          (error.response?.data as { message?: string } | undefined)?.message ??
          'Failed to import CSV serial numbers.';
      } else if (error instanceof Error) {
        errorMessage = error.message;
      }
      this.csvImportState.importError = errorMessage;
      this.csvImportState.step = 'summary';
    }
  }

  private resetCsvImportState(): void {
    this.csvImportState = {
      step: 'upload',
      file: null,
      rows: [],
      totalCount: 0,
      validCount: 0,
      invalidCount: 0,
      duplicateCount: 0,
      existsCurrentPoCount: 0,
      reassignCount: 0,
      parseError: null,
      importError: null,
    };
  }

  private applySerialDataFromDetail(detail: PurchaseOrderDetailItem): void {
    // Re-apply serial-related data from the refreshed PO detail
    this.serialStatusByNumber =
      detail.serialStatuses && typeof detail.serialStatuses === 'object'
        ? Object.fromEntries(
            Object.entries(detail.serialStatuses).map(([serialNumber, status]) => [
              this.normalizeSerial(serialNumber).toLowerCase(),
              String(status ?? '').trim().toLowerCase() || 'in_stock',
            ]),
          )
        : {};

    this.poLinkedSerialNumbersByUnitType =
      detail.poLinkedSerialNumbers && typeof detail.poLinkedSerialNumbers === 'object'
        ? this.normalizeSerialNumbersByUnitType(detail.poLinkedSerialNumbers)
        : {};

    this.unresolvedLinkedSerialNumbersByUnitType =
      detail.unresolvedLinkedSerialNumbers && typeof detail.unresolvedLinkedSerialNumbers === 'object'
        ? this.normalizeSerialNumbersByUnitType(detail.unresolvedLinkedSerialNumbers)
        : {};

    // Re-apply product items serial data
    if (detail.productItems.length > 0) {
      detail.productItems.forEach((product, index) => {
        const formItem = this.createForm.productItems[index];
        if (!formItem) {
          return;
        }

        const serialNumbers = this.normalizeSerialNumbersByUnitType(product.serialNumbers);
        for (const unitEntry of formItem.unitTypes) {
          const label = this.normalizeUnitTypeLabel(unitEntry.label);
          const serials = Array.isArray(serialNumbers[label]) ? serialNumbers[label] : [];
          unitEntry.serials = serials;
          unitEntry.serialInput = serials.join('\n');
        }
      });
    }
  }

  openSerialCsvImportPicker(): void {
    if (!this.canImportPurchaseCsv()) {
      this.createError = 'You do not have permission to import CSV serial numbers.';
      return;
    }

    this.resetCsvImportState();
    this.csvImportDialogMode = true;
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
    this.serialStatusByNumber = {};
    this.unresolvedLinkedSerialNumbersByUnitType = {};
    this.poLinkedSerialNumbersByUnitType = {};
    this.vendorSearch = '';
    this.productSearchByItem = {};
    this.isProductDropdownOpenByItem = {};
    this.activeProductTabIndex = 0;
    this.selectedUnitTypeByProduct = {};
    this.scannedSerialTablePageByKey = {};
    this.manualSerialDialogState = null;
    this.manualSerialInput = '';
    this.manualSerialError = '';
    this.queuedSerialScans = [];
    this.activeSerialFlushCount = 0;
    this.serialFlushFailureCount = 0;
    this.isSerialAutoRetryPaused = false;
    this.isFlushingQueuedSerials = false;
    this.clearQueuedSerialFlushTimer();
  }

  private finalizeDrawerClose(): void {
    this.stopPoSessionGuard();
    this.stopQueuedSerialAutoFlush();
    this.clearQueuedSerialFlushTimer();
    this.manualSerialDialogState = null;
    this.manualSerialInput = '';
    this.manualSerialError = '';
    this.serialStatusByNumber = {};
    this.unresolvedLinkedSerialNumbersByUnitType = {};
    this.poLinkedSerialNumbersByUnitType = {};
    this.queuedSerialScans = [];
    this.activeSerialFlushCount = 0;
    this.serialFlushFailureCount = 0;
    this.isSerialAutoRetryPaused = false;
    this.isFlushingQueuedSerials = false;
    this.isFormDrawerOpen = false;
    this.isProcessingApprovalAction = false;
    this.isExportingSerials = false;
  }

  private openRefreshConfirmDialog(): void {
    if (this.isFormDrawerBusy || !this.shouldBlockNavigationPrompt()) {
      return;
    }

    this.clearPoSessionGuardTimers();
    this.poGuardDialogMode = 'refresh-confirm';
  }

  private shouldBlockNavigationPrompt(): boolean {
    if (!this.isFormDrawerOpen) {
      return false;
    }

    return this.hasDrawerFormChanges() || this.pendingSerialScanCount > 0;
  }

  private hasDrawerFormChanges(): boolean {
    return this.getDrawerStateSnapshot() !== this.drawerInitialStateSnapshot;
  }

  private captureDrawerInitialSnapshot(): void {
    this.drawerInitialStateSnapshot = this.getDrawerStateSnapshot();
  }

  private getDrawerStateSnapshot(): string {
    const comparableState = {
      vendorMode: this.vendorMode,
      vendorId: String(this.createForm.vendorId ?? '').trim(),
      vendorName: String(this.createForm.vendorName ?? '').trim(),
      vendorAddress: String(this.createForm.vendorAddress ?? '').trim(),
      vendorContactPerson: String(this.createForm.vendorContactPerson ?? '').trim(),
      vendorContactNumber: String(this.createForm.vendorContactNumber ?? '').trim(),
      paymentDetails: this.createForm.paymentDetails.map((payment) => ({
        method: String(payment.method ?? '').trim(),
        amount: Number(payment.amount) || 0,
        terms: String(payment.terms ?? '').trim(),
        termsDueDate: payment.termsDueDate || '',
        status: String(payment.status ?? '').trim(),
        paymentDate: payment.paymentDate || '',
        bankName: String(payment.bankName ?? '').trim(),
        referenceNo: String(payment.referenceNo ?? '').trim(),
        checkNo: String(payment.checkNo ?? '').trim(),
        chequeDate: payment.chequeDate || '',
        issuedBy: String(payment.issuedBy ?? '').trim(),
        downPayment: Number(payment.downPayment) || 0,
      })),
      productItems: this.createForm.productItems.map((item) => ({
        productId: String(item.productId ?? '').trim(),
        capacityId: String(item.capacityId ?? '').trim(),
        unitPrice: Number(item.unitPrice) || 0,
        sellPrice: item.sellPrice === '' ? '' : Number(item.sellPrice) || 0,
        discountPrice: item.discountPrice === '' ? '' : Number(item.discountPrice) || 0,
        totalSetQty: Number(item.totalSetQty) || 0,
        unitTypes: item.unitTypes.map((entry) => ({
          label: String(entry.label ?? '').trim(),
          value: Number(entry.value) || 0,
          serials: entry.serials.map((serial) => String(serial ?? '').trim()),
        })),
      })),
      totalAmount: Number(this.createForm.totalAmount) || 0,
    };

    return JSON.stringify(comparableState);
  }

  private registerPoActivity(): void {
    if (!this.isFormDrawerOpen || this.isFormDrawerBusy) {
      return;
    }

    if (this.poGuardDialogMode !== null) {
      return;
    }

    this.startPoSessionGuard();
  }

  private startPoSessionGuard(): void {
    if (!this.isFormDrawerOpen) {
      return;
    }

    this.suppressBeforeUnloadPrompt = false;
    this.clearPoSessionGuardTimers();
    this.poGuardDialogMode = null;
    this.poIdleCountdownSeconds = 0;

    this.poIdleWarningTimer = setTimeout(() => {
      this.openPoIdleWarningDialog();
    }, this.poIdleWarningMs);

    this.poSessionTimeoutTimer = setTimeout(() => {
      this.openPoSessionTimeoutDialog();
    }, this.poSessionTimeoutMs);
  }

  private stopPoSessionGuard(): void {
    this.clearPoSessionGuardTimers();
    this.poGuardDialogMode = null;
    this.poIdleCountdownSeconds = 0;
    this.pendingSerialRemoval = null;
    this.suppressBeforeUnloadPrompt = false;
    this.drawerInitialStateSnapshot = '';
  }

  private clearPoSessionGuardTimers(): void {
    if (this.poIdleWarningTimer) {
      clearTimeout(this.poIdleWarningTimer);
      this.poIdleWarningTimer = null;
    }

    if (this.poSessionTimeoutTimer) {
      clearTimeout(this.poSessionTimeoutTimer);
      this.poSessionTimeoutTimer = null;
    }

    if (this.poIdleCountdownTimer) {
      clearInterval(this.poIdleCountdownTimer);
      this.poIdleCountdownTimer = null;
    }
  }

  private openPoIdleWarningDialog(): void {
    if (!this.isFormDrawerOpen) {
      return;
    }

    if (this.isFormDrawerBusy) {
      this.startPoSessionGuard();
      return;
    }

    this.poGuardDialogMode = 'idle-warning';
    this.poIdleCountdownSeconds = Math.max(
      0,
      Math.ceil((this.poSessionTimeoutMs - this.poIdleWarningMs) / 1000),
    );

    if (this.poIdleCountdownTimer) {
      clearInterval(this.poIdleCountdownTimer);
    }

    this.poIdleCountdownTimer = setInterval(() => {
      this.poIdleCountdownSeconds = Math.max(0, this.poIdleCountdownSeconds - 1);
    }, 1000);
  }

  private openPoSessionTimeoutDialog(): void {
    if (!this.isFormDrawerOpen) {
      return;
    }

    this.clearPoSessionGuardTimers();
    this.poGuardDialogMode = 'session-timeout';
    this.poIdleCountdownSeconds = 0;
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
      const serials = this.isMasterDataDrawerMode()
        ? this.getDisplayUnitTypeSerials(unitType)
        : unitType.serials;
      for (const serialNumber of serials) {
        rows.push({
          unitType: unitType.label,
          serialNumber,
        });
      }
    }

    if (this.isMasterDataDrawerMode()) {
      if (this.createForm.productItems.length === 1) {
        for (const entry of this.poLinkedSerialEntries) {
          for (const serialNumber of entry.serials) {
            const normalizedSerial = this.normalizeSerial(serialNumber).toLowerCase();
            if (rows.some((row) => this.normalizeSerial(row.serialNumber).toLowerCase() === normalizedSerial)) {
              continue;
            }

            rows.push({ unitType: entry.unitType, serialNumber });
          }
        }
      }

      for (const entry of this.unresolvedLinkedSerialEntries) {
        for (const serialNumber of entry.serials) {
          rows.push({
            unitType: `Unmapped - ${entry.unitType}`,
            serialNumber,
          });
        }
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
    this.syncProductComboboxState();
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
    this.syncProductComboboxState();
    this.scannedSerialTablePageByKey = {};
    this.activeProductTabIndex = Math.max(0, Math.min(this.activeProductTabIndex, this.createForm.productItems.length - 1));
    this.ensureSelectedUnitType(this.activeProductTabIndex);
    this.recalculateTotalAmount();
  }

  onProductChanged(index: number): void {
    const nextItems = [...this.createForm.productItems];
    const currentItem = nextItems[index];
    const productUnitTypeLabels = this.getProductUnitTypeLabels(currentItem?.productId ?? '');
    const nextUnitTypes = productUnitTypeLabels.length > 0
      ? productUnitTypeLabels.map((label) => this.createUnitTypeEntry(label, 0, []))
      : [this.createUnitTypeEntry('set', 0, [])];

    nextItems[index] = {
      ...nextItems[index],
      capacityId: '',
      unitTypes: nextUnitTypes,
    };
    this.createForm.productItems = nextItems;
    this.syncProductComboboxState();
    this.scannedSerialTablePageByKey = {};
    this.ensureSelectedUnitType(index);
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

  getProductItemTabLabel(item: PurchaseProductFormItem, index: number): string {
    const fallbackLabel = `Product ${index + 1}`;
    if (!item) {
      return fallbackLabel;
    }

    const productName = String(item.productId ? this.getProductNameById(item.productId) : '').trim();
    const capacityName = String(
      item.productId && item.capacityId
        ? this.getCapacityNameByProductAndCapacity(item.productId, item.capacityId)
        : '',
    ).trim();

    if (productName && capacityName) {
      return `${productName} (${capacityName})`;
    }

    if (productName) {
      return productName;
    }

    return fallbackLabel;
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
    this.setScannedSerialPage(productIndex, unitLabel, 1);
    if (this.drawerMode === 'edit') {
      this.focusSerialScanInput(productIndex, unitLabel);
    }
  }

  private getScannedSerialPageKey(productIndex: number, unitLabel: string): string {
    return `${productIndex}::${unitLabel}`;
  }

  private normalizeScannedSerialPage(page: number): number {
    const parsed = Number(page);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return 1;
    }

    return Math.floor(parsed);
  }

  getScannedSerialTotalPages(productIndex: number, unitLabel: string): number {
    const unitEntry = this.getUnitEntry(productIndex, unitLabel);
    const totalSerials = unitEntry?.serials.length ?? 0;
    return Math.max(1, Math.ceil(totalSerials / this.scannedSerialTablePageSize));
  }

  getScannedSerialCurrentPage(productIndex: number, unitLabel: string): number {
    const pageKey = this.getScannedSerialPageKey(productIndex, unitLabel);
    const storedPage = this.normalizeScannedSerialPage(this.scannedSerialTablePageByKey[pageKey] ?? 1);
    const totalPages = this.getScannedSerialTotalPages(productIndex, unitLabel);
    return Math.min(storedPage, totalPages);
  }

  setScannedSerialPage(productIndex: number, unitLabel: string, page: number): void {
    const totalPages = this.getScannedSerialTotalPages(productIndex, unitLabel);
    const nextPage = Math.min(this.normalizeScannedSerialPage(page), totalPages);
    const pageKey = this.getScannedSerialPageKey(productIndex, unitLabel);
    this.scannedSerialTablePageByKey[pageKey] = nextPage;
  }

  getPagedScannedSerials(productIndex: number, unitLabel: string): string[] {
    const unitEntry = this.getUnitEntry(productIndex, unitLabel);
    if (!unitEntry) {
      return [];
    }

    const currentPage = this.getScannedSerialCurrentPage(productIndex, unitLabel);
    const startIndex = (currentPage - 1) * this.scannedSerialTablePageSize;
    return unitEntry.serials.slice(startIndex, startIndex + this.scannedSerialTablePageSize);
  }

  getScannedSerialRowNumber(productIndex: number, unitLabel: string, pageIndex: number): number {
    const currentPage = this.getScannedSerialCurrentPage(productIndex, unitLabel);
    return (currentPage - 1) * this.scannedSerialTablePageSize + pageIndex + 1;
  }

  onUnitTypeQtyChange(productIndex: number): void {
    const item = this.createForm.productItems[productIndex];
    if (!item) {
      return;
    }

    item.unitTypes.forEach((entry) => {
      entry.value = Math.max(0, Number(entry.value) || 0);
    });

    this.recalculateTotalAmount();
  }

  onTotalSetQtyChange(productIndex: number): void {
    const item = this.createForm.productItems[productIndex];
    if (!item) {
      return;
    }

    const parsedTotalSetQty = Math.max(0, Number(item.totalSetQty) || 0);
    item.totalSetQty = parsedTotalSetQty;

    this.recalculateTotalAmount();
  }

  async scanSerialForSelectedUnit(productIndex: number, showEmptyError = false): Promise<void> {
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

    const timerKey = `${productIndex}::${unitLabel}`;
    const existingTimer = this.serialScanTimers[timerKey];
    if (existingTimer) {
      clearTimeout(existingTimer);
      delete this.serialScanTimers[timerKey];
    }

    this.processSerialForUnit(
      productIndex,
      unitLabel,
      unitEntry.scanInput,
      'Enter serial number before scanning',
      showEmptyError,
    );
  }

  private processSerialForUnit(
    productIndex: number,
    unitLabel: string,
    rawSerialInput: string,
    emptyMessage: string,
    showEmptyError: boolean,
  ): void {
    const item = this.createForm.productItems[productIndex];
    if (!item) {
      return;
    }

    const unitEntry = item.unitTypes.find((entry) => entry.label === unitLabel);
    if (!unitEntry) {
      return;
    }

    const serialNumber = this.normalizeSerial(rawSerialInput);
    unitEntry.scanError = '';
    unitEntry.scanSuccess = '';

    if (!serialNumber) {
      if (showEmptyError) {
        unitEntry.scanError = emptyMessage;
        void this.auditLogService.createAuditLog({
          action: 'SERIAL_SCAN_FAILURE',
          entityType: 'PurchaseOrder',
          entityId: this.editingPurchaseId,
          metadata: {
            serialNumber: rawSerialInput,
            reason: 'empty_serial_input',
            message: emptyMessage,
            productIndex,
            unitLabel,
            event: 'ui_validation_failure',
          },
        });
      }
      return;
    }

    if (this.drawerMode !== 'edit' || this.editingPurchaseId === null) {
      return;
    }

    const productId = Number(item.productId);
    const capacityId = Number(item.capacityId);

    if (!Number.isFinite(productId) || !Number.isFinite(capacityId)) {
      unitEntry.scanError = 'Select product and capacity before scanning serial numbers';
      void this.auditLogService.createAuditLog({
        action: 'SERIAL_SCAN_FAILURE',
        entityType: 'PurchaseOrder',
        entityId: this.editingPurchaseId,
        metadata: {
          serialNumber,
          reason: 'missing_product_capacity',
          message: 'Select product and capacity before scanning serial numbers',
          productIndex,
          unitLabel,
          event: 'ui_validation_failure',
        },
      });
      return;
    }

    const allowedQty = Number(unitEntry.value) || 0;
    if (allowedQty > 0 && unitEntry.serials.length >= allowedQty) {
      const errorMessage = `Limit reached. ${unitLabel} allows only ${allowedQty} serial number${allowedQty > 1 ? 's' : ''}`;
      this.setTransientScanError(
        productIndex,
        unitLabel,
        errorMessage,
      );
      unitEntry.scanInput = '';
      this.focusSerialScanInput(productIndex, unitLabel);
      void this.auditLogService.createAuditLog({
        action: 'SERIAL_SCAN_FAILURE',
        entityType: 'PurchaseOrder',
        entityId: this.editingPurchaseId,
        metadata: {
          serialNumber,
          reason: 'quantity_limit_reached',
          message: errorMessage,
          productIndex,
          unitLabel,
          allowedQty,
          currentCount: unitEntry.serials.length,
          event: 'ui_validation_failure',
        },
      });
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
      void this.auditLogService.createAuditLog({
        action: 'SERIAL_SCAN_FAILURE',
        entityType: 'PurchaseOrder',
        entityId: this.editingPurchaseId,
        metadata: {
          serialNumber,
          reason: 'duplicate_in_other_unit_type',
          message: 'Serial number already exists in another unit type for this product',
          productIndex,
          unitLabel,
          event: 'ui_validation_failure',
        },
      });
      return;
    }

    const existingInCurrentUnit = unitEntry.serials.some(
      (entry) => this.normalizeSerial(entry).toLowerCase() === normalizedIncoming,
    );
    if (existingInCurrentUnit) {
      unitEntry.scanError = 'Serial number already scanned for this unit type';
      unitEntry.scanInput = '';
      this.focusSerialScanInput(productIndex, unitLabel);
      void this.auditLogService.createAuditLog({
        action: 'SERIAL_SCAN_FAILURE',
        entityType: 'PurchaseOrder',
        entityId: this.editingPurchaseId,
        metadata: {
          serialNumber,
          reason: 'duplicate_in_current_unit_type',
          message: 'Serial number already scanned for this unit type',
          productIndex,
          unitLabel,
          event: 'ui_validation_failure',
        },
      });
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
      void this.scanSerialForSelectedUnit(productIndex, false);
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
    if (this.isSerialAutoRetryPaused) {
      this.isSerialAutoRetryPaused = false;
      this.serialFlushFailureCount = 0;
      if (this.createError === 'Failed to save scanned serial numbers. Automatic retry paused.') {
        this.createError = '';
      }
    }

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
      if (this.queuedSerialScans.length === 0 || this.isSerialAutoRetryPaused) {
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
          void this.auditLogService.createAuditLog({
            action: 'SERIAL_SCAN_FAILURE',
            entityType: 'PurchaseOrder',
            entityId: entry.purchaseId,
            metadata: {
              serialNumber: entry.serialNumber,
              reason: 'api_scan_failure',
              message: result?.message ?? 'Failed to save serial number',
              productIndex: entry.productIndex,
              unitLabel: entry.unitLabel,
              expectedProductId: entry.productId,
              expectedCapacityId: entry.capacityId,
              event: 'api_failure',
            },
          });
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

      this.serialFlushFailureCount = 0;
      this.isSerialAutoRetryPaused = false;

      return true;
    } catch (error: unknown) {
      this.serialFlushFailureCount += 1;
      this.queuedSerialScans = [...batch, ...this.queuedSerialScans];

      if (this.serialFlushFailureCount >= this.serialFlushMaxAutoRetryFailures) {
        this.isSerialAutoRetryPaused = true;
        this.createError = 'Failed to save scanned serial numbers. Automatic retry paused.';
      } else {
        this.createError = 'Failed to save scanned serial numbers. Retrying automatically.';
      }

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

      if (this.queuedSerialScans.length > 0 && !this.isSerialAutoRetryPaused) {
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
          ((error as any).response?.data as { message?: string } | undefined)?.message ??
          'Failed to delete serial number';
      } else {
        unitEntry.scanError = 'Failed to delete serial number';
      }
    } finally {
      unitEntry.isScanning = false;
    }
  }

  private buildPurchasePayload(): CreatePurchaseRequestPayload {
    const vendorId = this.resolveExistingVendorId();
    const vendorName = this.createForm.vendorName.trim();
    const useExistingVendor = !!vendorId;
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
        method: String(payment.method ?? '').trim() || undefined,
        terms: String(payment.terms ?? '').trim() || undefined,
        termsDueDate: payment.termsDueDate || null,
        status: this.normalizePayloadPaymentStatus(payment.status),
        paymentDate: payment.paymentDate || null,
        bankName: String(payment.bankName ?? '').trim() || undefined,
        referenceNo: String(payment.referenceNo ?? '').trim() || undefined,
        checkNo: String(payment.checkNo ?? '').trim() || undefined,
        chequeDate: payment.chequeDate || null,
        issuedBy: String(payment.issuedBy ?? '').trim() || undefined,
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

  private validatePurchaseForm(): string | null {
    const vendorName = this.createForm.vendorName.trim();
    const resolvedExistingVendorId = this.resolveExistingVendorId();

    if (!vendorName) {
      return 'Dealer name is required.';
    }

    if (resolvedExistingVendorId) {
      this.createForm.vendorId = resolvedExistingVendorId;
    } else {
      this.createForm.vendorId = '';
    }

    if (this.createForm.productItems.length === 0) {
      return 'At least one product item is required.';
    }

    for (const [index, item] of this.createForm.productItems.entries()) {
      if (!String(item.productId ?? '').trim()) {
        return `Product is required for item ${index + 1}.`;
      }

      if (!String(item.capacityId ?? '').trim()) {
        return `Capacity is required for item ${index + 1}.`;
      }

      if (!Number.isFinite(Number(item.unitPrice)) || Number(item.unitPrice) < 0) {
        return `Unit price must be valid for item ${index + 1}.`;
      }

      if (!Number.isFinite(Number(item.totalSetQty)) || Number(item.totalSetQty) <= 0) {
        return `Quantity must be greater than 0 for item ${index + 1}.`;
      }
    }

    return null;
  }

  private resolveExistingVendorId(): string {
    const existingVendorId = String(this.createForm.vendorId ?? '').trim();
    if (existingVendorId) {
      return existingVendorId;
    }

    const normalizedVendorName = String(this.createForm.vendorName ?? this.vendorSearch ?? '')
      .trim()
      .toLowerCase();
    if (!normalizedVendorName) {
      return '';
    }

    const exactMatch = this.vendorOptions.find(
      (item) => String(item.name ?? '').trim().toLowerCase() === normalizedVendorName,
    );

    if (!exactMatch) {
      return '';
    }

    this.vendorSearch = exactMatch.name;
    this.createForm.vendorName = exactMatch.name ?? '';
    this.createForm.vendorAddress = exactMatch.address ?? '';
    this.createForm.vendorContactPerson = exactMatch.contact_person ?? '';
    this.createForm.vendorContactNumber = exactMatch.contact_number ?? '';

    return exactMatch.id;
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

    this.unresolvedLinkedSerialNumbersByUnitType =
      detail.unresolvedLinkedSerialNumbers && typeof detail.unresolvedLinkedSerialNumbers === 'object'
        ? this.normalizeSerialNumbersByUnitType(detail.unresolvedLinkedSerialNumbers)
        : {};

    this.serialStatusByNumber =
      detail.serialStatuses && typeof detail.serialStatuses === 'object'
        ? Object.fromEntries(
            Object.entries(detail.serialStatuses).map(([serialNumber, status]) => [
              this.normalizeSerial(serialNumber).toLowerCase(),
              String(status ?? '').trim().toLowerCase() || 'in_stock',
            ]),
          )
        : {};

    this.poLinkedSerialNumbersByUnitType =
      detail.poLinkedSerialNumbers && typeof detail.poLinkedSerialNumbers === 'object'
        ? this.normalizeSerialNumbersByUnitType(detail.poLinkedSerialNumbers)
        : {};

    this.vendorSearch = detail.vendorName ?? fallbackItem.vendorName ?? '';
    this.syncProductComboboxState();
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
    const productUnitTypeLabels = this.getProductUnitTypeLabels(String(product.productId ?? ''));

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

    const hasAnySerials = Object.values(serialNumbers).some((entries) => entries.length > 0);
    const hasOnlyLegacySplitLabels =
      normalizedUnitTypes.length > 0 &&
      normalizedUnitTypes.every((entry) => this.isLegacySplitUnitType(entry.label));

    if (
      productUnitTypeLabels.length > 0 &&
      !hasAnySerials &&
      (normalizedUnitTypes.length === 0 || hasOnlyLegacySplitLabels)
    ) {
      normalizedUnitTypes = productUnitTypeLabels.map((label) => {
        const matchedQty = unitTypesFromPayload.find(
          (entry) => this.normalizeUnitTypeLabel(entry.label) === label,
        );
        const nextQty = Number(matchedQty?.value) || Number(product.totalSetQty) || 0;
        return this.createUnitTypeEntry(label, nextQty, []);
      });
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

  private isLegacySplitUnitType(label: unknown): boolean {
    const normalized = this.normalizeUnitTypeLabel(label);
    return normalized === 'indoor' || normalized === 'outdoor';
  }

  private getProductUnitTypeLabels(productId: string): string[] {
    const product = this.catalogProducts.find((item) => String(item.id) === String(productId));
    const labels = Array.isArray(product?.unitTypes) ? product.unitTypes : [];

    const normalized = labels
      .map((entry) => this.normalizeUnitTypeLabel(entry))
      .filter((entry, index, all) => entry.length > 0 && all.indexOf(entry) === index);

    return normalized;
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
        this.createUnitTypeEntry('set', 0, []),
      ],
      totalSetQty: 1,
    };
  }

  private syncProductComboboxState(): void {
    this.productSearchByItem = Object.fromEntries(
      this.createForm.productItems.map((item, index) => [String(index), item.productId ? this.getProductDisplayLabel(item.productId) : '']),
    );
    this.isProductDropdownOpenByItem = Object.fromEntries(
      this.createForm.productItems.map((_, index) => [String(index), false]),
    );
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
