import { CommonModule } from '@angular/common';
import { Component, HostListener, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { PageBreadcrumbComponent } from '../../shared/components/common/page-breadcrumb/page-breadcrumb.component';
import {
  ProductCapacityOption,
  ProductOption,
  SalesCustomerOption,
  SalesOrderConcernDetailsPayload,
  SalesOrderDetailItem,
  SalesOrderDetailProductItem,
  SalesOrderDetailUnitType,
  SalesOrderExpenseDetailsPayload,
  SalesOrderListItem,
  SalesOrderPayload,
  SalesOrderService,
  SalesOrderTransferDetailsPayload,
} from '../../shared/services/sales-order.service';
import { MaterialTransactionItem } from '../../shared/services/sales-order-material.service';
import { RbacService } from '../../shared/services/rbac.service';
import {
  BusinessProfileSettings,
  BusinessSettingsService,
} from '../../shared/services/business-settings.service';
import axios from 'axios';
import { PDFDocument, PDFFont, StandardFonts, rgb } from 'pdf-lib';

type SalesTab =
  | 'schedules'
  | 'services'
  | 'projects'
  | 'distribution'
  | 'sales-receivable'
  | 'remitted-sales';

interface SalesOrderRow {
  id: number;
  soNumber: string;
  customerName: string;
  totalAmount: number;
  status: string;
  salesType: string;
  projectCode?: string;
  projectName?: string;
  scheduleDate: string;
  serialCount?: number;
  createdAt?: string | null;
}

interface SalesUnitTypeFormItem {
  label: string;
  value: number;
  serials: string[];
  serialInput: string;
  scanInput: string;
  scanError: string;
  scanSuccess: string;
  isScanning: boolean;
}

interface SalesProductFormItem {
  productId: string;
  capacityId: string;
  unitPrice: number;
  sellPrice: number | '';
  discountPrice: number | '';
  unitTypes: SalesUnitTypeFormItem[];
  totalSetQty: number;
}
interface SalesServiceFormItem {
  serviceName: string;
  unitPrice: number;
  qty: number;
  total: number;
}

interface SalesPaymentFormItem {
  method: 'Cash' | 'Bank Transfer' | 'Terms' | 'Terms with DP' | 'Cheque' | 'Credit Card' | 'Installment';
  amount: number;
  terms: string;
  termsDueDate: string;
  autoTermsDueDate: boolean;
  status: string;
  referenceNo: string;
  paymentDate: string;
  issuedBy: string;
  ccCharge: string;
  checkNo: string;
  bankName: string;
  bankAccount: string;
  postDated: string;
  downPayment: number;
}

type SalesGuardDialogMode = 'close-confirm' | 'refresh-confirm' | 'remove-serial-confirm';

interface SalesPendingSerialRemoval {
  productIndex: number;
  unitLabel: string;
  serialNumber: string;
}

@Component({
  selector: 'app-sales-order',
  imports: [CommonModule, FormsModule, PageBreadcrumbComponent],
  templateUrl: './sales-order.component.html',
  styles: ``,
})
export class SalesOrderComponent implements OnInit, OnDestroy {
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
    private readonly route: ActivatedRoute,
    private readonly sanitizer: DomSanitizer,
    private readonly rbacService: RbacService,
  ) {}

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
  private serialScanTimers: Record<string, ReturnType<typeof setTimeout>> = {};
  private serialScanErrorTimers: Record<string, ReturnType<typeof setTimeout>> = {};

  orders: SalesOrderRow[] = [];
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
  guardDialogMode: SalesGuardDialogMode | null = null;
  isGuardDialogOpen = false;
  pendingSerialRemoval: SalesPendingSerialRemoval | null = null;
  pendingRefreshEvent: BeforeUnloadEvent | null = null;
  editingSalesId: number | null = null;
  customerMode: 'existing' | 'new' = 'existing';
  uiMessage = '';
  uiError = '';
  isSubmitting = false;
  isRemitting = false;
  customerOptions: SalesCustomerOption[] = [];
  customerSearch = '';
  isCustomerDropdownOpen = false;
  catalogProducts: ProductOption[] = [];
  activeProductTabIndex = 0;
  activeServiceTabIndex = 0;
  readonly serialsPerPage = 10;
  serialPageByUnitType: Record<string, number> = {};
  selectedUnitTypeByProduct: Record<number, string> = {};
  private drawerBaselineSnapshot = '';
  materialItems: MaterialTransactionItem[] = [];
  branchOptions: Array<{ id: number; branchName: string }> = [];
  activeExpenseTabIndex = 0;

  form: any = {
    customer_id: '',
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

  getFilteredCustomerOptions(): SalesCustomerOption[] {
    const normalizedQuery = String(this.customerSearch ?? '').trim().toLowerCase();
    if (!normalizedQuery) {
      return this.customerOptions;
    }

    return this.customerOptions.filter((item) =>
      String(item.name ?? '').toLowerCase().includes(normalizedQuery),
    );
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

    const rawRemarks = window.prompt('Enter reason for returned units:');
    if (rawRemarks === null) {
      return;
    }

    const remarks = rawRemarks.trim();
    if (!remarks) {
      this.uiError = 'Return remarks are required.';
      return;
    }

    this.returningOrderIds.add(order.id);
    this.uiError = '';

    try {
      const response = await this.salesOrderService.updateSalesOrder(order.id, {
        productItems: [],
        status: 'pending',
        remarks: `Returned Units: ${remarks}`,
      });

      if (!response.success) {
        this.uiError = response.message ?? 'Failed to mark sales order as returned';
        return;
      }

      this.uiMessage = 'Returned units has been recorded and status moved back to Pending.';
      await this.loadTabData(this.activeTab);
    } catch (error: unknown) {
      if (axios.isAxiosError(error)) {
        this.uiError =
          (error.response?.data as { message?: string } | undefined)?.message ??
          'Failed to mark sales order as returned';
      } else {
        this.uiError = 'Failed to mark sales order as returned';
      }
    } finally {
      this.returningOrderIds.delete(order.id);
    }
  }

  async markOrderAsReceived(order: SalesOrderRow): Promise<void> {
    if (this.activeTab !== 'sales-receivable' || this.receivingOrderIds.has(order.id)) {
      return;
    }

    const confirmed = window.confirm(
      `Mark sales order ${order.soNumber || order.id} as received/complete?`,
    );
    if (!confirmed) {
      return;
    }

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
        this.uiError = response.message ?? 'Failed to mark sales order as received';
        return;
      }

      this.uiMessage = 'Sales order marked as received successfully.';
      await this.loadTabData(this.activeTab);
    } catch (error: unknown) {
      if (axios.isAxiosError(error)) {
        this.uiError =
          (error.response?.data as { message?: string } | undefined)?.message ??
          'Failed to mark sales order as received';
      } else {
        this.uiError = 'Failed to mark sales order as received';
      }
    } finally {
      this.receivingOrderIds.delete(order.id);
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
        this.uiError = 'Failed to load sales order details for DR printing';
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
      if (axios.isAxiosError(error)) {
        this.uiError =
          (error.response?.data as { message?: string } | undefined)?.message ??
          'Failed to print Delivery Receipt';
      } else if (error instanceof Error) {
        this.uiError = error.message;
      } else {
        this.uiError = 'Failed to print Delivery Receipt';
      }
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
        status: this.form.status || 'pending',
        salesType: this.form.salesType || '',
        scheduleDate: this.form.scheduleDate || '',
        serialCount: 0,
        createdAt: null,
      };

    await this.printDeliveryReceipt(row);
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

    this.drawDrTemplateHeader(page, row, detail, regularFont, width, height);

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

  private drawDrTemplateHeader(
    page: ReturnType<PDFDocument['getPages']>[number],
    row: SalesOrderRow,
    detail: SalesOrderDetailItem,
    font: PDFFont,
    width: number,
    height: number,
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
      return;
    }

    page.drawText(address, { x: 110, y: height - 160, size: 10, font });
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
    this.drawerMode = 'create';
    this.editingSalesId = null;
    this.form.salesType = this.getSalesTypeFromActiveTab();
    this.isDrawerOpen = true;
    this.serialPageByUnitType = {};
    this.uiMessage = '';
    this.uiError = '';
    this.captureDrawerBaselineSnapshot();
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
        status: 'pending',
        salesType: '',
        scheduleDate: '-',
        serialCount: 0,
        createdAt: null,
      };

    this.resetForm();
    this.drawerMode = 'edit';
    this.editingSalesId = orderId;
    this.isDrawerOpen = true;
    this.serialPageByUnitType = {};
    this.uiMessage = '';
    this.uiError = '';

    try {
      const detail = await this.salesOrderService.getSalesOrderById(orderId);
      if (!detail) {
        this.uiError = 'Failed to load sales order details';
        return;
      }

      this.applyDetailToForm(detail, fallback);
      this.captureDrawerBaselineSnapshot();
    } catch (error: unknown) {
      if (axios.isAxiosError(error)) {
        this.uiError =
          (error.response?.data as { message?: string } | undefined)?.message ??
          'Failed to load sales order details';
      } else if (error instanceof Error) {
        this.uiError = error.message;
      } else {
        this.uiError = 'Failed to load sales order details';
      }
    }
  }

  closeDrawer(forceClose = false): void {
    if (!forceClose && this.hasUnsavedDrawerChanges()) {
      this.openGuardDialog('close-confirm');
      return;
    }

    this.isDrawerOpen = false;
    this.closeGuardDialog();
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

    return 'Close sales order?';
  }

  getGuardDialogMessage(): string {
    if (this.guardDialogMode === 'remove-serial-confirm') {
      return 'Are you sure you want to remove this serial number?';
    }

    if (this.guardDialogMode === 'refresh-confirm') {
      return 'You have unsaved changes. Refreshing will discard all unsaved updates.';
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

    return 'Close Drawer';
  }

  getGuardDialogCancelText(): string {
    if (this.guardDialogMode === 'remove-serial-confirm') {
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
      totalAmount: Number(item.totalAmount ?? 0),
      status: item.status ?? 'pending',
      salesType: item.salesType ?? '',
      projectCode: item.projectCode ?? '',
      projectName: item.projectName ?? '',
      scheduleDate: item.scheduleDate ?? '-',
      serialCount: Number(item.serialCount ?? 0),
      createdAt: item.createdAt ?? null,
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

      this.orders = this.mapListItemsToRows(result.items);
      this.applyMeta(result.meta);
    } catch (error: unknown) {
      if (axios.isAxiosError(error)) {
        this.errorMessage =
          (error.response?.data as { message?: string } | undefined)?.message ??
          'Unable to load sales orders';
      } else {
        this.errorMessage = 'Unable to load sales orders';
      }
      this.orders = [];
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

    this.recalculateTotalAmount();
  }

  onTotalSetQtyChange(productIndex: number): void {
    const item = this.form.productItems[productIndex];
    if (!item) return;

    item.totalSetQty = Math.max(0, Math.floor(Number(item.totalSetQty) || 0));

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

    unitEntry.isScanning = true;

    try {
      const response = await this.salesOrderService.scanSalesSerial({
        serialNumber,
        salesId: this.editingSalesId,
        expectedProductId: productId,
        expectedCapacityId: capacityId,
        expectedUnitType: unitLabel,
      });

      if (!response.success) {
        unitEntry.scanError = response.message ?? 'Failed to scan serial number';
        return;
      }

      const normalizedSerial = this.normalizeSerial(response.item?.serialNumber ?? serialNumber);
      const existingSerialsLower = new Set(
        unitEntry.serials.map((entry: string) => this.normalizeSerial(entry).toLowerCase()),
      );

      if (!existingSerialsLower.has(normalizedSerial.toLowerCase())) {
        unitEntry.serials = [...unitEntry.serials, normalizedSerial];
        this.changeSerialPage(
          productIndex,
          unitLabel,
          this.getTotalSerialPages(productIndex, unitLabel),
        );
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
    if (this.isSubmitting) {
      return;
    }

    const salesType = this.form.salesType;

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

    if (['service', 'sales and service'].includes(salesType)) {
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
    this.uiError = '';
    this.uiMessage = '';
    this.isSubmitting = true;

    try {
      if (this.drawerMode === 'create') {
        const response = await this.salesOrderService.createSalesOrder(payload);
        if (!response.success) {
          this.uiError = response.message ?? 'Failed to create sales order';
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
          this.uiError = response.message ?? 'Failed to update sales order';
          return;
        }
        this.uiMessage = response.message ?? 'Sales order updated successfully';
      }

      this.closeDrawer(true);
      this.page = 1;
      await this.loadTabData(this.activeTab);
    } catch (error: unknown) {
      if (axios.isAxiosError(error)) {
        this.uiError =
          (error.response?.data as { message?: string } | undefined)?.message ??
          'Failed to submit sales order';
      } else {
        this.uiError = 'Failed to submit sales order';
      }
    } finally {
      this.isSubmitting = false;
    }
  }

  async remitSales(): Promise<void> {
    if (this.drawerMode !== 'edit' || this.isRemitting || this.isSubmitting) {
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
        this.uiError = response.message ?? 'Failed to remit sales';
        return;
      }

      this.uiMessage = response.message ?? 'Sales remitted successfully';
      this.closeDrawer(true);
      this.page = 1;
      await this.loadTabData(this.activeTab);
    } catch (error: unknown) {
      if (axios.isAxiosError(error)) {
        this.uiError =
          (error.response?.data as { message?: string } | undefined)?.message ??
          'Failed to remit sales';
      } else {
        this.uiError = 'Failed to remit sales';
      }
    } finally {
      this.isRemitting = false;
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
        resolutionNotes: String(cd.resolutionNotes ?? '').trim() || undefined,
        resolvedAt: cd.resolvedAt || undefined,
      };
    })();

    const payload: SalesOrderPayload = {
      customer_id: this.customerMode === 'existing' ? this.form.customer_id || null : null,
      customer: customerPayload,
      totalAmount: Number(this.form.totalAmount) || 0,
      scheduleDate: this.form.scheduleDate || null,
      salesType: this.form.salesType || this.getSalesTypeFromActiveTab(),
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
          unitTypesQty: item.unitTypes.map((entry: any) => ({
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
      },
      concernDetails: {
        concernType: '',
        concernSubject: '',
        concernDescription: '',
        concernStatus: '',
        priority: '',
        resolutionNotes: '',
        resolvedAt: '',
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
        this.createUnitTypeEntry('indoor', 0, []),
        this.createUnitTypeEntry('outdoor', 0, []),
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

    const labels =
      normalizedLabelsFromPayload.length > 0
        ? normalizedLabelsFromPayload
        : normalizedLabelsFromSerial.length > 0
          ? normalizedLabelsFromSerial
          : ['set'];

    const unitTypes = labels.map((label) => {
      const serials = Array.isArray(serialNumbers[label]) ? serialNumbers[label] : [];
      return this.createUnitTypeEntry(label, resolvedSetQty, serials);
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
      detail.productItems.length > 0
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
    };

    const expenseDetails = Array.isArray(detail.expenseDetails) && detail.expenseDetails.length > 0
      ? detail.expenseDetails
      : [this.createEmptyExpenseItem()];

    this.form = {
      customer_id: detail.customerId ?? '',
      totalAmount: Number(detail.totalAmount) || Number(fallbackItem.totalAmount) || 0,
      scheduleDate: this.toDateInputValue(detail.scheduleDate),
      salesType: detail.salesType || this.getSalesTypeFromActiveTab(),
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
    this.selectedUnitTypeByProduct = {};
    this.form.productItems.forEach((_: unknown, index: number) => this.ensureSelectedUnitType(index));
    this.recalculateTotalAmount();
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
    } catch {
      this.catalogProducts = [];
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

  private normalizeSerial(value: unknown): string {
    return String(value ?? '').trim().replace(/\s+/g, ' ');
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
