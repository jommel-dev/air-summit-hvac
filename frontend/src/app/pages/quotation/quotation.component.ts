import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { PageBreadcrumbComponent } from '../../shared/components/common/page-breadcrumb/page-breadcrumb.component';
import { ProductOption, SalesCustomerOption } from '../../shared/services/sales-order.service';
import {
  BusinessProfileSettings,
  BusinessSettingsService,
} from '../../shared/services/business-settings.service';
import {
  QuotationDetailItem,
  QuotationListItem,
  QuotationPayload,
  QuotationService,
  QuotationTermsConditions,
} from '../../shared/services/quotation.service';
import { RbacService } from '../../shared/services/rbac.service';
import axios from 'axios';

type QuotationTab = 'all' | 'draft' | 'finalized' | 'converted' | 'expired';

interface InstallationDetailFormItem {
  description: string;
  unitPrice: number;
  excessQty: number;
  freeQty: number;
  unit: string;
}

interface QuotationProductFormItem {
  productId: string;
  capacityId: string;
  unitPrice: number;
  sellPrice: number | '';
  discountPrice: number | '';
  totalSetQty: number;
  grouping: string;
  installationDetails: InstallationDetailFormItem[];
  remarks: string;
}

interface QuotationPreviewPdfRow {
  groupName: string;
  model: string;
  description: string;
  capacity: string;
  qty: number;
  discPrice: number;
  miscTotal: number;
  lineTotal: number;
}

interface QuotationPreviewMiscRow {
  groupName: string;
  model: string;
  description: string;
  unitPrice: number;
  excessQty: number;
  amount: number;
}

interface QuotationPreviewPdfData {
  quoteNo: string;
  quoteDate: string | null | undefined;
  customerName: string;
  customerContactPerson: string;
  customerContactNumber: string;
  customerAddress: string;
  totalAmount: number;
  rows: QuotationPreviewPdfRow[];
  miscRows: QuotationPreviewMiscRow[];
}

interface QuotationHeaderProfile {
  businessName: string;
  addressDetails: string;
  contactDetails: string;
  emailDetails: string;
  logoSrc: string | null;
}

@Component({
  selector: 'app-quotation',
  imports: [CommonModule, FormsModule, PageBreadcrumbComponent],
  templateUrl: './quotation.component.html',
})
export class QuotationComponent implements OnInit, OnDestroy {
  constructor(
    private readonly quotationService: QuotationService,
    private readonly businessSettingsService: BusinessSettingsService,
    private readonly rbacService: RbacService,
    private readonly sanitizer: DomSanitizer,
  ) {}

  private businessProfileSettings: BusinessProfileSettings | null = null;

  activeTab: QuotationTab = 'all';
  search = '';
  page = 1;
  limit = 10;
  total = 0;
  totalPages = 1;
  isLoading = false;
  errorMessage = '';
  uiMessage = '';
  uiError = '';

  isDrawerOpen = false;
  drawerMode: 'create' | 'edit' = 'create';
  editingQuotationId: number | null = null;
  customerMode: 'existing' | 'new' = 'existing';
  customerSearch = '';
  isCustomerDropdownOpen = false;

  quotations: QuotationListItem[] = [];
  customerOptions: SalesCustomerOption[] = [];
  catalogProducts: ProductOption[] = [];

  isSubmitting = false;
  finalizingIds = new Set<number>();
  convertingIds = new Set<number>();
  deletingIds = new Set<number>();
  isQuotationPreviewOpen = false;
  quotationPreviewUrl: SafeResourceUrl | null = null;
  quotationPreviewFilename = 'Quotation-Preview.pdf';
  private quotationPreviewObjectUrl: string | null = null;
  private quotationPreviewPdfData: QuotationPreviewPdfData | null = null;
  readonly groupingSuggestions = ['FOOD HALL', 'TOILET', 'STORAGE', 'ADMIN', 'OFFICE', 'KITCHEN', 'DINING AREA', 'MEETING ROOM'];

  form = {
    quoteDate: this.getDefaultQuoteDate(),
    validityDays: 14,
    customer_id: '',
    customer: {
      name: '',
      address: '',
      contact_person: '',
      contact_number: '',
      email: '',
      tin_number: '',
    },
    productItems: [this.createEmptyProductItem()],
    totalAmount: 0,
    remarks: '',
    status: 'draft',
    termsConditions: this.createDefaultTermsConditions(),
  };

  private getDefaultQuoteDate(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }

  private createEmptyProductItem(): QuotationProductFormItem {
    return {
      productId: '',
      capacityId: '',
      unitPrice: 0,
      sellPrice: '',
      discountPrice: '',
      totalSetQty: 1,
      grouping: '',
      installationDetails: [this.createEmptyInstallationDetail()],
      remarks: '',
    };
  }

  private createEmptyInstallationDetail(): InstallationDetailFormItem {
    return {
      description: 'FREE INSTALLATION FOR 1st 10 FT Back to Back',
      unitPrice: 0,
      excessQty: 0,
      freeQty: 10,
      unit: 'FT',
    };
  }

  private createDefaultTermsConditions(): QuotationTermsConditions {
    return {
      warrantyException:
        '(1) Actual cancellation of the service request / repair on the committed schedule due to unavailable working permit in the site or an incorrect service request\n' +
        '(2) The unit diagnose as NO Detect Found(NDP) (e.g. power supply issue, loose cable, for general cleaning only)\n' +
        '(3) The damage was caused by mishandling (e.g) improper installation/ physical or impact damage\n' +
        '(4) The unit was serviced, altered and/ or tampered by non-accredited installers or service centers that led to malfunction or failure of the operation',
      validity:
        'Quotation only valid 14 days upon issued\n' +
        'Free delivery within Pampanga, please contact us regarding your location, and we will be happy to assist you with queries',
      note:
        '(1) An authorized dealer shall have Accreditation Certificate from AIRSUMMIT AIRCON AND REFRIGERATIONS SERVICES to maintain equipments Full Warranty\n' +
        '(2) Any damage units while at the custody of the client will not be shouldered by AIRSUMMIT AIRCON AND REFRIGERATIONS SERVICES\n' +
        '(3) This quotation serves as the sales contract when duly signed by the customer.',
      penaltyFee:
        '20% cancellation fee of the total amount of the conforme contract will be applied.\n' +
        'ADDITIONAL 4% PENALTY FOR LATE PAYMENT',
      warranty:
        'One(1) Year Warranty on Parts / One (1) Service except cleaning\n' +
        'Five(5) Years Warranty Compressor under normal usage',
    };
  }

  ngOnInit(): void {
    void this.loadQuotations();
    void this.loadReferenceData();
    void this.loadCustomerOptions();
    void this.loadBusinessProfileSettings();
  }

  ngOnDestroy(): void {
    this.revokeQuotationPreviewUrl();
  }

  getTabs(): Array<{ key: QuotationTab; label: string }> {
    return [
      { key: 'all', label: 'All' },
      { key: 'draft', label: 'Draft' },
      { key: 'finalized', label: 'Finalized' },
      { key: 'converted', label: 'Converted' },
      { key: 'expired', label: 'Expired' },
    ];
  }

  canCreateQuotation(): boolean {
    return this.rbacService.canAccess('quotation', 'canCreate');
  }

  canEditQuotation(): boolean {
    return this.rbacService.canAccess('quotation', 'canUpdate');
  }

  canFinalizeQuotation(): boolean {
    return this.rbacService.canAccess('quotation', 'canUpdate');
  }

  canConvertQuotation(): boolean {
    return this.rbacService.canAccess('quotation', 'canUpdate');
  }

  canPermanentlyDeleteExpiredQuotation(): boolean {
    const roleName = String(this.rbacService.getPayload()?.roleName ?? '').trim().toLowerCase();
    return roleName.includes('admin') || roleName.includes('super') || roleName.includes('owner');
  }

  async setTab(tab: QuotationTab): Promise<void> {
    if (this.activeTab === tab) {
      return;
    }

    this.activeTab = tab;
    this.page = 1;
    await this.loadQuotations();
  }

  async onSearchChange(value: string): Promise<void> {
    this.search = value;
    this.page = 1;
    await this.loadQuotations();
  }

  async onPageChange(nextPage: number): Promise<void> {
    if (nextPage < 1 || nextPage > this.totalPages || nextPage === this.page) {
      return;
    }

    this.page = nextPage;
    await this.loadQuotations();
  }

  async loadQuotations(): Promise<void> {
    this.isLoading = true;
    this.errorMessage = '';

    try {
      const response = await this.quotationService.listQuotations({
        page: this.page,
        limit: this.limit,
        search: this.search.trim() || undefined,
        status: this.activeTab === 'all' ? undefined : this.activeTab,
      });

      this.quotations = response.items;
      this.page = response.meta.page;
      this.limit = response.meta.limit;
      this.total = response.meta.total;
      this.totalPages = Math.max(1, response.meta.totalPages);
    } catch (error: unknown) {
      this.quotations = [];
      this.total = 0;
      this.totalPages = 1;

      if (axios.isAxiosError(error)) {
        this.errorMessage =
          (error.response?.data as { message?: string } | undefined)?.message ??
          'Unable to load quotations';
      } else {
        this.errorMessage = 'Unable to load quotations';
      }
    } finally {
      this.isLoading = false;
    }
  }

  async loadReferenceData(): Promise<void> {
    try {
      this.catalogProducts = await this.quotationService.getProducts();
    } catch {
      this.catalogProducts = [];
    }
  }

  async loadCustomerOptions(search?: string): Promise<void> {
    try {
      this.customerOptions = await this.quotationService.getCustomers(search);
    } catch {
      this.customerOptions = [];
    }
  }

  openCreateDrawer(): void {
    this.drawerMode = 'create';
    this.editingQuotationId = null;
    this.customerMode = 'existing';
    this.customerSearch = '';
    this.form = {
      quoteDate: this.getDefaultQuoteDate(),
      validityDays: 14,
      customer_id: '',
      customer: {
        name: '',
        address: '',
        contact_person: '',
        contact_number: '',
        email: '',
        tin_number: '',
      },
      productItems: [this.createEmptyProductItem()],
      totalAmount: 0,
      remarks: '',
      status: 'draft',
      termsConditions: this.createDefaultTermsConditions(),
    };

    this.uiMessage = '';
    this.uiError = '';
    this.isDrawerOpen = true;
  }

  async openEditDrawer(item: QuotationListItem): Promise<void> {
    this.drawerMode = 'edit';
    this.editingQuotationId = item.id;
    this.uiMessage = '';
    this.uiError = '';
    this.isDrawerOpen = true;

    const detail = await this.quotationService.getQuotationById(item.id);
    if (!detail) {
      this.uiError = 'Unable to load quotation details';
      return;
    }

    this.applyDetailToForm(detail);
  }

  closeDrawer(): void {
    this.isDrawerOpen = false;
  }

  private parseItemMeta(rawRemarks: string): {
    itemRemarks: string;
    grouping: string;
    installationDetails: InstallationDetailFormItem[];
  } {
    const fallback = {
      itemRemarks: rawRemarks || '',
      grouping: '',
      installationDetails: [this.createEmptyInstallationDetail()],
    };

    const remarks = String(rawRemarks ?? '');
    if (!remarks.startsWith('__QMETA__')) {
      return fallback;
    }

    try {
      const payload = JSON.parse(remarks.replace('__QMETA__', '').trim()) as {
        itemRemarks?: string;
        grouping?: string;
        installationDetails?: InstallationDetailFormItem[];
      };

      return {
        itemRemarks: String(payload.itemRemarks ?? '').trim(),
        grouping: String(payload.grouping ?? '').trim(),
        installationDetails:
          Array.isArray(payload.installationDetails) && payload.installationDetails.length > 0
            ? payload.installationDetails.map((detail) => ({
                description: String(detail.description ?? '').trim(),
                unitPrice: Number(detail.unitPrice ?? 0),
                excessQty: Number(detail.excessQty ?? 0),
                freeQty: Number(detail.freeQty ?? 0),
                unit: String(detail.unit ?? 'FT').trim() || 'FT',
              }))
            : [this.createEmptyInstallationDetail()],
      };
    } catch {
      return fallback;
    }
  }

  private serializeItemMeta(item: QuotationProductFormItem): string {
    return `__QMETA__ ${JSON.stringify({
      itemRemarks: String(item.remarks ?? '').trim(),
      grouping: String(item.grouping ?? '').trim(),
      installationDetails: (item.installationDetails ?? []).map((detail) => ({
        description: String(detail.description ?? '').trim(),
        unitPrice: Number(detail.unitPrice ?? 0),
        excessQty: Number(detail.excessQty ?? 0),
        freeQty: Number(detail.freeQty ?? 0),
        unit: String(detail.unit ?? 'FT').trim() || 'FT',
      })),
    })}`;
  }

  private applyDetailToForm(detail: QuotationDetailItem): void {
    this.customerSearch = detail.customerName;
    this.customerMode = detail.customerId ? 'existing' : 'new';

    this.form = {
      quoteDate: this.toDateInputValue(detail.quoteDate) || this.getDefaultQuoteDate(),
      validityDays: Number(detail.validityDays ?? 14) > 0 ? Number(detail.validityDays ?? 14) : 14,
      customer_id: String(detail.customerId ?? ''),
      customer: {
        name: detail.customerName,
        address: detail.customerAddress,
        contact_person: detail.customerContactPerson,
        contact_number: detail.customerContactNumber,
        email: detail.customerEmail,
        tin_number: detail.customerTinNumber,
      },
      productItems:
        detail.productItems.length > 0
          ? detail.productItems.map((item) => {
              const meta = this.parseItemMeta(item.remarks || '');
              return {
                productId: String(item.productId ?? ''),
                capacityId: String(item.capacityId ?? ''),
                unitPrice: Number(item.unitPrice ?? 0),
                sellPrice: Number(item.sellPrice ?? 0),
                discountPrice: Number(item.discountPrice ?? 0),
                totalSetQty: Number(item.totalSetQty ?? 0),
                grouping: meta.grouping,
                installationDetails: meta.installationDetails,
                remarks: meta.itemRemarks,
              };
            })
          : [this.createEmptyProductItem()],
      totalAmount: Number(detail.totalAmount ?? 0),
      remarks: detail.remarks || '',
      status: detail.status || 'draft',
      termsConditions: {
        warrantyException: String(detail.termsConditions?.warrantyException ?? '') || this.createDefaultTermsConditions().warrantyException!,
        validity: String(detail.termsConditions?.validity ?? '') || this.createDefaultTermsConditions().validity!,
        note: String(detail.termsConditions?.note ?? '') || this.createDefaultTermsConditions().note!,
        penaltyFee: String(detail.termsConditions?.penaltyFee ?? '') || this.createDefaultTermsConditions().penaltyFee!,
        warranty: String(detail.termsConditions?.warranty ?? '') || this.createDefaultTermsConditions().warranty!,
      },
    };

    this.recalculateTotalAmount();
  }

  private toDateInputValue(value: string | null | undefined): string {
    if (!value) {
      return '';
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return '';
    }

    return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`;
  }

  onCustomerComboboxFocus(): void {
    this.isCustomerDropdownOpen = true;
  }

  onCustomerComboboxBlur(): void {
    setTimeout(() => {
      this.isCustomerDropdownOpen = false;
    }, 150);
  }

  async onCustomerSearchChange(value: string): Promise<void> {
    this.customerSearch = value;
    this.form.customer_id = '';
    this.form.customer.name = value;
    this.isCustomerDropdownOpen = true;
    await this.loadCustomerOptions(value);
  }

  getFilteredCustomerOptions(): SalesCustomerOption[] {
    const query = String(this.customerSearch ?? '').trim().toLowerCase();
    if (!query) {
      return this.customerOptions;
    }

    return this.customerOptions.filter((customer) =>
      String(customer.name ?? '').toLowerCase().includes(query),
    );
  }

  selectCustomer(customerId: string): void {
    const selected = this.customerOptions.find((item) => item.id === customerId);
    if (!selected) {
      return;
    }

    this.form.customer_id = selected.id;
    this.customerSearch = selected.name;
    this.form.customer.name = selected.name ?? '';
    this.form.customer.address = selected.address ?? '';
    this.form.customer.contact_person = selected.contact_person ?? '';
    this.form.customer.contact_number = selected.contact_number ?? '';
    this.form.customer.email = selected.email ?? '';
    this.form.customer.tin_number = selected.tin_number ?? '';
    this.isCustomerDropdownOpen = false;
  }

  addProductItem(): void {
    this.form.productItems = [...this.form.productItems, this.createEmptyProductItem()];
  }

  removeProductItem(index: number): void {
    if (this.form.productItems.length <= 1) {
      return;
    }

    this.form.productItems = this.form.productItems.filter((_, idx) => idx !== index);
    this.recalculateTotalAmount();
  }

  getCapacitiesByProduct(productId: string): Array<{ id: number; name: string; sellPrice?: number; unitPrice?: number }> {
    if (!productId) {
      return [];
    }

    return this.catalogProducts.find((item) => String(item.id) === String(productId))?.capacities ?? [];
  }

  onProductChanged(index: number): void {
    const items = [...this.form.productItems];
    items[index].capacityId = '';
    items[index].sellPrice = '';
    items[index].unitPrice = 0;
    this.form.productItems = items;
    this.recalculateTotalAmount();
  }

  onCapacityChanged(index: number): void {
    const item = this.form.productItems[index];
    const capacity = this.getCapacitiesByProduct(item.productId).find(
      (entry) => String(entry.id) === String(item.capacityId),
    );

    if (!capacity) {
      item.unitPrice = 0;
      item.sellPrice = '';
      this.recalculateTotalAmount();
      return;
    }

    item.unitPrice = Number(capacity.unitPrice ?? 0);
    item.sellPrice = Number(capacity.sellPrice ?? 0);
    this.recalculateTotalAmount();
  }

  onItemPriceOrQtyChanged(): void {
    this.recalculateTotalAmount();
  }

  onValidityDaysChanged(value: unknown): void {
    const parsed = Number(value);
    this.form.validityDays = Number.isFinite(parsed) && parsed > 0 ? Math.min(3650, Math.floor(parsed)) : 14;
  }

  getFormExpiryDate(): string {
    const base = new Date(this.form.quoteDate || this.getDefaultQuoteDate());
    if (Number.isNaN(base.getTime())) {
      return '-';
    }

    base.setDate(base.getDate() + Number(this.form.validityDays ?? 14));
    return this.formatDateOnly(base.toISOString());
  }

  setGrouping(index: number, grouping: string): void {
    const item = this.form.productItems[index];
    if (!item) {
      return;
    }

    item.grouping = String(grouping ?? '').trim();
  }

  addInstallationDetail(index: number): void {
    const item = this.form.productItems[index];
    if (!item) {
      return;
    }

    item.installationDetails = [...(item.installationDetails ?? []), this.createEmptyInstallationDetail()];
  }

  removeInstallationDetail(itemIndex: number, detailIndex: number): void {
    const item = this.form.productItems[itemIndex];
    if (!item) {
      return;
    }

    if ((item.installationDetails ?? []).length <= 1) {
      return;
    }

    item.installationDetails = item.installationDetails.filter((_, index) => index !== detailIndex);
    this.recalculateTotalAmount();
  }

  getInstallationTotal(item: QuotationProductFormItem): number {
    return (item.installationDetails ?? []).reduce((sum, detail) => {
      const unitPrice = Number(detail.unitPrice ?? 0);
      const excessQty = Number(detail.excessQty ?? 0);
      return sum + unitPrice * Math.max(0, excessQty);
    }, 0);
  }

  getMiscTotal(item: QuotationProductFormItem): number {
    return this.getInstallationTotal(item);
  }

  getLineTotal(item: QuotationProductFormItem): number {
    const unitPrice = Number(item.unitPrice ?? 0);
    const sellPrice = Number(item.sellPrice ?? 0);
    const discountPrice = Number(item.discountPrice ?? 0);
    const qty = Number(item.totalSetQty ?? 0);
    const price = discountPrice > 0 ? discountPrice : sellPrice > 0 ? sellPrice : unitPrice;
    return price * qty + this.getMiscTotal(item);
  }

  private calculatePreviewLineTotal(price: number, qty: number, miscTotal: number): number {
    return Number(price ?? 0) * Number(qty ?? 0) + Number(miscTotal ?? 0);
  }

  recalculateTotalAmount(): void {
    this.form.totalAmount = this.form.productItems.reduce(
      (sum, item) => sum + this.getLineTotal(item),
      0,
    );
  }

  async saveQuotation(): Promise<void> {
    if (this.isSubmitting) {
      return;
    }

    this.uiError = '';
    this.uiMessage = '';

    if (this.form.productItems.length === 0) {
      this.uiError = 'At least one product item is required';
      return;
    }

    if (!this.form.customer_id && !String(this.form.customer.name ?? '').trim()) {
      this.uiError = 'Select an existing customer or enter customer name';
      return;
    }

    this.recalculateTotalAmount();

    const payload: QuotationPayload = {
      quoteDate: this.form.quoteDate,
      validityDays: Number(this.form.validityDays ?? 14),
      customer_id: this.form.customer_id || null,
      customer: {
        name: String(this.form.customer.name ?? '').trim(),
        address: String(this.form.customer.address ?? '').trim(),
        contact_person: String(this.form.customer.contact_person ?? '').trim(),
        contact_number: String(this.form.customer.contact_number ?? '').trim(),
        email: String(this.form.customer.email ?? '').trim(),
        tin_number: String(this.form.customer.tin_number ?? '').trim(),
      },
      totalAmount: this.form.totalAmount,
      remarks: this.form.remarks,
      status: this.form.status,
      termsConditions: {
        warrantyException: this.form.termsConditions.warrantyException,
        validity: this.form.termsConditions.validity,
        note: this.form.termsConditions.note,
        penaltyFee: this.form.termsConditions.penaltyFee,
        warranty: this.form.termsConditions.warranty,
      },
      productItems: this.form.productItems.map((item) => {
        const product = this.catalogProducts.find((p) => String(p.id) === String(item.productId));
        const unitTypes: Array<{ label: string; value: number }> = (product?.unitTypes ?? []).map((ut) => ({
          label: String(ut).trim().toLowerCase(),
          value: Number(item.totalSetQty ?? 0),
        }));
        return {
          productId: item.productId ? Number(item.productId) : undefined,
          capacityId: item.capacityId ? Number(item.capacityId) : undefined,
          unitPrice: Number(item.unitPrice ?? 0),
          sellPrice: Number(item.sellPrice ?? 0),
          discountPrice: Number(item.discountPrice ?? 0),
          totalSetQty: Number(item.totalSetQty ?? 0),
          unitTypesQty: unitTypes.length > 0 ? unitTypes : [{ label: 'set', value: Number(item.totalSetQty ?? 0) }],
          remarks: this.serializeItemMeta(item),
        };
      }),
    };

    this.isSubmitting = true;

    try {
      const response =
        this.drawerMode === 'create'
          ? await this.quotationService.createQuotation(payload)
          : await this.quotationService.updateQuotation(Number(this.editingQuotationId), payload);

      if (!response.success) {
        this.uiError = response.message ?? 'Unable to save quotation';
        return;
      }

      this.uiMessage = response.message ?? 'Quotation saved successfully';
      this.closeDrawer();
      await this.loadQuotations();
    } catch (error: unknown) {
      if (axios.isAxiosError(error)) {
        this.uiError =
          (error.response?.data as { message?: string } | undefined)?.message ??
          'Unable to save quotation';
      } else {
        this.uiError = 'Unable to save quotation';
      }
    } finally {
      this.isSubmitting = false;
    }
  }

  async finalizeQuotation(item: QuotationListItem): Promise<void> {
    if (this.finalizingIds.has(item.id)) {
      return;
    }

    this.finalizingIds.add(item.id);
    this.uiError = '';
    this.uiMessage = '';

    try {
      const response = await this.quotationService.finalizeQuotation(item.id);
      if (!response.success) {
        this.uiError = response.message ?? 'Unable to finalize quotation';
        return;
      }

      this.uiMessage = response.message ?? 'Quotation finalized';
      await this.loadQuotations();
    } catch (error: unknown) {
      if (axios.isAxiosError(error)) {
        this.uiError =
          (error.response?.data as { message?: string } | undefined)?.message ??
          'Unable to finalize quotation';
      } else {
        this.uiError = 'Unable to finalize quotation';
      }
    } finally {
      this.finalizingIds.delete(item.id);
    }
  }

  async convertToSalesOrder(item: QuotationListItem): Promise<void> {
    if (this.convertingIds.has(item.id)) {
      return;
    }

    this.convertingIds.add(item.id);
    this.uiError = '';
    this.uiMessage = '';

    try {
      const response = await this.quotationService.convertToSalesOrder(item.id);
      if (!response.success) {
        this.uiError = response.message ?? 'Unable to convert quotation';
        return;
      }

      const salesOrderId = Number(response.data?.salesOrderId ?? 0);
      this.uiMessage = salesOrderId > 0
        ? `Quotation converted successfully. Sales Order ID: ${salesOrderId}`
        : response.message ?? 'Quotation converted successfully';
      await this.loadQuotations();
    } catch (error: unknown) {
      if (axios.isAxiosError(error)) {
        this.uiError =
          (error.response?.data as { message?: string } | undefined)?.message ??
          'Unable to convert quotation';
      } else {
        this.uiError = 'Unable to convert quotation';
      }
    } finally {
      this.convertingIds.delete(item.id);
    }
  }

  async permanentlyDeleteExpiredQuotation(item: QuotationListItem): Promise<void> {
    if (this.deletingIds.has(item.id)) {
      return;
    }

    if (!this.isExpired(item)) {
      this.uiError = 'Only expired quotations can be permanently deleted';
      return;
    }

    if (!this.canPermanentlyDeleteExpiredQuotation()) {
      this.uiError = 'Only admin, super admin, or business owner can permanently delete expired quotations';
      return;
    }

    const confirmed = window.confirm(
      `Permanently delete expired quotation ${item.quoteNo || item.id}? This cannot be undone.`,
    );
    if (!confirmed) {
      return;
    }

    const password = window.prompt('Enter your admin password to permanently delete this expired quotation:');
    if (password === null) {
      return;
    }

    if (!String(password).trim()) {
      this.uiError = 'Admin password is required';
      return;
    }

    this.deletingIds.add(item.id);
    this.uiError = '';
    this.uiMessage = '';

    try {
      const response = await this.quotationService.permanentlyDeleteExpiredQuotation(item.id, String(password).trim());
      if (!response.success) {
        this.uiError = response.message ?? 'Unable to permanently delete expired quotation';
        return;
      }

      this.uiMessage = response.message ?? 'Expired quotation permanently deleted';
      await this.loadQuotations();
    } catch (error: unknown) {
      if (axios.isAxiosError(error)) {
        this.uiError =
          (error.response?.data as { message?: string } | undefined)?.message ??
          'Unable to permanently delete expired quotation';
      } else {
        this.uiError = 'Unable to permanently delete expired quotation';
      }
    } finally {
      this.deletingIds.delete(item.id);
    }
  }

  async previewQuotation(item: QuotationListItem): Promise<void> {
    const detail = await this.quotationService.getQuotationById(item.id);
    if (!detail) {
      this.uiError = 'Unable to load quotation details for preview';
      return;
    }

    const groupedItems = new Map<string, Array<{
      model: string;
      description: string;
      frequency: string;
      capacity: string;
      phvHz: string;
      qty: number;
      discPrice: number;
      miscTotal: number;
      lineTotal: number;
    }>>();
    const pdfRows: QuotationPreviewPdfRow[] = [];
    const miscRows: QuotationPreviewMiscRow[] = [];

    for (const productItem of detail.productItems) {
      const meta = this.parseItemMeta(productItem.remarks || '');
      const groupName = meta.grouping || 'UNSPECIFIED AREA';
      const priceToUse = Number(
        productItem.discountPrice > 0
          ? productItem.discountPrice
          : productItem.sellPrice > 0
            ? productItem.sellPrice
            : productItem.unitPrice,
      );

      const installLines = (meta.installationDetails ?? [])
        .map((install) => {
          const unitPrice = Number(install.unitPrice ?? 0);
          const excessQty = Number(install.excessQty ?? 0);
          const freeQty = Number(install.freeQty ?? 0);
          const unit = String(install.unit || 'FT').trim() || 'FT';
          const base = String(install.description || '').trim() || 'Installation';
          return `${base} | Unit Price: ${this.formatAmount(unitPrice)} | Excess: ${excessQty} | Free: ${freeQty} ${this.escapeHtml(unit)}`;
        })
        .join('<br/>');

      const descriptionParts = [
        this.escapeHtml(productItem.productName || '-'),
        meta.itemRemarks ? this.escapeHtml(meta.itemRemarks) : '',
        installLines,
      ].filter((part) => String(part).trim().length > 0);
      const miscTotal = (meta.installationDetails ?? []).reduce((sum, install) => {
        const unitPrice = Number(install.unitPrice ?? 0);
        const excessQty = Number(install.excessQty ?? 0);
        return sum + unitPrice * Math.max(0, excessQty);
      }, 0);
      const quantity = Number(productItem.totalSetQty ?? 0);
      const lineTotal = this.calculatePreviewLineTotal(priceToUse, quantity, miscTotal);

      if (!groupedItems.has(groupName)) {
        groupedItems.set(groupName, []);
      }

      groupedItems.get(groupName)?.push({
        model: this.escapeHtml(productItem.productName || '-'),
        description: descriptionParts.join('<br/>'),
        frequency: 'N/A',
        capacity: this.escapeHtml(productItem.capacityName || '-'),
        phvHz: '1/230/60',
        qty: quantity,
        discPrice: priceToUse,
        miscTotal,
        lineTotal,
      });

      pdfRows.push({
        groupName,
        model: String(productItem.productName || '-'),
        description: [
          String(productItem.productName || '-'),
          meta.itemRemarks ? String(meta.itemRemarks) : '',
          (meta.installationDetails ?? [])
            .map((install) => {
              const unitPrice = Number(install.unitPrice ?? 0);
              const excessQty = Number(install.excessQty ?? 0);
              const freeQty = Number(install.freeQty ?? 0);
              const unit = String(install.unit || 'FT').trim() || 'FT';
              const base = String(install.description || '').trim() || 'Installation';
              return `${base} | Unit Price: ${this.formatAmountPdf(unitPrice)} | Excess: ${excessQty} | Free: ${freeQty} ${unit}`;
            })
            .join(' | '),
        ]
          .filter((part) => part.trim().length > 0)
          .join(' | '),
        capacity: String(productItem.capacityName || '-'),
        qty: quantity,
        discPrice: priceToUse,
        miscTotal,
        lineTotal,
      });

      for (const install of meta.installationDetails ?? []) {
        const unitPrice = Number(install.unitPrice ?? 0);
        const excessQty = Number(install.excessQty ?? 0);
        const amount = unitPrice * Math.max(0, excessQty);
        if (amount <= 0) {
          continue;
        }

        miscRows.push({
          groupName,
          model: String(productItem.productName || '-'),
          description: String(install.description || '').trim() || 'Miscellaneous',
          unitPrice,
          excessQty,
          amount,
        });
      }
    }

    const tableRowsHtml = [...groupedItems.entries()]
      .map(([groupName, rows]) => {
        const sectionRow = `
          <tr>
            <td colspan="8" class="section-row">${this.escapeHtml(groupName)}</td>
          </tr>
        `;

        const itemRows = rows
          .map((row) => `
            <tr>
              <td>${row.model}</td>
              <td>${row.description}</td>
              <td class="center">${row.frequency}</td>
              <td class="center">${row.capacity}</td>
              <td class="center">${row.phvHz}</td>
              <td class="center">${row.qty}</td>
              <td class="right">${this.formatAmount(row.discPrice)}</td>
              <td class="right">${this.formatAmount(row.lineTotal)}</td>
            </tr>
          `)
          .join('');

        return `${sectionRow}${itemRows}`;
      })
      .join('');

    const businessProfile = await this.loadBusinessProfileSettings();
    const headerProfile = await this.buildQuotationHeaderProfile(businessProfile);
    const miscTableRowsHtml = miscRows.length > 0
      ? miscRows
          .map((row) => `
            <tr>
              <td>${this.escapeHtml(row.groupName)}</td>
              <td>${this.escapeHtml(row.model)}</td>
              <td>${this.escapeHtml(row.description)}</td>
              <td class="right">${this.formatAmount(row.unitPrice)}</td>
              <td class="right">${row.excessQty}</td>
              <td class="right">${this.formatAmount(row.amount)}</td>
            </tr>
          `)
          .join('')
      : '<tr><td colspan="6" class="center">No miscellaneous costs</td></tr>';

    const totalAmount = pdfRows.reduce((sum, row) => sum + Number(row.lineTotal ?? 0), 0);

    const html = this.buildQuotationPreviewHtml({
      quoteNo: String(detail.quoteNo || '').trim() || 'AUTO GENERATED',
      quoteDate: detail.quoteDate,
      customerName: detail.customerName,
      customerContactPerson: detail.customerContactPerson,
      customerContactNumber: detail.customerContactNumber,
      customerAddress: detail.customerAddress,
      headerBusinessName: headerProfile.businessName,
      headerAddress: headerProfile.addressDetails,
      headerContact: headerProfile.contactDetails,
      headerEmail: headerProfile.emailDetails,
      totalAmount,
      logoSrc: headerProfile.logoSrc,
      tableRowsHtml,
      miscTableRowsHtml,
      termsConditions: detail.termsConditions,
    });

    this.quotationPreviewPdfData = {
      quoteNo: String(detail.quoteNo || '').trim() || 'AUTO GENERATED',
      quoteDate: detail.quoteDate,
      customerName: detail.customerName,
      customerContactPerson: detail.customerContactPerson,
      customerContactNumber: detail.customerContactNumber,
      customerAddress: detail.customerAddress,
      totalAmount,
      rows: pdfRows,
      miscRows,
    };

    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const blobUrl = URL.createObjectURL(blob);
    this.openQuotationPreview(blobUrl, `Quotation-${detail.quoteNo || detail.id}.pdf`);
  }

  async previewQuotationFromDrawer(): Promise<void> {
    this.recalculateTotalAmount();

    const groupedItems = new Map<string, Array<{
      model: string;
      description: string;
      frequency: string;
      capacity: string;
      phvHz: string;
      qty: number;
      discPrice: number;
      miscTotal: number;
      lineTotal: number;
    }>>();
    const pdfRows: QuotationPreviewPdfRow[] = [];
    const miscRows: QuotationPreviewMiscRow[] = [];

    for (const row of this.form.productItems) {
      const groupName = String(row.grouping || '').trim() || 'UNSPECIFIED AREA';
      const productName = this.getProductName(row.productId);
      const capacityName = this.getCapacityName(row.productId, row.capacityId);
      const priceToUse = Number(
        Number(row.discountPrice ?? 0) > 0
          ? row.discountPrice
          : Number(row.sellPrice ?? 0) > 0
            ? row.sellPrice
            : row.unitPrice,
      );

      const installLines = (row.installationDetails ?? [])
        .map((install) => {
          const unitPrice = Number(install.unitPrice ?? 0);
          const excessQty = Number(install.excessQty ?? 0);
          const freeQty = Number(install.freeQty ?? 0);
          const unit = String(install.unit || 'FT').trim() || 'FT';
          const base = String(install.description || '').trim() || 'Installation';
          return `${base} | Unit Price: ${this.formatAmount(unitPrice)} | Excess: ${excessQty} | Free: ${freeQty} ${this.escapeHtml(unit)}`;
        })
        .join('<br/>');

      const descriptionParts = [
        this.escapeHtml(productName),
        String(row.remarks || '').trim() ? this.escapeHtml(String(row.remarks || '').trim()) : '',
        installLines,
      ].filter((part) => String(part).trim().length > 0);
      const miscTotal = this.getMiscTotal(row);

      if (!groupedItems.has(groupName)) {
        groupedItems.set(groupName, []);
      }

      groupedItems.get(groupName)?.push({
        model: this.escapeHtml(productName),
        description: descriptionParts.join('<br/>'),
        frequency: 'N/A',
        capacity: this.escapeHtml(capacityName),
        phvHz: '1/230/60',
        qty: Number(row.totalSetQty ?? 0),
        discPrice: priceToUse,
        miscTotal,
        lineTotal: this.getLineTotal(row),
      });

      pdfRows.push({
        groupName,
        model: productName,
        description: [
          productName,
          String(row.remarks || '').trim(),
          (row.installationDetails ?? [])
            .map((install) => {
              const unitPrice = Number(install.unitPrice ?? 0);
              const excessQty = Number(install.excessQty ?? 0);
              const freeQty = Number(install.freeQty ?? 0);
              const unit = String(install.unit || 'FT').trim() || 'FT';
              const base = String(install.description || '').trim() || 'Installation';
              return `${base} | Unit Price: ${this.formatAmountPdf(unitPrice)} | Excess: ${excessQty} | Free: ${freeQty} ${unit}`;
            })
            .join(' | '),
        ]
          .filter((part) => part.trim().length > 0)
          .join(' | '),
        capacity: capacityName,
        qty: Number(row.totalSetQty ?? 0),
        discPrice: priceToUse,
        miscTotal,
        lineTotal: this.getLineTotal(row),
      });

      for (const install of row.installationDetails ?? []) {
        const unitPrice = Number(install.unitPrice ?? 0);
        const excessQty = Number(install.excessQty ?? 0);
        const amount = unitPrice * Math.max(0, excessQty);
        if (amount <= 0) {
          continue;
        }

        miscRows.push({
          groupName,
          model: productName,
          description: String(install.description || '').trim() || 'Miscellaneous',
          unitPrice,
          excessQty,
          amount,
        });
      }
    }

    const tableRowsHtml = [...groupedItems.entries()]
      .map(([groupName, rows]) => {
        const sectionRow = `
          <tr>
            <td colspan="8" class="section-row">${this.escapeHtml(groupName)}</td>
          </tr>
        `;

        const itemRows = rows
          .map((row) => `
            <tr>
              <td>${row.model}</td>
              <td>${row.description}</td>
              <td class="center">${row.frequency}</td>
              <td class="center">${row.capacity}</td>
              <td class="center">${row.phvHz}</td>
              <td class="center">${row.qty}</td>
              <td class="right">${this.formatAmount(row.discPrice)}</td>
              <td class="right">${this.formatAmount(row.lineTotal)}</td>
            </tr>
          `)
          .join('');

        return `${sectionRow}${itemRows}`;
      })
      .join('');

    const businessProfile = await this.loadBusinessProfileSettings();
    const headerProfile = await this.buildQuotationHeaderProfile(businessProfile);
    const miscTableRowsHtml = miscRows.length > 0
      ? miscRows
          .map((row) => `
            <tr>
              <td>${this.escapeHtml(row.groupName)}</td>
              <td>${this.escapeHtml(row.model)}</td>
              <td>${this.escapeHtml(row.description)}</td>
              <td class="right">${this.formatAmount(row.unitPrice)}</td>
              <td class="right">${row.excessQty}</td>
              <td class="right">${this.formatAmount(row.amount)}</td>
            </tr>
          `)
          .join('')
      : '<tr><td colspan="6" class="center">No miscellaneous costs</td></tr>';

    const html = this.buildQuotationPreviewHtml({
      quoteNo: 'AUTO GENERATED',
      quoteDate: this.form.quoteDate,
      customerName: this.form.customer.name,
      customerContactPerson: this.form.customer.contact_person,
      customerContactNumber: this.form.customer.contact_number,
      customerAddress: this.form.customer.address,
      headerBusinessName: headerProfile.businessName,
      headerAddress: headerProfile.addressDetails,
      headerContact: headerProfile.contactDetails,
      headerEmail: headerProfile.emailDetails,
      totalAmount: this.form.totalAmount,
      logoSrc: headerProfile.logoSrc,
      tableRowsHtml,
      miscTableRowsHtml,
      termsConditions: this.form.termsConditions,
    });

    this.quotationPreviewPdfData = {
      quoteNo: 'AUTO GENERATED',
      quoteDate: this.form.quoteDate,
      customerName: this.form.customer.name,
      customerContactPerson: this.form.customer.contact_person,
      customerContactNumber: this.form.customer.contact_number,
      customerAddress: this.form.customer.address,
      totalAmount: Number(this.form.totalAmount ?? 0),
      rows: pdfRows,
      miscRows,
    };

    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const blobUrl = URL.createObjectURL(blob);
    this.openQuotationPreview(blobUrl, 'Quotation-Draft-Preview.pdf');
  }

  private getProductName(productId: string): string {
    if (!productId) {
      return '-';
    }

    const product = this.catalogProducts.find((entry) => String(entry.id) === String(productId));
    return String(product?.name || '-');
  }

  private getCapacityName(productId: string, capacityId: string): string {
    if (!productId || !capacityId) {
      return '-';
    }

    const product = this.catalogProducts.find((entry) => String(entry.id) === String(productId));
    const capacity = product?.capacities?.find((entry) => String(entry.id) === String(capacityId));
    return String(capacity?.name || '-');
  }

  private buildQuotationPreviewHtml(payload: {
    quoteNo: string;
    quoteDate: string | null | undefined;
    customerName: string;
    customerContactPerson: string;
    customerContactNumber: string;
    customerAddress: string;
    headerBusinessName: string;
    headerAddress: string;
    headerContact: string;
    headerEmail: string;
    totalAmount: number;
    logoSrc: string | null;
    tableRowsHtml: string;
    miscTableRowsHtml: string;
    termsConditions?: QuotationTermsConditions;
  }): string {
    const tc = payload.termsConditions ?? {};
    const defaults = this.createDefaultTermsConditions();
    const warranty = String(tc.warranty || defaults.warranty || '');
    const validity = String(tc.validity || defaults.validity || '');
    const note = String(tc.note || defaults.note || '');
    const penaltyFee = String(tc.penaltyFee || defaults.penaltyFee || '');
    const warrantyException = String(tc.warrantyException || defaults.warrantyException || '');

    const toHtmlLines = (text: string) =>
      text.split('\n').map((line) => this.escapeHtml(line)).join('<br/>');

    const logoSrc = payload.logoSrc
      ? this.escapeHtml(this.resolveAssetUrl(payload.logoSrc))
      : '';
    const signatorySrc = this.escapeHtml(this.resolveAssetUrl('/images/van-esign.png'));
    const headerBusinessName = this.escapeHtml(String(payload.headerBusinessName || '').trim());
    const headerAddress = this.escapeHtml(String(payload.headerAddress || '').trim());
    const headerContact = this.escapeHtml(String(payload.headerContact || '').trim());
    const headerEmail = this.escapeHtml(String(payload.headerEmail || '').trim());

    return `
      <html>
        <head>
          <title>Quotation ${this.escapeHtml(payload.quoteNo)}</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 20px; color: #111; font-size: 12px; }
            html, body { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; color-adjust: exact !important; }
            .top { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 18px; }
            .brand-block { width: 180px; display: flex; align-items: flex-start; }
            .logo { width: 150px; }
            .brand-name-fallback { color: #1f3f9a; font-size: 20px; font-weight: 700; line-height: 1.15; }
            .contacts { color: #1f3f9a; font-size: 12px; line-height: 1.45; font-weight: 600; text-align: left; max-width: 290px; margin-left: auto; padding-top: 6px; }
            .customer-contract { display: flex; justify-content: space-between; margin-bottom: 8px; }
            .customer-lines { width: 60%; line-height: 1.45; }
            .customer-lines .label { display: inline-block; width: 110px; }
            .contract-box { width: 34%; }
            .contract-title { background-color: #0f9cdf !important; color: #ffffff !important; padding: 4px 8px; font-weight: 700; margin-bottom: 8px; }
            .contract-meta { font-size: 12px; line-height: 1.4; }
            table { border-collapse: collapse; width: 100%; margin-top: 6px; }
            th, td { border: 1px solid #888; padding: 5px 6px; font-size: 11px; vertical-align: top; }
            th { background-color: #0f9cdf !important; color: #ffffff !important; text-align: left; }
            .center { text-align: center; }
            .right { text-align: right; }
            .section-row { background: #efefef; font-weight: 700; text-transform: uppercase; }
            .mid { display: flex; gap: 16px; margin-top: 10px; }
            .payment { flex: 1; }
            .totals { width: 240px; }
            .block-title { background-color: #0f9cdf !important; color: #ffffff !important; padding: 4px 8px; font-weight: 700; margin-bottom: 6px; }
            .payment-row { display: flex; gap: 10px; line-height: 1.45; margin-bottom: 2px; }
            .payment-row .label { width: 110px; color: #333; }
            .totals-row { display: flex; justify-content: space-between; border-bottom: 1px solid #aaa; padding: 2px 0; font-weight: 700; }
            .terms { margin-top: 10px; }
            .terms-line { display: flex; gap: 10px; line-height: 1.45; margin-bottom: 3px; }
            .terms-line .label { width: 110px; color: #333; }
            .signatures { margin-top: 70px; display: flex; justify-content: space-between; }
            .sig { width: 250px; font-size: 12px; }
            .sig-signature { height: 48px; margin: 0 auto -25px auto; object-fit: contain; object-position: center bottom; display: block; }
            .sig-line { border-top: 1px solid #333; margin-top: 22px; padding-top: 4px; }
            @media print {
              html, body, table, thead, tbody, tr, th, td, .contract-title, .block-title {
                -webkit-print-color-adjust: exact !important;
                print-color-adjust: exact !important;
                color-adjust: exact !important;
              }
              th { background-color: #0f9cdf !important; color: #ffffff !important; }
              .contract-title, .block-title { background-color: #0f9cdf !important; color: #ffffff !important; }
            }
          </style>
        </head>
        <body>
          <div class="top">
            <div class="brand-block">
              ${logoSrc ? `<img src="${logoSrc}" class="logo" alt="${headerBusinessName || 'Business Logo'}" />` : `<div class="brand-name-fallback">${headerBusinessName || 'HVAC Warehouse & Sales'}</div>`}
            </div>
            <div class="contacts">
              ${headerAddress ? `<div>Address: ${headerAddress}</div>` : ''}
              ${headerContact ? `<div>Contact Us: ${headerContact}</div>` : ''}
              ${headerEmail ? `<div>Email Us: ${headerEmail}</div>` : ''}
            </div>
          </div>

          <div class="customer-contract">
            <div class="customer-lines">
              <div><span class="label">Customer:</span> ${this.escapeHtml(payload.customerName || '-')}</div>
              <div><span class="label">Contact Person</span> ${this.escapeHtml(payload.customerContactPerson || '-')}</div>
              <div><span class="label">Contact Number</span> ${this.escapeHtml(payload.customerContactNumber || '-')}</div>
              <div><span class="label">Address</span> ${this.escapeHtml(payload.customerAddress || '-')}</div>
            </div>
            <div class="contract-box">
              <div class="contract-title">SALES CONTRACT</div>
              <div class="contract-meta">Sales Quotation#: ${this.escapeHtml(payload.quoteNo || '-')}</div>
              <div class="contract-meta">Date : ${this.formatDateOnly(payload.quoteDate)}</div>
            </div>
          </div>

          <table>
            <thead>
              <tr>
                <th style="width: 13%;">Model</th>
                <th style="width: 38%;">Specifications<br/><span style="font-weight: 400;">Descriptions</span></th>
                <th style="width: 8%;">Frequency</th>
                <th style="width: 8%;">Capacity</th>
                <th style="width: 9%;">Ph/V/Hz</th>
                <th style="width: 6%;">Qty</th>
                <th style="width: 8%;">DISC PRICE</th>
                <th style="width: 9%;">TOTAL (PHP)</th>
              </tr>
            </thead>
            <tbody>
              ${payload.tableRowsHtml || '<tr><td colspan="8" class="center">No quotation items</td></tr>'}
            </tbody>
          </table>

          <div class="terms" style="margin-top: 8px;">
            <div class="block-title">MATERIAL MISCELLANEOUS</div>
            <table>
              <thead>
                <tr>
                  <th style="width: 16%;">Section</th>
                  <th style="width: 20%;">Model</th>
                  <th style="width: 34%;">Description</th>
                  <th style="width: 10%;">Unit Price</th>
                  <th style="width: 8%;">Excess</th>
                  <th style="width: 12%;">Amount</th>
                </tr>
              </thead>
              <tbody>
                ${payload.miscTableRowsHtml}
              </tbody>
            </table>
          </div>

          <div class="mid">
            <div class="payment">
              <div class="block-title">PAYMENT DETAILS</div>
              <div class="payment-row"><span class="label">Payment Terms</span><span>50% Downpayment Upon Approval<br/>50% Upon Completion of Work</span></div>
              <div class="payment-row"><span class="label">Payment Instruction</span><span>For payment check please make the check payable to ROGER VAN V. SARAZA</span></div>
              <div class="payment-row"><span class="label">Bank Account</span><span>BDO Bank Account No. <strong>0119-6006-1435</strong><br/>Account Name: <strong>ROGER VAN V. SARAZA</strong></span></div>
            </div>

            <div class="totals">
              <div class="totals-row"><span>TOTAL</span><span>${this.formatAmount(payload.totalAmount)}</span></div>
              <div class="totals-row"><span>DISCOUNT</span><span>${this.formatAmount(0)}</span></div>
              <div class="totals-row"><span>VAT</span><span>${this.formatAmount(0)}</span></div>
              <div class="totals-row"><span>GRAND TOTAL</span><span>${this.formatAmount(payload.totalAmount)}</span></div>
            </div>
          </div>

          <div class="terms">
            <div class="block-title">TERMS &amp; CONDITIONS</div>
            <div class="terms-line"><span class="label">Warranty</span><span>${toHtmlLines(warranty)}</span></div>
            <div class="terms-line"><span class="label">Warranty Exception</span><span>${toHtmlLines(warrantyException)}</span></div>
            <div class="terms-line"><span class="label">Validity</span><span>${toHtmlLines(validity)}</span></div>
            <div class="terms-line"><span class="label">Note</span><span>${toHtmlLines(note)}</span></div>
            <div class="terms-line"><span class="label" style="color:#c00;font-weight:700;">Penalty Fee</span><span style="color:#c00;">${toHtmlLines(penaltyFee)}</span></div>
          </div>

          <div class="signatures">
            <div class="sig">
              <img src="${signatorySrc}" alt="Roger Van Saraza Signature" class="sig-signature" />
              <div class="sig-line">Roger Van Saraza</div>
              <div>Proprietor & Tech. Manager</div>
            </div>
            <div class="sig">
              <div class="sig-line">Printed Name & Signature</div>
              <div>RECEIVED BY:</div>
            </div>
          </div>

        </body>
      </html>
    `;
  }

  closeQuotationPreview(): void {
    this.isQuotationPreviewOpen = false;
    this.revokeQuotationPreviewUrl();
    this.quotationPreviewPdfData = null;
  }

  printQuotationPreview(): void {
    const frame = document.getElementById('quotation-preview-frame') as HTMLIFrameElement | null;
    frame?.contentWindow?.focus();
    frame?.contentWindow?.print();
  }

  async downloadQuotationPreview(): Promise<void> {
    if (!this.quotationPreviewPdfData) {
      return;
    }

    try {
      const pdfBytes = await this.generateQuotationPdf(this.quotationPreviewPdfData);
      const normalizedBytes = Uint8Array.from(pdfBytes);
      const blob = new Blob([normalizedBytes], { type: 'application/pdf' });
      const fileUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = fileUrl;
      link.download = this.quotationPreviewFilename.endsWith('.pdf')
        ? this.quotationPreviewFilename
        : `${this.quotationPreviewFilename}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(fileUrl);
    } catch {
      this.uiError = 'Unable to generate PDF download preview';
    }
  }

  private async generateQuotationPdf(data: QuotationPreviewPdfData): Promise<Uint8Array> {
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([850, 1100]);
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const { width, height } = page.getSize();

    const businessProfile = await this.loadBusinessProfileSettings();
    const headerProfile = await this.buildQuotationHeaderProfile(businessProfile);
    const logoSources = headerProfile.logoSrc
      ? [headerProfile.logoSrc, '/images/air-summit-logo.png', '/images/logo/logo.svg']
      : ['/images/air-summit-logo.png', '/images/logo/logo.svg'];

    const logoBytes = await this.loadLogoPngBytes(logoSources);
    if (logoBytes) {
      const logo = await pdfDoc.embedPng(logoBytes);
      const logoWidth = 120;
      const scale = logoWidth / logo.width;
      const logoHeight = logo.height * scale;
      page.drawImage(logo, {
        x: 48,
        y: height - logoHeight - 25,
        width: logoWidth,
        height: logoHeight,
      });
    } else {
      page.drawText(headerProfile.businessName || 'AIR SUMMIT', {
        x: 50,
        y: height - 50,
        size: 20,
        font: fontBold,
        color: rgb(0.1, 0.24, 0.6),
      });
    }

    const contacts = [
      headerProfile.addressDetails ? `Address: ${headerProfile.addressDetails}` : '',
      headerProfile.contactDetails ? `Contact Us: ${headerProfile.contactDetails}` : '',
      headerProfile.emailDetails ? `Email Us: ${headerProfile.emailDetails}` : '',
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
        if (font.widthOfTextAtSize(candidate, 9) <= maxWidth) {
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

    const headerLines = contacts.flatMap((line) => wrapHeaderLine(line, 255)).slice(0, 6);
    headerLines.forEach((line, index) => {
      page.drawText(line, {
        x: width - 305,
        y: height - 52 - index * 12,
        size: 9,
        font,
        color: rgb(0.1, 0.24, 0.6),
      });
    });

    let y = height - 135;

    page.drawText(`Customer: ${String(data.customerName || '-')}`, { x: 50, y, size: 10, font });
    page.drawText(`Contact Person: ${String(data.customerContactPerson || '-')}`, { x: 50, y: y - 14, size: 10, font });
    page.drawText(`Contact Number: ${String(data.customerContactNumber || '-')}`, { x: 50, y: y - 28, size: 10, font });
    page.drawText(`Address: ${String(data.customerAddress || '-')}`, { x: 50, y: y - 42, size: 10, font });

    page.drawRectangle({
      x: width - 250,
      y: y - 2,
      width: 190,
      height: 16,
      color: rgb(0.85, 0.85, 0.85),
    });
    page.drawText('SALES CONTRACT', { x: width - 240, y: y + 2, size: 9, font: fontBold });
    page.drawText(`Sales Quotation#: ${String(data.quoteNo || 'AUTO GENERATED')}`, { x: width - 248, y: y - 18, size: 9, font });
    page.drawText(`Date: ${this.formatDateOnly(data.quoteDate)}`, { x: width - 248, y: y - 32, size: 9, font });

    y -= 74;

    const drawCell = (text: string, x: number, cellY: number, maxWidth: number, align: 'left' | 'center' | 'right' = 'left') => {
      const safe = String(text ?? '');
      const trimmed = safe.length > 70 ? `${safe.slice(0, 67)}...` : safe;
      const textWidth = font.widthOfTextAtSize(trimmed, 8);
      const tx = align === 'right' ? x + maxWidth - textWidth - 3 : align === 'center' ? x + (maxWidth - textWidth) / 2 : x + 3;
      page.drawText(trimmed, { x: tx, y: cellY + 4, size: 8, font });
    };

    const columns = [
      { label: 'Section', width: 90 },
      { label: 'Model', width: 125 },
      { label: 'Description', width: 240 },
      { label: 'Capacity', width: 70 },
      { label: 'Qty', width: 45 },
      { label: 'Disc Price', width: 90 },
      { label: 'Total', width: 90 },
    ];

    let x = 50;
    columns.forEach((col) => {
      page.drawRectangle({ x, y, width: col.width, height: 20, color: rgb(0.85, 0.85, 0.85) });
      page.drawText(col.label, { x: x + 4, y: y + 6, size: 8, font: fontBold });
      x += col.width;
    });

    y -= 20;

    for (const row of data.rows) {
      if (y < 140) {
        break;
      }

      x = 50;
      const rowHeight = 18;
      const values = [
        row.groupName,
        row.model,
        row.description,
        row.capacity,
        String(row.qty),
        this.formatAmountPdf(row.discPrice),
        this.formatAmountPdf(row.lineTotal),
      ];

      values.forEach((value, index) => {
        const col = columns[index];
        page.drawRectangle({ x, y, width: col.width, height: rowHeight, borderColor: rgb(0.7, 0.7, 0.7), borderWidth: 0.5 });
        drawCell(value, x, y, col.width, index >= 4 ? 'right' : 'left');
        x += col.width;
      });

      y -= rowHeight;
    }

    y -= 10;
    page.drawText(`TOTAL: ${this.formatAmountPdf(data.totalAmount)}`, { x: width - 220, y, size: 10, font: fontBold });
    page.drawText(`GRAND TOTAL: ${this.formatAmountPdf(data.totalAmount)}`, { x: width - 220, y: y - 16, size: 10, font: fontBold });

    const eSignBytes = await this.loadLogoPngBytes(['/images/van-esign.png']);
    if (eSignBytes) {
      const eSign = await pdfDoc.embedPng(eSignBytes);
      const eSignWidth = 130;
      const eSignScale = eSignWidth / eSign.width;
      const eSignHeight = eSign.height * eSignScale;
      const preparedByLineStartX = 50;
      const preparedByLineEndX = 280;
      const preparedByLineWidth = preparedByLineEndX - preparedByLineStartX;
      const eSignX = preparedByLineStartX + (preparedByLineWidth - eSignWidth) / 2;
      page.drawImage(eSign, {
        x: eSignX,
        y: 72,
        width: eSignWidth,
        height: eSignHeight,
      });
    }

    page.drawText('Prepared by:', { x: 50, y: 85, size: 10, font });
    page.drawLine({ start: { x: 50, y: 70 }, end: { x: 280, y: 70 }, thickness: 0.8, color: rgb(0.2, 0.2, 0.2) });
    page.drawText('Received by:', { x: width - 280, y: 85, size: 10, font });
    page.drawLine({ start: { x: width - 280, y: 70 }, end: { x: width - 50, y: 70 }, thickness: 0.8, color: rgb(0.2, 0.2, 0.2) });

    return await pdfDoc.save();
  }

  private async loadLogoPngBytes(paths: string[]): Promise<Uint8Array | null> {
    for (const path of paths) {
      const bytes = await this.loadLogoPngBytesFromPath(path);
      if (bytes) {
        return bytes;
      }
    }

    return null;
  }

  private async loadLogoPngBytesFromPath(path: string): Promise<Uint8Array | null> {
    try {
      const response = await fetch(path);
      if (!response.ok) {
        return null;
      }

      const contentType = String(response.headers.get('content-type') || '').toLowerCase();

      // For PNG/JPG assets, use raw bytes directly.
      if (contentType.includes('image/png') || contentType.includes('image/jpeg') || contentType.includes('image/jpg')) {
        const bytes = await response.arrayBuffer();
        return new Uint8Array(bytes);
      }

      // If content type is missing, rely on file extension as a fallback.
      const normalizedPath = String(path || '').toLowerCase();
      if (normalizedPath.endsWith('.png') || normalizedPath.endsWith('.jpg') || normalizedPath.endsWith('.jpeg')) {
        const bytes = await response.arrayBuffer();
        return new Uint8Array(bytes);
      }

      // For SVG, rasterize to PNG before embedding into PDF.
      const svgText = await response.text();
      const blob = new Blob([svgText], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(blob);

      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Unable to load logo image'));
        img.src = url;
      });

      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, image.width);
      canvas.height = Math.max(1, image.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        URL.revokeObjectURL(url);
        return null;
      }

      ctx.drawImage(image, 0, 0);
      URL.revokeObjectURL(url);

      const dataUrl = canvas.toDataURL('image/png');
      const bytes = await fetch(dataUrl).then((response) => response.arrayBuffer());
      return new Uint8Array(bytes);
    } catch {
      return null;
    }
  }

  private async loadLogoPreviewSrc(businessProfile?: BusinessProfileSettings | null): Promise<string | null> {
    const showLogo = this.parsePrintBool(businessProfile?.printShowLogo, true);
    if (!showLogo) {
      return null;
    }

    const preferredLogo = String(
      (businessProfile?.printLogoVariant ?? 'light') === 'dark'
        ? (businessProfile?.businessLogoDark ?? businessProfile?.businessLogo ?? '')
        : (businessProfile?.businessLogoLight ?? businessProfile?.businessLogo ?? ''),
    ).trim();

    const candidates = [preferredLogo, '/images/air-summit-logo.png', '/images/logo/logo.svg'].filter(
      (path) => String(path || '').trim().length > 0,
    );

    for (const path of candidates) {
      try {
        const response = await fetch(path);
        if (!response.ok) {
          continue;
        }

        const blob = await response.blob();
        return await this.blobToDataUrl(blob);
      } catch {
        // Try next candidate path.
      }
    }

    return null;
  }

  private async buildQuotationHeaderProfile(
    businessProfile: BusinessProfileSettings | null,
  ): Promise<QuotationHeaderProfile> {
    const businessName = String(businessProfile?.businessName ?? '').trim() || 'HVAC Warehouse & Sales';
    const showAddress = this.parsePrintBool(businessProfile?.printAddressShowQuotation, true);
    const addressDetails = showAddress
      ? String(businessProfile?.printAddressDetails ?? businessProfile?.businessAddress ?? '').trim()
      : '';

    const contactDetails = String(businessProfile?.businessContact ?? '').trim();
    const emailDetails = String(businessProfile?.businessEmail ?? '').trim();
    const logoSrc = await this.loadLogoPreviewSrc(businessProfile);

    return {
      businessName,
      addressDetails,
      contactDetails,
      emailDetails,
      logoSrc,
    };
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

  private parsePrintBool(value: string | null | undefined, defaultValue: boolean): boolean {
    if (value === null || value === undefined) {
      return defaultValue;
    }

    return String(value).trim().toLowerCase() === 'true';
  }

  private resolveAssetUrl(path: string): string {
    const normalizedPath = String(path ?? '').trim();
    if (!normalizedPath) {
      return '';
    }

    if (/^https?:\/\//i.test(normalizedPath) || normalizedPath.startsWith('data:') || normalizedPath.startsWith('blob:')) {
      return normalizedPath;
    }

    if (typeof window === 'undefined') {
      return normalizedPath;
    }

    return new URL(normalizedPath, window.location.origin).toString();
  }

  private blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          resolve(reader.result);
          return;
        }

        reject(new Error('Unable to convert blob to data URL'));
      };
      reader.onerror = () => reject(new Error('Unable to convert blob to data URL'));
      reader.readAsDataURL(blob);
    });
  }

  private openQuotationPreview(blobUrl: string, filename: string): void {
    this.revokeQuotationPreviewUrl();
    this.quotationPreviewObjectUrl = blobUrl;
    this.quotationPreviewUrl = this.sanitizer.bypassSecurityTrustResourceUrl(blobUrl);
    this.quotationPreviewFilename = filename;
    this.isQuotationPreviewOpen = true;
  }

  private revokeQuotationPreviewUrl(): void {
    if (this.quotationPreviewObjectUrl) {
      URL.revokeObjectURL(this.quotationPreviewObjectUrl);
    }

    this.quotationPreviewObjectUrl = null;
    this.quotationPreviewUrl = null;
  }

  private escapeHtml(value: string): string {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  formatAmount(value: number): string {
    return new Intl.NumberFormat('en-PH', {
      style: 'currency',
      currency: 'PHP',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Number(value ?? 0));
  }

  private formatAmountPdf(value: number): string {
    return Number(value ?? 0).toLocaleString('en-PH', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  formatDateOnly(value: string | null | undefined): string {
    if (!value) {
      return '-';
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return String(value);
    }

    return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`;
  }

  isFinalized(item: QuotationListItem): boolean {
    return String(item.status ?? '').trim().toLowerCase() === 'finalized';
  }

  isConverted(item: QuotationListItem): boolean {
    return String(item.status ?? '').trim().toLowerCase() === 'converted';
  }

  isExpired(item: QuotationListItem): boolean {
    return Boolean(item.isDeleted) || String(item.status ?? '').trim().toLowerCase() === 'expired';
  }
}
