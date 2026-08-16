import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { ModalComponent } from '../../shared/components/ui/modal/modal.component';
import { TableComponent } from '../../shared/components/ui/table/table.component';
import {
  CreateProjectPayload,
  ProjectBilling,
  ProjectDetail,
  ProjectListItem,
  ProjectRelatedSalesOrder,
  ProjectSoaItem,
  ProjectsService,
} from '../../shared/services/projects.service';
import {
  ProductOption,
  SalesCustomerOption,
  SalesOrderDetailItem,
  SalesOrderService,
} from '../../shared/services/sales-order.service';
import {
  BusinessProfileSettings,
  BusinessSettingsService,
} from '../../shared/services/business-settings.service';
import { apiClient } from '../../shared/services/api-client';
import { RbacService } from '../../shared/services/rbac.service';
import axios from 'axios';

@Component({
  selector: 'app-projects',
  standalone: true,
  imports: [CommonModule, FormsModule, ModalComponent, TableComponent],
  templateUrl: './projects.component.html',
  styleUrls: ['./projects.component.css'],
})
export class ProjectsComponent implements OnInit, OnDestroy {
  projects: ProjectListItem[] = [];
  selectedProject: ProjectDetail | null = null;
  billing: ProjectBilling | null = null;
  statements: ProjectSoaItem[] = [];

  isDrawerOpen = false;
  isFormOpen = false;
  isSettlementOpen = false;
  formMode: 'create' | 'edit' = 'create';
  isLoading = false;
  isSaving = false;
  errorMessage = '';
  successMessage = '';

  search = '';
  page = 1;
  limit = 20;
  total = 0;
  totalPages = 1;

  form: CreateProjectPayload = this.emptyForm();
  customerSearch = '';
  customerOptions: SalesCustomerOption[] = [];
  isCustomerDropdownOpen = false;
  private customerSearchTimer: ReturnType<typeof setTimeout> | null = null;

  soaPeriodFrom = '';
  soaPeriodTo = '';
  soaDueDate = '';
  soaNotes = '';
  soaBusy = false;
  isSoaPreviewOpen = false;
  soaPreviewUrl: SafeResourceUrl | null = null;
  soaPreviewFilename = 'project-soa.pdf';
  private soaPreviewObjectUrl: string | null = null;

  settlementMode: 'partial' | 'full' | 'cheque' | 'split' = 'partial';
  settlementAmount = '';
  settlementSalesOrderId: number | null = null;
  splitBankAmount = '';
  splitChequeAmount = '';
  settlementBankName = '';
  settlementCheckNo = '';
  settlementPostDated = '';
  settlementBusy = false;
  settlementError = '';

  constructor(
    private readonly projectsService: ProjectsService,
    private readonly salesOrderService: SalesOrderService,
    private readonly businessSettingsService: BusinessSettingsService,
    private readonly rbacService: RbacService,
    private readonly router: Router,
    private readonly sanitizer: DomSanitizer,
  ) {}

  ngOnInit(): void {
    void this.loadProjects();
  }

  ngOnDestroy(): void {
    this.revokeSoaPreview();
  }

  canCreate(): boolean {
    return this.rbacService.hasEffectivePermissionKey('projects.create');
  }

  canEdit(): boolean {
    return this.rbacService.hasEffectivePermissionKey('projects.edit');
  }

  canDelete(): boolean {
    return this.rbacService.hasEffectivePermissionKey('projects.delete');
  }

  private emptyForm(): CreateProjectPayload {
    return {
      projectCode: '',
      projectName: '',
      customerId: '',
      projectType: '',
      projectOwner: '',
      projectLocation: '',
      projectStartDate: '',
      projectEndDate: '',
      projectManager: '',
      projectStatus: 'planning',
      projectNotes: '',
      pocName: '',
      pocPhone: '',
      pocEmail: '',
    };
  }

  async loadProjects(): Promise<void> {
    this.isLoading = true;
    this.errorMessage = '';

    try {
      const result = await this.projectsService.search({
        search: this.search.trim() || undefined,
        page: this.page,
        limit: this.limit,
      });
      this.projects = result.items;
      this.total = result.meta.total;
      this.totalPages = result.meta.totalPages;
    } catch (error: unknown) {
      this.errorMessage = this.extractError(error, 'Unable to load projects');
      this.projects = [];
      this.total = 0;
      this.totalPages = 1;
    } finally {
      this.isLoading = false;
    }
  }

  async openProjectDrawer(project: ProjectListItem): Promise<void> {
    this.errorMessage = '';
    this.successMessage = '';
    try {
      this.selectedProject = await this.projectsService.getById(project.id);
      if (!this.selectedProject) {
        this.errorMessage = 'Unable to load project details';
        return;
      }
      this.isDrawerOpen = true;
      await Promise.all([this.refreshBilling(), this.refreshStatements()]);
    } catch (error: unknown) {
      this.errorMessage = this.extractError(error, 'Unable to load project details');
    }
  }

  closeDrawer(): void {
    this.selectedProject = null;
    this.billing = null;
    this.statements = [];
    this.isDrawerOpen = false;
    this.isSettlementOpen = false;
  }

  openCreateForm(): void {
    this.formMode = 'create';
    this.form = this.emptyForm();
    this.customerSearch = '';
    this.customerOptions = [];
    // Avoid stacking over the view drawer
    this.isDrawerOpen = false;
    this.isSettlementOpen = false;
    this.isFormOpen = true;
    void this.loadCustomerOptions('');
  }

  openEditForm(): void {
    if (!this.selectedProject || !this.canEdit()) return;
    this.formMode = 'edit';
    this.form = {
      projectCode: this.selectedProject.projectCode || '',
      projectName: this.selectedProject.projectName || '',
      customerId: this.selectedProject.customerId || '',
      projectType: this.selectedProject.projectType || '',
      projectOwner: this.selectedProject.projectOwner || '',
      projectLocation: this.selectedProject.projectLocation || '',
      projectStartDate: this.selectedProject.projectStartDate || '',
      projectEndDate: this.selectedProject.projectEndDate || '',
      projectManager: this.selectedProject.projectManager || '',
      projectStatus: this.selectedProject.projectStatus || 'planning',
      projectNotes: this.selectedProject.projectNotes || '',
      pocName: this.selectedProject.pocName || '',
      pocPhone: this.selectedProject.pocPhone || '',
      pocEmail: this.selectedProject.pocEmail || '',
    };
    this.customerSearch = this.selectedProject.customerName || '';
    // Close view drawer so Edit modal is not covered
    this.isDrawerOpen = false;
    this.isSettlementOpen = false;
    this.isFormOpen = true;
    void this.loadCustomerOptions(this.customerSearch);
  }

  closeForm(): void {
    this.isFormOpen = false;
    // Restore view drawer after cancelling edit
    if (this.formMode === 'edit' && this.selectedProject) {
      this.isDrawerOpen = true;
    }
  }

  onSearchChange(): void {
    this.page = 1;
    void this.loadProjects();
  }

  onPageChange(newPage: number): void {
    this.page = newPage;
    void this.loadProjects();
  }

  onCustomerSearchChange(value: string): void {
    this.customerSearch = value;
    this.isCustomerDropdownOpen = true;
    if (this.customerSearchTimer) clearTimeout(this.customerSearchTimer);
    this.customerSearchTimer = setTimeout(() => {
      void this.loadCustomerOptions(value);
    }, 250);
  }

  private async loadCustomerOptions(search: string): Promise<void> {
    try {
      this.customerOptions = await this.salesOrderService.getCustomers(search.trim() || undefined);
    } catch {
      this.customerOptions = [];
    }
  }

  selectCustomer(customer: SalesCustomerOption): void {
    this.form.customerId = customer.id;
    this.customerSearch = customer.name;
    this.isCustomerDropdownOpen = false;
    if (!this.form.pocName && customer.contact_person) {
      this.form.pocName = customer.contact_person;
    }
    if (!this.form.pocPhone && customer.contact_number) {
      this.form.pocPhone = customer.contact_number;
    }
    if (!this.form.pocEmail && customer.email) {
      this.form.pocEmail = customer.email;
    }
  }

  async saveProject(): Promise<void> {
    if (this.isSaving) return;
    this.errorMessage = '';
    this.successMessage = '';

    if (!this.form.projectCode.trim() || !this.form.projectName.trim()) {
      this.errorMessage = 'Project code and name are required';
      return;
    }
    if (!this.form.customerId) {
      this.errorMessage = 'Customer is required';
      return;
    }

    this.isSaving = true;
    try {
      const payload: CreateProjectPayload = {
        ...this.form,
        projectCode: this.form.projectCode.trim(),
        projectName: this.form.projectName.trim(),
        projectStartDate: this.form.projectStartDate || null,
        projectEndDate: this.form.projectEndDate || null,
      };

      const saved =
        this.formMode === 'create'
          ? await this.projectsService.create(payload)
          : await this.projectsService.update(this.selectedProject!.id, payload);

      if (!saved) {
        this.errorMessage = 'Unable to save project';
        return;
      }

      this.isFormOpen = false;
      this.successMessage =
        this.formMode === 'create' ? 'Project created successfully' : 'Project updated successfully';
      await this.loadProjects();
      this.selectedProject = saved;
      this.isDrawerOpen = true;
      await Promise.all([this.refreshBilling(), this.refreshStatements()]);
    } catch (error: unknown) {
      this.errorMessage = this.extractError(error, 'Unable to save project');
    } finally {
      this.isSaving = false;
    }
  }

  async deleteProject(): Promise<void> {
    if (!this.selectedProject || !this.canDelete()) return;
    const confirmed = window.confirm(
      `Delete or cancel project ${this.selectedProject.projectCode}? Linked sales orders will soft-cancel the project.`,
    );
    if (!confirmed) return;

    try {
      const result = await this.projectsService.remove(this.selectedProject.id);
      this.successMessage = result.message || 'Project removed';
      this.closeDrawer();
      await this.loadProjects();
    } catch (error: unknown) {
      this.errorMessage = this.extractError(error, 'Unable to delete project');
    }
  }

  async refreshBilling(): Promise<void> {
    if (!this.selectedProject) return;
    try {
      this.billing = await this.projectsService.getBilling(this.selectedProject.id);
    } catch {
      this.billing = null;
    }
  }

  async refreshStatements(): Promise<void> {
    if (!this.selectedProject) return;
    try {
      this.statements = await this.projectsService.listStatements(this.selectedProject.id);
    } catch {
      this.statements = [];
    }
  }

  async generateSoa(): Promise<void> {
    if (!this.selectedProject || this.soaBusy) return;
    if (!this.soaPeriodFrom || !this.soaPeriodTo) {
      this.errorMessage = 'SOA period from/to are required';
      return;
    }

    this.soaBusy = true;
    this.errorMessage = '';
    try {
      const created = await this.projectsService.createStatement(this.selectedProject.id, {
        periodFrom: this.soaPeriodFrom,
        periodTo: this.soaPeriodTo,
        dueDate: this.soaDueDate || undefined,
        notes: this.soaNotes || undefined,
      });
      this.successMessage = 'SOA generated — review and print, then Mark as Sent when issued';
      this.soaNotes = '';
      await this.refreshStatements();
      const previewTarget =
        (created?.id
          ? this.statements.find((item) => item.id === created.id)
          : null) ??
        created ??
        this.statements[0];
      if (previewTarget) {
        await this.previewSoaPdf(previewTarget);
      }
    } catch (error: unknown) {
      this.errorMessage = this.extractError(error, 'Unable to generate SOA');
    } finally {
      this.soaBusy = false;
    }
  }

  async markSoaSent(soa: ProjectSoaItem): Promise<void> {
    if (!this.selectedProject || this.soaBusy) return;
    this.soaBusy = true;
    this.errorMessage = '';
    try {
      const result = await this.projectsService.markStatementSent(this.selectedProject.id, soa.id);
      this.successMessage = result.message || 'SOA marked as sent';
      await this.refreshStatements();
    } catch (error: unknown) {
      this.errorMessage = this.extractError(error, 'Unable to mark SOA as sent');
    } finally {
      this.soaBusy = false;
    }
  }

  async previewSoaPdf(statement: ProjectSoaItem): Promise<void> {
    if (!this.selectedProject) return;
    try {
      const pdfBytes = await this.buildProjectSoaPdf(statement);
      this.revokeSoaPreview();
      const blob = new Blob([new Uint8Array(pdfBytes)], { type: 'application/pdf' });
      this.soaPreviewObjectUrl = URL.createObjectURL(blob);
      this.soaPreviewUrl = this.sanitizer.bypassSecurityTrustResourceUrl(this.soaPreviewObjectUrl);
      this.soaPreviewFilename = `${statement.soaNumber || 'SOA'}-${this.selectedProject.projectCode}.pdf`;
      this.isSoaPreviewOpen = true;
    } catch (error: unknown) {
      this.errorMessage = this.extractError(error, 'Unable to build SOA PDF');
    }
  }

  closeSoaPreview(): void {
    this.isSoaPreviewOpen = false;
    this.revokeSoaPreview();
  }

  downloadSoaPdf(): void {
    if (!this.soaPreviewObjectUrl) return;
    const anchor = document.createElement('a');
    anchor.href = this.soaPreviewObjectUrl;
    anchor.download = this.soaPreviewFilename;
    anchor.click();
  }

  getSoaStatusColor(status: string | undefined): string {
    switch (String(status ?? '').toLowerCase()) {
      case 'sent':
        return 'bg-blue-100 text-blue-800';
      case 'paid':
        return 'bg-green-100 text-green-800';
      case 'overdue':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-700';
    }
  }

  private revokeSoaPreview(): void {
    if (this.soaPreviewObjectUrl) {
      URL.revokeObjectURL(this.soaPreviewObjectUrl);
    }
    this.soaPreviewObjectUrl = null;
    this.soaPreviewUrl = null;
  }

  private formatAmountPdf(value: number | null | undefined): string {
    return (
      'PHP ' +
      new Intl.NumberFormat('en-PH', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(Number(value ?? 0))
    );
  }

  private async buildProjectSoaPdf(statement: ProjectSoaItem): Promise<Uint8Array> {
    const project = this.selectedProject!;
    let biz: BusinessProfileSettings | null = null;
    try {
      biz = await this.businessSettingsService.getBusinessProfile();
    } catch {
      biz = null;
    }

    let catalog: ProductOption[] = [];
    try {
      catalog = await this.salesOrderService.getProducts();
    } catch {
      catalog = [];
    }

    const orders = [...(project.relatedSalesOrders ?? [])].sort((a, b) => {
      const aDate = a.scheduleDate || a.createdAt || '';
      const bDate = b.scheduleDate || b.createdAt || '';
      return new Date(aDate).getTime() - new Date(bDate).getTime();
    });

    const detailRows = await Promise.all(
      orders.map(async (order) => {
        let detail: SalesOrderDetailItem | null = null;
        let miscItems: Array<{
          category?: string;
          itemName?: string;
          quantity?: number;
          unitPrice?: number;
          totalPrice?: number;
          isInclusion?: boolean;
        }> = [];
        try {
          const [detailResult, miscResponse] = await Promise.all([
            this.salesOrderService.getSalesOrderById(order.id),
            apiClient.get<unknown>(`/sales-order/${order.id}/misc-items`),
          ]);
          detail = detailResult;
          const miscPayload = (miscResponse as { data?: unknown })?.data;
          miscItems = Array.isArray(miscPayload)
            ? miscPayload
            : Array.isArray((miscPayload as { items?: unknown })?.items)
              ? ((miscPayload as { items: typeof miscItems }).items ?? [])
              : Array.isArray((miscPayload as { data?: unknown })?.data)
                ? ((miscPayload as { data: typeof miscItems }).data ?? [])
                : [];
        } catch {
          detail = null;
          miscItems = [];
        }

        const amount = Number(detail?.totalAmount ?? order.totalAmount ?? 0);
        const paid = Math.max(0, amount - Number(order.balance ?? 0));
        return {
          date: this.formatScheduleDate(order.scheduleDate || order.createdAt || detail?.scheduleDate),
          soNumber: order.soNumber || detail?.soNumber || `#${order.id}`,
          details: this.buildSoaOrderDetailsText(detail, miscItems, catalog),
          amount,
          paid,
          balance: Number(order.balance ?? 0),
        };
      }),
    );

    const pdfDoc = await PDFDocument.create();
    const reg = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    // Landscape A4 for wide order-details column
    const pageW = 842;
    const pageH = 595;
    const page = pdfDoc.addPage([pageW, pageH]);
    const margin = 36;
    let y = pageH - margin;

    const brand: [number, number, number] = [0.06, 0.47, 0.87];
    const dark: [number, number, number] = [0.1, 0.1, 0.1];
    const gray: [number, number, number] = [0.45, 0.45, 0.45];
    const green: [number, number, number] = [0.08, 0.55, 0.22];
    const red: [number, number, number] = [0.75, 0.1, 0.1];
    const white: [number, number, number] = [1, 1, 1];

    const txt = (
      text: string,
      x: number,
      atY: number,
      opts?: { size?: number; font?: typeof reg; color?: [number, number, number]; maxWidth?: number },
    ) => {
      const safe = String(text ?? '')
        .replace(/\u20b1/g, 'PHP')
        .replace(/[\u2013\u2014\u2015]/g, '-')
        .replace(/[\u2018\u2019]/g, "'")
        .replace(/[\u201c\u201d]/g, '"')
        .replace(/[\u0080-\uFFFF]/g, '?');
      page.drawText(safe, {
        x,
        y: atY,
        size: opts?.size ?? 10,
        font: opts?.font ?? reg,
        color: rgb(...(opts?.color ?? dark)),
        maxWidth: opts?.maxWidth,
      });
    };

    const bizName = String(biz?.businessName ?? 'HVAC Warehouse & Sales').trim();
    txt(bizName, margin, y, { size: 14, font: bold, color: brand });
    txt('PROJECT STATEMENT OF ACCOUNT', pageW - margin - 220, y, {
      size: 12,
      font: bold,
      color: brand,
    });
    y -= 16;
    txt(`SOA No: ${statement.soaNumber || '-'}`, pageW - margin - 220, y, { size: 9 });
    y -= 12;
    txt(`Status: ${String(statement.soaStatus || 'draft').toUpperCase()}`, pageW - margin - 220, y, {
      size: 9,
      color: gray,
    });
    y -= 22;

    txt('Project', margin, y, { size: 8, font: bold, color: gray });
    txt(`${project.projectCode} - ${project.projectName}`, margin + 55, y, { size: 10, font: bold });
    y -= 14;
    txt('Customer', margin, y, { size: 8, font: bold, color: gray });
    txt(project.customerName || '-', margin + 55, y, { size: 10 });
    y -= 14;
    txt('Period', margin, y, { size: 8, font: bold, color: gray });
    txt(
      `${this.formatScheduleDate(statement.periodFrom)} to ${this.formatScheduleDate(statement.periodTo)}`,
      margin + 55,
      y,
      { size: 10 },
    );
    if (statement.dueDate) {
      y -= 14;
      txt('Due Date', margin, y, { size: 8, font: bold, color: gray });
      txt(this.formatScheduleDate(statement.dueDate), margin + 55, y, { size: 10 });
    }
    y -= 26;

    const summaryBoxTop = y + 8;
    page.drawRectangle({
      x: margin,
      y: y - 54,
      width: pageW - margin * 2,
      height: 62,
      borderColor: rgb(0.85, 0.85, 0.85),
      borderWidth: 1,
    });
    const summaryItems = [
      ['Opening', statement.openingBalance],
      ['Charges', statement.totalCharges],
      ['Payments', statement.totalPayments],
      ['Closing', statement.closingBalance],
    ] as const;
    summaryItems.forEach(([label, value], index) => {
      const x = margin + 24 + index * 190;
      txt(label, x, summaryBoxTop - 16, { size: 8, color: gray });
      txt(this.formatAmountPdf(value), x, summaryBoxTop - 36, { size: 12, font: bold });
    });
    y -= 78;

    const cols = {
      date: { x: margin, w: 78 },
      so: { x: margin + 78, w: 90 },
      details: { x: margin + 168, w: 320 },
      amount: { x: margin + 488, w: 100 },
      paid: { x: margin + 588, w: 90 },
      balance: { x: margin + 678, w: 90 },
    };
    const tableW = pageW - margin * 2;
    const headerH = 20;

    page.drawRectangle({
      x: margin,
      y: y - headerH + 4,
      width: tableW,
      height: headerH,
      color: rgb(...brand),
    });
    const headerY = y - 10;
    txt('Date', cols.date.x + 4, headerY, { size: 8, font: bold, color: white });
    txt('SO Number', cols.so.x + 4, headerY, { size: 8, font: bold, color: white });
    txt('Order Details (Products, Excess, Service)', cols.details.x + 4, headerY, {
      size: 8,
      font: bold,
      color: white,
    });
    txt('Amount', cols.amount.x + 4, headerY, { size: 8, font: bold, color: white });
    txt('Paid', cols.paid.x + 4, headerY, { size: 8, font: bold, color: white });
    txt('Balance', cols.balance.x + 4, headerY, { size: 8, font: bold, color: white });
    y -= headerH + 8;

    if (detailRows.length === 0) {
      txt('No linked sales orders for this project.', margin, y, { size: 9, color: gray });
      y -= 16;
    } else {
      for (const row of detailRows) {
        const detailLines = this.wrapPdfText(row.details || '-', 62).slice(0, 4);
        const rowHeight = Math.max(18, detailLines.length * 11 + 6);
        if (y - rowHeight < 56) break;

        txt(row.date, cols.date.x + 4, y, { size: 8 });
        txt(row.soNumber, cols.so.x + 4, y, { size: 8, color: brand });
        detailLines.forEach((line, index) => {
          txt(line, cols.details.x + 4, y - index * 11, {
            size: 7.5,
            color: gray,
            maxWidth: cols.details.w - 8,
          });
        });
        txt(this.formatAmountPdf(row.amount), cols.amount.x + 4, y, { size: 8 });
        txt(this.formatAmountPdf(row.paid), cols.paid.x + 4, y, {
          size: 8,
          font: bold,
          color: green,
        });
        txt(this.formatAmountPdf(row.balance), cols.balance.x + 4, y, {
          size: 8,
          font: bold,
          color: red,
        });
        y -= rowHeight;
      }
    }

    if (statement.notes) {
      y -= 8;
      txt('Notes', margin, y, { size: 9, font: bold, color: gray });
      y -= 12;
      txt(statement.notes.slice(0, 160), margin, y, { size: 9 });
    }

    page.drawLine({
      start: { x: margin, y: 42 },
      end: { x: pageW - margin, y: 42 },
      thickness: 0.5,
      color: rgb(0.85, 0.85, 0.85),
    });
    txt(
      'Draft = generated for review. Mark as Sent after issuing to the customer.',
      margin,
      28,
      { size: 8, color: gray },
    );

    return pdfDoc.save();
  }

  private buildSoaOrderDetailsText(
    detail: SalesOrderDetailItem | null,
    miscItems: Array<{
      category?: string;
      itemName?: string;
      quantity?: number;
      unitPrice?: number;
      totalPrice?: number;
      isInclusion?: boolean;
    }>,
    catalog: ProductOption[],
  ): string {
    const parts: string[] = [];

    for (const item of detail?.productItems ?? []) {
      const product = catalog.find((entry) => String(entry.id) === String(item.productId));
      const capacity = product?.capacities?.find((entry) => String(entry.id) === String(item.capacityId));
      const qty = Math.max(0, Math.floor(Number(item.totalSetQty) || 0));
      const name = String(product?.name ?? `Product #${item.productId}`).trim();
      const capacityName = String(capacity?.name ?? '').trim();
      parts.push(`Product: ${qty}x ${name}${capacityName ? ` (${capacityName})` : ''}`);
    }

    for (const item of miscItems) {
      if (String(item.category ?? '').trim().toLowerCase() !== 'excess') continue;
      if (item.isInclusion) continue;
      const qty = Number(item.quantity) || 0;
      const name = String(item.itemName ?? 'Excess').trim();
      parts.push(`Excess: ${qty > 0 ? `${qty}x ` : ''}${name}`);
    }

    for (const item of detail?.serviceItems ?? []) {
      const name = String(item.serviceName ?? 'Service').trim();
      const qty = Math.max(0, Math.floor(Number(item.qty) || 0));
      parts.push(`Service: ${qty > 0 ? `${qty}x ` : ''}${name}`);
    }

    return parts.length > 0 ? parts.join(' | ') : 'No line items';
  }

  private wrapPdfText(text: string, maxChars: number): string[] {
    const words = String(text ?? '')
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (words.length === 0) return ['-'];

    const lines: string[] = [];
    let current = '';
    for (const word of words) {
      const next = current ? `${current} ${word}` : word;
      if (next.length > maxChars && current) {
        lines.push(current);
        current = word;
      } else {
        current = next;
      }
    }
    if (current) lines.push(current);
    return lines;
  }

  get settlementTargetBalance(): number {
    if (this.settlementSalesOrderId != null) {
      const selected = this.billing?.salesOrders?.find((so) => so.id === this.settlementSalesOrderId);
      return Number(selected?.balance ?? 0);
    }
    return Number(this.billing?.balance ?? 0);
  }

  get splitBankAmountValue(): number {
    const parsed = Number(this.splitBankAmount);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  get splitChequeAmountValue(): number {
    const parsed = Number(this.splitChequeAmount);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  getSettlementActionClass(mode: 'partial' | 'full' | 'cheque' | 'split'): string {
    return this.settlementMode === mode
      ? 'border-brand-500 bg-brand-50 text-brand-700 dark:border-brand-400 dark:bg-brand-500/15 dark:text-brand-300'
      : 'border-gray-200 bg-white text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300';
  }

  openSettlement(): void {
    this.settlementError = '';
    this.settlementSalesOrderId = null;
    this.settlementBankName = '';
    this.settlementCheckNo = '';
    this.settlementPostDated = '';
    this.isSettlementOpen = true;
    this.setSettlementMode('partial');
  }

  closeSettlement(): void {
    this.isSettlementOpen = false;
    this.settlementMode = 'partial';
    this.settlementAmount = '';
    this.splitBankAmount = '';
    this.splitChequeAmount = '';
    this.settlementBankName = '';
    this.settlementCheckNo = '';
    this.settlementPostDated = '';
    this.settlementSalesOrderId = null;
    this.settlementError = '';
    this.settlementBusy = false;
  }

  setSettlementMode(mode: 'partial' | 'full' | 'cheque' | 'split'): void {
    this.settlementMode = mode;
    this.settlementError = '';
    const balance = this.settlementTargetBalance;

    if (mode === 'full' || mode === 'cheque') {
      this.settlementAmount = balance > 0 ? String(balance) : '';
      this.splitBankAmount = '';
      this.splitChequeAmount = '';
      return;
    }

    if (mode === 'split') {
      this.settlementAmount = '';
      this.splitBankAmount = '';
      this.splitChequeAmount = balance > 0 ? String(balance) : '';
      return;
    }

    this.settlementAmount = '';
    this.splitBankAmount = '';
    this.splitChequeAmount = '';
  }

  onSettlementSalesOrderChange(): void {
    this.setSettlementMode(this.settlementMode);
  }

  updateSplitBankAmount(value: string): void {
    this.splitBankAmount = value;
    this.settlementError = '';
    const balance = this.settlementTargetBalance;
    const bankAmount = Math.max(Number(value), 0);
    if (!Number.isFinite(bankAmount)) {
      this.splitChequeAmount = '';
      return;
    }
    const chequeAmount = Math.max(balance - bankAmount, 0);
    this.splitChequeAmount = chequeAmount > 0 ? String(Number(chequeAmount.toFixed(2))) : '0';
  }

  async saveSettlement(): Promise<void> {
    if (!this.selectedProject || this.settlementBusy) return;

    const amount = Number(this.settlementAmount);
    if (this.settlementMode === 'partial' && (!Number.isFinite(amount) || amount <= 0)) {
      this.settlementError = 'Enter a valid partial amount.';
      return;
    }

    const splitBankAmount = Number(this.splitBankAmount);
    const splitChequeAmount = Number(this.splitChequeAmount);
    if (
      this.settlementMode === 'split' &&
      (!Number.isFinite(splitBankAmount) ||
        !Number.isFinite(splitChequeAmount) ||
        splitBankAmount <= 0 ||
        splitChequeAmount <= 0)
    ) {
      this.settlementError = 'Enter valid bank and cheque amounts for split settlement.';
      return;
    }

    this.settlementError = '';
    this.settlementBusy = true;

    try {
      const result = await this.projectsService.createSettlement(this.selectedProject.id, {
        mode: this.settlementMode,
        amount: this.settlementMode === 'partial' ? amount : undefined,
        bankAmount: this.settlementMode === 'split' ? splitBankAmount : undefined,
        chequeAmount: this.settlementMode === 'split' ? splitChequeAmount : undefined,
        bankName:
          this.settlementMode === 'cheque' || this.settlementMode === 'split'
            ? this.settlementBankName.trim() || null
            : undefined,
        checkNo:
          this.settlementMode === 'cheque' || this.settlementMode === 'split'
            ? this.settlementCheckNo.trim() || null
            : undefined,
        postDated:
          this.settlementMode === 'cheque' || this.settlementMode === 'split'
            ? this.settlementPostDated || null
            : undefined,
        salesOrderId: this.settlementSalesOrderId || undefined,
      });
      this.successMessage = result.message || 'Settlement recorded';
      this.closeSettlement();
      this.selectedProject = await this.projectsService.getById(this.selectedProject.id);
      await this.refreshBilling();
      await this.loadProjects();
    } catch (error: unknown) {
      this.settlementError = this.extractError(error, 'Unable to record settlement');
    } finally {
      this.settlementBusy = false;
    }
  }

  formatCurrency(value: number | undefined | null): string {
    return `₱${Number(value ?? 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  formatScheduleDate(value: string | null | undefined): string {
    if (!value) {
      return 'Not set';
    }

    const raw = String(value).trim();
    if (!raw) {
      return 'Not set';
    }

    const datePart = raw.includes('T') ? raw.slice(0, 10) : raw.slice(0, 10);
    const parsed = new Date(`${datePart}T00:00:00`);
    if (Number.isNaN(parsed.getTime())) {
      return raw;
    }

    return parsed.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }

  viewRelatedSalesOrder(so: ProjectRelatedSalesOrder): void {
    void this.router.navigate(['/users/sales-order'], {
      queryParams: {
        tab: 'projects',
        viewId: so.id,
      },
    });
  }

  getStatusColor(status: string | undefined): string {
    switch (status?.toLowerCase()) {
      case 'planning':
        return 'bg-blue-100 text-blue-800';
      case 'ongoing':
        return 'bg-green-100 text-green-800';
      case 'completed':
        return 'bg-gray-100 text-gray-800';
      case 'cancelled':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  }

  getSOStatusColor(status: string): string {
    switch (status?.toLowerCase()) {
      case 'pending':
        return 'bg-yellow-100 text-yellow-800';
      case 'for-delivery':
      case 'for delivery':
        return 'bg-blue-100 text-blue-800';
      case 'remitted':
        return 'bg-purple-100 text-purple-800';
      case 'complete':
      case 'completed':
        return 'bg-green-100 text-green-800';
      case 'cancelled':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  }

  trackBySOId(_index: number, so: { id: number }): number {
    return so.id;
  }

  private extractError(error: unknown, fallback: string): string {
    if (axios.isAxiosError(error)) {
      return (
        (error.response?.data as { message?: string } | undefined)?.message ?? fallback
      );
    }
    return fallback;
  }
}
