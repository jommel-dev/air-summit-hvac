
import { CommonModule } from '@angular/common';
import { Component, HostListener, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { PageBreadcrumbComponent } from '../../shared/components/common/page-breadcrumb/page-breadcrumb.component';
import {
  SalesOrderRow,
  SalesTab,
  ProductOption,
  SalesOrderPayload,
  SalesOrderMigrationPreviewItem,
  SalesCustomerOption,
  SalesOrderDetailItem,
  SalesOrderDetailProductItem,
  SalesOrderDetailUnitType,
  SalesOrderListItem,
  ProductCapacityOption,
  SalesOrderExpenseDetailsPayload,
  SalesReturnSerialOptionGroup,
  SalesOrderService,
} from '../../shared/services/sales-order.service';
import { MaterialTransactionItem } from '../../shared/services/sales-order-material.service';
import axios from 'axios';
import { PDFDocument, StandardFonts, rgb, PDFFont } from 'pdf-lib';
import {
  BusinessProfileSettings,
  BusinessSettingsService,
} from '../../shared/services/business-settings.service';
import { RbacService } from '../../shared/services/rbac.service';
import { UserManagementService, UserApiItem } from '../../shared/services/user-management.service';
import { AuditLogFrontendService } from '../../shared/services/audit-log.service';
import { ModalComponent } from '../../shared/components/ui/modal/modal.component';
import { SerialValidationModalComponent, SerialValidationModalMode, SerialValidationDetails } from './serial-validation-modal/serial-validation-modal.component';
import { DrGeneratorService } from '../../shared/services/dr-generator.service';
import { DrEligibleOrder } from '../../shared/interfaces/dr-generator.interfaces';

type SalesOrderErrorDialog = {
  title: string;
  message: string;
  confirmText?: string;
};

type SalesGuardDialogMode = 'close-confirm' | 'remove-serial-confirm' | 'refresh-confirm' | 'receive-confirm';

interface SalesPendingSerialRemoval {
  productIndex: number;
  unitLabel: string;
  serialNumber: string;
}

interface QueuedSalesSerialScan {
  productIndex: number;
  unitLabel: string;
  serialNumber: string;
  salesId: number;
  productId: number;
  capacityId: number;
}

interface PendingValidationWarning {
  serialNumber: string;
  productIndex: number;
  unitLabel: string;
  validationStatus: string;
  details: Record<string, unknown>;
  salesId: number;
  productId: number;
  capacityId: number;
}

interface SalesUnitTypeFormItem {
  label: string;
  value: number;
  serials: string[];
  serialInput: string;
  scanInput: string;
  scanError: string;
  scanSuccess: string;
  scanInfo: string;
  isScanning?: boolean;
}

interface SalesProductFormItem {
  productId: string;
  capacityId: string;
  unitPrice: number;
  sellPrice: number | string;
  discountPrice: number | string;
  unitTypes: SalesUnitTypeFormItem[];
  totalSetQty: number;
}

interface SalesServiceFormItem {
  serviceName: string;
  unitPrice: number;
  qty: number;
  total: number;
}

type SalesPaymentMethod = 'Cash' | 'Bank Transfer' | 'Terms' | 'Terms with DP' | 'Cheque' | 'Credit Card' | 'Installment';
interface SalesPaymentFormItem {
  method: SalesPaymentMethod;
  amount: number;
  terms?: string;
  termsDueDate?: string;
  autoTermsDueDate?: boolean;
  status?: string;
  referenceNo?: string;
  paymentDate?: string;
  issuedBy?: string;
  ccCharge?: string;
  checkNo?: string;
  bankName?: string;
  bankAccount?: string;
  postDated?: string;
  downPayment?: number;
}

@Component({
  selector: 'app-sales-order',
  imports: [CommonModule, FormsModule, PageBreadcrumbComponent, ModalComponent, SerialValidationModalComponent],
  templateUrl: './sales-order.component.html',
  styles: ``,
})

export class SalesOrderComponent {
    // Error dialog state for modal
    isErrorDialogOpen = false;
    errorDialog: SalesOrderErrorDialog | null = null;
    /**
     * Opens a modal dialog for error messages, matching SO Session Guard modal style.
     */
    openErrorDialog(message: string, title = 'Sales Order Error', confirmText = 'Close'): void {
      this.errorDialog = { title, message, confirmText };
      this.isErrorDialogOpen = true;
    }

    closeErrorDialog(): void {
      this.isErrorDialogOpen = false;
      this.errorDialog = null;
    }

    receiverOptions: UserApiItem[] = [];
  readonly salesTypeOptions = [
    'sales',
    'sales and service',
    'project',
    'sub-dealer',
    'service',
    'concern',
    'transfer',
  ] as const;

  readonly serviceNameOptions = [
    'CLEANING',
    'DISMANTLE',
    'RELOCATION',
    'CHARING FREON',
    'SURVEY',
    'CHIPPING',
    'PUMP DOWN',
    'INSTALL ONLY',
    'CHECKUP',
  ] as const;

  readonly paymentMethodOptions: SalesPaymentFormItem['method'][] = [
    'Cash',
    'Bank Transfer',
    'Terms',
    'Terms with DP',
    'Cheque',
    'Credit Card',
    'Installment',
  ];

  constructor(
    private readonly salesOrderService: SalesOrderService,
    private readonly businessSettingsService: BusinessSettingsService,
    private readonly drGeneratorService: DrGeneratorService,
    private readonly route: ActivatedRoute,
    private readonly sanitizer: DomSanitizer,
    private readonly rbacService: RbacService,
    private readonly userManagementService: UserManagementService,
    private readonly auditLogService: AuditLogFrontendService,
  ) {}

  // ...existing code (all properties, methods, etc. go here, inside the class)...

  // Example usage: Replace all direct uiError assignments in SO creation with openErrorDialog

  activeTab: SalesTab = 'schedules';
  isLoading = false;
  errorMessage = '';
  search = '';
  page = 1;
  limit = 10;
  total = 0;
  totalPages = 1;
  private readonly searchDebounceMs = 300;
  private searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private customerDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly serialScanDebounceMs = 120;
  private readonly serialBatchSize = 50;
  private readonly serialBatchIdleMs = 1500;
  private readonly serialBatchIntervalMs = 5000;
  private serialScanTimers: Record<string, ReturnType<typeof setTimeout>> = {};
  private serialScanErrorTimers: Record<string, ReturnType<typeof setTimeout>> = {};
  isFlushingQueuedSerials = false;
  private activeSerialFlushCount = 0;
  private queuedSerialScans: QueuedSalesSerialScan[] = [];
  private queuedSerialFlushTimer: ReturnType<typeof setTimeout> | null = null;
  private queuedSerialIntervalTimer: ReturnType<typeof setInterval> | null = null;

  get pendingSerialScanCount(): number {
    return this.queuedSerialScans.length + this.activeSerialFlushCount;
  }

  orders: SalesOrderRow[] = [];
  selectedOrderIds = new Set<number>();
  isAssignInstallerModalOpen = false;
  bulkInstallerName = '';
  isBulkAssigning = false;
  isBulkRemitModalOpen = false;
  isBulkRemitting = false;
  bulkRemitInstallerName = '';
  bulkRemitInstallerOrders: Array<{ id: number; soNumber: string; customerName: string; status: string }> = [];
  isBulkRemitInstallerPromptOpen = false;
  isLoadingInstallerOrders = false;
  returningOrderIds = new Set<number>();
  receivingOrderIds = new Set<number>();
  printingOrderIds = new Set<number>();
  isDrPreviewOpen = false;
  drPreviewUrl: SafeResourceUrl | null = null;
  drPreviewFilename = 'Delivery-Receipt.pdf';
  private drPreviewObjectUrl: string | null = null;
  private drTemplateBytes: Uint8Array | null = null;
  private drTemplateSourceKey: string | null = null;
  private readonly defaultDrTemplateSource = '/docs/DefaultHVAC-DR.pdf';
  private businessProfileSettings: BusinessProfileSettings | null = null;

  isDrawerOpen = false;
  drawerMode: 'create' | 'edit' = 'create';
  nextSoNumberPreview = '';
  guardDialogMode: SalesGuardDialogMode | null = null;
  isGuardDialogOpen = false;
  pendingSerialRemoval: SalesPendingSerialRemoval | null = null;
  pendingRefreshEvent: BeforeUnloadEvent | null = null;
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

  toggleOrderSelection(orderId: number): void {
    if (this.selectedOrderIds.has(orderId)) {
      this.selectedOrderIds.delete(orderId);
    } else {
      this.selectedOrderIds.add(orderId);
    }
  }

  toggleSelectAll(): void {
    if (this.selectedOrderIds.size === this.orders.length) {
      this.selectedOrderIds.clear();
    } else {
      this.selectedOrderIds = new Set(this.orders.map(o => o.id));
    }
  }

  get isAllSelected(): boolean {
    return this.orders.length > 0 && this.selectedOrderIds.size === this.orders.length;
  }

  openAssignInstallerModal(): void {
    this.bulkInstallerName = '';
    this.isAssignInstallerModalOpen = true;
  }

  closeAssignInstallerModal(): void {
    this.isAssignInstallerModalOpen = false;
    this.bulkInstallerName = '';
  }

  async confirmBulkAssignInstaller(): Promise<void> {
    if (!this.bulkInstallerName.trim() || this.selectedOrderIds.size === 0) {
      return;
    }
    this.isBulkAssigning = true;
    try {
      const result = await this.salesOrderService.bulkAssignInstaller(
        [...this.selectedOrderIds],
        this.bulkInstallerName.trim(),
      );
      if (result.success) {
        // Update local rows
        for (const order of this.orders) {
          if (this.selectedOrderIds.has(order.id)) {
            order.installer = this.bulkInstallerName.trim();
          }
        }
        this.selectedOrderIds.clear();
        this.closeAssignInstallerModal();
      } else {
        this.openErrorModal('Assign Error', result.message || 'Failed to assign installer');
      }
    } catch (error: unknown) {
      this.openErrorModal('Assign Error', 'Failed to assign installer');
    } finally {
      this.isBulkAssigning = false;
    }
  }

  // ─── Bulk Remit ─────────────────────────────────────────────────────────────

  openBulkRemitModal(): void {
    if (this.selectedOrderIds.size === 0) return;

    // UI-level validation: check for pending or no-serial orders
    const selectedOrders = this.orders.filter(o => this.selectedOrderIds.has(o.id));
    const pendingOrders = selectedOrders.filter(o => {
      const normalized = (o.status ?? '').trim().toLowerCase().replace(/[_ ]/g, '-');
      return normalized === 'pending';
    });
    const noSerialOrders = selectedOrders.filter(o => {
      const normalized = (o.status ?? '').trim().toLowerCase().replace(/[_ ]/g, '-');
      return normalized !== 'pending' && (o.serialCount ?? 0) === 0;
    });

    if (pendingOrders.length > 0 || noSerialOrders.length > 0) {
      const issues: string[] = [];
      if (pendingOrders.length > 0) {
        const soList = pendingOrders.map(o => o.soNumber).join(', ');
        issues.push(`The following order(s) are still in Pending status and cannot be remitted: ${soList}`);
      }
      if (noSerialOrders.length > 0) {
        const soList = noSerialOrders.map(o => o.soNumber).join(', ');
        issues.push(`The following order(s) have no scanned serial numbers: ${soList}`);
      }
      this.openErrorModal('Cannot Remit', issues.join('\n\n'));
      return;
    }

    // Check if a single order is selected and it has an installer
    if (this.selectedOrderIds.size === 1) {
      const orderId = [...this.selectedOrderIds][0];
      const order = this.orders.find(o => o.id === orderId);
      if (order?.installer?.trim()) {
        // Ask the user if they want to remit all of this installer's SOs for today
        this.bulkRemitInstallerName = order.installer.trim();
        this.isBulkRemitInstallerPromptOpen = true;
        return;
      }
    }

    // Multiple selection or no installer — go straight to confirm
    this.isBulkRemitModalOpen = true;
  }

  closeBulkRemitModal(): void {
    this.isBulkRemitModalOpen = false;
  }

  closeBulkRemitInstallerPrompt(): void {
    this.isBulkRemitInstallerPromptOpen = false;
    this.bulkRemitInstallerName = '';
    this.bulkRemitInstallerOrders = [];
  }

  /** User said YES to "Remit All of <installer>'s SO for today?" */
  async confirmRemitAllInstallerOrders(): Promise<void> {
    this.isLoadingInstallerOrders = true;
    try {
      const result = await this.salesOrderService.getInstallerOrdersForToday(this.bulkRemitInstallerName);
      if (result.success && result.orders.length > 0) {
        // Auto-select all installer orders for today
        this.bulkRemitInstallerOrders = result.orders;
        const installerOrderIds = result.orders.map(o => o.id);
        for (const id of installerOrderIds) {
          this.selectedOrderIds.add(id);
        }
        this.isBulkRemitInstallerPromptOpen = false;
        this.isBulkRemitModalOpen = true;
      } else {
        this.isBulkRemitInstallerPromptOpen = false;
        this.openErrorModal('No Orders Found', `No "for-delivery" orders found for ${this.bulkRemitInstallerName} today.`);
      }
    } catch {
      this.isBulkRemitInstallerPromptOpen = false;
      this.openErrorModal('Error', 'Failed to fetch installer orders for today.');
    } finally {
      this.isLoadingInstallerOrders = false;
    }
  }

  /** User said NO — just remit the one they selected manually */
  declineRemitAllInstallerOrders(): void {
    this.isBulkRemitInstallerPromptOpen = false;
    this.bulkRemitInstallerName = '';
    this.bulkRemitInstallerOrders = [];
    this.isBulkRemitModalOpen = true;
  }

  async confirmBulkRemit(): Promise<void> {
    if (this.selectedOrderIds.size === 0) return;
    this.isBulkRemitting = true;
    try {
      const result = await this.salesOrderService.bulkRemit([...this.selectedOrderIds]);
      if (result.success) {
        // Update local rows
        for (const order of this.orders) {
          if (this.selectedOrderIds.has(order.id)) {
            order.status = 'remitted';
          }
        }
        this.selectedOrderIds.clear();
        this.closeBulkRemitModal();
        this.bulkRemitInstallerOrders = [];

        // Show message with skipped info if any
        let message = result.message || 'Orders remitted successfully';
        if (result.skipped && result.skipped.length > 0) {
          const skippedDetails = result.skipped.map(s => `${s.soNumber}: ${s.reason}`).join('\n');
          this.openErrorModal('Remit Completed (with skipped)', `${message}\n\nSkipped orders:\n${skippedDetails}`);
        }

        // Reload the current tab to reflect changes
        await this.loadTabData(this.activeTab);
      } else {
        this.openErrorModal('Remit Error', result.message || 'Failed to remit orders');
      }
    } catch (error: unknown) {
      this.openErrorModal('Remit Error', 'Failed to remit orders');
    } finally {
      this.isBulkRemitting = false;
    }
  }

  isReturnModalOpen = false;
  pendingReturnOrder: SalesOrderRow | null = null;
  isReturnModalLoading = false;
  returnModalError = '';
  returnSerialGroups: SalesReturnSerialOptionGroup[] = [];
  returnForm = {
    remarks: '',
    isDefective: false,
  };
  selectedReturnedSerialNumbers = new Set<string>();
  editingSalesId: number | null = null;
  customerMode: 'existing' | 'new' = 'existing';
  uiMessage = '';
  uiError = '';

  // Daily Unit Release Report state
  isDailyUnitReleaseModalOpen = false;
  isGeneratingDailyUnitRelease = false;
  dailyUnitReleaseError = '';
  dailyUnitReleaseDateFrom = new Date().toISOString().split('T')[0];
  dailyUnitReleaseDateTo = new Date().toISOString().split('T')[0];

  isMigrationModalOpen = false;
  isMigrationPreviewLoading = false;
  isMigrationImporting = false;
  migrationPreviewError = '';
  migrationPreviewFileName = '';
  migrationSourceRows: Array<Record<string, unknown>> = [];
  selectedMediumRowNumbers = new Set<number>();
  migrationImportSummary: {
    batchFailed: boolean;
    message: string;
    total: number;
    created: number;
    failed: number;
    blocked: number;
    aborted: number;
    skippedReview: number;
    failureDetails: Array<{ rowNumber: number; status: string; message: string }>;
  } | null = null;
  migrationPreviewSummary: {
    total: number;
    highConfidence: number;
    reviewNeeded: number;
    rejected: number;
    matchedCustomers: number;
    newCustomers: number;
  } | null = null;
  migrationPreviewItems: SalesOrderMigrationPreviewItem[] = [];
  isMigrationDrawerMode = false;
  migrationEditingRowNumber: number | null = null;
  migrationEditedPayloadByRow: Record<number, SalesOrderPayload> = {};
  isSubmitting = false;
  isRemitting = false;
  isSendingForDelivery = false;
  customerOptions: SalesCustomerOption[] = [];
  customerSearch = '';
  isCustomerDropdownOpen = false;
  catalogProducts: ProductOption[] = [];
  productSearchQuery = '';
  isProductDropdownOpen = false;
  activeProductTabIndex = 0;
  activeServiceTabIndex = 0;
  readonly serialsPerPage = 10;
  serialPageByUnitType: Record<string, number> = {};
  selectedUnitTypeByProduct: Record<number, string> = {};
  private drawerBaselineSnapshot = '';
  materialItems: MaterialTransactionItem[] = [];
  branchOptions: Array<{ id: number; branchName: string }> = [];
  activeExpenseTabIndex = 0;

  // Rejected scan counter state
  rejectedScanCount = 0;
  rejectedScanList: Array<{ serialNumber: string; reason: string; timestamp: Date }> = [];

  // Serial validation warning modal state
  pendingValidationWarnings: PendingValidationWarning[] = [];
  currentValidationWarning: PendingValidationWarning | null = null;
  isValidationModalOpen = false;
  validationModalMode: SerialValidationModalMode | null = null;
  validationModalDetails: SerialValidationDetails = {};

  // Project search/picker properties
  projectSearchInput = '';
  projectSearchResults: any[] = [];
  projectSearchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  selectedProjectDetails: any = null;

  form: any = {
    customer_id: '',
    projectId: undefined as number | undefined,
    totalAmount: 0,
    scheduleDate: '',
    salesType: 'sales',
    projectName: '',
    projectCode: '',
    installer: '',
    remarks: '',
    transferDetails: {
      fromBranchId: undefined as number | undefined,
      toBranchId: undefined as number | undefined,
      transferDate: '',
      expectedDeliveryDate: '',
      actualDeliveryDate: '',
      transferStatus: '',
      transferNotes: '',
    },
    concernDetails: {
      concernType: '',
      concernSubject: '',
      concernDescription: '',
      concernStatus: '',
      priority: '',
      resolutionNotes: '',
      resolvedAt: '',
      warrantySerials: '',
    },
    expenseDetails: [this.createEmptyExpenseItem()],
    customer: {
      name: '',
      address: '',
      contact_person: '',
      contact_number: '',
      email: '',
      tin_number: '',
    },
    paymentDetails: [this.createEmptyPaymentItem()],
    productItems: [this.createEmptyProductItem()],
    serviceItems: [this.createEmptyServiceItem()],
    status: 'pending',
  };

  private readonly salesTabPermissionKeyMap: Record<SalesTab, string> = {
    schedules: 'sales-order.tab.schedules',
    services: 'sales-order.tab.services',
    projects: 'sales-order.tab.projects',
    distribution: 'sales-order.tab.distribution',
    'sales-receivable': 'sales-order.tab.sales-receivable',
    'remitted-sales': 'sales-order.tab.remitted-sales',
  };

  ngOnInit(): void {
    const availableTabs = this.getTabs();
    if (availableTabs.length > 0) {
      this.activeTab = availableTabs[0].key;
    }

    void this.loadTabData(this.activeTab);
    void this.loadReferenceData();
    void this.loadCustomerOptions();
    this.startQueuedSerialAutoFlush();

    // Load employees for receiver dropdown
    this.userManagementService.getUsers().then((res) => {
      this.receiverOptions = res.data || [];
    });

    const editId = Number(this.route.snapshot.queryParamMap.get('editId'));
    if (Number.isInteger(editId) && editId > 0) {
      void this.openEditDrawerById(editId);
    }
  }

  ngOnDestroy(): void {
    if (this.searchDebounceTimer) {
      clearTimeout(this.searchDebounceTimer);
      this.searchDebounceTimer = null;
    }

    if (this.customerDebounceTimer) {
      clearTimeout(this.customerDebounceTimer);
      this.customerDebounceTimer = null;
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

    this.revokeDrPreviewUrl();
  }

  async setTab(tab: SalesTab): Promise<void> {
    if (!this.canAccessSalesTab(tab)) {
      return;
    }

    if (this.activeTab === tab) return;
    this.activeTab = tab;
    this.page = 1;
    await this.loadTabData(tab);
  }

  openMigrationModal(): void {
    this.isMigrationModalOpen = true;
    this.migrationPreviewError = '';
  }

  closeMigrationModal(): void {
    this.isMigrationModalOpen = false;
    this.migrationImportSummary = null;
    this.selectedMediumRowNumbers.clear();
    this.migrationEditedPayloadByRow = {};
    this.closeMigrationRowEdit();
  }

  openMigrationRowEdit(item: SalesOrderMigrationPreviewItem): void {
    if (this.isMigrationBranchAssignmentRow(item)) {
      this.migrationPreviewError =
        'This row is configured for direct branch assignment, so it does not open in the Sales Order editor.';
      return;
    }

    const rowNumber = Number(item.rowNumber ?? 0);
    if (!Number.isFinite(rowNumber) || rowNumber <= 0) {
      this.migrationPreviewError = 'Invalid migration row selected.';
      return;
    }

    const candidatePayload =
      this.migrationEditedPayloadByRow[rowNumber] ??
      ((item.mappedPayload as SalesOrderPayload | null) ?? null);

    if (!candidatePayload) {
      this.migrationPreviewError = 'This row has no importable payload yet. Fix mapping issues first.';
      return;
    }

    this.migrationEditingRowNumber = rowNumber;
    this.isMigrationDrawerMode = true;
    this.migrationPreviewError = '';
    this.isMigrationModalOpen = false;

    this.resetForm();
    this.drawerMode = 'create';
    this.editingSalesId = null;
    this.isDrawerOpen = true;
    this.serialPageByUnitType = {};
    this.uiMessage = '';
    this.uiError = '';
    this.applyMigrationPayloadToForm(candidatePayload);
    this.captureDrawerBaselineSnapshot();
  }

  closeMigrationRowEdit(): void {
    this.isMigrationDrawerMode = false;
    this.migrationEditingRowNumber = null;
  }

  isMigrationRowEdited(rowNumber: number): boolean {
    return Boolean(this.migrationEditedPayloadByRow[rowNumber]);
  }

  isMigrationBranchAssignmentRow(item: SalesOrderMigrationPreviewItem): boolean {
    const mappedPayload = (item.mappedPayload ?? null) as Record<string, unknown> | null;
    return String(mappedPayload?.['migrationMode'] ?? '').trim().toLowerCase() === 'branch-assignment';
  }

  private applyMigrationPayloadToForm(payload: SalesOrderPayload): void {
    const paymentDetails =
      Array.isArray(payload.paymentDetails) && payload.paymentDetails.length > 0
        ? payload.paymentDetails.map((payment) => ({
            method: this.toPaymentMethod(payment?.method),
            amount: Number(payment?.amount) || 0,
            terms: String(payment?.terms ?? ''),
            termsDueDate: this.toDateInputValue(String(payment?.termsDueDate ?? '')),
            autoTermsDueDate: true,
            status: String(payment?.status ?? ''),
            referenceNo: String(payment?.referenceNo ?? ''),
            paymentDate: this.toDateInputValue(String(payment?.paymentDate ?? '')),
            issuedBy: String(payment?.issuedBy ?? ''),
            ccCharge: String(payment?.ccCharge ?? ''),
            checkNo: String(payment?.checkNo ?? ''),
            bankName: String(payment?.bankName ?? ''),
            bankAccount: String(payment?.bankAccount ?? ''),
            postDated: String(payment?.postDated ?? ''),
            downPayment: Number(payment?.downPayment) || 0,
          }))
        : [this.createEmptyPaymentItem()];

    const productItems =
      Array.isArray(payload.productItems) && payload.productItems.length > 0
        ? payload.productItems.map((product: any) => {
            const unitTypesFromPayload = Array.isArray(product?.unitTypesQty)
              ? product.unitTypesQty
              : [];
            const serialNumbersRaw =
              product?.serialNumbers && typeof product.serialNumbers === 'object'
                ? (product.serialNumbers as Record<string, unknown>)
                : {};

            const serialNumbers: Record<string, string[]> = {};
            for (const [key, value] of Object.entries(serialNumbersRaw)) {
              if (key.toLowerCase() === 'status') continue;
              if (!Array.isArray(value)) continue;
              const normalized = value
                .map((entry) => this.normalizeSerial(String(entry ?? '')))
                .filter((entry) => entry.length > 0);
              if (normalized.length > 0) {
                serialNumbers[String(key).trim().toLowerCase()] = normalized;
              }
            }

            const labelsFromPayload = unitTypesFromPayload
              .map((entry: any) => String(entry?.label ?? '').trim().toLowerCase())
              .filter((label: string, index: number, self: string[]) => label.length > 0 && self.indexOf(label) === index);
            const labelsFromSerial = Object.keys(serialNumbers).filter((label, index, self) => self.indexOf(label) === index);

            // Fall back to catalog unitTypes before 'set'
            const catalogProd = this.catalogProducts.find((p) => String(p.id) === String(product?.productId));
            const catalogUnitTypesFallback = (catalogProd?.unitTypes ?? [])
              .map((u: string) => String(u).trim().toLowerCase())
              .filter(Boolean);

            const labels =
              labelsFromPayload.length > 0
                ? labelsFromPayload
                : labelsFromSerial.length > 0
                  ? labelsFromSerial
                  : catalogUnitTypesFallback.length > 0
                    ? catalogUnitTypesFallback
                    : ['set'];

            const qtyMap = new Map<string, number>();
            for (const entry of unitTypesFromPayload) {
              const label = String(entry?.label ?? '').trim().toLowerCase();
              if (!label) continue;
              qtyMap.set(label, Math.max(0, Math.floor(Number(entry?.value) || 0)));
            }

            const fallbackQty = Math.max(0, Math.floor(Number(product?.totalSetQty) || 0));
            const unitTypes = labels.map((label: string) => {
              const serials = Array.isArray(serialNumbers[label]) ? serialNumbers[label] : [];
              const value = qtyMap.get(label) ?? (serials.length > 0 ? serials.length : fallbackQty);
              return this.createUnitTypeEntry(label, value, serials);
            });

            return {
              productId: String(product?.productId ?? ''),
              capacityId: String(product?.capacityId ?? ''),
              unitPrice: Number(product?.unitPrice) || 0,
              sellPrice: Number(product?.sellPrice) || 0,
              discountPrice: Number(product?.discountPrice) || 0,
              unitTypes,
              totalSetQty: Math.max(0, Math.floor(Number(product?.totalSetQty) || 0)),
            };
          })
        : [this.createEmptyProductItem()];

    const serviceItems =
      Array.isArray(payload.serviceItems) && payload.serviceItems.length > 0
        ? payload.serviceItems.map((item: any) => ({
            serviceName: String(item?.serviceName ?? ''),
            unitPrice: Number(item?.serviceCost) || 0,
            qty: Number(item?.serviceDurationHours) || 0,
            total: Number(item?.serviceCost) || 0,
          }))
        : [this.createEmptyServiceItem()];

    const customer = payload.customer ?? {};
    this.customerMode = payload.customer_id ? 'existing' : 'new';
    this.form = {
      ...this.form,
      customer_id: payload.customer_id ?? '',
      totalAmount: Number(payload.totalAmount) || 0,
      scheduleDate: this.toDateInputValue(String(payload.scheduleDate ?? '')),
      salesType: String(payload.salesType ?? this.getSalesTypeFromActiveTab()),
      projectName: String(payload.projectName ?? ''),
      projectCode: String(payload.projectCode ?? ''),
      installer: String(payload.installer ?? ''),
      remarks: String(payload.remarks ?? ''),
      transferDetails: payload.transferDetails ?? this.form.transferDetails,
      concernDetails: payload.concernDetails ?? this.form.concernDetails,
      expenseDetails:
        Array.isArray(payload.expenseDetails) && payload.expenseDetails.length > 0
          ? payload.expenseDetails
          : [this.createEmptyExpenseItem()],
      customer: {
        name: String((customer as any).name ?? ''),
        address: String((customer as any).address ?? ''),
        contact_person: String((customer as any).contact_person ?? ''),
        contact_number: String((customer as any).contact_number ?? ''),
        email: String((customer as any).email ?? ''),
        tin_number: String((customer as any).tin_number ?? ''),
      },
      paymentDetails,
      productItems,
      serviceItems,
      status: String(payload.status ?? 'pending'),
    };

    this.customerSearch = this.form.customer.name ?? '';
    this.activeProductTabIndex = 0;
    this.syncProductSearchQuery();
    this.activeServiceTabIndex = 0;
    this.selectedUnitTypeByProduct = {};
    this.form.productItems.forEach((_: unknown, index: number) => this.ensureSelectedUnitType(index));
    this.recalculateTotalAmount();
  }

  private async refreshMigrationPreview(): Promise<void> {
    this.isMigrationPreviewLoading = true;
    this.migrationPreviewError = '';
    this.migrationImportSummary = null;
    this.selectedMediumRowNumbers.clear();

    try {
      const result = await this.salesOrderService.previewDailyReleaseMigration(this.migrationSourceRows);
      if (!result.success) {
        this.migrationPreviewError = result.message ?? 'Failed to preview migration CSV.';
        this.migrationPreviewSummary = null;
        this.migrationPreviewItems = [];
        return;
      }

      this.migrationPreviewSummary = result.summary;
      this.migrationPreviewItems = result.items ?? [];
    } catch (error) {
      this.migrationPreviewError =
        error instanceof Error ? error.message : 'Failed to refresh migration preview.';
      this.migrationPreviewSummary = null;
      this.migrationPreviewItems = [];
    } finally {
      this.isMigrationPreviewLoading = false;
    }
  }

  async onMigrationFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    this.migrationPreviewError = '';
    this.migrationPreviewFileName = file.name;
    this.isMigrationPreviewLoading = true;

    try {
      const content = await file.text();
      const rows = this.parseMigrationCsv(content);
      this.migrationSourceRows = rows;
      this.migrationImportSummary = null;
      this.selectedMediumRowNumbers.clear();
      this.migrationEditedPayloadByRow = {};

      if (rows.length === 0) {
        this.migrationPreviewError = 'No valid rows found in CSV.';
        this.migrationPreviewSummary = null;
        this.migrationPreviewItems = [];
        return;
      }

      await this.refreshMigrationPreview();
    } catch (error) {
      this.migrationPreviewError =
        error instanceof Error ? error.message : 'Failed to read migration CSV.';
      this.migrationPreviewSummary = null;
      this.migrationPreviewItems = [];
      this.migrationSourceRows = [];
      this.selectedMediumRowNumbers.clear();
    } finally {
      this.isMigrationPreviewLoading = false;
      input.value = '';
    }
  }

  async importMigrationHighConfidence(): Promise<void> {
    if (this.isMigrationImporting || this.isMigrationPreviewLoading) return;
    if (!this.migrationSourceRows.length) {
      this.migrationPreviewError = 'Upload and preview a CSV first.';
      return;
    }

    this.isMigrationImporting = true;
    this.migrationPreviewError = '';
    this.uiError = '';
    this.uiMessage = '';

    try {
      const selectedMediumRows = [...this.selectedMediumRowNumbers];
      const editedPayloads = Object.entries(this.migrationEditedPayloadByRow)
        .map(([rowNumber, payload]) => ({ rowNumber: Number(rowNumber), payload }))
        .filter((entry) => Number.isFinite(entry.rowNumber) && entry.rowNumber > 0);

      const result = await this.salesOrderService.importDailyReleaseMigration(
        this.migrationSourceRows,
        selectedMediumRows,
        editedPayloads,
      );
      if (!result.summary) {
        this.migrationPreviewError = result.message ?? 'Migration import failed.';
        return;
      }

      const failureDetails = (result.items ?? []).filter(
        (d) => d.status === 'failed' || d.status === 'blocked' || d.status === 'aborted',
      );

      this.migrationImportSummary = {
        batchFailed: result.batchFailed ?? !result.success,
        message: result.message ?? '',
        total: result.summary.total,
        created: result.summary.created,
        failed: result.summary.failed,
        blocked: result.summary.blocked,
        aborted: result.summary.aborted,
        skippedReview: result.summary.skippedReview,
        failureDetails,
      };

      if (result.success) {
        this.uiMessage = `Migration import done: ${result.summary.created} row(s) created.`;
        await this.loadTabData(this.activeTab);
      } else {
        this.uiError = result.message ?? 'Migration batch failed.';
      }
    } catch (error) {
      this.migrationPreviewError = error instanceof Error ? error.message : 'Migration import failed.';
    } finally {
      this.isMigrationImporting = false;
    }
  }

  toggleMediumRowSelection(rowNumber: number, checked: boolean): void {
    if (!Number.isFinite(rowNumber) || rowNumber <= 0) return;

    if (checked) {
      this.selectedMediumRowNumbers.add(rowNumber);
    } else {
      this.selectedMediumRowNumbers.delete(rowNumber);
    }
  }

  isMediumRowSelected(rowNumber: number): boolean {
    return this.selectedMediumRowNumbers.has(rowNumber);
  }

  getImportCandidateCount(): number {
    const high = this.migrationPreviewSummary?.highConfidence ?? 0;
    return high + this.selectedMediumRowNumbers.size;
  }

  private parseMigrationCsv(content: string): Array<Record<string, unknown>> {
    const lines = String(content ?? '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    if (lines.length <= 1) return [];

    const headers = this.parseCsvLine(lines[0]);
    const rows: Array<Record<string, unknown>> = [];

    for (let i = 1; i < lines.length; i++) {
      const cols = this.parseCsvLine(lines[i]);
      if (cols.every((col) => !String(col ?? '').trim())) continue;

      const row: Record<string, unknown> = {};
      for (let c = 0; c < headers.length; c++) {
        row[String(headers[c] ?? '').trim()] = String(cols[c] ?? '').trim();
      }
      rows.push(row);
    }

    return rows;
  }

  private parseCsvLine(line: string): string[] {
    const out: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        const next = line[i + 1];
        if (inQuotes && next === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
        continue;
      }

      if (ch === ',' && !inQuotes) {
        out.push(current);
        current = '';
        continue;
      }

      current += ch;
    }

    out.push(current);
    return out;
  }

  getMigrationConfidenceClass(confidence: string): string {
    if (confidence === 'high') {
      return 'bg-success-50 text-success-700 dark:bg-success-500/15 dark:text-success-400';
    }
    if (confidence === 'medium') {
      return 'bg-warning-50 text-warning-700 dark:bg-warning-500/15 dark:text-warning-400';
    }
    return 'bg-error-50 text-error-700 dark:bg-error-500/15 dark:text-error-400';
  }

  getTabs(): Array<{ key: SalesTab; label: string }> {
    const allTabs: Array<{ key: SalesTab; label: string }> = [
      { key: 'schedules', label: 'Schedules' },
      { key: 'services', label: 'Services' },
      { key: 'projects', label: 'Projects' },
      { key: 'distribution', label: 'Distribution' },
      { key: 'sales-receivable', label: 'Sales Receivable' },
      { key: 'remitted-sales', label: 'Remitted Sales' },
    ];

    return allTabs.filter((tab) => this.canAccessSalesTab(tab.key));
  }

  canCreateSalesOrder(): boolean {
    return this.rbacService.canAccess('sales_order', 'canCreate');
  }

  canEditSalesOrder(): boolean {
    return this.rbacService.canAccess('sales_order', 'canUpdate');
  }

  private canAccessSalesTab(tab: SalesTab): boolean {
    if (!this.rbacService.canAccess('sales_order', 'canRead')) {
      return false;
    }

    const hasExplicitTabRules =
      this.rbacService.hasAnyEffectivePermissionWithPrefix('sales-order.tab.');
    if (!hasExplicitTabRules) {
      return true;
    }

    const permissionKey = this.salesTabPermissionKeyMap[tab];
    return this.rbacService.hasEffectivePermissionKey(permissionKey);
  }

  onSearchChange(value: string): void {
    this.search = value;
    this.page = 1;
    if (this.searchDebounceTimer) clearTimeout(this.searchDebounceTimer);
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

  onCustomerSearchChange(value: string): void {
    this.customerSearch = value;
    this.form.customer_id = '';
    this.isCustomerDropdownOpen = true;
    this.form.customer.name = String(value ?? '').trim();
    this.form.customer.address = '';
    this.form.customer.contact_person = '';
    this.form.customer.contact_number = '';
    this.form.customer.email = '';
    this.form.customer.tin_number = '';

    const normalized = String(value ?? '').trim().toLowerCase();
    if (normalized) {
      const exactMatch = this.customerOptions.find(
        (item) => String(item.name ?? '').trim().toLowerCase() === normalized,
      );

      if (exactMatch) {
        this.form.customer_id = exactMatch.id;
        this.form.customer.name = exactMatch.name ?? '';
        this.form.customer.address = exactMatch.address ?? '';
        this.form.customer.contact_person = exactMatch.contact_person ?? '';
        this.form.customer.contact_number = exactMatch.contact_number ?? '';
        this.form.customer.email = exactMatch.email ?? '';
        this.form.customer.tin_number = exactMatch.tin_number ?? '';
      }
    }

    if (this.customerDebounceTimer) {
      clearTimeout(this.customerDebounceTimer);
    }

    this.customerDebounceTimer = setTimeout(() => {
      void this.loadCustomerOptions(this.customerSearch);
      this.customerDebounceTimer = null;
    }, this.searchDebounceMs);
  }

  selectCustomer(customerId: string): void {
    this.form.customer_id = customerId;
    const selected = this.customerOptions.find((item) => item.id === customerId);
    if (!selected) return;

    this.customerSearch = selected.name;
    this.form.customer.name = selected.name ?? '';
    this.form.customer.address = selected.address ?? '';
    this.form.customer.contact_person = selected.contact_person ?? '';
    this.form.customer.contact_number = selected.contact_number ?? '';
    this.form.customer.email = selected.email ?? '';
    this.form.customer.tin_number = selected.tin_number ?? '';
    this.isCustomerDropdownOpen = false;
  }

  onCustomerComboboxFocus(): void {
    this.isCustomerDropdownOpen = true;
    if (this.customerOptions.length === 0) {
      void this.loadCustomerOptions(this.customerSearch);
    }
  }

  onCustomerComboboxBlur(): void {
    setTimeout(() => {
      this.isCustomerDropdownOpen = false;
    }, 150);
  }

  onProjectSearchChange(value: string): void {
    this.projectSearchInput = value;

    if (this.projectSearchDebounceTimer) {
      clearTimeout(this.projectSearchDebounceTimer);
    }

    if (!value || value.trim().length === 0) {
      this.projectSearchResults = [];
      this.projectSearchDebounceTimer = null;
      return;
    }

    this.projectSearchDebounceTimer = setTimeout(() => {
      void this.loadProjectSearchResults(value);
      this.projectSearchDebounceTimer = null;
    }, this.searchDebounceMs);
  }

  private async loadProjectSearchResults(query: string): Promise<void> {
    try {
      const response = await this.salesOrderService.searchProjects({
        search: query,
        page: 1,
        limit: 10,
      });
      this.projectSearchResults = response.items || [];
    } catch (error) {
      console.error('Failed to search projects:', error);
      this.projectSearchResults = [];
    }
  }

  async selectProject(project: any): Promise<void> {
    if (!project || !project.id) {
      return;
    }

    try {
      // Get full project details with related SOs
      const projectDetails = await this.salesOrderService.getProjectWithRelatedSOs(project.id);
      if (!projectDetails) {
        console.error('Failed to load project details');
        return;
      }

      // Update form with selected project
      this.form.projectId = project.id;
      this.form.projectCode = project.projectCode;
      this.form.projectName = project.projectName;
      this.selectedProjectDetails = projectDetails;
      this.projectSearchResults = [];
      this.projectSearchInput = '';
    } catch (error) {
      console.error('Failed to select project:', error);
    }
  }

  clearProjectSelection(): void {
    this.form.projectId = undefined;
    this.form.projectCode = '';
    this.form.projectName = '';
    this.selectedProjectDetails = null;
    this.projectSearchInput = '';
    this.projectSearchResults = [];
  }

  getFilteredCustomerOptions(): SalesCustomerOption[] {
    const normalizedQuery = String(this.customerSearch ?? '').trim().toLowerCase();
    if (!normalizedQuery) {
      return this.customerOptions;
    }

    return this.customerOptions.filter((item) =>
      String(item.name ?? '').toLowerCase().includes(normalizedQuery),
    );
  }

  syncProductSearchQuery(): void {
    const item = this.form.productItems[this.activeProductTabIndex];
    if (!item?.productId) {
      this.productSearchQuery = '';
      return;
    }
    const found = this.catalogProducts.find((p) => String(p.id) === String(item.productId));
    this.productSearchQuery = found
      ? `${found.name}${found.brandName ? ' (' + found.brandName + ')' : ''}`
      : '';
  }

  onProductSearchFocus(): void {
    this.isProductDropdownOpen = true;
  }

  onProductSearchBlur(): void {
    setTimeout(() => {
      this.isProductDropdownOpen = false;
    }, 150);
  }

  onProductSearchChange(value: string): void {
    this.productSearchQuery = value;
    this.isProductDropdownOpen = true;
    const index = this.activeProductTabIndex;
    const nextItems = [...this.form.productItems];
    nextItems[index] = {
      ...nextItems[index],
      productId: '',
      capacityId: '',
      sellPrice: '',
      unitPrice: 0,
    };
    this.form.productItems = nextItems;
    this.recalculateTotalAmount();
  }

  selectProductFromSearch(product: ProductOption, index: number): void {
    const nextItems = [...this.form.productItems];
    nextItems[index] = {
      ...nextItems[index],
      productId: String(product.id),
    };
    this.form.productItems = nextItems;
    this.productSearchQuery = `${product.name}${product.brandName ? ' (' + product.brandName + ')' : ''}`;
    this.isProductDropdownOpen = false;
    this.onProductChanged(index);
  }

  getFilteredCatalogProducts(): ProductOption[] {
    const q = String(this.productSearchQuery ?? '').trim().toLowerCase();
    if (!q) return this.catalogProducts;
    return this.catalogProducts.filter((p) => {
      const name = String(p.name ?? '').toLowerCase();
      const brand = String(p.brandName ?? '').toLowerCase();
      return name.includes(q) || brand.includes(q) || `${name} (${brand})`.includes(q);
    });
  }

  getRowActionLabel(): 'Edit' {
    return 'Edit';
  }

  isForDeliveryStatus(status: string): boolean {
    const normalized = String(status ?? '').trim().toLowerCase();
    return normalized === 'for-delivery' || normalized === 'for delivery' || normalized === 'for_delivery';
  }

  async markReturnedUnits(order: SalesOrderRow): Promise<void> {
    if (!this.isForDeliveryStatus(order.status)) {
      return;
    }

    this.pendingReturnOrder = order;
    this.isReturnModalOpen = true;
    this.isReturnModalLoading = true;
    this.returnModalError = '';
    this.returnForm = {
      remarks: '',
      isDefective: false,
    };
    this.selectedReturnedSerialNumbers = new Set<string>();
    this.returnSerialGroups = [];

    try {
      const detail = await this.salesOrderService.getSalesOrderById(order.id);
      this.returnSerialGroups = this.buildReturnSerialGroups(detail);
    } catch (error: unknown) {
      if (axios.isAxiosError(error)) {
        this.returnModalError =
          (error.response?.data as { message?: string } | undefined)?.message ??
          'Failed to load sales order serials';
      } else {
        this.returnModalError = 'Failed to load sales order serials';
      }
    } finally {
      this.isReturnModalLoading = false;
    }
  }

  closeReturnModal(): void {
    if (this.isReturnModalLoading || this.returningOrderIds.has(this.pendingReturnOrder?.id ?? -1)) {
      return;
    }

    this.isReturnModalOpen = false;
    this.pendingReturnOrder = null;
    this.returnModalError = '';
    this.returnSerialGroups = [];
    this.returnForm = {
      remarks: '',
      isDefective: false,
    };
    this.selectedReturnedSerialNumbers = new Set<string>();
  }

  onReturnDefectiveChange(value: boolean): void {
    this.returnForm.isDefective = value;
    if (!value) {
      this.selectedReturnedSerialNumbers = new Set<string>();
    }
  }

  isReturnedSerialSelected(serialNumber: string): boolean {
    return this.selectedReturnedSerialNumbers.has(this.normalizeSerial(serialNumber));
  }

  toggleReturnedSerialSelection(serialNumber: string, checked: boolean): void {
    const normalizedSerial = this.normalizeSerial(serialNumber);
    if (!normalizedSerial) {
      return;
    }

    const next = new Set(this.selectedReturnedSerialNumbers);
    if (checked) {
      next.add(normalizedSerial);
    } else {
      next.delete(normalizedSerial);
    }
    this.selectedReturnedSerialNumbers = next;
  }

  async confirmReturnedUnits(): Promise<void> {
    const order = this.pendingReturnOrder;
    if (!order || !this.isForDeliveryStatus(order.status)) {
      return;
    }

    const remarks = String(this.returnForm.remarks ?? '').trim();
    if (!remarks) {
      this.returnModalError = 'Return remarks are required.';
      return;
    }

    if (this.returnForm.isDefective && this.selectedReturnedSerialNumbers.size === 0) {
      this.returnModalError = 'Select one or more indoor or outdoor serial numbers for defective return.';
      return;
    }

    this.returningOrderIds.add(order.id);
    this.uiError = '';
    this.returnModalError = '';

    try {
      const response = await this.salesOrderService.updateSalesOrder(order.id, {
        productItems: [],
        status: 'pending',
        remarks: `Returned Units: ${remarks}`,
        returnedSerialDetails: {
          isDefective: this.returnForm.isDefective,
          defectReason: this.returnForm.isDefective ? remarks : undefined,
          defectDate: this.returnForm.isDefective ? new Date().toISOString() : null,
          serialNumbers: this.returnForm.isDefective
            ? [...this.selectedReturnedSerialNumbers]
            : undefined,
        },
      });

      if (!response.success) {
        this.returnModalError = response.message ?? 'Failed to mark sales order as returned';
        return;
      }

      this.uiMessage = this.returnForm.isDefective
        ? 'Returned units were recorded, linked serials were marked defective, and the SO status moved back to Pending.'
        : 'Returned units has been recorded and status moved back to Pending.';
      this.closeReturnModal();
      await this.loadTabData(this.activeTab);
    } catch (error: unknown) {
      if (axios.isAxiosError(error)) {
        this.returnModalError =
          (error.response?.data as { message?: string } | undefined)?.message ??
          'Failed to mark sales order as returned';
      } else {
        this.returnModalError = 'Failed to mark sales order as returned';
      }
    } finally {
      this.returningOrderIds.delete(order.id);
    }
  }

  private buildReturnSerialGroups(detail: SalesOrderDetailItem): SalesReturnSerialOptionGroup[] {
    const grouped = new Map<string, string[]>();

    for (const item of detail.productItems ?? []) {
      for (const [unitLabel, serials] of Object.entries(item.serialNumbers ?? {})) {
        const normalizedUnitLabel = String(unitLabel ?? '').trim();
        if (!normalizedUnitLabel || !Array.isArray(serials)) {
          continue;
        }

        const existing = grouped.get(normalizedUnitLabel) ?? [];
        const seen = new Set(existing.map((serial) => this.normalizeSerial(serial).toLowerCase()));

        for (const serial of serials) {
          const normalizedSerial = this.normalizeSerial(serial);
          const normalizedKey = normalizedSerial.toLowerCase();
          if (!normalizedSerial || seen.has(normalizedKey)) {
            continue;
          }

          seen.add(normalizedKey);
          existing.push(normalizedSerial);
        }

        if (existing.length > 0) {
          grouped.set(normalizedUnitLabel, existing);
        }
      }
    }

    return [...grouped.entries()]
      .map(([unitLabel, serials]) => ({ unitLabel, serials }))
      .sort((left, right) => left.unitLabel.localeCompare(right.unitLabel));
  }

  canSendForDeliveryFromDrawer(): boolean {
    if (this.drawerMode !== 'edit' || this.isMigrationDrawerMode) {
      return false;
    }

    const normalizedStatus = String(this.form.status ?? '').trim().toLowerCase();
    return !['for-delivery', 'for delivery', 'for_delivery', 'remitted', 'complete', 'completed'].includes(normalizedStatus);
  }

  private validateProductSerialRequirements(targetStatus?: string): string | null {
    const salesType = this.form.salesType;
    const status = String(targetStatus ?? this.form.status ?? '').toLowerCase();

    // Skip serial validation during creation mode - allow saving draft first
    if (this.drawerMode === 'create') {
      return null;
    }

    if (salesType === 'transfer' && ['for-delivery', 'remitted'].includes(status)) {
      const missingSerials: string[] = [];
      (this.form.productItems ?? []).forEach((item: any, idx: number) => {
        (item.unitTypes ?? []).forEach((ut: any) => {
          if (ut.value > 0 && (!ut.serials || ut.serials.length < ut.value)) {
            missingSerials.push(`Product #${idx + 1} (${ut.label})`);
          }
        });
      });
      if (missingSerials.length > 0) {
        return `All required serial numbers must be scanned before submitting. Missing: ${missingSerials.join(', ')}`;
      }

      return null;
    }

    if (salesType === 'transfer') {
      return null;
    }

    // For non-transfer types, require serials only when status is for-delivery or remitted
    const isDeliveryOrRemit = ['for-delivery', 'remitted'].includes(status);
    if (!isDeliveryOrRemit) {
      return null;
    }

    const hasProduct = (this.form.productItems ?? []).length > 0;
    const hasZeroQty = (this.form.productItems ?? []).some((item: any) => Number(item.totalSetQty) <= 0);
    const missingSerials = (this.form.productItems ?? []).some((item: any) => {
      return (item.unitTypes ?? []).some((ut: any) => ut.value > 0 && (!ut.serials || ut.serials.length < ut.value));
    });

    if (hasProduct && hasZeroQty) {
      return 'Unit quantity must not be zero.';
    }
    if (hasProduct && missingSerials) {
      return 'All required serial numbers must be scanned before submitting.';
    }

    return null;
  }

  pendingReceiveOrder: SalesOrderRow | null = null;
  isCancelModalOpen = false;
  pendingCancelOrder: SalesOrderRow | null = null;
  cancelRemarks = '';
  cancelModalError = '';
  cancellingOrderIds = new Set<number>();

  openCancelModal(order: SalesOrderRow): void {
    this.pendingCancelOrder = order;
    this.cancelRemarks = '';
    this.cancelModalError = '';
    this.isCancelModalOpen = true;
  }

  closeCancelModal(): void {
    this.isCancelModalOpen = false;
    this.pendingCancelOrder = null;
    this.cancelRemarks = '';
    this.cancelModalError = '';
  }

  async confirmCancelOrder(): Promise<void> {
    const order = this.pendingCancelOrder;
    if (!order) return;
    if (!this.cancelRemarks.trim()) {
      this.cancelModalError = 'Cancellation reason is required.';
      return;
    }
    this.cancellingOrderIds.add(order.id);
    this.cancelModalError = '';
    try {
      const response = await this.salesOrderService.updateSalesOrder(order.id, {
        productItems: [],
        status: 'cancelled',
        remarks: `Cancelled: ${this.cancelRemarks.trim()}`,
      });
      if (!response.success) {
        this.cancelModalError = response.message ?? 'Failed to cancel order.';
        return;
      }
      this.uiMessage = `Sales order ${order.soNumber || order.id} has been cancelled.`;
      this.closeCancelModal();
      await this.loadTabData(this.activeTab);
    } catch (error: unknown) {
      this.cancelModalError = axios.isAxiosError(error)
        ? ((error.response?.data as { message?: string })?.message ?? 'Failed to cancel order.')
        : 'Failed to cancel order.';
    } finally {
      this.cancellingOrderIds.delete(order.id);
    }
  }

  async markOrderAsReceived(order: SalesOrderRow): Promise<void> {
    if (this.activeTab !== 'sales-receivable' || this.receivingOrderIds.has(order.id)) {
      return;
    }
    this.pendingReceiveOrder = order;
    this.openGuardDialog('receive-confirm');
  }

  private async confirmMarkOrderAsReceived(): Promise<void> {
    const order = this.pendingReceiveOrder;
    if (!order) return;
    this.receivingOrderIds.add(order.id);
    this.uiError = '';
    this.uiMessage = '';
    try {
      const response = await this.salesOrderService.updateSalesOrder(order.id, {
        productItems: [],
        status: 'complete',
        remarks: 'Marked as received from Sales Receivable table',
      });
      if (!response.success) {
        this.openErrorModal('Receive Error', response.message ?? 'Failed to mark sales order as received');
        this.receivingOrderIds.delete(order.id);
        return;
      }
      this.uiMessage = 'Sales order marked as received successfully.';
      await this.loadTabData(this.activeTab);
    } catch (error: unknown) {
      let errorMessage = 'Failed to mark sales order as received';
      if (axios.isAxiosError(error)) {
        errorMessage =
          (error.response?.data as { message?: string } | undefined)?.message ??
          'Failed to mark sales order as received';
      }
      this.openErrorModal('Receive Error', errorMessage);
    } finally {
      this.receivingOrderIds.delete(order.id);
      this.pendingReceiveOrder = null;
    }
  }

  async printDeliveryReceipt(order: SalesOrderRow): Promise<void> {
    if (this.printingOrderIds.has(order.id)) {
      return;
    }

    this.uiError = '';
    this.uiMessage = '';
    this.printingOrderIds.add(order.id);

    try {
      const detail = await this.salesOrderService.getSalesOrderById(order.id);
      if (!detail) {
        this.openErrorModal('Print Error', 'Failed to load sales order details for DR printing');
        return;
      }

      if (this.catalogProducts.length === 0) {
        await this.loadReferenceData();
      }

      const businessProfile = await this.loadBusinessProfileSettings();
      const pdfBytes = await this.buildDeliveryReceiptPdf(order, detail, businessProfile);
      const blobSafeBytes = new Uint8Array(pdfBytes.length);
      blobSafeBytes.set(pdfBytes);
      const blob = new Blob([blobSafeBytes], { type: 'application/pdf' });
      const blobUrl = URL.createObjectURL(blob);
      this.openDrPreview(blobUrl, `DR-${order.soNumber || order.id}.pdf`);
    } catch (error: unknown) {
      let errorMessage = 'Failed to print Delivery Receipt';
      if (axios.isAxiosError(error)) {
        errorMessage =
          (error.response?.data as { message?: string } | undefined)?.message ??
          'Failed to print Delivery Receipt';
      } else if (error instanceof Error) {
        errorMessage = error.message;
      }
      this.openErrorModal('Print Error', errorMessage);
    } finally {
      this.printingOrderIds.delete(order.id);
    }
  }

  async printDeliveryReceiptFromDrawer(): Promise<void> {
    if (this.drawerMode !== 'edit') {
      return;
    }

    const targetId = Number(this.editingSalesId);
    if (!Number.isFinite(targetId) || targetId <= 0) {
      this.uiError = 'Invalid sales order id for DR printing';
      return;
    }

    const rowFromList = this.orders.find((order) => order.id === targetId);
    const row: SalesOrderRow =
      rowFromList ??
      {
        id: targetId,
        soNumber: '',
        customerName: this.form.customer.name || '',
        totalAmount: Number(this.form.totalAmount) || 0,
        paymentMethod: '',
        status: this.form.status || 'pending',
        salesType: this.form.salesType || '',
        scheduleDate: this.form.scheduleDate || '-',
        serialCount: 0,
        createdAt: null,
      };

    await this.printDeliveryReceipt(row);
  }

  /**
   * Checks if a given order status is eligible for DR generation.
   * DR-eligible statuses: 'for-delivery', 'remitted', 'complete', 'released'
   */
  isDrEligibleStatus(status: string): boolean {
    const normalized = String(status ?? '').trim().toLowerCase().replace(/[\s_]/g, '-');
    return ['for-delivery', 'remitted', 'complete', 'released'].includes(normalized);
  }

  /**
   * NEW DR generation path: Fetches all DR-eligible orders for a customer
   * and generates a new-format DR PDF using DrGeneratorService.
   * Keeps existing printDeliveryReceipt() as legacy path (Req 5.4).
   */
  async printNewDeliveryReceipt(orderId: number): Promise<void> {
    if (!orderId) {
      this.openErrorModal('Print Error', 'Order ID is required for DR generation.');
      return;
    }

    this.uiError = '';
    this.uiMessage = '';

    try {
      const result = await this.salesOrderService.getDrEligibleOrders(orderId);
      if (!result.success || !result.items || result.items.length === 0) {
        const msg = (result as { message?: string }).message || 'No DR-eligible orders found for this installer + delivery date.';
        this.openErrorModal('Print Error', msg);
        return;
      }

      const businessProfile = await this.loadBusinessProfileSettings();

      // Map API response to DrEligibleOrder interface for the generator
      const drOrders: DrEligibleOrder[] = result.items.map((item) => ({
        id: item.id,
        soNumber: item.soNumber,
        customerName: item.customerName,
        customerAddress: item.customerAddress,
        customerType: item.customerType,
        installer: item.installer,
        scheduleDate: item.scheduleDate,
        paymentMethod: item.paymentMethod,
        productItems: (item.productItems ?? []).map((pi) => ({
          productName: pi.productName,
          capacityName: pi.capacityName,
          sellPrice: pi.sellPrice,
          serialNumbers: (pi.serialNumbers ?? []).map((sn) => ({
            serialNumber: sn.serialNumber,
            unitType: sn.unitType,
          })),
        })),
      }));

      const pdfBytes = await this.drGeneratorService.generateDr(drOrders, businessProfile);
      const blobSafeBytes = new Uint8Array(pdfBytes.length);
      blobSafeBytes.set(pdfBytes);
      const blob = new Blob([blobSafeBytes], { type: 'application/pdf' });
      const blobUrl = URL.createObjectURL(blob);
      this.openDrPreview(blobUrl, `DR-${drOrders[0]?.installer || 'Unknown'}.pdf`);
    } catch (error: unknown) {
      let errorMessage = 'Failed to generate new Delivery Receipt';
      if (axios.isAxiosError(error)) {
        errorMessage =
          (error.response?.data as { message?: string } | undefined)?.message ??
          'Failed to generate new Delivery Receipt';
      } else if (error instanceof Error) {
        errorMessage = error.message;
      }
      this.openErrorModal('Print Error', errorMessage);
    }
  }

  /**
   * Prints the new DR from the drawer, using the currently editing order's ID.
   */
  async printNewDeliveryReceiptFromDrawer(): Promise<void> {
    if (this.drawerMode !== 'edit') {
      return;
    }

    const orderId = this.editingSalesId;
    if (!orderId) {
      this.uiError = 'No order ID available for DR generation.';
      return;
    }

    await this.printNewDeliveryReceipt(orderId);
  }

  closeDrPreview(): void {
    this.isDrPreviewOpen = false;
    this.revokeDrPreviewUrl();
  }

  downloadDrPreview(): void {
    if (!this.drPreviewObjectUrl) {
      return;
    }

    const link = document.createElement('a');
    link.href = this.drPreviewObjectUrl;
    link.download = this.drPreviewFilename || 'Delivery-Receipt.pdf';
    link.click();
  }

  isDownloadingSoDetails = false;

  async downloadSoDetails(): Promise<void> {
    if (!this.editingSalesId || this.isDownloadingSoDetails) {
      return;
    }

    this.isDownloadingSoDetails = true;

    try {
      const detail = await this.salesOrderService.getSalesOrderById(this.editingSalesId);
      if (!detail) {
        this.uiError = 'Failed to load SO details for export';
        return;
      }

      const excelJsModule = await import('exceljs').catch(async () => import('exceljs/dist/exceljs.min.js'));
      const WorkbookCtor =
        (excelJsModule as { Workbook?: new () => any }).Workbook ??
        (excelJsModule as { default?: { Workbook?: new () => any } }).default?.Workbook;

      if (!WorkbookCtor) {
        this.uiError = 'Excel export is unavailable.';
        return;
      }

      const workbook = new WorkbookCtor();

      // Sheet 1: SO Summary
      const summarySheet = workbook.addWorksheet('SO Details');
      summarySheet.columns = [{ width: 22 }, { width: 40 }];
      summarySheet.addRow(['SO Number', detail.soNumber ?? '']);
      summarySheet.addRow(['Customer', detail.customerName ?? '']);
      summarySheet.addRow(['Address', detail.customerAddress ?? '']);
      summarySheet.addRow(['Contact Person', detail.customerContactPerson ?? '']);
      summarySheet.addRow(['Contact Number', detail.customerContactNumber ?? '']);
      summarySheet.addRow(['Status', detail.status ?? '']);
      summarySheet.addRow(['Schedule Date', detail.scheduleDate ?? '']);
      summarySheet.addRow(['Sales Type', detail.salesType ?? '']);
      summarySheet.addRow(['Total Amount', detail.totalAmount ?? 0]);
      summarySheet.addRow(['Remarks', detail.remarks ?? '']);
      summarySheet.addRow(['Created At', detail.createdAt ?? '']);
      summarySheet.getColumn(1).font = { bold: true };

      // Sheet 2: Product Items & Serials
      const serialsSheet = workbook.addWorksheet('Product Items & Serials');
      const serialHeaders = ['Product Name', 'Capacity', 'Unit Type', 'Serial Number', 'Unit Price', 'Sell Price', 'Discount Price', 'Qty'];
      const headerRow = serialsSheet.addRow(serialHeaders);
      headerRow.font = { bold: true };
      serialsSheet.columns = serialHeaders.map(() => ({ width: 20 }));

      for (const item of detail.productItems ?? []) {
        const product = this.catalogProducts.find((p) => String(p.id) === String(item.productId));
        const productName = product?.name ?? `Product #${item.productId}`;
        const capacity = product?.capacities?.find((c) => String(c.id) === String(item.capacityId));
        const capacityName = capacity?.name ?? `Capacity #${item.capacityId}`;

        const serialEntries = item.serialNumbers ?? {};
        let hasSerials = false;

        for (const [unitType, serials] of Object.entries(serialEntries)) {
          if (!Array.isArray(serials)) continue;
          for (const serial of serials) {
            serialsSheet.addRow([productName, capacityName, unitType, serial, item.unitPrice, item.sellPrice, item.discountPrice, item.totalSetQty]);
            hasSerials = true;
          }
        }

        if (!hasSerials) {
          serialsSheet.addRow([productName, capacityName, '', '(no serials)', item.unitPrice, item.sellPrice, item.discountPrice, item.totalSetQty]);
        }
      }

      // Sheet 3: Payment Details
      const paymentSheet = workbook.addWorksheet('Payment Details');
      const paymentHeaders = ['Method', 'Amount', 'Status', 'Terms', 'Due Date', 'Bank Name', 'Reference No', 'Check No', 'Down Payment'];
      const paymentHeaderRow = paymentSheet.addRow(paymentHeaders);
      paymentHeaderRow.font = { bold: true };
      paymentSheet.columns = paymentHeaders.map(() => ({ width: 18 }));

      for (const payment of detail.paymentDetails ?? []) {
        paymentSheet.addRow([
          payment.method ?? '',
          payment.amount ?? 0,
          payment.status ?? '',
          payment.terms ?? '',
          payment.termsDueDate ?? '',
          payment.bankName ?? '',
          payment.referenceNo ?? '',
          payment.checkNo ?? '',
          payment.downPayment ?? 0,
        ]);
      }

      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const fileName = `${detail.soNumber ?? `SO-${this.editingSalesId}`}_details.xlsx`;
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = fileName;
      anchor.click();
      URL.revokeObjectURL(objectUrl);
    } catch (error: unknown) {
      this.uiError = 'Failed to export SO details';
      console.error('downloadSoDetails error', error);
    } finally {
      this.isDownloadingSoDetails = false;
    }
  }

  openDailyUnitReleaseReport(): void {
    this.isDailyUnitReleaseModalOpen = true;
    this.dailyUnitReleaseError = '';
    this.dailyUnitReleaseDateFrom = new Date().toISOString().split('T')[0];
    this.dailyUnitReleaseDateTo = new Date().toISOString().split('T')[0];
  }

  closeDailyUnitReleaseReport(): void {
    if (this.isGeneratingDailyUnitRelease) return;
    this.isDailyUnitReleaseModalOpen = false;
    this.dailyUnitReleaseError = '';
  }

  async generateDailyUnitReleaseReport(): Promise<void> {
    if (this.isGeneratingDailyUnitRelease) return;

    if (!this.dailyUnitReleaseDateFrom || !this.dailyUnitReleaseDateTo) {
      this.dailyUnitReleaseError = 'Both date fields are required.';
      return;
    }

    this.isGeneratingDailyUnitRelease = true;
    this.dailyUnitReleaseError = '';

    try {
      // Load all SOs from multiple tabs to get a complete picture
      const allOrders: SalesOrderListItem[] = [];
      for (const loader of [
        () => this.salesOrderService.getDeliveries({ page: 1, limit: 500 }),
        () => this.salesOrderService.getRemittedSales({ page: 1, limit: 500 }),
        () => this.salesOrderService.getSchedules({ page: 1, limit: 500 }),
      ]) {
        const result = await loader();
        allOrders.push(...result.items);
      }

      // Deduplicate by id
      const uniqueOrders = [...new Map(allOrders.map((o) => [o.id, o])).values()];

      // Filter by date range (scheduleDate or createdAt)
      const from = this.dailyUnitReleaseDateFrom;
      const to = this.dailyUnitReleaseDateTo;
      const filteredOrders = uniqueOrders.filter((order) => {
        const dateStr = order.scheduleDate ?? order.createdAt ?? '';
        const orderDate = dateStr.split('T')[0];
        return orderDate >= from && orderDate <= to;
      });

      if (filteredOrders.length === 0) {
        this.dailyUnitReleaseError = 'No sales orders found for the selected date range.';
        return;
      }

      // Fetch detail for each SO (serial numbers, product info)
      const details: Array<{ order: SalesOrderListItem; detail: SalesOrderDetailItem }> = [];
      for (const order of filteredOrders) {
        try {
          const detail = await this.salesOrderService.getSalesOrderById(order.id);
          if (detail) {
            details.push({ order, detail });
          }
        } catch {
          // Skip if detail fails to load
        }
      }

      // Build Excel
      const excelJsModule = await import('exceljs').catch(async () => import('exceljs/dist/exceljs.min.js'));
      const WorkbookCtor =
        (excelJsModule as { Workbook?: new () => any }).Workbook ??
        (excelJsModule as { default?: { Workbook?: new () => any } }).default?.Workbook;

      if (!WorkbookCtor) {
        this.dailyUnitReleaseError = 'Excel export is unavailable.';
        return;
      }

      const workbook = new WorkbookCtor();

      // Sheet 1: Daily Unit Release
      const sheet1 = workbook.addWorksheet('Daily Unit Release');
      const s1Headers = ['Date', 'SO No', 'Customer Name', 'Team (Installer)', 'Unit (Product Capacity)', 'Indoor Serial', 'Outdoor Serial', 'Window Serial', 'Remarks'];
      const s1HeaderRow = sheet1.addRow(s1Headers);
      s1HeaderRow.font = { bold: true };
      sheet1.columns = [
        { width: 12 }, { width: 14 }, { width: 22 }, { width: 18 },
        { width: 24 }, { width: 22 }, { width: 22 }, { width: 22 }, { width: 30 },
      ];

      for (const { order, detail } of details) {
        const date = (order.scheduleDate ?? order.createdAt ?? '').split('T')[0];
        const soNo = detail.soNumber ?? '';
        const customer = detail.customerName ?? '';
        const installer = detail.installer ?? '';
        const remarks = this.buildReportRemarks(detail);

        for (const item of detail.productItems ?? []) {
          const product = this.catalogProducts.find((p) => String(p.id) === String(item.productId));
          const productName = product?.name ?? `Product #${item.productId}`;
          const capacity = product?.capacities?.find((c) => String(c.id) === String(item.capacityId));
          const capacityName = capacity?.name ?? '';
          const unitLabel = `${productName} ${capacityName}`.trim();

          const serials = item.serialNumbers ?? {};
          const indoorSerials = serials['indoor'] ?? [];
          const outdoorSerials = serials['outdoor'] ?? [];
          const windowSerials = serials['window'] ?? [];

          const maxRows = Math.max(1, indoorSerials.length, outdoorSerials.length, windowSerials.length);
          for (let i = 0; i < maxRows; i++) {
            sheet1.addRow([
              i === 0 ? date : '',
              i === 0 ? soNo : '',
              i === 0 ? customer : '',
              i === 0 ? installer : '',
              i === 0 ? unitLabel : '',
              indoorSerials[i] ?? '',
              outdoorSerials[i] ?? '',
              windowSerials[i] ?? '',
              i === 0 ? remarks : '',
            ]);
          }
        }
      }

      // Sheet 2: By Products
      const sheet2 = workbook.addWorksheet('By Products');
      const productGroups = new Map<string, { indoor: string[]; outdoor: string[]; window: string[] }>();

      for (const { detail } of details) {
        for (const item of detail.productItems ?? []) {
          const product = this.catalogProducts.find((p) => String(p.id) === String(item.productId));
          const productName = product?.name ?? `Product #${item.productId}`;
          const capacity = product?.capacities?.find((c) => String(c.id) === String(item.capacityId));
          const capacityName = capacity?.name ?? '';
          const groupKey = `${productName} ${capacityName}`.trim();

          const existing = productGroups.get(groupKey) ?? { indoor: [], outdoor: [], window: [] };
          const serials = item.serialNumbers ?? {};
          existing.indoor.push(...(serials['indoor'] ?? []));
          existing.outdoor.push(...(serials['outdoor'] ?? []));
          existing.window.push(...(serials['window'] ?? []));
          productGroups.set(groupKey, existing);
        }
      }

      sheet2.columns = [{ width: 30 }, { width: 25 }, { width: 15 }];
      const s2HeaderRow = sheet2.addRow(['Product', 'Serial Number', 'Unit Type']);
      s2HeaderRow.font = { bold: true };

      for (const [groupName, serials] of productGroups.entries()) {
        sheet2.addRow([]);
        const titleRow = sheet2.addRow([groupName]);
        titleRow.font = { bold: true };

        for (const serial of serials.indoor) {
          sheet2.addRow(['', serial, 'indoor']);
        }
        for (const serial of serials.outdoor) {
          sheet2.addRow(['', serial, 'outdoor']);
        }
        for (const serial of serials.window) {
          sheet2.addRow(['', serial, 'window']);
        }
      }

      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const fileName = `daily_unit_release_${from}_${to}.xlsx`;
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = fileName;
      anchor.click();
      URL.revokeObjectURL(objectUrl);

      this.closeDailyUnitReleaseReport();
    } catch (error: unknown) {
      this.dailyUnitReleaseError = 'Failed to generate report. Please try again.';
      console.error('generateDailyUnitReleaseReport error', error);
    } finally {
      this.isGeneratingDailyUnitRelease = false;
    }
  }

  private buildReportRemarks(detail: SalesOrderDetailItem): string {
    const parts: string[] = [];
    const remarks = String(detail.remarks ?? '').trim();
    if (remarks) parts.push(remarks);

    // Check for returned/defective info
    for (const item of detail.productItems ?? []) {
      const serials = item.serialNumbers ?? {};
      for (const [, serialList] of Object.entries(serials)) {
        if (!Array.isArray(serialList)) continue;
        // nothing to add per-serial here, but remarks covers returned info
      }
    }

    return parts.join(' | ');
  }

  private async buildDeliveryReceiptPdf(
    row: SalesOrderRow,
    detail: SalesOrderDetailItem,
    businessProfile: BusinessProfileSettings | null,
  ): Promise<Uint8Array> {
    const templateBytes = await this.getDrTemplateBytes(businessProfile?.drTemplatePdf);
    const pdfDoc = await PDFDocument.load(Uint8Array.from(templateBytes));
    const page = pdfDoc.getPages()[0] ?? pdfDoc.addPage([595, 842]);
    const regularFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const italicFont = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);
    const width = page.getWidth();
    const height = page.getHeight();
    const showDrAddressDetails = this.parsePrintBool(businessProfile?.printAddressShowDr, true);
    const drAddressDetails = showDrAddressDetails
      ? String(businessProfile?.printAddressDetails ?? businessProfile?.businessAddress ?? '').trim()
      : '';
    const drContactDetails = String(businessProfile?.businessContact ?? '').trim();
    const drEmailDetails = String(businessProfile?.businessEmail ?? '').trim();

    const logoSources = await this.getDrLogoCandidatePaths(businessProfile);
    const logoBytes = await this.loadDrLogoPngBytes(logoSources);
    if (logoBytes) {
      const logo = await pdfDoc.embedPng(logoBytes);
      const logoWidth = 120;
      const scale = logoWidth / Math.max(1, logo.width);
      const logoHeight = logo.height * scale;
      page.drawImage(logo, {
        x: 30,
        y: height - logoHeight - 20,
        width: logoWidth,
        height: logoHeight,
      });
    }

    this.drawDrTemplateHeader(
      page,
      row,
      detail,
      regularFont,
      width,
      height,
      drAddressDetails,
      drContactDetails,
      drEmailDetails,
    );

    let y = height - 250;

    let totalAmount = 0;
    for (const item of detail.productItems) {
      const qty = Number(item.totalSetQty || 0);
      const unitPrice =
        Number(item.discountPrice || 0) > 0
          ? Number(item.discountPrice || 0)
          : Number(item.sellPrice || 0) > 0
            ? Number(item.sellPrice || 0)
            : Number(item.unitPrice || 0);
      const amount = qty * unitPrice;
      totalAmount += amount;

      const description = this.getProductDescription(item.productId, item.capacityId);
      const unitLabel = this.getItemUnitLabel(item);

      page.drawText(String(qty), { x: 42, y, size: 10, font: regularFont });
      page.drawText(unitLabel, { x: 75, y, size: 10, font: regularFont });
      page.drawText(description, { x: 120, y, size: 10, font: boldFont, maxWidth: width - 340 });
      page.drawText(this.formatNumber(unitPrice), { x: width - 200, y, size: 10, font: regularFont });
      page.drawText(this.formatNumber(amount), { x: width - 130, y, size: 10, font: regularFont });

      y -= 15;
      if (y < height - 630) {
        break;
      }
    }

    page.drawText(this.formatNumber(totalAmount), {
      x: width - 130,
      y: height - 652,
      size: 12,
      font: boldFont,
    });

    let currentAttachmentPage: ReturnType<typeof pdfDoc.addPage> | null = null;
    let currentAttachmentY = 0;
    let serialPageNumber = 0;
    const minY = 60;

    for (const item of detail.productItems) {
      const serialRows = this.buildSerialRows(item.serialNumbers);
      if (serialRows.length === 0) {
        continue;
      }

      const indoorList = serialRows.filter((entry) => ['INDOOR', 'WINDOW'].includes(entry.unitType));
      const outdoorList = serialRows.filter((entry) => entry.unitType === 'OUTDOOR');
      const hasCategorizedRows = indoorList.length > 0 || outdoorList.length > 0;
      const fallbackRows = hasCategorizedRows ? [] : serialRows;
      const totalRows = Math.max(indoorList.length, outdoorList.length, fallbackRows.length);

      if (totalRows === 0) {
        continue;
      }

      if (!currentAttachmentPage || currentAttachmentY < 120) {
        serialPageNumber += 1;
        currentAttachmentPage = this.createDrAttachmentPage(
          pdfDoc,
          boldFont,
          italicFont,
          width,
          height,
          serialPageNumber,
          row,
          detail,
        );
        currentAttachmentY = height - 130;
      }

      currentAttachmentPage.drawText(
        `PRODUCT: ${this.getAttachmentProductDescription(item.productId, item.capacityId)}`,
        { x: 50, y: currentAttachmentY, size: 10, font: boldFont },
      );
      currentAttachmentY -= 20;

      for (let i = 0; i < totalRows; i += 1) {
        if (!currentAttachmentPage || currentAttachmentY < minY) {
          serialPageNumber += 1;
          currentAttachmentPage = this.createDrAttachmentPage(
            pdfDoc,
            boldFont,
            italicFont,
            width,
            height,
            serialPageNumber,
            row,
            detail,
          );
          currentAttachmentY = height - 130;
        }

        const indoorSerial = hasCategorizedRows
          ? indoorList[i]?.serial ?? '-'
          : fallbackRows[i]?.serial ?? '-';
        const outdoorSerial = hasCategorizedRows
          ? outdoorList[i]?.serial ?? '-'
          : '-';

        currentAttachmentPage.drawText(String(i + 1), {
          x: 55,
          y: currentAttachmentY,
          size: 9,
          font: regularFont,
        });
        currentAttachmentPage.drawText(indoorSerial, {
          x: 150,
          y: currentAttachmentY,
          size: 9,
          font: regularFont,
        });
        currentAttachmentPage.drawText(outdoorSerial, {
          x: 380,
          y: currentAttachmentY,
          size: 9,
          font: regularFont,
        });

        currentAttachmentPage.drawLine({
          start: { x: 50, y: currentAttachmentY - 4 },
          end: { x: width - 50, y: currentAttachmentY - 4 },
          thickness: 0.5,
          color: rgb(0.9, 0.9, 0.9),
        });

        currentAttachmentY -= 15;
      }

      currentAttachmentY -= 15;
    }

    return pdfDoc.save();
  }

  private async getDrTemplateBytes(templateSource?: string | null): Promise<Uint8Array> {
    const source = String(templateSource ?? '').trim() || this.defaultDrTemplateSource;
    if (this.drTemplateBytes && this.drTemplateSourceKey === source) {
      return this.drTemplateBytes;
    }

    let response = await fetch(source);
    if (!response.ok && source !== this.defaultDrTemplateSource) {
      response = await fetch(this.defaultDrTemplateSource);
    }

    if (!response.ok) {
      throw new Error('Unable to load DR template PDF');
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    this.drTemplateBytes = bytes;
    this.drTemplateSourceKey = source;
    return bytes;
  }

  private async loadBusinessProfileSettings(): Promise<BusinessProfileSettings | null> {
    if (this.businessProfileSettings) {
      return this.businessProfileSettings;
    }

    try {
      this.businessProfileSettings = await this.businessSettingsService.getBusinessProfile();
      return this.businessProfileSettings;
    } catch {
      return null;
    }
  }

  private async getDrLogoCandidatePaths(
    businessProfile: BusinessProfileSettings | null,
  ): Promise<string[]> {
    const showLogo = this.parsePrintBool(businessProfile?.printShowLogo, true);
    if (!showLogo) {
      return [];
    }

    const preferredLogo = String(
      (businessProfile?.printLogoVariant ?? 'light') === 'dark'
        ? (businessProfile?.businessLogoDark ?? businessProfile?.businessLogo ?? '')
        : (businessProfile?.businessLogoLight ?? businessProfile?.businessLogo ?? ''),
    ).trim();

    return [preferredLogo, '/images/air-summit-logo.png', '/images/logo/logo.svg']
      .map((path) => this.resolveAssetUrl(path))
      .filter((path) => String(path || '').trim().length > 0);
  }

  private resolveAssetUrl(path: string | null | undefined): string {
    const raw = String(path ?? '').trim();
    if (!raw) {
      return '';
    }

    if (/^https?:\/\//i.test(raw) || raw.startsWith('data:') || raw.startsWith('blob:')) {
      return raw;
    }

    if (raw.startsWith('/')) {
      return raw;
    }

    return `/${raw}`;
  }

  private async loadDrLogoPngBytes(paths: string[]): Promise<Uint8Array | null> {
    for (const path of paths) {
      const bytes = await this.loadDrLogoPngBytesFromPath(path);
      if (bytes) {
        return bytes;
      }
    }

    return null;
  }

  private async loadDrLogoPngBytesFromPath(path: string): Promise<Uint8Array | null> {
    try {
      const response = await fetch(path);
      if (!response.ok) {
        return null;
      }

      const contentType = String(response.headers.get('content-type') || '').toLowerCase();
      const normalizedPath = String(path || '').toLowerCase();
      const isPng = contentType.includes('image/png') || normalizedPath.endsWith('.png');
      const isJpeg = contentType.includes('image/jpeg') || contentType.includes('image/jpg') || normalizedPath.endsWith('.jpg') || normalizedPath.endsWith('.jpeg');

      if (isPng || isJpeg) {
        const bytes = await response.arrayBuffer();
        return new Uint8Array(bytes);
      }

      const svgText = await response.text();
      const blob = new Blob([svgText], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(blob);

      try {
        const image = await new Promise<HTMLImageElement>((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = () => reject(new Error('Unable to load DR logo image'));
          img.src = url;
        });

        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, image.width);
        canvas.height = Math.max(1, image.height);
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          return null;
        }

        ctx.drawImage(image, 0, 0);
        const dataUrl = canvas.toDataURL('image/png');
        const bytes = await fetch(dataUrl).then((item) => item.arrayBuffer());
        return new Uint8Array(bytes);
      } finally {
        URL.revokeObjectURL(url);
      }
    } catch {
      return null;
    }
  }

  private drawDrTemplateHeader(
    page: ReturnType<PDFDocument['getPages']>[number],
    row: SalesOrderRow,
    detail: SalesOrderDetailItem,
    font: PDFFont,
    width: number,
    height: number,
    drAddressDetails: string,
    drContactDetails: string,
    drEmailDetails: string,
  ): void {
    const customerName = this.trimToLength(detail.customerName || row.customerName || '', 36);
    const address = String(detail.customerAddress || '').trim();
    const dateLabel = this.formatDateOnly(detail.scheduleDate || row.scheduleDate);
    const reference = this.trimToLength(row.soNumber || detail.soNumber || row.id || '', 18);

    page.drawText(customerName, { x: 110, y: height - 140, size: 11, font });
    page.drawText(dateLabel, { x: width - 140, y: height - 140, size: 11, font });
    page.drawText(reference, { x: width - 140, y: height - 165, size: 11, font });

    if (address.length > 70) {
      page.drawText(address.slice(0, 40), { x: 110, y: height - 160, size: 10, font });
      page.drawText(address.slice(40, 80), { x: 110, y: height - 175, size: 10, font });
    } else {
      page.drawText(address, { x: 110, y: height - 160, size: 10, font });
    }

    const headerLines = [
      drAddressDetails ? `Address: ${drAddressDetails}` : '',
      drContactDetails ? `Contact Us: ${drContactDetails}` : '',
      drEmailDetails ? `Email Us: ${drEmailDetails}` : '',
    ].filter((line) => String(line || '').trim().length > 0);

    const wrapHeaderLine = (text: string, maxWidth: number): string[] => {
      const words = String(text || '').trim().split(/\s+/).filter((word) => word.length > 0);
      if (words.length === 0) {
        return [];
      }

      const lines: string[] = [];
      let currentLine = '';

      for (const word of words) {
        const candidate = currentLine ? `${currentLine} ${word}` : word;
        if (font.widthOfTextAtSize(candidate, 8) <= maxWidth) {
          currentLine = candidate;
          continue;
        }

        if (currentLine) {
          lines.push(currentLine);
        }
        currentLine = word;
      }

      if (currentLine) {
        lines.push(currentLine);
      }

      return lines;
    };

    const headerBlockWidth = Math.min(190, Math.max(130, Math.floor(width * 0.32)));
    const headerX = width - headerBlockWidth - 60;
    const minHeaderY = height - 245;

    let headerY = height - 30;
    for (const line of headerLines.flatMap((entry) => wrapHeaderLine(entry, headerBlockWidth)).slice(0, 6)) {
      if (headerY < minHeaderY) {
        break;
      }

      page.drawText(line, { x: headerX, y: headerY, size: 9, font });
      headerY -= 9;
    }
  }

  private parsePrintBool(value: string | null | undefined, defaultValue: boolean): boolean {
    if (value === null || value === undefined) {
      return defaultValue;
    }

    return String(value).trim().toLowerCase() === 'true';
  }

  private createDrAttachmentPage(
    pdfDoc: PDFDocument,
    boldFont: PDFFont,
    italicFont: PDFFont,
    width: number,
    height: number,
    pageNumber: number,
    row: SalesOrderRow,
    detail: SalesOrderDetailItem,
  ): ReturnType<PDFDocument['addPage']> {
    const page = pdfDoc.addPage([width, height]);
    const reference = String(row.soNumber || detail.soNumber || row.id || 'N/A');
    const dateLabel = this.formatDateOnly(detail.scheduleDate || row.scheduleDate);

    page.drawText('SERIAL NUMBERS', { x: 50, y: height - 40, size: 14, font: boldFont });
    page.drawText(`Reference SO: ${reference} | Date: ${dateLabel}`, {
      x: 50,
      y: height - 55,
      size: 9,
      font: italicFont,
    });
    page.drawText(`Page ${pageNumber}`, { x: width - 100, y: height - 40, size: 10, font: boldFont });

    const headerY = height - 100;
    page.drawRectangle({
      x: 50,
      y: headerY - 5,
      width: width - 100,
      height: 20,
      color: rgb(0.95, 0.95, 0.95),
    });

    page.drawText('#', { x: 55, y: headerY, size: 10, font: boldFont });
    page.drawText('INDOOR SERIAL NUMBER', { x: 150, y: headerY, size: 10, font: boldFont });
    page.drawText('OUTDOOR SERIAL NUMBER', { x: 380, y: headerY, size: 10, font: boldFont });

    return page;
  }

  private getItemUnitLabel(item: SalesOrderDetailProductItem): string {
    const product = this.catalogProducts.find(
      (entry) => String(entry.id) === String(item.productId),
    );
    const productUnit = String(product?.unit || '').trim();

    if (productUnit) {
      return productUnit.toUpperCase();
    }

    return 'SET';
  }

  private getAttachmentProductDescription(productId: string, capacityId: string): string {
    const product = this.catalogProducts.find(
      (entry) => String(entry.id) === String(productId),
    );

    if (!product) {
      return `Product ${productId} (${capacityId})`;
    }

    const capacity = product.capacities.find(
      (entry) => String(entry.id) === String(capacityId),
    );

    const brand = String(product.brandName || '').trim();
    const productName = String(product.name || '').trim();
    const capacityName = String(capacity?.name || capacityId || '').trim();
    const title = [brand, productName].filter((entry) => entry.length > 0).join(' ');
    const withCapacity = capacityName ? `${title} (${capacityName})` : title;

    return this.trimToLength(withCapacity || `Product ${productId} (${capacityId})`, 70);
  }

  private trimToLength(value: unknown, maxLength: number): string {
    const text = String(value ?? '').trim();
    if (text.length <= maxLength) {
      return text;
    }

    return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
  }

  private openDrPreview(blobUrl: string, filename: string): void {
    this.revokeDrPreviewUrl();
    this.drPreviewObjectUrl = blobUrl;
    this.drPreviewUrl = this.sanitizer.bypassSecurityTrustResourceUrl(blobUrl);
    this.drPreviewFilename = filename;
    this.isDrPreviewOpen = true;
  }

  private revokeDrPreviewUrl(): void {
    if (this.drPreviewObjectUrl) {
      URL.revokeObjectURL(this.drPreviewObjectUrl);
    }

    this.drPreviewObjectUrl = null;
    this.drPreviewUrl = null;
  }

  private getProductDescription(productId: string, capacityId: string): string {
    const product = this.catalogProducts.find(
      (entry) => String(entry.id) === String(productId),
    );

    if (!product) {
      return `Product ${productId} / Capacity ${capacityId}`;
    }

    const capacity = product.capacities.find(
      (entry) => String(entry.id) === String(capacityId),
    );

    const brand = String(product.brandName || '').trim();
    const productName = String(product.name || '').trim();
    const capacityName = String(capacity?.name || capacityId || '').trim();

    return [brand, productName, capacityName].filter((entry) => entry.length > 0).join(' ');
  }

  private buildSerialRows(serialMap: Record<string, string[]>): Array<{ unitType: string; serial: string }> {
    const rows: Array<{ unitType: string; serial: string }> = [];
    for (const [unitType, serials] of Object.entries(serialMap || {})) {
      for (const serial of serials || []) {
        const normalized = this.normalizeSerial(serial);
        if (!normalized) {
          continue;
        }

        rows.push({
          unitType: String(unitType || 'set').toUpperCase(),
          serial: normalized,
        });
      }
    }

    return rows;
  }

  private formatNumber(value: number): string {
    return Number(value || 0).toLocaleString('en-PH', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  openCreateDrawer(): void {
    this.resetForm();
    this.closeMigrationRowEdit();
    this.drawerMode = 'create';
    this.editingSalesId = null;
    this.form.salesType = this.getSalesTypeFromActiveTab();
    this.isDrawerOpen = true;
    this.serialPageByUnitType = {};
    this.uiMessage = '';
    this.uiError = '';
    this.rejectedScanCount = 0;
    this.rejectedScanList = [];
    this.captureDrawerBaselineSnapshot();

    this.salesOrderService.getNextSoNumber().then((result) => {
      this.nextSoNumberPreview = result.nextSoNumber ?? '';
    }).catch(() => {
      this.nextSoNumberPreview = '';
    });
  }

  async openEditDrawer(order: SalesOrderRow): Promise<void> {
    await this.openEditDrawerById(order.id, order);
  }

  private async openEditDrawerById(orderId: number, fallbackOrder?: SalesOrderRow): Promise<void> {
    const fallback: SalesOrderRow =
      fallbackOrder ??
      {
        id: orderId,
        soNumber: '',
        customerName: '',
        totalAmount: 0,
        paymentMethod: '',
        status: 'pending',
        salesType: '',
        scheduleDate: '-',
        serialCount: 0,
        createdAt: null,
      };

    this.resetForm();
    this.closeMigrationRowEdit();
    this.drawerMode = 'edit';
    this.editingSalesId = orderId;
    this.isDrawerOpen = true;
    this.serialPageByUnitType = {};
    this.uiMessage = '';
    this.uiError = '';
    this.rejectedScanCount = 0;
    this.rejectedScanList = [];

    try {
      const detail = await this.salesOrderService.getSalesOrderById(orderId);
      if (!detail) {
        this.openErrorModal('Load Error', 'Failed to load sales order details');
        return;
      }

      this.applyDetailToForm(detail, fallback);
      this.captureDrawerBaselineSnapshot();
    } catch (error: unknown) {
      let errorMessage = 'Failed to load sales order details';
      if (axios.isAxiosError(error)) {
        errorMessage =
          (error.response?.data as { message?: string } | undefined)?.message ??
          'Failed to load sales order details';
      } else if (error instanceof Error) {
        errorMessage = error.message;
      }
      this.openErrorModal('Load Error', errorMessage);
    }
  }

  closeDrawer(forceClose = false): void {
    if (!forceClose && this.hasUnsavedDrawerChanges()) {
      this.openGuardDialog('close-confirm');
      return;
    }

    const shouldReturnToMigrationModal = this.isMigrationDrawerMode;
    this.isDrawerOpen = false;
    this.nextSoNumberPreview = '';
    this.closeGuardDialog();

    if (shouldReturnToMigrationModal) {
      this.closeMigrationRowEdit();
      this.isMigrationModalOpen = true;
    }
  }

  requestCloseDrawer(): void {
    this.closeDrawer();
  }

  @HostListener('window:beforeunload', ['$event'])
  onBeforeUnload(event: BeforeUnloadEvent): void {
    if (!this.hasUnsavedDrawerChanges()) {
      return;
    }

    event.preventDefault();
    event.returnValue = '';
  }

  @HostListener('window:keydown', ['$event'])
  onWindowKeydown(event: KeyboardEvent): void {
    if (!this.isDrawerOpen || !this.hasUnsavedDrawerChanges()) {
      return;
    }

    const isRefreshKey = event.key === 'F5' || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'r');
    if (!isRefreshKey) {
      return;
    }

    event.preventDefault();
    this.pendingRefreshEvent = null;
    this.openGuardDialog('refresh-confirm');
  }

  confirmGuardDialog(): void {
    if (!this.guardDialogMode) {
      this.closeGuardDialog();
      return;
    }
    if (this.guardDialogMode === 'remove-serial-confirm') {
      void this.confirmRemoveScannedSerial();
      return;
    }
    if (this.guardDialogMode === 'refresh-confirm') {
      this.closeGuardDialog();
      window.location.reload();
      return;
    }
    if (this.guardDialogMode === 'receive-confirm') {
      void this.confirmMarkOrderAsReceived();
      this.closeGuardDialog();
      return;
    }
    this.closeDrawer(true);
  }

  cancelGuardDialog(): void {
    this.pendingSerialRemoval = null;
    this.closeGuardDialog();
  }

  getGuardDialogTitle(): string {
    if (this.guardDialogMode === 'remove-serial-confirm') {
      return 'Remove serial number?';
    }
    if (this.guardDialogMode === 'refresh-confirm') {
      return 'Refresh this page?';
    }
    if (this.guardDialogMode === 'receive-confirm') {
      return 'Mark sales order as received/complete?';
    }
    return 'Close sales order?';
  }

  getGuardDialogMessage(): string {
    if (this.guardDialogMode === 'remove-serial-confirm') {
      return 'Are you sure you want to remove this serial number?';
    }
    if (this.guardDialogMode === 'refresh-confirm') {
      return 'You have unsaved changes. Refreshing will discard all unsaved updates.';
    }
    if (this.guardDialogMode === 'receive-confirm') {
      const order = this.pendingReceiveOrder;
      return order ? `Mark sales order ${order.soNumber || order.id} as received/complete?` : '';
    }
    return 'Closing this SO drawer will discard the current on-screen editing context. Browser refresh and tab close are also guarded while this drawer is open.';
  }

  getGuardDialogConfirmText(): string {
    if (this.guardDialogMode === 'remove-serial-confirm') {
      return 'Remove Serial';
    }
    if (this.guardDialogMode === 'refresh-confirm') {
      return 'Refresh Now';
    }
    if (this.guardDialogMode === 'receive-confirm') {
      return 'Mark as Received';
    }
    return 'Close Drawer';
  }

  getGuardDialogCancelText(): string {
    if (this.guardDialogMode === 'remove-serial-confirm') {
      return 'Cancel';
    }
    if (this.guardDialogMode === 'receive-confirm') {
      return 'Cancel';
    }
    return 'Keep Editing';
  }

  getGuardDialogConfirmButtonClasses(): string {
    if (this.guardDialogMode === 'remove-serial-confirm' || this.guardDialogMode === 'close-confirm') {
      return 'rounded-lg border border-error-300 bg-error-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-error-600 dark:border-error-500/50 dark:bg-error-500 dark:hover:bg-error-600';
    }

    return 'rounded-lg border border-brand-300 bg-brand-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-600 dark:border-brand-500/50 dark:bg-brand-500 dark:hover:bg-brand-600';
  }

  private openGuardDialog(mode: SalesGuardDialogMode): void {
    this.guardDialogMode = mode;
    this.isGuardDialogOpen = true;
  }

  private closeGuardDialog(): void {
    this.isGuardDialogOpen = false;
    this.guardDialogMode = null;
    this.pendingRefreshEvent = null;
  }

  private hasUnsavedDrawerChanges(): boolean {
    if (!this.isDrawerOpen || this.isSubmitting || this.isRemitting || this.isDrPreviewOpen) {
      return false;
    }

    return this.getDrawerSnapshot() !== this.drawerBaselineSnapshot;
  }

  private captureDrawerBaselineSnapshot(): void {
    this.drawerBaselineSnapshot = this.getDrawerSnapshot();
  }

  private getDrawerSnapshot(): string {
    return JSON.stringify({
      customerMode: this.customerMode,
      customerSearch: this.customerSearch,
      selectedUnitTypeByProduct: this.selectedUnitTypeByProduct,
      form: this.form,
      materialItems: this.materialItems,
    });
  }

  private getSerialPageKey(productIndex: number, unitLabel: string): string {
    return `${productIndex}::${unitLabel}`;
  }

  private ensureSerialPageInBounds(productIndex: number, unitLabel: string): void {
    const key = this.getSerialPageKey(productIndex, unitLabel);
    const totalPages = this.getTotalSerialPages(productIndex, unitLabel);
    const currentPage = this.serialPageByUnitType[key] ?? 1;
    this.serialPageByUnitType[key] = Math.min(Math.max(1, currentPage), totalPages);
  }

  private mapListItemsToRows(items: SalesOrderListItem[]): SalesOrderRow[] {
    return (items ?? []).map((item) => ({
      id: item.id,
      soNumber: item.soNumber,
      customerName: item.customerName,
      customerId: item.customerId ?? null,
      installer: item.installer ?? '',
      totalAmount: Number(item.totalAmount ?? 0),
      paymentMethod: item.paymentMethod ?? '-',
      status: item.status ?? 'pending',
      salesType: item.salesType ?? '',
      projectCode: item.projectCode ?? '',
      projectName: item.projectName ?? '',
      scheduleDate: item.scheduleDate ?? '-',
      serialCount: Number(item.serialCount ?? 0),
      createdAt: item.createdAt ?? null,
      concernStatus: item.concernStatus ?? '',
    }));
  }

  private applyMeta(meta?: { page: number; limit: number; total: number; totalPages: number }): void {
    if (!meta) {
      this.total = this.orders.length;
      this.totalPages = 1;
      return;
    }

    this.page = meta.page;
    this.limit = meta.limit;
    this.total = meta.total;
    this.totalPages = Math.max(1, meta.totalPages || 1);
  }

  private async loadTabData(tab: SalesTab): Promise<void> {
    if (!this.canAccessSalesTab(tab)) {
      this.orders = [];
      this.selectedOrderIds.clear();
      this.total = 0;
      this.totalPages = 1;
      this.errorMessage = 'You do not have access to this sales tab.';
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
      const result =
        tab === 'schedules'
          ? await this.salesOrderService.getSchedules(query)
          : tab === 'services'
            ? await this.salesOrderService.getServices(query)
            : tab === 'projects'
              ? await this.salesOrderService.getProjects(query)
              : tab === 'distribution'
                ? await this.salesOrderService.getDistribution(query)
                : tab === 'sales-receivable'
                  ? await this.salesOrderService.getSalesReceivable(query)
                  : await this.salesOrderService.getRemittedSales(query);

      console.log('[Tab Debug] tab:', tab, '| items:', result.items?.length, '| meta:', result.meta);
      console.log('[Tab Debug] warehouseman branchId from JWT:', this.rbacService.getBranchId());

      this.orders = this.mapListItemsToRows(result.items);
      this.selectedOrderIds.clear();
      this.applyMeta(result.meta);
    } catch (error: unknown) {
      console.error('[Tab Debug] loadTabData error:', error);
      if (axios.isAxiosError(error)) {
        this.errorMessage =
          (error.response?.data as { message?: string } | undefined)?.message ??
          'Unable to load sales orders';
      } else {
        this.errorMessage = 'Unable to load sales orders';
      }
      this.orders = [];
      this.selectedOrderIds.clear();
      this.total = 0;
      this.totalPages = 1;
    } finally {
      this.isLoading = false;
    }
  }

  addPaymentDetail(): void {
    this.form.paymentDetails = [...this.form.paymentDetails, this.createEmptyPaymentItem()];
    this.syncPaymentAmounts();
  }

  removePaymentDetail(index: number): void {
    if (this.form.paymentDetails.length <= 1) return;
    this.form.paymentDetails = this.form.paymentDetails.filter((_: unknown, itemIndex: number) => itemIndex !== index);
  }

  addProductItem(): void {
    this.form.productItems = [...this.form.productItems, this.createEmptyProductItem()];
    this.activeProductTabIndex = this.form.productItems.length - 1;
    this.productSearchQuery = '';
    this.isProductDropdownOpen = false;
    this.ensureSelectedUnitType(this.activeProductTabIndex);
    this.recalculateTotalAmount();
  }

  addServiceItem(): void {
    this.form.serviceItems = [...this.form.serviceItems, this.createEmptyServiceItem()];
    this.activeServiceTabIndex = this.form.serviceItems.length - 1;
  }

  removeProductItem(index: number): void {
    if (this.form.productItems.length <= 1) return;
    this.form.productItems = this.form.productItems.filter((_: unknown, itemIndex: number) => itemIndex !== index);
    delete this.selectedUnitTypeByProduct[index];
    this.selectedUnitTypeByProduct = Object.fromEntries(
      Object.entries(this.selectedUnitTypeByProduct).map(([itemIndex, label]) => {
        const numericIndex = Number(itemIndex);
        if (numericIndex > index) return [String(numericIndex - 1), label];
        return [itemIndex, label];
      }),
    );
    this.activeProductTabIndex = Math.max(
      0,
      Math.min(this.activeProductTabIndex, this.form.productItems.length - 1),
    );
    this.ensureSelectedUnitType(this.activeProductTabIndex);
    this.recalculateTotalAmount();
  }

  removeServiceItem(index: number): void {
    if (this.form.serviceItems.length <= 1) return;
    this.form.serviceItems = this.form.serviceItems.filter((_: unknown, itemIndex: number) => itemIndex !== index);
    this.activeServiceTabIndex = Math.max(
      0,
      Math.min(this.activeServiceTabIndex, this.form.serviceItems.length - 1),
    );
  }

  addTransferExpenseItem(): void {
    this.form.expenseDetails = [
      ...this.form.expenseDetails,
      this.createEmptyExpenseItem(),
    ];
  }

  removeTransferExpenseItem(index: number): void {
    if (this.form.expenseDetails.length <= 1) return;
    this.form.expenseDetails = this.form.expenseDetails.filter((_: unknown, itemIndex: number) => itemIndex !== index);
  }

  getCapacitiesByProduct(productId: string): ProductCapacityOption[] {
    const product = this.catalogProducts.find((item) => String(item.id) === String(productId));
    return product?.capacities ?? [];
  }

  onProductChanged(index: number): void {
    const nextItems = [...this.form.productItems];
    nextItems[index] = {
      ...nextItems[index],
      capacityId: '',
      sellPrice: '',
      unitPrice: 0,
    };
    this.form.productItems = nextItems;
    this.recalculateTotalAmount();
  }

  onCapacityChanged(index: number): void {
    const item = this.form.productItems[index];
    if (!item) {
      return;
    }

    const capacity = this.getCapacitiesByProduct(item.productId).find(
      (entry) => String(entry.id) === String(item.capacityId),
    );

    if (!capacity) {
      item.sellPrice = '';
      item.unitPrice = 0;
      this.recalculateTotalAmount();
      return;
    }

    item.sellPrice = Number(capacity.sellPrice ?? 0) || 0;
    item.unitPrice = Number(capacity.unitPrice ?? 0) || 0;
    this.recalculateTotalAmount();
  }

  onPaymentMethodChange(index: number): void {
    const payment = this.form.paymentDetails[index];
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

    if (payment.method !== 'Cheque') {
      payment.checkNo = '';
      payment.issuedBy = '';
      payment.bankAccount = '';
      payment.postDated = '';
    }

    if (payment.method !== 'Bank Transfer' && payment.method !== 'Cheque') {
      payment.bankName = '';
    }

    if (payment.method !== 'Bank Transfer' && payment.method !== 'Credit Card') {
      payment.referenceNo = '';
    }

    if (payment.method !== 'Credit Card') {
      payment.ccCharge = '';
    }

    if (payment.method !== 'Cash' && payment.method !== 'Credit Card') {
      payment.paymentDate = '';
    }

    if (payment.autoTermsDueDate) {
      this.onTermsChanged(index);
    }

    this.syncPaymentAmounts();
  }

  toggleAutoTermsDueDate(index: number): void {
    const payment = this.form.paymentDetails[index];
    if (!payment) {
      return;
    }

    payment.autoTermsDueDate = !payment.autoTermsDueDate;
    if (payment.autoTermsDueDate) {
      this.onTermsChanged(index);
    }
  }

  isAutoTermsDueDate(index: number): boolean {
    const payment = this.form.paymentDetails[index];
    return payment?.autoTermsDueDate ?? true;
  }

  onTermsChanged(index: number): void {
    const payment = this.form.paymentDetails[index];
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

  shouldShowPaymentField(method: SalesPaymentFormItem['method'], field: string): boolean {
    const methodMap: Record<SalesPaymentFormItem['method'], Set<string>> = {
      Cash: new Set(['amount', 'paymentDate']),
      'Bank Transfer': new Set(['amount', 'bankName', 'referenceNo']),
      Terms: new Set(['amount', 'terms', 'termsDueDate']),
      'Terms with DP': new Set(['amount', 'terms', 'termsDueDate', 'downPayment']),
      Cheque: new Set(['amount', 'checkNo', 'issuedBy', 'bankName', 'bankAccount', 'postDated']),
      'Credit Card': new Set(['amount', 'ccCharge', 'referenceNo', 'paymentDate']),
      Installment: new Set(['amount', 'terms', 'termsDueDate', 'downPayment']),
    };

    return methodMap[method]?.has(field) ?? false;
  }

  setActiveProductTab(index: number): void {
    this.activeProductTabIndex = index;
    this.syncProductSearchQuery();
    this.ensureSelectedUnitType(index);
    if (this.drawerMode === 'edit') {
      const selectedUnit = this.getSelectedUnitTypeLabel(index);
      this.focusSerialScanInput(index, selectedUnit);
    }
  }

  setActiveServiceTab(index: number): void {
    this.activeServiceTabIndex = index;
  }

  getActiveProductItem(): SalesProductFormItem | null {
    return this.form.productItems[this.activeProductTabIndex] ?? null;
  }

  getActiveServiceItem(): SalesServiceFormItem | null {
    return this.form.serviceItems[this.activeServiceTabIndex] ?? null;
  }

  getSelectedUnitTypeLabel(productIndex: number): string {
    const selected = this.selectedUnitTypeByProduct[productIndex];
    if (selected) return selected;
    const fallback = this.form.productItems[productIndex]?.unitTypes[0]?.label ?? 'set';
    this.selectedUnitTypeByProduct[productIndex] = fallback;
    return fallback;
  }

  selectUnitType(productIndex: number, unitLabel: string): void {
    this.selectedUnitTypeByProduct[productIndex] = unitLabel;
    if (this.drawerMode === 'edit') {
      this.focusSerialScanInput(productIndex, unitLabel);
    }
  }

  getPaginatedSerials(productIndex: number, unitLabel: string): string[] {
    const item = this.form.productItems[productIndex];
    const unitEntry = item?.unitTypes.find((entry: SalesUnitTypeFormItem) => entry.label === unitLabel);
    if (!unitEntry) {
      return [];
    }

    const currentPage = this.getSerialPage(productIndex, unitLabel);
    const start = (currentPage - 1) * this.serialsPerPage;
    return unitEntry.serials.slice(start, start + this.serialsPerPage);
  }

  getSerialPage(productIndex: number, unitLabel: string): number {
    const key = this.getSerialPageKey(productIndex, unitLabel);
    const totalPages = this.getTotalSerialPages(productIndex, unitLabel);
    const currentPage = this.serialPageByUnitType[key] ?? 1;
    return Math.min(Math.max(1, currentPage), totalPages);
  }

  getTotalSerialPages(productIndex: number, unitLabel: string): number {
    const item = this.form.productItems[productIndex];
    const unitEntry = item?.unitTypes.find((entry: SalesUnitTypeFormItem) => entry.label === unitLabel);
    const totalSerials = unitEntry?.serials.length ?? 0;
    return Math.max(1, Math.ceil(totalSerials / this.serialsPerPage));
  }

  changeSerialPage(productIndex: number, unitLabel: string, nextPage: number): void {
    const key = this.getSerialPageKey(productIndex, unitLabel);
    const totalPages = this.getTotalSerialPages(productIndex, unitLabel);
    this.serialPageByUnitType[key] = Math.min(Math.max(1, nextPage), totalPages);
  }

  onUnitTypeQtyChange(productIndex: number): void {
    const item = this.form.productItems[productIndex];
    if (!item) return;

    item.unitTypes = item.unitTypes.map((entry: SalesUnitTypeFormItem) => ({
      ...entry,
      value: Math.max(0, Math.floor(Number(entry.value) || 0)),
    }));

    item.totalSetQty = item.unitTypes.reduce(
      (maxQty: number, entry: SalesUnitTypeFormItem) => Math.max(maxQty, Number(entry.value) || 0),
      0,
    );

    this.recalculateTotalAmount();
  }

  private syncMigrationDrawerQuantitiesFromSerials(): void {
    if (!this.isMigrationDrawerMode) {
      return;
    }

    this.form.productItems = (this.form.productItems ?? []).map((item: SalesProductFormItem) => {
      const nextUnitTypes = (item.unitTypes ?? []).map((entry: SalesUnitTypeFormItem) => {
        const parsed = this.parseSerials(entry.serialInput)
          .map((serial) => this.normalizeSerial(serial))
          .filter((serial, index, self) => serial.length > 0 && self.indexOf(serial) === index);

        const mergedSerials = [...new Set([
          ...((entry.serials ?? []).map((serial) => this.normalizeSerial(serial)).filter((serial) => serial.length > 0)),
          ...parsed,
        ])];

        const computedValue = Math.max(
          0,
          Math.floor(Number(entry.value) || 0),
          mergedSerials.length,
        );

        return {
          ...entry,
          serials: mergedSerials,
          serialInput: mergedSerials.join('\n'),
          value: computedValue,
        };
      });

      const computedTotalSetQty = nextUnitTypes.reduce(
        (maxQty: number, entry: SalesUnitTypeFormItem) => Math.max(maxQty, Number(entry.value) || 0),
        0,
      );

      return {
        ...item,
        unitTypes: nextUnitTypes,
        totalSetQty: computedTotalSetQty,
      };
    });
  }

  onTotalSetQtyChange(productIndex: number): void {
    const item = this.form.productItems[productIndex];
    if (!item) return;

    // Update totalSetQty
    item.totalSetQty = Math.max(0, Math.floor(Number(item.totalSetQty) || 0));

    // If there are unitTypes, update all their values to match totalSetQty (or distribute as needed)
    if (Array.isArray(item.unitTypes) && item.unitTypes.length > 0) {
      item.unitTypes = item.unitTypes.map((entry: SalesUnitTypeFormItem) => ({
        ...entry,
        value: item.totalSetQty,
      }));
    }

    // Always sync unitTypesQty for backend payload
    (item as any).unitTypesQty = (item.unitTypes || []).map((entry: any) => ({
      label: entry.label,
      value: Number(entry.value) || 0,
    }));

    this.recalculateTotalAmount();
  }

  recalculateTotalAmount(): void {
    const productTotal = this.form.productItems.reduce((sum: number, item: SalesProductFormItem) => {
      const unitPrice = Number(item.unitPrice) || 0;
      const sellPrice = Number(item.sellPrice) || 0;
      const discountPrice = Number(item.discountPrice) || 0;
      const qty = Math.max(0, Math.floor(Number(item.totalSetQty) || 0));
      const priceToUse = discountPrice > 0 ? discountPrice : sellPrice > 0 ? sellPrice : unitPrice;
      return sum + priceToUse * qty;
    }, 0);

    let serviceTotal = 0;
    this.form.serviceItems = this.form.serviceItems.map((item: SalesServiceFormItem) => {
      const unitPrice = Number(item.unitPrice) || 0;
      const qty = Math.max(0, Math.floor(Number(item.qty) || 0));
      const total = unitPrice * qty;
      serviceTotal += total;
      return {
        ...item,
        total,
      };
    });

    this.form.totalAmount = productTotal + serviceTotal;
    this.syncPaymentAmounts();
  }

  onSerialScanInputChange(productIndex: number, unitLabel: string, value: string): void {
    const item = this.form.productItems[productIndex];
    if (!item) return;
    const unitEntry = item.unitTypes.find((entry: SalesUnitTypeFormItem) => entry.label === unitLabel);
    if (!unitEntry) return;

    unitEntry.scanInput = value;
    unitEntry.scanError = '';
    unitEntry.scanSuccess = '';
    unitEntry.scanInfo = '';

    const normalizedSerial = this.normalizeSerial(value);
    if (!normalizedSerial) return;

    const timerKey = `${productIndex}::${unitLabel}`;
    const existingTimer = this.serialScanTimers[timerKey];
    if (existingTimer) clearTimeout(existingTimer);

    this.serialScanTimers[timerKey] = setTimeout(() => {
      void this.scanSerialForSelectedUnit(productIndex);
      delete this.serialScanTimers[timerKey];
    }, this.serialScanDebounceMs);
  }

  async scanSerialForSelectedUnit(productIndex: number): Promise<void> {
    if (this.drawerMode !== 'edit' || !this.editingSalesId) return;

    const item = this.form.productItems[productIndex];
    if (!item) return;

    const unitLabel = this.getSelectedUnitTypeLabel(productIndex);
    const unitEntry = item.unitTypes.find((entry: SalesUnitTypeFormItem) => entry.label === unitLabel);
    if (!unitEntry) return;

    const timerKey = `${productIndex}::${unitLabel}`;
    const existingTimer = this.serialScanTimers[timerKey];
    if (existingTimer) {
      clearTimeout(existingTimer);
      delete this.serialScanTimers[timerKey];
    }

    const serialNumber = this.normalizeSerial(unitEntry.scanInput);
    unitEntry.scanError = '';
    unitEntry.scanSuccess = '';
    unitEntry.scanInfo = '';
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
    const existsInOtherUnitType = item.unitTypes.some((entry: SalesUnitTypeFormItem) => {
      if (entry.label === unitLabel) return false;
      return entry.serials.some(
        (serial: string) => this.normalizeSerial(serial).toLowerCase() === normalizedIncoming,
      );
    });

    if (existsInOtherUnitType) {
      unitEntry.scanError = 'Serial number already exists in another unit type for this product';
      return;
    }

    const existingInCurrentUnit = unitEntry.serials.some(
      (entry: string) => this.normalizeSerial(entry).toLowerCase() === normalizedIncoming,
    );
    if (existingInCurrentUnit) {
      unitEntry.scanError = 'Serial number already scanned for this unit type';
      unitEntry.scanInput = '';
      this.focusSerialScanInput(productIndex, unitLabel);
      return;
    }

    unitEntry.serials = [...unitEntry.serials, serialNumber];
    this.changeSerialPage(productIndex, unitLabel, this.getTotalSerialPages(productIndex, unitLabel));
    unitEntry.scanInput = '';
    unitEntry.scanSuccess = 'Serial number queued for saving';
    unitEntry.scanError = '';

    this.queueSerialScan({
      productIndex,
      unitLabel,
      serialNumber,
      salesId: this.editingSalesId,
      productId,
      capacityId,
    });

    this.focusSerialScanInput(productIndex, unitLabel);
  }

  requestRemoveScannedSerial(productIndex: number, unitLabel: string, serialNumber: string): void {
    this.pendingSerialRemoval = {
      productIndex,
      unitLabel,
      serialNumber,
    };
    this.openGuardDialog('remove-serial-confirm');
  }

  async confirmRemoveScannedSerial(): Promise<void> {
    if (!this.pendingSerialRemoval) {
      this.closeGuardDialog();
      return;
    }

    const { productIndex, unitLabel, serialNumber } = this.pendingSerialRemoval;

    if (!this.editingSalesId) {
      this.pendingSerialRemoval = null;
      this.closeGuardDialog();
      return;
    }

    const item = this.form.productItems[productIndex];
    if (!item) return;
    const unitEntry = item.unitTypes.find((entry: SalesUnitTypeFormItem) => entry.label === unitLabel);
    if (!unitEntry) return;

    unitEntry.scanError = '';
    unitEntry.scanSuccess = '';
    unitEntry.scanInfo = '';
    unitEntry.isScanning = true;

    try {
      const response = await this.salesOrderService.removeSalesSerial({
        serialNumber,
        salesId: this.editingSalesId,
        unitType: unitLabel,
      });

      if (!response.success) {
        unitEntry.scanError = response.message ?? 'Failed to remove serial number';
        return;
      }

      const normalizedTarget = this.normalizeSerial(serialNumber).toLowerCase();
      unitEntry.serials = unitEntry.serials.filter(
        (entry: string) => this.normalizeSerial(entry).toLowerCase() !== normalizedTarget,
      );
      this.ensureSerialPageInBounds(productIndex, unitLabel);
      unitEntry.serialInput = unitEntry.serials.join('\n');
      unitEntry.scanSuccess = response.message ?? 'Serial number removed successfully';
      unitEntry.scanError = '';
    } catch (error: unknown) {
      if (axios.isAxiosError(error)) {
        unitEntry.scanError =
          (error.response?.data as { message?: string } | undefined)?.message ??
          'Failed to remove serial number';
      } else {
        unitEntry.scanError = 'Failed to remove serial number';
      }
    } finally {
      unitEntry.isScanning = false;
      this.pendingSerialRemoval = null;
      this.closeGuardDialog();
    }
  }

  async saveDesignForm(): Promise<void> {
    this.syncMigrationDrawerQuantitiesFromSerials();
    const salesType = this.form.salesType;
    const validationError = this.validateProductSerialRequirements();
    if (validationError) {
      this.uiError = validationError;
      return;
    }
    if (this.isSubmitting) {
      return;
    }

    // (moved up: salesType already declared above)
    if (salesType === 'transfer') {
      const td = this.form.transferDetails ?? {};
      if (!td.fromBranchId || !td.toBranchId) {
        this.uiError = 'Please select both source and destination branches for transfer.';
        return;
      }
      if (td.fromBranchId === td.toBranchId) {
        this.uiError = 'From and To branch must be different for transfer.';
        return;
      }
    }

    if (['service', 'sales and service', 'concern'].includes(salesType)) {
      const hasService = (this.form.serviceItems ?? []).some((item: any) =>
        String(item.serviceName ?? '').trim().length > 0 ||
        Number(item.unitPrice) > 0 ||
        Number(item.qty) > 0,
      );
      if (!hasService) {
        this.uiError = 'Add at least one service item.';
        return;
      }
    }

    if (salesType === 'concern') {
      const cd = this.form.concernDetails ?? {};
      if (!String(cd.concernDescription ?? '').trim()) {
        this.uiError = 'Please provide a concern description.';
        return;
      }
    }

    const payload = this.buildPayload();

    if (this.isMigrationDrawerMode) {
      const rowNumber = Number(this.migrationEditingRowNumber ?? 0);
      if (!Number.isFinite(rowNumber) || rowNumber <= 0) {
        this.uiError = 'Invalid migration row reference.';
        return;
      }

      this.migrationEditedPayloadByRow[rowNumber] = payload;
      this.uiError = '';
      this.uiMessage = `Migration row ${rowNumber} payload updated.`;
      this.closeDrawer(true);
      await this.refreshMigrationPreview();
      return;
    }

    this.uiError = '';
    this.uiMessage = '';
    this.isSubmitting = true;

    try {
      if (this.drawerMode === 'create') {
        const response = await this.salesOrderService.createSalesOrder(payload);
        if (!response.success) {
          this.openErrorModal('Submit Error', response.message ?? 'Failed to create sales order');
          return;
        }
        this.uiMessage = response.message ?? 'Sales order created successfully';
      } else {
        const targetId = Number(this.editingSalesId);
        if (!Number.isFinite(targetId) || targetId <= 0) {
          this.uiError = 'Invalid sales order id for update';
          return;
        }

        const response = await this.salesOrderService.updateSalesOrder(targetId, payload);
        if (!response.success) {
          this.openErrorModal('Submit Error', response.message ?? 'Failed to update sales order');
          return;
        }
        this.uiMessage = response.message ?? 'Sales order updated successfully';
      }

      this.closeDrawer(true);
      this.page = 1;
      await this.loadTabData(this.activeTab);
    } catch (error: unknown) {
      let errorMessage = 'Failed to submit sales order';
      if (axios.isAxiosError(error)) {
        errorMessage =
          (error.response?.data as { message?: string } | undefined)?.message ??
          'Failed to submit sales order';
      }
      this.openErrorModal('Submit Error', errorMessage);
    } finally {
      this.isSubmitting = false;
    }
  }

  async remitSales(): Promise<void> {
    if (this.drawerMode !== 'edit' || this.isRemitting || this.isSubmitting) {
      return;
    }

    const validationError = this.validateProductSerialRequirements('remitted');
    if (validationError) {
      this.uiError = validationError.replace('submitting', 'remitting');
      return;
    }

    const targetId = Number(this.editingSalesId);
    if (!Number.isFinite(targetId) || targetId <= 0) {
      this.uiError = 'Invalid sales order id for remittance';
      return;
    }

    this.uiError = '';
    this.uiMessage = '';
    this.isRemitting = true;

    try {
      const response = await this.salesOrderService.updateSalesOrder(targetId, {
        productItems: [],
        status: 'remitted',
        remarks: this.form.remarks || undefined,
      });

      if (!response.success) {
        this.openErrorModal('Remit Error', response.message ?? 'Failed to remit sales');
        return;
      }

      this.uiMessage = response.message ?? 'Sales remitted successfully';
      this.closeDrawer(true);
      this.page = 1;
      await this.loadTabData(this.activeTab);
    } catch (error: unknown) {
      let errorMessage = 'Failed to remit sales';
      if (axios.isAxiosError(error)) {
        errorMessage =
          (error.response?.data as { message?: string } | undefined)?.message ??
          'Failed to remit sales';
      }
      this.openErrorModal('Remit Error', errorMessage);
    } finally {
      this.isRemitting = false;
    }
  }

  async sendForDelivery(): Promise<void> {
    if (this.drawerMode !== 'edit' || this.isSendingForDelivery || this.isSubmitting || this.isRemitting) {
      return;
    }

    const targetId = Number(this.editingSalesId);
    if (!Number.isFinite(targetId) || targetId <= 0) {
      this.uiError = 'Invalid sales order id for delivery';
      return;
    }

    this.syncMigrationDrawerQuantitiesFromSerials();

    const validationError = this.validateProductSerialRequirements('for-delivery');
    if (validationError) {
      this.uiError = validationError;
      return;
    }

    const payload = this.buildPayload();
    payload.status = 'for-delivery';

    this.uiError = '';
    this.uiMessage = '';
    this.isSendingForDelivery = true;

    try {
      const response = await this.salesOrderService.updateSalesOrder(targetId, payload);
      if (!response.success) {
        this.openErrorModal('Delivery Error', response.message ?? 'Failed to send sales order for delivery');
        return;
      }

      this.uiMessage = response.message ?? 'Sales order sent for delivery successfully';
      this.closeDrawer(true);
      this.page = 1;
      await this.loadTabData(this.activeTab);
    } catch (error: unknown) {
      let errorMessage = 'Failed to send sales order for delivery';
      if (axios.isAxiosError(error)) {
        errorMessage =
          (error.response?.data as { message?: string } | undefined)?.message ??
          'Failed to send sales order for delivery';
      }
      this.openErrorModal('Delivery Error', errorMessage);
    } finally {
      this.isSendingForDelivery = false;
    }
  }

  private buildPayload(): SalesOrderPayload {
    const customerType = this.form.salesType === 'sub-dealer' ? 'sub_dealer' : 'regular';
    const normalizedCustomerName = String(this.form.customer.name ?? '').trim();
    const customerPayload: any = {
      customer_type: customerType,
    };

    if (normalizedCustomerName) {
      customerPayload.name = normalizedCustomerName;
      customerPayload.address = this.form.customer.address || undefined;
      customerPayload.contact_person = this.form.customer.contact_person || undefined;
      customerPayload.contact_number = this.form.customer.contact_number || undefined;
      customerPayload.email = this.form.customer.email || undefined;
      customerPayload.tin_number = this.form.customer.tin_number || undefined;
    }

    const transferDetailsPayload = (() => {
      const td = this.form.transferDetails ?? {};
      const hasTransferInfo =
        Boolean(td.fromBranchId) ||
        Boolean(td.toBranchId) ||
        String(td.transferNotes ?? '').trim().length > 0 ||
        String(td.transferStatus ?? '').trim().length > 0 ||
        Boolean(td.transferDate) ||
        Boolean(td.expectedDeliveryDate) ||
        Boolean(td.actualDeliveryDate);

      if (!hasTransferInfo) return undefined;

      return {
        fromBranchId: td.fromBranchId ?? undefined,
        toBranchId: td.toBranchId ?? undefined,
        transferDate: td.transferDate || undefined,
        expectedDeliveryDate: td.expectedDeliveryDate || undefined,
        actualDeliveryDate: td.actualDeliveryDate || undefined,
        transferStatus: td.transferStatus || undefined,
        transferNotes: td.transferNotes || undefined,
      };
    })();

    const concernDetailsPayload = (() => {
      const cd = this.form.concernDetails ?? {};
      const hasConcernInfo =
        String(cd.concernType ?? '').trim().length > 0 ||
        String(cd.concernSubject ?? '').trim().length > 0 ||
        String(cd.concernDescription ?? '').trim().length > 0 ||
        String(cd.concernStatus ?? '').trim().length > 0 ||
        String(cd.priority ?? '').trim().length > 0 ||
        String(cd.resolutionNotes ?? '').trim().length > 0 ||
        Boolean(cd.resolvedAt);

      if (!hasConcernInfo) return undefined;

      return {
        concernType: String(cd.concernType ?? '').trim() || undefined,
        concernSubject: String(cd.concernSubject ?? '').trim() || undefined,
        concernDescription: String(cd.concernDescription ?? '').trim() || undefined,
        concernStatus: String(cd.concernStatus ?? '').trim() || undefined,
        priority: String(cd.priority ?? '').trim() || undefined,
        resolutionNotes: cd.concernStatus === 'warranty'
          ? String(cd.warrantySerials ?? '').trim() || undefined
          : String(cd.resolutionNotes ?? '').trim() || undefined,
        resolvedAt: cd.resolvedAt || undefined,
      };
    })();

    const payload: SalesOrderPayload = {
      customer_id: this.customerMode === 'existing' ? this.form.customer_id || null : null,
      customer: customerPayload,
      totalAmount: Number(this.form.totalAmount) || 0,
      scheduleDate: this.form.scheduleDate || null,
      salesType: this.form.salesType || this.getSalesTypeFromActiveTab(),
      projectId: this.form.projectId || undefined,
      projectName: this.form.projectName || undefined,
      projectCode: this.form.projectCode || undefined,
      installer: this.form.installer || undefined,
      remarks: this.form.remarks,
      transferDetails: transferDetailsPayload,
      concernDetails: concernDetailsPayload,
      expenseDetails: (this.form.expenseDetails ?? []).filter((item: SalesOrderExpenseDetailsPayload) =>
        String(item.expenseType ?? '').trim().length > 0 ||
        Number(item.amount) > 0 ||
        String(item.expenseDescription ?? '').trim().length > 0,
      ),
      paymentDetails: this.form.paymentDetails.map((payment: any) => ({
        method: payment.method || undefined,
        amount: Number(payment.amount) || 0,
        terms: payment.terms || undefined,
        termsDueDate: payment.termsDueDate || null,
        status: payment.status || undefined,
        referenceNo: payment.referenceNo || undefined,
        paymentDate: payment.paymentDate || null,
        issuedBy: payment.issuedBy || undefined,
        ccCharge: payment.ccCharge || undefined,
        checkNo: payment.checkNo || undefined,
        bankName: payment.bankName || undefined,
        bankAccount: payment.bankAccount || undefined,
        postDated: payment.postDated || undefined,
        downPayment: Number(payment.downPayment) || 0,
      })),
      productItems: this.form.productItems
        .filter((item: any) => Boolean(item.productId) && Boolean(item.capacityId))
        .map((item: any) => ({
          transType: 'sales',
          productId: item.productId ? Number(item.productId) : undefined,
          capacityId: item.capacityId ? Number(item.capacityId) : undefined,
          unitPrice: Number(item.unitPrice) || 0,
          sellPrice: item.sellPrice === '' ? '' : Number(item.sellPrice) || 0,
          discountPrice: item.discountPrice === '' ? '' : Number(item.discountPrice) || 0,
          unitTypesQty: (item.unitTypes || []).map((entry: any) => ({
            label: entry.label,
            value: Number(entry.value) || 0,
          })),
          totalSetQty: Number(item.totalSetQty) || 0,
          purchaseId: null,
          salesId: this.editingSalesId,
          serialNumbers: this.buildSerialNumbersPayload(item),
        })),
      serviceItems: this.form.serviceItems
        .filter(
          (item: any) =>
            String(item.serviceName ?? '').trim().length > 0 ||
            Number(item.unitPrice) > 0 ||
            Number(item.qty) > 0,
        )
        .map((item: any) => ({
          serviceName: String(item.serviceName ?? '').trim() || undefined,
          serviceCost: Number(item.unitPrice) || 0,
          serviceDurationHours: Number(item.qty) || 0,
          serviceNotes: '',
          serviceStatus: '',
        })),
      status: this.form.status || 'pending',
    };

    return payload;
  }

  private resetForm(): void {
    this.customerMode = 'existing';
    this.form = {
      customer_id: '',
      totalAmount: 0,
      scheduleDate: '',
      salesType: this.getSalesTypeFromActiveTab(),
      projectName: '',
      projectCode: '',
      installer: '',
      remarks: '',
      transferDetails: {
        fromBranchId: undefined as number | undefined,
        toBranchId: undefined as number | undefined,
        transferDate: '',
        expectedDeliveryDate: '',
        actualDeliveryDate: '',
        transferStatus: '',
        transferNotes: '',
        receiverName: '',
        receivedBy: undefined as number | undefined,
      },
      concernDetails: {
        concernType: '',
        concernSubject: '',
        concernDescription: '',
        concernStatus: '',
        priority: '',
        resolutionNotes: '',
        resolvedAt: '',
        warrantySerials: '',
      },
      expenseDetails: [this.createEmptyExpenseItem()],
      customer: {
        name: '',
        address: '',
        contact_person: '',
        contact_number: '',
        email: '',
        tin_number: '',
      },
      paymentDetails: [this.createEmptyPaymentItem()],
      productItems: [this.createEmptyProductItem()],
      serviceItems: [this.createEmptyServiceItem()],
      status: this.getDefaultStatusFromActiveTab(),
    };

    this.editingSalesId = null;
    this.customerSearch = '';
    this.activeProductTabIndex = 0;
    this.activeServiceTabIndex = 0;
    this.selectedUnitTypeByProduct = {};
    this.serialPageByUnitType = {};
    this.pendingSerialRemoval = null;
    this.closeGuardDialog();
    this.drawerBaselineSnapshot = '';
    this.materialItems = [];
    this.ensureSelectedUnitType(0);
    this.syncPaymentAmounts();
  }

  private createEmptyPaymentItem(): SalesPaymentFormItem {
    return {
      method: 'Cash',
      amount: 0,
      terms: '',
      termsDueDate: '',
      autoTermsDueDate: true,
      status: 'paid',
      referenceNo: '',
      paymentDate: '',
      issuedBy: '',
      ccCharge: '',
      checkNo: '',
      bankName: '',
      bankAccount: '',
      postDated: '',
      downPayment: 0,
    };
  }

  private createUnitTypeEntry(label: string, value = 0, serials: string[] = []): SalesUnitTypeFormItem {
    const normalizedLabel = String(label || 'set').trim().toLowerCase() || 'set';
    const normalizedSerials = [
      ...new Set(
        (serials ?? [])
          .map((entry) => this.normalizeSerial(entry))
          .filter((entry) => entry.length > 0),
      ),
    ];

    return {
      label: normalizedLabel,
      value: Number(value) || 0,
      serials: normalizedSerials,
      serialInput: normalizedSerials.join('\n'),
      scanInput: '',
      scanError: '',
      scanSuccess: '',
      scanInfo: '',
      isScanning: false,
    };
  }

  private createEmptyProductItem(): SalesProductFormItem {
    return {
      productId: '',
      capacityId: '',
      unitPrice: 0,
      sellPrice: '',
      discountPrice: '',
      unitTypes: [
        this.createUnitTypeEntry('indoor', 1, []),
        this.createUnitTypeEntry('outdoor', 1, []),
      ],
      totalSetQty: 1,
    };
  }

  private createEmptyServiceItem(): SalesServiceFormItem {
    return {
      serviceName: '',
      unitPrice: 0,
      qty: 0,
      total: 0,
    };
  }

  private createEmptyExpenseItem(): SalesOrderExpenseDetailsPayload {
    return {
      expenseType: '',
      expenseDescription: '',
      amount: 0,
      expenseDate: '',
      paidTo: '',
      paymentMethod: '',
      referenceNo: '',
    };
  }

  private ensureSelectedUnitType(productIndex: number): void {
    const item = this.form.productItems[productIndex];
    if (!item || item.unitTypes.length === 0) return;

    const current = this.selectedUnitTypeByProduct[productIndex];
    const exists = item.unitTypes.some((entry: SalesUnitTypeFormItem) => entry.label === current);
    if (!exists) {
      this.selectedUnitTypeByProduct[productIndex] = item.unitTypes[0].label;
    }
  }

  private setTransientScanError(productIndex: number, unitLabel: string, message: string): void {
    const item = this.form.productItems[productIndex];
    if (!item) return;

    const unitEntry = item.unitTypes.find((entry: SalesUnitTypeFormItem) => entry.label === unitLabel);
    if (!unitEntry) return;

    const timerKey = `${productIndex}::${unitLabel}`;
    const existingTimer = this.serialScanErrorTimers[timerKey];
    if (existingTimer) clearTimeout(existingTimer);

    unitEntry.scanError = message;
    unitEntry.scanSuccess = '';
    unitEntry.scanInfo = '';

    this.serialScanErrorTimers[timerKey] = setTimeout(() => {
      const currentItem = this.form.productItems[productIndex];
      const currentUnit = currentItem?.unitTypes.find((entry: SalesUnitTypeFormItem) => entry.label === unitLabel);
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
      if (!element) return;

      element.focus();
      element.select();
    }, 0);
  }

  private parseSerials(rawValue: string): string[] {
    return String(rawValue ?? '')
      .split(/\r?\n|,/)
      .map((value: string) => value.trim())
      .filter((value) => value.length > 0);
  }

  private buildSerialNumbersPayload(item: SalesProductFormItem): Record<string, string[]> {
    const globalSeen = new Set<string>();

    return item.unitTypes.reduce<Record<string, string[]>>((accumulator, unitType) => {
      const typed = this.parseSerials(unitType.serialInput);
      const scanned = unitType.serials.map((entry) => this.normalizeSerial(entry));
      const mergedMap = new Map<string, string>();

      for (const entry of [...scanned, ...typed]) {
        const normalized = this.normalizeSerial(entry);
        if (!normalized) continue;

        const key = normalized.toLowerCase();
        if (!mergedMap.has(key)) {
          mergedMap.set(key, normalized);
        }
      }

      const merged = [...mergedMap.values()].filter((entry) => {
        const key = entry.toLowerCase();
        if (globalSeen.has(key)) return false;
        globalSeen.add(key);
        return true;
      });

      if (merged.length > 0) {
        accumulator[unitType.label] = merged;
      }

      return accumulator;
    }, {});
  }

  private buildUnitTypesFromSerialMap(serialMap: Record<string, string[]>): SalesUnitTypeFormItem[] {
    return Object.entries(serialMap)
      .filter(([label]) => label.trim().length > 0)
      .map(([label, serials]) => this.createUnitTypeEntry(label, Number(serials.length) || 0, serials));
  }

  private mapDetailProductItem(product: SalesOrderDetailProductItem): SalesProductFormItem {
    const unitTypesFromPayload = Array.isArray(product.unitTypesQty) ? product.unitTypesQty : [];
    const serialNumbers = product.serialNumbers ?? {};

    const normalizedLabelsFromPayload = unitTypesFromPayload
      .map((entry) => String(entry.label ?? 'set').trim().toLowerCase() || 'set')
      .filter((label, index, self) => self.indexOf(label) === index);
    const normalizedLabelsFromSerial = Object.keys(serialNumbers)
      .map((label) => String(label).trim().toLowerCase() || 'set')
      .filter((label, index, self) => self.indexOf(label) === index);

    // Look up the product's registered unitTypes from the catalog
    const catalogProduct = this.catalogProducts.find((p) => String(p.id) === String(product.productId));
    const catalogUnitTypes = (catalogProduct?.unitTypes ?? [])
      .map((u) => String(u).trim().toLowerCase())
      .filter(Boolean);

    const savedTotalSetQty = Math.max(0, Math.floor(Number(product.totalSetQty) || 0));
    const payloadMaxQty = unitTypesFromPayload.reduce(
      (maxQty: number, entry: SalesOrderDetailUnitType) => Math.max(maxQty, Math.max(0, Math.floor(Number(entry.value) || 0))),
      0,
    );
    const serialMaxQty = normalizedLabelsFromSerial.reduce((maxQty, label) => {
      const serials = Array.isArray(serialNumbers[label]) ? serialNumbers[label] : [];
      return Math.max(maxQty, serials.length);
    }, 0);

    const resolvedSetQty =
      savedTotalSetQty > 0
        ? savedTotalSetQty
        : payloadMaxQty > 0
          ? payloadMaxQty
          : serialMaxQty;

    // Priority: saved unitTypesQty labels > serial keys > catalog unitTypes > fallback 'set'
    const labels =
      normalizedLabelsFromPayload.length > 0
        ? normalizedLabelsFromPayload
        : normalizedLabelsFromSerial.length > 0
          ? normalizedLabelsFromSerial
          : catalogUnitTypes.length > 0
            ? catalogUnitTypes
            : ['set'];

    const qtyMap = new Map<string, number>();
    for (const entry of unitTypesFromPayload) {
      const label = String(entry.label ?? 'set').trim().toLowerCase() || 'set';
      qtyMap.set(label, Math.max(0, Math.floor(Number(entry.value) || 0)));
    }

    const unitTypes = labels.map((label) => {
      const serials = Array.isArray(serialNumbers[label]) ? serialNumbers[label] : [];
      const value = qtyMap.get(label) ?? (serials.length > 0 ? serials.length : resolvedSetQty);
      return this.createUnitTypeEntry(label, value, serials);
    });

    return {
      productId: String(product.productId ?? ''),
      capacityId: String(product.capacityId ?? ''),
      unitPrice: Number(product.unitPrice) || 0,
      sellPrice: Number(product.sellPrice) || 0,
      discountPrice: Number(product.discountPrice) || 0,
      unitTypes,
      totalSetQty: resolvedSetQty,
    };
  }

  private applyDetailToForm(detail: SalesOrderDetailItem, fallbackItem: SalesOrderRow): void {
    this.customerMode = detail.customerId ? 'existing' : 'new';

    const paymentDetails =
      detail.paymentDetails.length > 0
        ? detail.paymentDetails.map((payment) => ({
          method: this.toPaymentMethod(payment.method),
            amount: Number(payment.amount) || 0,
            terms: payment.terms ?? '',
            termsDueDate: this.toDateInputValue(payment.termsDueDate),
            autoTermsDueDate: true,
            status: payment.status ?? 'paid',
            referenceNo: payment.referenceNo ?? '',
            paymentDate: this.toDateInputValue(payment.paymentDate),
            issuedBy: payment.issuedBy ?? '',
            ccCharge: payment.ccCharge ?? '',
            checkNo: payment.checkNo ?? '',
            bankName: payment.bankName ?? '',
            bankAccount: payment.bankAccount ?? '',
            postDated: payment.postDated ?? '',
            downPayment: Number(payment.downPayment) || 0,
          }))
        : [this.createEmptyPaymentItem()];

    const productItems =
      Array.isArray(detail.productItems) && detail.productItems.length > 0
        ? detail.productItems.map((product) => this.mapDetailProductItem(product))
        : [this.createEmptyProductItem()];

    const serviceItems =
      Array.isArray(detail.serviceItems) && detail.serviceItems.length > 0
        ? detail.serviceItems.map((service) => service)
        : [this.createEmptyServiceItem()];

    this.materialItems = detail.materialItems ?? [];

    const transferDetails = detail.transferDetails ?? {
      fromBranchId: undefined,
      toBranchId: undefined,
      transferDate: '',
      expectedDeliveryDate: '',
      actualDeliveryDate: '',
      transferStatus: '',
      transferNotes: '',
    };

    const concernDetails = detail.concernDetails ?? {
      concernType: '',
      concernSubject: '',
      concernDescription: '',
      concernStatus: '',
      priority: '',
      resolutionNotes: '',
      resolvedAt: '',
      warrantySerials: '',
    };
    // If status is warranty, resolutionNotes holds the warranty serials
    (concernDetails as any).warrantySerials =
      concernDetails.concernStatus === 'warranty'
        ? (concernDetails.resolutionNotes ?? '')
        : '';
    if (concernDetails.concernStatus === 'warranty') {
      (concernDetails as any).resolutionNotes = '';
    }

    const expenseDetails = Array.isArray(detail.expenseDetails) && detail.expenseDetails.length > 0
      ? detail.expenseDetails
      : [this.createEmptyExpenseItem()];

    this.form = {
      customer_id: detail.customerId ?? '',
      totalAmount: Number(detail.totalAmount) || Number(fallbackItem.totalAmount) || 0,
      scheduleDate: this.toDateInputValue(detail.scheduleDate),
      salesType: detail.salesType || this.getSalesTypeFromActiveTab(),
      projectId: detail.projectId || undefined,
      projectName: detail.projectName ?? '',
      projectCode: detail.projectCode ?? '',
      installer: detail.installer ?? '',
      remarks: detail.remarks ?? '',
      transferDetails,
      concernDetails,
      expenseDetails,
      customer: {
        name: detail.customerName ?? fallbackItem.customerName ?? '',
        address: detail.customerAddress ?? '',
        contact_person: detail.customerContactPerson ?? '',
        contact_number: detail.customerContactNumber ?? '',
        email: detail.customerEmail ?? '',
        tin_number: detail.customerTinNumber ?? '',
      },
      paymentDetails,
      productItems,
      serviceItems,
      status: detail.status ?? fallbackItem.status ?? 'pending',
    };

    this.customerSearch = detail.customerName ?? fallbackItem.customerName ?? '';
    if (detail.customerId && !this.customerOptions.some((customer) => customer.id === detail.customerId)) {
      this.customerOptions = [
        {
          id: detail.customerId,
          name: detail.customerName || detail.customerId,
          address: detail.customerAddress ?? '',
          contact_person: detail.customerContactPerson ?? '',
          contact_number: detail.customerContactNumber ?? '',
          email: detail.customerEmail ?? '',
          tin_number: detail.customerTinNumber ?? '',
        },
        ...this.customerOptions,
      ];
    }

    this.activeProductTabIndex = 0;
    this.syncProductSearchQuery();
    this.selectedUnitTypeByProduct = {};
    this.form.productItems.forEach((_: unknown, index: number) => this.ensureSelectedUnitType(index));
    this.recalculateTotalAmount();

    // Load project details if projectId exists
    if (detail.projectId) {
      this.salesOrderService.getProjectWithRelatedSOs(detail.projectId).then((projectDetail) => {
        if (projectDetail) {
          this.selectedProjectDetails = projectDetail;
        }
      }).catch(() => {
        // Silently fail if project details cannot be loaded
      });
    }
  }

  private getAutoPaymentStatus(method: SalesPaymentFormItem['method']): string {
    if (method === 'Cash' || method === 'Bank Transfer') {
      return 'paid';
    }

    return 'unpaid';
  }

  private toPaymentMethod(value: unknown): SalesPaymentFormItem['method'] {
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

  private getDisplayPaymentStatus(payment: SalesPaymentFormItem): string {
    const autoStatus = this.getAutoPaymentStatus(payment.method);
    if (autoStatus === 'paid') {
      return 'paid';
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const isOverdueDate = (rawDate?: string | null): boolean => {
      if (!rawDate) {
        return false;
      }

      const parsed = new Date(String(rawDate));
      if (Number.isNaN(parsed.getTime())) {
        return false;
      }

      parsed.setHours(0, 0, 0, 0);
      return parsed < today;
    };

    if ((payment.method === 'Terms' || payment.method === 'Terms with DP') && isOverdueDate(payment.termsDueDate)) {
      return 'overdue';
    }

    if (payment.method === 'Cheque' && isOverdueDate(payment.postDated)) {
      return 'overdue';
    }

    return 'unpaid';
  }

  private syncPaymentAmounts(): void {
    const computedAmount = Number(this.form.totalAmount) || 0;
    this.form.paymentDetails = this.form.paymentDetails.map((payment: SalesPaymentFormItem) => {
      const nextPayment: SalesPaymentFormItem = {
        ...payment,
        amount: computedAmount,
      };

      return {
        ...nextPayment,
        status: this.getDisplayPaymentStatus(nextPayment),
      };
    });
  }

  private toDateInputValue(value: string | null | undefined): string {
    if (!value) return '';

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private async loadReferenceData(): Promise<void> {
    try {
      const products = await this.salesOrderService.getProducts();
      this.catalogProducts = Array.isArray(products) ? products : [];
      this.syncProductSearchQuery();
    } catch {
      this.catalogProducts = [];
      this.syncProductSearchQuery();
    }

    try {
      const branches = await this.salesOrderService.getBranches();
      this.branchOptions = Array.isArray(branches) ? branches : [];
    } catch {
      this.branchOptions = [];
    }
  }

  private async loadCustomerOptions(search?: string): Promise<void> {
    try {
      const customers = await this.salesOrderService.getCustomers(search);
      this.customerOptions = Array.isArray(customers) ? customers : [];
    } catch {
      this.customerOptions = [];
    }
  }

  private getSalesTypeFromActiveTab(): string {
    if (this.activeTab === 'schedules') return 'sales';
    if (this.activeTab === 'services') return 'service';
    if (this.activeTab === 'projects') return 'project';
    if (this.activeTab === 'distribution') return 'sub-dealer';
    if (this.activeTab === 'sales-receivable') return 'sales';
    if (this.activeTab === 'remitted-sales') return 'sales';
    return 'sales';
  }

  private getDefaultStatusFromActiveTab(): string {
    if (this.activeTab === 'services') return 'after_sales';
    return 'pending';
  }

  private queueSerialScan(scan: QueuedSalesSerialScan): void {
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
      const response = await this.salesOrderService.scanSalesSerialBatch({
        items: batch.map((entry) => ({
          serialNumber: entry.serialNumber,
          salesId: entry.salesId,
          expectedProductId: entry.productId,
          expectedCapacityId: entry.capacityId,
          expectedUnitType: entry.unitLabel,
        })),
      });

      const results = Array.isArray(response.items) ? response.items : [];
      const warningStatuses = ['not_found', 'warning_defective', 'warning_mismatch', 'warning_reassignment'];

      batch.forEach((entry, index) => {
        const result = results[index];
        const unitEntry = this.getUnitEntryForBatch(entry.productIndex, entry.unitLabel);
        if (!unitEntry) {
          return;
        }

        // Check if this item has a validation warning that requires user confirmation
        if (!result?.success && result?.validationStatus && warningStatuses.includes(result.validationStatus)) {
          // Remove the optimistic local serial; it will be re-added if user confirms
          this.removeLocalSerial(unitEntry, entry.serialNumber);
          unitEntry.scanError = '';
          unitEntry.scanSuccess = '';
          unitEntry.scanInfo = '';

          // Queue the warning for sequential user presentation
          this.pendingValidationWarnings.push({
            serialNumber: entry.serialNumber,
            productIndex: entry.productIndex,
            unitLabel: entry.unitLabel,
            validationStatus: result.validationStatus,
            details: (result.details as Record<string, unknown>) ?? {},
            salesId: entry.salesId,
            productId: entry.productId,
            capacityId: entry.capacityId,
          });
          return;
        }

        if (!result?.success) {
          this.removeLocalSerial(unitEntry, entry.serialNumber);
          unitEntry.scanError = result?.message ?? 'Failed to save serial number';
          unitEntry.scanSuccess = '';
          unitEntry.scanInfo = '';
          void this.auditLogService.createAuditLog({
            action: 'SERIAL_SCAN_FAILURE',
            entityType: 'SalesOrder',
            entityId: entry.salesId,
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

        // Display informational message for scanned-status serial reassignment
        if (
          result.validationStatus === 'info_scanned_status' &&
          result.details?.['previousPoNumber']
        ) {
          unitEntry.scanInfo = `Serial reassigned from PO ${result.details['previousPoNumber']}`;
          unitEntry.scanSuccess = '';
        } else {
          unitEntry.scanInfo = '';
          unitEntry.scanSuccess =
            response.summary && response.summary.successCount > 1
              ? `${response.summary.successCount} serial numbers saved`
              : result.message ?? 'Serial number saved successfully';
        }
      });

      // After processing all batch items, present any queued warnings to the user
      if (this.pendingValidationWarnings.length > 0 && !this.isValidationModalOpen) {
        this.presentNextValidationWarning();
      }

      // Only show error modal for genuine hard failures (not validation warnings handled by modals)
      const hardFailureCount = (response.summary?.failureCount ?? 0);
      if (!response.success && hardFailureCount > 0) {
        this.openErrorModal('Scan Failed', response.message ?? 'Some serial numbers failed to save.');
      }

      return true;
    } catch (error: unknown) {
      this.queuedSerialScans = [...batch, ...this.queuedSerialScans];
      let errorMessage = 'Failed to save scanned serial numbers. Retrying automatically.';
      this.setBatchScanError(batch, 'Failed to save serial numbers. They remain queued.');

      if (axios.isAxiosError(error)) {
        errorMessage =
          (error.response?.data as { message?: string } | undefined)?.message ?? errorMessage;
      }

      this.openErrorModal('Scan Error', errorMessage);
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

  private setBatchScanningState(batch: QueuedSalesSerialScan[], isScanning: boolean): void {
    const visited = new Set<string>();
    for (const entry of batch) {
      const key = `${entry.productIndex}::${entry.unitLabel}`;
      if (visited.has(key)) {
        continue;
      }

      visited.add(key);
      const unitEntry = this.getUnitEntryForBatch(entry.productIndex, entry.unitLabel);
      if (unitEntry) {
        unitEntry.isScanning = isScanning;
      }
    }
  }

  private setBatchScanError(batch: QueuedSalesSerialScan[], message: string): void {
    const visited = new Set<string>();
    for (const entry of batch) {
      const key = `${entry.productIndex}::${entry.unitLabel}`;
      if (visited.has(key)) {
        continue;
      }

      visited.add(key);
      const unitEntry = this.getUnitEntryForBatch(entry.productIndex, entry.unitLabel);
      if (unitEntry) {
        unitEntry.scanError = message;
        unitEntry.scanSuccess = '';
        unitEntry.scanInfo = '';
      }
    }
  }

  private getUnitEntryForBatch(productIndex: number, unitLabel: string): SalesUnitTypeFormItem | null {
    const item = this.form.productItems[productIndex];
    if (!item) {
      return null;
    }

    return item.unitTypes.find((entry: SalesUnitTypeFormItem) => entry.label === unitLabel) ?? null;
  }

  private removeLocalSerial(unitEntry: SalesUnitTypeFormItem, serialNumber: string): void {
    unitEntry.serials = unitEntry.serials.filter(
      (s: string) => this.normalizeSerial(s).toLowerCase() !== this.normalizeSerial(serialNumber).toLowerCase(),
    );
  }

  private replaceLocalSerial(
    unitEntry: SalesUnitTypeFormItem,
    oldSerial: string,
    newSerial: string,
  ): void {
    const normalizedOld = this.normalizeSerial(oldSerial).toLowerCase();
    unitEntry.serials = unitEntry.serials.map((s: string) =>
      this.normalizeSerial(s).toLowerCase() === normalizedOld ? newSerial : s,
    );
  }

  private normalizeSerial(value: unknown): string {
    return String(value ?? '').trim().replace(/\s+/g, ' ');
  }

  // --- Serial Validation Warning Modal Handling ---

  /**
   * Presents the next queued validation warning to the user via the modal.
   * Warnings are processed sequentially, one at a time.
   */
  private presentNextValidationWarning(): void {
    if (this.pendingValidationWarnings.length === 0) {
      this.currentValidationWarning = null;
      this.isValidationModalOpen = false;
      this.validationModalMode = null;
      this.validationModalDetails = {};
      return;
    }

    const warning = this.pendingValidationWarnings[0];
    this.currentValidationWarning = warning;
    this.validationModalMode = this.mapValidationStatusToModalMode(warning.validationStatus);
    this.validationModalDetails = {
      serialNumber: warning.serialNumber,
      expectedProductName: warning.details['expectedProductName'] as string | undefined,
      expectedCapacityName: warning.details['expectedCapacityName'] as string | undefined,
      actualProductName: warning.details['actualProductName'] as string | undefined,
      actualCapacityName: warning.details['actualCapacityName'] as string | undefined,
      currentCustomerName: warning.details['currentCustomerName'] as string | undefined,
      currentSoNumber: warning.details['currentSoNumber'] as string | undefined,
      currentSalesId: warning.details['currentSalesId'] as number | undefined,
    };
    this.isValidationModalOpen = true;
  }

  /**
   * Maps a backend validationStatus string to the appropriate modal mode.
   */
  private mapValidationStatusToModalMode(status: string): SerialValidationModalMode {
    switch (status) {
      case 'warning_mismatch':
        return 'mismatch-warning';
      case 'warning_defective':
        return 'defective-warning';
      case 'warning_reassignment':
        return 'reassignment-warning';
      case 'not_found':
        return 'force-insert-prompt';
      default:
        return 'mismatch-warning';
    }
  }

  /**
   * Determines which force flag to set based on the current validation warning status.
   */
  private getForceFlags(status: string): { forceAssign?: boolean; forceInsert?: boolean; forceReassign?: boolean } {
    switch (status) {
      case 'warning_mismatch':
      case 'warning_defective':
        return { forceAssign: true };
      case 'not_found':
        return { forceInsert: true };
      case 'warning_reassignment':
        return { forceReassign: true };
      default:
        return {};
    }
  }

  /**
   * Called when the user confirms the validation warning modal.
   * Re-sends the serial with the appropriate force flag.
   */
  onValidationModalConfirm(): void {
    if (!this.currentValidationWarning) {
      this.presentNextValidationWarning();
      return;
    }

    const warning = this.currentValidationWarning;

    // Remove from queue
    this.pendingValidationWarnings.shift();

    // Close modal immediately before async re-send
    this.isValidationModalOpen = false;
    this.currentValidationWarning = null;

    // Re-send serial with the appropriate force flag
    const forceFlags = this.getForceFlags(warning.validationStatus);
    void this.resendSerialWithForce(warning, forceFlags);

    // Present the next warning (if any) after a brief delay for UX
    setTimeout(() => {
      this.presentNextValidationWarning();
    }, 200);
  }

  /**
   * Called when the user cancels the validation warning modal.
   * Discards the serial from the queue and refocuses scan input.
   */
  onValidationModalCancel(): void {
    if (!this.currentValidationWarning) {
      this.presentNextValidationWarning();
      return;
    }

    const warning = this.currentValidationWarning;

    // Remove from queue
    this.pendingValidationWarnings.shift();

    // Close modal
    this.isValidationModalOpen = false;
    this.currentValidationWarning = null;

    // Refocus the scan input for the relevant product/unit type
    this.focusSerialScanInput(warning.productIndex, warning.unitLabel);

    // Present the next warning (if any) after a brief delay
    setTimeout(() => {
      this.presentNextValidationWarning();
    }, 200);
  }

  /**
   * Re-sends a single serial scan with force flags via the batch API.
   */
  private async resendSerialWithForce(
    warning: PendingValidationWarning,
    forceFlags: { forceAssign?: boolean; forceInsert?: boolean; forceReassign?: boolean },
  ): Promise<void> {
    const unitEntry = this.getUnitEntryForBatch(warning.productIndex, warning.unitLabel);

    try {
      const response = await this.salesOrderService.scanSalesSerialBatch({
        items: [
          {
            serialNumber: warning.serialNumber,
            salesId: warning.salesId,
            expectedProductId: warning.productId,
            expectedCapacityId: warning.capacityId,
            expectedUnitType: warning.unitLabel,
            ...forceFlags,
          },
        ],
      });

      const result = response.items?.[0];
      if (result?.success) {
        // Re-add serial to the local list on success
        const normalizedSerial = this.normalizeSerial(result.item?.serialNumber ?? warning.serialNumber);
        if (unitEntry) {
          unitEntry.serials = [...unitEntry.serials, normalizedSerial];
          unitEntry.scanError = '';
          unitEntry.scanInfo = '';
          unitEntry.scanSuccess = result.message ?? 'Serial number saved successfully';
        }
      } else {
        // Force re-send still failed, treat as a rejected scan
        if (unitEntry) {
          unitEntry.scanError = result?.message ?? 'Force scan failed';
          unitEntry.scanSuccess = '';
          unitEntry.scanInfo = '';
        }
        this.rejectedScanCount++;
        this.rejectedScanList.push({
          serialNumber: warning.serialNumber,
          reason: result?.message ?? 'Force scan failed after confirmation',
          timestamp: new Date(),
        });
      }
    } catch {
      // Network error during force re-send
      if (unitEntry) {
        unitEntry.scanError = 'Failed to save serial after confirmation. Please try scanning again.';
        unitEntry.scanSuccess = '';
        unitEntry.scanInfo = '';
      }
      this.rejectedScanCount++;
      this.rejectedScanList.push({
        serialNumber: warning.serialNumber,
        reason: 'Network error during force re-send',
        timestamp: new Date(),
      });
    }
  }

  openDatePicker(event: Event): void {
    const input = event.target as (HTMLInputElement & { showPicker?: () => void }) | null;
    if (!input || input.type !== 'date') {
      return;
    }

    if (typeof input.showPicker === 'function') {
      try {
        input.showPicker();
      } catch {
      }
    }
  }

  formatAmount(value: number): string {
    return new Intl.NumberFormat('en-PH', {
      style: 'currency',
      currency: 'PHP',
      minimumFractionDigits: 2,
    }).format(value ?? 0);
  }

  formatDate(value: string | null | undefined): string {
    if (!value) {
      return '-';
    }

    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
  }

  formatDateOnly(value: string | null | undefined): string {
    if (!value) {
      return '-';
    }

    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? value
      : date.toLocaleDateString('en-PH', {
          year: 'numeric',
          month: 'short',
          day: '2-digit',
        });
  }
}
