import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { PageBreadcrumbComponent } from '../../shared/components/common/page-breadcrumb/page-breadcrumb.component';
import { ModalComponent } from '../../shared/components/ui/modal/modal.component';
import { CanDirective } from '../../shared/directives/can.directive';
import {
  CustomerQueryParams,
  SalesCustomerConcern,
  SalesCustomerDetail,
  SalesCustomerOrder,
  SalesCustomerSoPayment,
  SalesCustomerSettlement,
  SalesStatementOfAccountItem,
  SalesOrderService,
} from '../../shared/services/sales-order.service';
import { PurchaseOrderService, VendorDetail } from '../../shared/services/purchase-order.service';
import { RbacService } from '../../shared/services/rbac.service';
import { BusinessSettingsService, BusinessProfileSettings } from '../../shared/services/business-settings.service';

type StakeholderTab = 'regular' | 'sub_dealer' | 'dealer';
type DetailTab = 'orders' | 'payments' | 'statement' | 'concerns';

@Component({
  selector: 'app-customers',
  standalone: true,
  imports: [CommonModule, FormsModule, PageBreadcrumbComponent, ModalComponent, CanDirective],
  templateUrl: './customers.component.html',
  styles: ``,
})
export class CustomersComponent implements OnInit {
  activeTab: StakeholderTab = 'regular';
  search = '';
  page = 1;
  limit = 20;
  total = 0;
  totalPages = 1;
  isLoading = false;

  customers: SalesCustomerDetail[] = [];

  isModalOpen = false;
  isDrawerOpen = false;
  modalMode: 'create' | 'edit' = 'create';
  editingCustomer: SalesCustomerDetail | null = null;
  selectedCustomer: SalesCustomerDetail | null = null;

  form: Partial<SalesCustomerDetail> = this.createEmptyForm();

  detailTab: DetailTab = 'orders';
  orders: SalesCustomerOrder[] = [];
  soPayments: SalesCustomerSoPayment[] = [];
  settlements: SalesCustomerSettlement[] = [];
  paymentSummary = { totalCharges: 0, totalManualPayments: 0, outstandingBalance: 0 };
  concerns: SalesCustomerConcern[] = [];
  statements: SalesStatementOfAccountItem[] = [];
  isDetailLoading = false;

  soaForm = { periodFrom: this.defaultPeriodFrom(), periodTo: this.defaultPeriodTo(), dueDate: '', notes: '' };
  isSaving = false;
  isGeneratingSoa = false;
  uiError = '';

  // SOA preview
  isSoaPreviewOpen = false;
  soaPreviewUrl: SafeResourceUrl | null = null;
  soaPreviewFilename = 'statement-of-account.pdf';
  private soaPreviewObjectUrl: string | null = null;

  constructor(
    private readonly salesOrderService: SalesOrderService,
    private readonly purchaseOrderService: PurchaseOrderService,
    private readonly rbacService: RbacService,
    private readonly sanitizer: DomSanitizer,
    private readonly businessSettingsService: BusinessSettingsService,
  ) {}

  private mapVendorToStakeholder(vendor: VendorDetail): SalesCustomerDetail {
    return {
      id: String(vendor.id ?? ''),
      name: String(vendor.name ?? '').trim(),
      customer_type: 'dealer',
      current_balance: 0,
      credit_limit: 0,
      payment_terms: 0,
      address: String(vendor.address ?? '').trim(),
      contact_person: String(vendor.contact_person ?? '').trim(),
      contact_number: String(vendor.contact_number ?? '').trim(),
      email: String(vendor.email ?? '').trim(),
      tin_number: String(vendor.tin_number ?? '').trim(),
      created_at: vendor.created_at ?? null,
      updated_at: vendor.updated_at ?? null,
    };
  }

  isDealerStakeholder(customer: SalesCustomerDetail | Partial<SalesCustomerDetail> | null | undefined = this.selectedCustomer): boolean {
    return String(customer?.customer_type ?? '').trim().toLowerCase() === 'dealer';
  }

  ngOnInit(): void {
    void this.loadCustomers();
  }

  get canCreateCustomer(): boolean { return this.rbacService.canAccess('customers', 'canCreate'); }
  get canUpdateCustomer(): boolean { return this.rbacService.canAccess('customers', 'canUpdate'); }
  get canDeleteCustomer(): boolean { return this.rbacService.canAccess('customers', 'canDelete'); }
  get canViewCustomers(): boolean { return this.rbacService.canAccess('customers', 'canRead'); }

  get tabLabel(): string {
    if (this.activeTab === 'sub_dealer') return 'Sub-Dealers';
    if (this.activeTab === 'dealer') return 'Dealers';
    return 'Stakeholders';
  }

  async loadCustomers(): Promise<void> {
    if (!this.canViewCustomers) { this.customers = []; return; }
    this.isLoading = true;
    this.uiError = '';
    try {
      if (this.activeTab === 'dealer') {
        const response = await this.purchaseOrderService.listVendorStakeholders({
          search: this.search.trim() || undefined,
          page: this.page,
          limit: this.limit,
        });
        this.customers = response.items.map((item) => this.mapVendorToStakeholder(item));
        this.total = response.meta.total;
        this.totalPages = response.meta.totalPages;
        return;
      }

      const params: CustomerQueryParams = {
        search: this.search.trim() || undefined,
        type: this.activeTab as 'regular' | 'sub_dealer',
        page: this.page,
        limit: this.limit,
      };
      const response = await this.salesOrderService.listCustomers(params);
      this.customers = response.items;
      this.total = response.meta.total;
      this.totalPages = response.meta.totalPages;
    } catch (error: unknown) {
      this.uiError = (error as Error)?.message || 'Failed to load stakeholders';
      this.customers = [];
      this.total = 0;
      this.totalPages = 1;
    } finally {
      this.isLoading = false;
    }
  }

  onSearchChange(value: string): void {
    this.search = value;
    this.page = 1;
    void this.loadCustomers();
  }

  onTabChange(tab: StakeholderTab): void {
    this.activeTab = tab;
    this.page = 1;
    void this.loadCustomers();
  }

  onPageChange(next: number): void {
    if (next < 1 || next > this.totalPages) return;
    this.page = next;
    void this.loadCustomers();
  }

  openCreateModal(): void {
    this.modalMode = 'create';
    this.editingCustomer = null;
    this.form = this.createEmptyForm();
    this.isModalOpen = true;
    this.uiError = '';
  }

  openEditModal(customer: SalesCustomerDetail): void {
    this.modalMode = 'edit';
    this.editingCustomer = customer;
    this.form = { ...customer };
    this.isModalOpen = true;
    this.uiError = '';
  }

  openDetailsDrawer(customer: SalesCustomerDetail): void {
    this.selectedCustomer = customer;
    this.detailTab = 'orders';
    this.soaForm = { periodFrom: this.defaultPeriodFrom(), periodTo: this.defaultPeriodTo(), dueDate: '', notes: '' };
    this.isDrawerOpen = true;
    if (this.isDealerStakeholder(customer)) {
      this.orders = [];
      this.soPayments = [];
      this.settlements = [];
      this.concerns = [];
      this.statements = [];
      this.paymentSummary = { totalCharges: 0, totalManualPayments: 0, outstandingBalance: 0 };
      this.isDetailLoading = false;
      return;
    }
    void this.loadCustomerDetails(customer.id);
  }

  closeModal(): void {
    this.isModalOpen = false;
    this.editingCustomer = null;
  }

  closeDrawer(): void {
    this.isDrawerOpen = false;
    this.selectedCustomer = null;
    this.isDetailLoading = false;
    this.revokeSoaPreview();
  }

  private createEmptyForm(): Partial<SalesCustomerDetail> {
    return {
      name: '',
      customer_type: this.activeTab,
      current_balance: 0,
      payment_terms: 0,
      address: '',
      contact_person: '',
      contact_number: '',
      email: '',
      tin_number: '',
    };
  }

  async saveCustomer(): Promise<void> {
    if (this.activeTab === 'dealer' || this.isDealerStakeholder(this.form)) {
      const payload = {
        name: String(this.form.name ?? '').trim(),
        address: String(this.form.address ?? '').trim(),
        contactPerson: String(this.form.contact_person ?? '').trim(),
        contactNumber: String(this.form.contact_number ?? '').trim(),
        email: String(this.form.email ?? '').trim(),
        tinNumber: String(this.form.tin_number ?? '').trim(),
      };
      if (!payload.name) { this.uiError = 'Name is required'; return; }
      this.isSaving = true;
      this.uiError = '';
      try {
        if (this.modalMode === 'edit' && this.editingCustomer) {
          await this.purchaseOrderService.updateVendor(this.editingCustomer.id, payload);
        } else {
          await this.purchaseOrderService.createVendor(payload);
        }
        this.isModalOpen = false;
        void this.loadCustomers();
      } catch (error: unknown) {
        this.uiError = (error as Error)?.message || 'Failed to save';
      } finally {
        this.isSaving = false;
      }
      return;
    }

    const payload = {
      name: String(this.form.name ?? '').trim(),
      address: String(this.form.address ?? '').trim(),
      contactPerson: String(this.form.contact_person ?? '').trim(),
      contactNumber: String(this.form.contact_number ?? '').trim(),
      email: String(this.form.email ?? '').trim(),
      tinNumber: String(this.form.tin_number ?? '').trim(),
      customerType: String(this.form.customer_type ?? this.activeTab) as 'regular' | 'sub_dealer',
      paymentTerms: Number(this.form.payment_terms ?? 0),
    };
    if (!payload.name) { this.uiError = 'Name is required'; return; }
    this.isSaving = true;
    this.uiError = '';
    try {
      if (this.modalMode === 'edit' && this.editingCustomer) {
        await this.salesOrderService.updateCustomer(this.editingCustomer.id, payload);
      } else {
        await this.salesOrderService.createCustomer(payload);
      }
      this.isModalOpen = false;
      void this.loadCustomers();
    } catch (error: unknown) {
      this.uiError = (error as Error)?.message || 'Failed to save';
    } finally {
      this.isSaving = false;
    }
  }

  async deleteCustomer(customer: SalesCustomerDetail): Promise<void> {
    if (!confirm(`Delete "${customer.name}"? This cannot be undone.`)) return;
    try {
      if (this.isDealerStakeholder(customer)) {
        await this.purchaseOrderService.deleteVendor(customer.id);
        void this.loadCustomers();
        return;
      }
      await this.salesOrderService.deleteCustomer(customer.id);
      void this.loadCustomers();
    } catch (error: unknown) {
      this.uiError = (error as Error)?.message || 'Failed to delete';
    }
  }

  private async loadCustomerDetails(customerId: string): Promise<void> {
    if (!customerId) return;
    this.isDetailLoading = true;
    this.uiError = '';
    try {
      this.orders = [];
      this.soPayments = [];
      this.settlements = [];
      this.concerns = [];
      this.statements = [];
      this.paymentSummary = { totalCharges: 0, totalManualPayments: 0, outstandingBalance: 0 };

      const [ordersResult, paymentsResult, concernsResult, statementsResult] = await Promise.all([
        this.salesOrderService.getCustomerOrders(customerId, { page: 1, limit: 50 }),
        this.salesOrderService.getCustomerPayments(customerId),
        this.salesOrderService.getCustomerConcerns(customerId),
        this.salesOrderService.getCustomerStatementOfAccounts(customerId, { page: 1, limit: 20 }),
      ]);

      this.orders = ordersResult.items;
      this.soPayments = paymentsResult.soPayments ?? [];
      this.settlements = paymentsResult.settlements ?? [];
      this.paymentSummary = paymentsResult.summary ?? { totalCharges: 0, totalManualPayments: 0, outstandingBalance: 0 };
      this.concerns = concernsResult.items ?? [];
      this.statements = statementsResult.items;
    } catch (error: unknown) {
      this.uiError = (error as Error)?.message || 'Failed to load details';
    } finally {
      this.isDetailLoading = false;
    }
  }

  // ── Formatting helpers ──────────────────────────────────────────────

  formatAmount(value: number | null | undefined): string {
    return new Intl.NumberFormat('en-PH', {
      style: 'currency', currency: 'PHP', minimumFractionDigits: 2,
    }).format(Number(value ?? 0));
  }

  formatDate(value: string | null | undefined): string {
    const raw = String(value ?? '').trim();
    if (!raw) return '—';
    const d = new Date(raw);
    if (isNaN(d.getTime())) return raw;
    return d.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: '2-digit' });
  }

  formatDateTime(value: string | null | undefined): string {
    const raw = String(value ?? '').trim();
    if (!raw) return '—';
    const d = new Date(raw);
    if (isNaN(d.getTime())) return raw;
    return d.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: '2-digit' }) +
      ' ' + d.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' });
  }

  // Days remaining until a due date (negative = overdue)
  daysUntil(dateStr: string | null | undefined): number | null {
    if (!dateStr) return null;
    const due = new Date(dateStr);
    if (isNaN(due.getTime())) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    due.setHours(0, 0, 0, 0);
    return Math.round((due.getTime() - today.getTime()) / 86400000);
  }

  daysLabel(days: number | null): string {
    if (days === null) return '';
    if (days === 0) return 'Due today';
    if (days > 0) return `${days}d remaining`;
    return `${Math.abs(days)}d overdue`;
  }

  daysClass(days: number | null): string {
    if (days === null) return '';
    if (days < 0) return 'text-error-600 dark:text-error-400 font-semibold';
    if (days <= 7) return 'text-warning-600 dark:text-warning-400 font-semibold';
    return 'text-success-600 dark:text-success-400';
  }

  statusBadgeClass(status: string): string {
    const s = (status ?? '').toLowerCase();
    if (['paid', 'completed', 'complete', 'resolved', 'closed'].includes(s))
      return 'bg-success-50 text-success-700 dark:bg-success-500/15 dark:text-success-400';
    if (['overdue', 'rejected', 'cancelled'].includes(s))
      return 'bg-error-50 text-error-700 dark:bg-error-500/15 dark:text-error-400';
    if (['unpaid', 'pending', 'open', 'in_progress', 'in-progress', 'scheduled'].includes(s))
      return 'bg-warning-50 text-warning-700 dark:bg-warning-500/15 dark:text-warning-400';
    return 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300';
  }

  priorityBadgeClass(priority: string): string {
    const p = (priority ?? '').toLowerCase();
    if (p === 'urgent' || p === 'high') return 'bg-error-50 text-error-700 dark:bg-error-500/15 dark:text-error-400';
    if (p === 'medium') return 'bg-warning-50 text-warning-700 dark:bg-warning-500/15 dark:text-warning-400';
    return 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300';
  }

  // Get the effective due date for a payment (terms or cheque post-dated)
  getEffectiveDueDate(payment: SalesCustomerSoPayment): string | null {
    return payment.termsDueDate ?? payment.postDated ?? null;
  }

  // Concern display label
  getConcernLabel(concern: SalesCustomerConcern): string {
    if (concern.serviceName) return concern.serviceName;
    if (concern.concernSubject) return concern.concernSubject;
    return concern.salesType || 'Service/Concern';
  }

  getConcernStatus(concern: SalesCustomerConcern): string {
    return concern.serviceStatus || concern.concernStatus || concern.status || '';
  }

  // ── SOA ─────────────────────────────────────────────────────────────

  async generateStatementOfAccount(): Promise<void> {
    if (!this.selectedCustomer) return;
    this.isGeneratingSoa = true;
    this.uiError = '';
    try {
      const response = await this.salesOrderService.createCustomerStatementOfAccount(
        this.selectedCustomer.id,
        { periodFrom: this.soaForm.periodFrom, periodTo: this.soaForm.periodTo, dueDate: this.soaForm.dueDate || undefined, notes: this.soaForm.notes || undefined },
      );
      if (!response.success) { this.uiError = response.message || 'Failed to generate SOA'; return; }
      await this.loadCustomerDetails(this.selectedCustomer.id);
      const created = this.statements.find((s) => s.id === Number(response.data?.statementOfAccountId ?? 0));
      if (created) await this.previewSoaPdf(created);
    } catch (error: unknown) {
      this.uiError = (error as Error)?.message || 'Failed to generate SOA';
    } finally {
      this.isGeneratingSoa = false;
    }
  }

  async previewSoaPdf(statement: SalesStatementOfAccountItem): Promise<void> {
    if (!this.selectedCustomer) return;
    const pdfBytes = await this.buildSoaPdf(statement);
    this.revokeSoaPreview();
    const blob = new Blob([new Uint8Array(pdfBytes)], { type: 'application/pdf' });
    this.soaPreviewObjectUrl = URL.createObjectURL(blob);
    this.soaPreviewUrl = this.sanitizer.bypassSecurityTrustResourceUrl(this.soaPreviewObjectUrl);
    this.soaPreviewFilename = `${statement.soaNumber || 'SOA'}.pdf`;
    this.isSoaPreviewOpen = true;
  }

  closeSoaPreview(): void {
    this.isSoaPreviewOpen = false;
    this.revokeSoaPreview();
  }

  downloadSoaPdf(): void {
    if (!this.soaPreviewObjectUrl) return;
    const a = document.createElement('a');
    a.href = this.soaPreviewObjectUrl;
    a.download = this.soaPreviewFilename;
    a.click();
  }

  private revokeSoaPreview(): void {
    if (this.soaPreviewObjectUrl) URL.revokeObjectURL(this.soaPreviewObjectUrl);
    this.soaPreviewObjectUrl = null;
    this.soaPreviewUrl = null;
  }

  // Format amount for PDF — uses PHP prefix instead of ₱ symbol (WinAnsi font limitation)
  private formatAmountPdf(value: number | null | undefined): string {
    return 'PHP ' + new Intl.NumberFormat('en-PH', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Number(value ?? 0));
  }

  private async buildSoaPdf(statement: SalesStatementOfAccountItem): Promise<Uint8Array> {
    const customer = this.selectedCustomer!;

    // Load business profile for header
    let biz: BusinessProfileSettings | null = null;
    try { biz = await this.businessSettingsService.getBusinessProfile(); } catch { /* use defaults */ }

    const pdfDoc = await PDFDocument.create();
    const reg = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    // ── helpers ──────────────────────────────────────────────────────
    const brand: [number, number, number] = [0.06, 0.47, 0.87];
    const dark: [number, number, number] = [0.1, 0.1, 0.1];
    const gray: [number, number, number] = [0.45, 0.45, 0.45];
    const lightGray: [number, number, number] = [0.92, 0.92, 0.92];
    const white: [number, number, number] = [1, 1, 1];
    const red: [number, number, number] = [0.75, 0.1, 0.1];
    const green: [number, number, number] = [0.1, 0.5, 0.2];
    const amber: [number, number, number] = [0.7, 0.45, 0.0];

    // Build ledger rows from orders — each SO gets a charge row, then separate rows for each payment event
    interface LedgerRow {
      date: string;
      soNumber: string;
      transaction: string;
      details: string;
      amount: number;       // charge (SO total)
      payment: number;      // cash/paid settlement amount
      downPayment: number;  // down payment
      balance: number;      // running balance after this row
    }

    const rows: LedgerRow[] = [];
    let runningBalance = 0;

    // Sort orders ascending by date for correct running balance
    const sortedOrders = [...this.orders].sort((a, b) => {
      const da = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const db = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return da - db;
    });

    for (const order of sortedOrders) {
      const pmts = order.payments ?? [];
      const totalDP = pmts.reduce((s, p) => s + (p.downPayment ?? 0), 0);

      // Build product details string
      const details = (order.productItems ?? []).map((p) => {
        const cap = p.capacity ? ` (${p.capacity})` : '';
        const price = p.discountPrice > 0 ? p.discountPrice : p.unitPrice;
        return `${p.qty}x ${p.productName}${cap} @ ${this.formatAmountPdf(price)}`;
      }).join('\n') || order.salesType || 'Sales Order';

      // Determine transaction label — just the method, no extra text
      const method = pmts.length > 0 ? (pmts[0].method || 'Sales') : 'Sales';
      const hasDP = totalDP > 0;
      // If has DP and still unpaid terms → show method only (e.g. "Terms with DP")
      // If fully paid cash/bank → show method only (e.g. "Cash")
      const transaction = method;

      // Row 1: SO charge row — amount + DP, payment column is blank
      runningBalance += order.totalAmount;
      runningBalance -= totalDP;

      rows.push({
        date: this.formatDate(order.createdAt),
        soNumber: order.soNumber,
        transaction,
        details,
        amount: order.totalAmount,
        payment: 0,           // no payment on charge row
        downPayment: totalDP,
        balance: Math.max(0, runningBalance),
      });

      // Row 2+: Each paid settlement on this SO gets its own row
      // Use the payment date if available, otherwise SO date
      const paidPayments = pmts.filter(p => p.status === 'paid' && p.amount > 0);
      for (const pmt of paidPayments) {
        runningBalance -= pmt.amount;
        // Use actual payment date, fall back to SO date
        const pmtDate = pmt.paymentDate || pmt.termsDueDate || pmt.postDated || order.createdAt;
        rows.push({
          date: this.formatDate(pmtDate),
          soNumber: order.soNumber,
          transaction: 'Partial Payment',
          details: 'Settlement',
          amount: 0,
          payment: pmt.amount,
          downPayment: 0,
          balance: Math.max(0, runningBalance),
        });
      }
    }

    // Manual settlements from dashboard — each is its own row with actual payment date
    const sortedSettlements = [...this.settlements].sort((a, b) => {
      const da = a.date ? new Date(a.date).getTime() : 0;
      const db = b.date ? new Date(b.date).getTime() : 0;
      return da - db;
    });
    for (const s of sortedSettlements) {
      runningBalance -= s.amount;
      rows.push({
        date: this.formatDate(s.date),   // actual settlement date
        soNumber: s.soNumber ?? '—',
        transaction: 'Partial Payment',
        details: s.notes || 'Settlement',
        amount: 0,
        payment: s.amount,
        downPayment: 0,
        balance: Math.max(0, runningBalance),
      });
    }

    // ── Page setup ───────────────────────────────────────────────────
    const pageW = 842; // A4 landscape
    const pageH = 595;
    const margin = 36;
    const rowH = 32;  // increased for proper line height
    const headerH = 155;
    const tableHeaderH = 22;
    const footerH = 50;
    const usableH = pageH - margin - headerH - tableHeaderH - footerH;
    const rowsPerPage = Math.floor(usableH / rowH);

    // Column x positions and widths
    const cols = {
      date:        { x: margin,       w: 68 },
      soNum:       { x: margin + 68,  w: 72 },
      transaction: { x: margin + 140, w: 100 },
      details:     { x: margin + 240, w: 200 },
      amount:      { x: margin + 440, w: 80 },
      payment:     { x: margin + 520, w: 72 },
      dp:          { x: margin + 592, w: 72 },
      balance:     { x: margin + 664, w: 80 },
    };
    const tableW = pageW - margin * 2;

    const totalPages = Math.max(1, Math.ceil(rows.length / rowsPerPage));

    const drawPage = async (pageIndex: number): Promise<ReturnType<typeof pdfDoc.addPage>> => {
      const page = pdfDoc.addPage([pageW, pageH]);

      const txt = (text: string, x: number, y: number, opts?: {
        size?: number; font?: typeof reg; color?: [number, number, number]; maxWidth?: number;
      }) => {
        const safeText = String(text ?? '').replace(/[\u0080-\uFFFF]/g, (c) => {
          // Replace non-WinAnsi chars with safe equivalents
          if (c === '\u20b1') return 'PHP';
          return '?';
        });
        try {
          page.drawText(safeText, {
            x, y,
            size: opts?.size ?? 9,
            font: opts?.font ?? reg,
            color: rgb(...(opts?.color ?? dark)),
            maxWidth: opts?.maxWidth,
          });
        } catch { /* skip unencodable chars */ }
      };

      let y = pageH - margin;

      // ── Company Header ──────────────────────────────────────────────
      // Logo (if available as base64 PNG/JPEG)
      const logoSrc = String(biz?.businessLogoLight ?? biz?.businessLogo ?? '').trim();
      let logoDrawn = false;
      if (logoSrc.startsWith('data:image/png;base64,') || logoSrc.startsWith('data:image/jpeg;base64,')) {
        try {
          const base64 = logoSrc.split(',')[1];
          const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
          const img = logoSrc.includes('png')
            ? await pdfDoc.embedPng(bytes)
            : await pdfDoc.embedJpg(bytes);
          const logoH = 40;
          const logoW = img.width * (logoH / img.height);
          page.drawImage(img, { x: margin, y: y - logoH, width: logoW, height: logoH });
          logoDrawn = true;
        } catch { /* skip logo on error */ }
      }

      // Business name & address
      const bizName = String(biz?.businessName ?? 'HVAC Warehouse & Sales').trim();
      const bizAddr = String(biz?.businessAddress ?? '').trim();
      const bizContact = String(biz?.businessContact ?? '').trim();
      const bizEmail = String(biz?.businessEmail ?? '').trim();
      const nameX = logoDrawn ? margin + 90 : margin;

      txt(bizName, nameX, y - 12, { size: 14, font: bold, color: brand });
      if (bizAddr) txt(bizAddr, nameX, y - 26, { size: 8, color: gray });
      if (bizContact || bizEmail) txt([bizContact, bizEmail].filter(Boolean).join('  |  '), nameX, y - 38, { size: 8, color: gray });

      // SOA title on right
      txt('STATEMENT OF ACCOUNT', pageW - margin - 180, y - 12, { size: 13, font: bold, color: brand });
      txt(`SOA No: ${statement.soaNumber || '—'}`, pageW - margin - 180, y - 28, { size: 9, color: dark });
      txt(`Generated: ${this.formatDate(statement.generatedAt)}`, pageW - margin - 180, y - 42, { size: 9, color: gray });
      txt(`Page ${pageIndex + 1} of ${totalPages}`, pageW - margin - 180, y - 56, { size: 8, color: gray });

      y -= 65;
      page.drawLine({ start: { x: margin, y }, end: { x: pageW - margin, y }, thickness: 0.5, color: rgb(...lightGray) });
      y -= 12;

      // ── Customer Info ───────────────────────────────────────────────
      txt('BILL TO:', margin, y, { size: 8, font: bold, color: gray });
      txt(customer.name, margin + 50, y, { size: 10, font: bold });
      txt(`Address: ${customer.address || '—'}`, margin + 50, y - 14, { size: 8, color: gray });
      txt(`Contact: ${customer.contact_person || '—'}  ${customer.contact_number || ''}`, margin + 50, y - 26, { size: 8, color: gray });

      // Period info on right
      txt('PERIOD:', pageW - margin - 200, y, { size: 8, font: bold, color: gray });
      txt(`${this.formatDate(statement.periodFrom)} to ${this.formatDate(statement.periodTo)}`, pageW - margin - 200, y - 14, { size: 9, font: bold });
      if (statement.dueDate) txt(`Due: ${this.formatDate(statement.dueDate)}`, pageW - margin - 200, y - 28, { size: 8, color: amber });

      y -= 44;
      page.drawLine({ start: { x: margin, y }, end: { x: pageW - margin, y }, thickness: 0.5, color: rgb(...lightGray) });
      y -= 4;

      // ── Table Header ────────────────────────────────────────────────
      page.drawRectangle({ x: margin, y: y - tableHeaderH, width: tableW, height: tableHeaderH, color: rgb(...brand) });
      const hY = y - tableHeaderH + 6;
      txt('Date',        cols.date.x + 2,        hY, { size: 8, font: bold, color: white });
      txt('SO #',        cols.soNum.x + 2,        hY, { size: 8, font: bold, color: white });
      txt('Transaction', cols.transaction.x + 2,  hY, { size: 8, font: bold, color: white });
      txt('Details',     cols.details.x + 2,      hY, { size: 8, font: bold, color: white });
      txt('Amount',      cols.amount.x + 2,        hY, { size: 8, font: bold, color: white });
      txt('Payment',     cols.payment.x + 2,       hY, { size: 8, font: bold, color: white });
      txt('Down Pmt',    cols.dp.x + 2,            hY, { size: 8, font: bold, color: white });
      txt('Balance',     cols.balance.x + 2,       hY, { size: 8, font: bold, color: white });
      y -= tableHeaderH + 4;

      // ── Table Rows ──────────────────────────────────────────────────
      const pageRows = rows.slice(pageIndex * rowsPerPage, (pageIndex + 1) * rowsPerPage);
      pageRows.forEach((row, i) => {
        const rowY = y - i * rowH;
        // Alternating row background
        if (i % 2 === 0) {
          page.drawRectangle({ x: margin, y: rowY - rowH + 4, width: tableW, height: rowH, color: rgb(0.97, 0.97, 0.97) });
        }
        const textY = rowY - 12;
        txt(row.date,        cols.date.x + 2,        textY, { size: 8 });
        txt(row.soNumber,    cols.soNum.x + 2,        textY, { size: 8, color: brand });
        txt(row.transaction, cols.transaction.x + 2,  textY, { size: 7.5, maxWidth: cols.transaction.w - 4 });

        // Details — single line only to prevent overlap
        const firstDetail = row.details.split('\n')[0] ?? '';
        txt(firstDetail, cols.details.x + 2, textY, { size: 7.5, maxWidth: cols.details.w - 4, color: gray });

        // Amounts right-aligned
        const amtStr = row.amount > 0 ? this.formatAmountPdf(row.amount) : '-';
        const pmtStr = row.payment > 0 ? this.formatAmountPdf(row.payment) : '-';
        const dpStr  = row.downPayment > 0 ? this.formatAmountPdf(row.downPayment) : '-';
        const balStr = this.formatAmountPdf(row.balance);

        txt(amtStr, cols.amount.x + 2,  textY, { size: 8 });
        txt(pmtStr, cols.payment.x + 2, textY, { size: 8, color: row.payment > 0 ? green : gray });
        txt(dpStr,  cols.dp.x + 2,      textY, { size: 8, color: row.downPayment > 0 ? [0.4, 0.1, 0.7] as [number,number,number] : gray });
        txt(balStr, cols.balance.x + 2, textY, { size: 8, font: bold, color: row.balance > 0 ? red : green });

        // Row separator
        page.drawLine({
          start: { x: margin, y: rowY - rowH + 4 },
          end: { x: pageW - margin, y: rowY - rowH + 4 },
          thickness: 0.3, color: rgb(...lightGray),
        });
      });

      // ── Grand Total (last page only) ────────────────────────────────
      if (pageIndex === totalPages - 1) {
        const totalY = y - pageRows.length * rowH - 4;
        page.drawRectangle({ x: margin, y: totalY - 18, width: tableW, height: 20, color: rgb(...brand) });
        txt('GRAND TOTAL', cols.details.x + 2, totalY - 6, { size: 9, font: bold, color: white });
        const grandAmount  = rows.reduce((s, r) => s + r.amount, 0);
        const grandPayment = rows.reduce((s, r) => s + r.payment, 0);
        const grandDP      = rows.reduce((s, r) => s + r.downPayment, 0);
        const grandBalance = rows.length > 0 ? rows[rows.length - 1].balance : 0;
        txt(this.formatAmountPdf(grandAmount),  cols.amount.x + 2,  totalY - 6, { size: 9, font: bold, color: white });
        txt(this.formatAmountPdf(grandPayment), cols.payment.x + 2, totalY - 6, { size: 9, font: bold, color: white });
        txt(this.formatAmountPdf(grandDP),      cols.dp.x + 2,      totalY - 6, { size: 9, font: bold, color: white });
        txt(this.formatAmountPdf(grandBalance), cols.balance.x + 2, totalY - 6, { size: 9, font: bold, color: white });

        // Notes
        if (statement.notes) {
          const notesY = totalY - 36;
          txt('Notes:', margin, notesY, { size: 8, font: bold, color: gray });
          const noteLines = this.wrapPdfText(statement.notes, 120);
          noteLines.slice(0, 3).forEach((line, i) => {
            txt(line, margin + 40, notesY - i * 12, { size: 8, color: gray });
          });
        }
      }

      // ── Footer ──────────────────────────────────────────────────────
      page.drawLine({ start: { x: margin, y: margin + 30 }, end: { x: pageW - margin, y: margin + 30 }, thickness: 0.4, color: rgb(...lightGray) });
      txt('This document was generated electronically from HVAC Warehouse and Sales Management System.', margin, margin + 18, { size: 7, color: gray });
      const footerRight = String(biz?.printFooterText ?? '').trim() || 'For inquiries, please contact your account manager.';
      txt(footerRight, margin, margin + 8, { size: 7, color: gray });

      return page;
    };

    // Generate all pages
    for (let i = 0; i < totalPages; i++) {
      await drawPage(i);
    }

    return pdfDoc.save();
  }

  private defaultPeriodFrom(): string {
    return `${new Date().getFullYear()}-01-01`;
  }

  private defaultPeriodTo(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private wrapPdfText(text: string, maxChars: number): string[] {
    const words = String(text ?? '').split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let line = '';
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (next.length <= maxChars) { line = next; continue; }
      if (line) lines.push(line);
      line = word;
    }
    if (line) lines.push(line);
    return lines.length > 0 ? lines : [''];
  }
}
