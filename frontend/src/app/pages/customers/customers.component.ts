import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { PageBreadcrumbComponent } from '../../shared/components/common/page-breadcrumb/page-breadcrumb.component';
import { ModalComponent } from '../../shared/components/ui/modal/modal.component';
import { CanDirective } from '../../shared/directives/can.directive';
import {
  CustomerQueryParams,
  SalesCustomerConcern,
  SalesCustomerDetail,
  SalesCustomerOrder,
  SalesCustomerPayment,
  SalesStatementOfAccountItem,
  SalesOrderService,
} from '../../shared/services/sales-order.service';
import { RbacService } from '../../shared/services/rbac.service';

type CustomerTab = 'regular' | 'sub_dealer';

type DetailTab = 'orders' | 'payments' | 'statement' | 'concerns';

@Component({
  selector: 'app-customers',
  standalone: true,
  imports: [CommonModule, FormsModule, PageBreadcrumbComponent, ModalComponent, CanDirective],
  templateUrl: './customers.component.html',
  styles: ``,
})
export class CustomersComponent implements OnInit {
  activeTab: CustomerTab = 'regular';
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
  drawerMode: 'details' = 'details';
  editingCustomer: SalesCustomerDetail | null = null;
  selectedCustomer: SalesCustomerDetail | null = null;

  form: Partial<SalesCustomerDetail> = this.createEmptyForm();

  detailTab: DetailTab = 'orders';
  orders: SalesCustomerOrder[] = [];
  payments: SalesCustomerPayment[] = [];
  concerns: SalesCustomerConcern[] = [];
  statements: SalesStatementOfAccountItem[] = [];
  isDetailLoading = false;

  soaForm = {
    periodFrom: '',
    periodTo: '',
    dueDate: '',
    notes: '',
  };

  isSaving = false;
  isGeneratingSoa = false;
  uiError = '';

  constructor(private readonly salesOrderService: SalesOrderService, private readonly rbacService: RbacService) {}

  ngOnInit(): void {
    void this.loadCustomers();
  }

  get canCreateCustomer(): boolean {
    return this.rbacService.canAccess('customers', 'canCreate');
  }

  get canUpdateCustomer(): boolean {
    return this.rbacService.canAccess('customers', 'canUpdate');
  }

  get canDeleteCustomer(): boolean {
    return this.rbacService.canAccess('customers', 'canDelete');
  }

  get canViewCustomers(): boolean {
    return this.rbacService.canAccess('customers', 'canRead');
  }

  async loadCustomers(): Promise<void> {
    if (!this.canViewCustomers) {
      this.customers = [];
      return;
    }

    this.isLoading = true;
    this.uiError = '';

    try {
      const params: CustomerQueryParams = {
        search: this.search.trim() || undefined,
        type: this.activeTab,
        page: this.page,
        limit: this.limit,
      };

      const response = await this.salesOrderService.listCustomers(params);
      this.customers = response.items;
      this.total = response.meta.total;
      this.totalPages = response.meta.totalPages;
    } catch (error: unknown) {
      this.uiError = (error as Error)?.message || 'Failed to load customers';
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

  onTabChange(tab: CustomerTab): void {
    this.activeTab = tab;
    this.page = 1;
    void this.loadCustomers();
  }

  onPageChange(next: number): void {
    if (next < 1 || next > this.totalPages) {
      return;
    }
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

  openDetailsModal(customer: SalesCustomerDetail): void {
    this.drawerMode = 'details';
    this.selectedCustomer = customer;
    this.detailTab = 'orders';
    this.soaForm = { periodFrom: '', periodTo: '', dueDate: '', notes: '' };
    this.isDrawerOpen = true;
    void this.loadCustomerDetails(customer.id);
  }

  closeModal(): void {
    this.isModalOpen = false;
    this.editingCustomer = null;
    this.selectedCustomer = null;
  }

  closeDrawer(): void {
    this.isDrawerOpen = false;
    this.selectedCustomer = null;
    this.isDetailLoading = false;
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
    if (!this.canCreateCustomer && !this.canUpdateCustomer) {
      this.uiError = 'You do not have permission to save customers.';
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

    if (!payload.name) {
      this.uiError = 'Name is required';
      return;
    }

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
      this.uiError = (error as Error)?.message || 'Failed to save customer';
    } finally {
      this.isSaving = false;
    }
  }

  async deleteCustomer(customer: SalesCustomerDetail): Promise<void> {
    if (!this.canDeleteCustomer) {
      this.uiError = 'You do not have permission to delete customers.';
      return;
    }

    if (!confirm(`Delete customer "${customer.name}"? This action cannot be undone.`)) {
      return;
    }

    try {
      await this.salesOrderService.deleteCustomer(customer.id);
      void this.loadCustomers();
    } catch (error: unknown) {
      this.uiError = (error as Error)?.message || 'Failed to delete customer';
    }
  }

  private async loadCustomerDetails(customerId: string): Promise<void> {
    if (!customerId) {
      return;
    }

    this.isDetailLoading = true;
    this.uiError = '';

    try {
      this.orders = [];
      this.payments = [];
      this.concerns = [];
      this.statements = [];

      const [ordersResult, paymentsResult, concernsResult, statementsResult] = await Promise.all([
        this.salesOrderService.getCustomerOrders(customerId, { page: 1, limit: 20 }),
        this.salesOrderService.getCustomerPayments(customerId),
        this.salesOrderService.getCustomerConcerns(customerId),
        this.salesOrderService.getCustomerStatementOfAccounts(customerId, { page: 1, limit: 20 }),
      ]);

      this.orders = ordersResult.items;
      this.payments = paymentsResult.items ?? [];
      this.concerns = concernsResult.items ?? [];
      this.statements = statementsResult.items;
    } catch (error: unknown) {
      this.uiError = (error as Error)?.message || 'Failed to load customer details';
    } finally {
      this.isDetailLoading = false;
    }
  }

  async generateStatementOfAccount(): Promise<void> {
    if (!this.selectedCustomer) {
      return;
    }

    const payload = {
      periodFrom: this.soaForm.periodFrom,
      periodTo: this.soaForm.periodTo,
      dueDate: this.soaForm.dueDate || undefined,
      notes: this.soaForm.notes || undefined,
    };

    this.isGeneratingSoa = true;
    this.uiError = '';

    try {
      const response = await this.salesOrderService.createCustomerStatementOfAccount(this.selectedCustomer.id, payload);
      if (!response.success) {
        this.uiError = response.message || 'Failed to generate statement of account';
        return;
      }

      await this.loadCustomerDetails(this.selectedCustomer.id);

      const createdStatementId = Number(response.data?.statementOfAccountId ?? 0);
      const createdStatement = this.statements.find((statement) => statement.id === createdStatementId);
      if (createdStatement) {
        await this.downloadStatementOfAccountPdf(createdStatement);
      }
    } catch (error: unknown) {
      this.uiError = (error as Error)?.message || 'Failed to generate statement of account';
    } finally {
      this.isGeneratingSoa = false;
    }
  }

  async downloadStatementOfAccountPdf(statement: SalesStatementOfAccountItem): Promise<void> {
    if (!this.selectedCustomer) {
      return;
    }

    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([612, 792]);
    const regularFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const formatAmount = (value: number) =>
      new Intl.NumberFormat('en-PH', {
        style: 'currency',
        currency: 'PHP',
        minimumFractionDigits: 2,
      }).format(Number(value ?? 0));
    const formatDate = (value: string | null | undefined) => {
      const raw = String(value ?? '').trim();
      if (!raw) {
        return '-';
      }

      const parsed = new Date(raw);
      if (Number.isNaN(parsed.getTime())) {
        return raw;
      }

      return parsed.toLocaleDateString('en-PH', {
        year: 'numeric',
        month: 'short',
        day: '2-digit',
      });
    };
    const drawText = (
      text: string,
      x: number,
      y: number,
      options?: { size?: number; font?: typeof regularFont; color?: [number, number, number] },
    ) => {
      const color = options?.color ?? [0, 0, 0];
      page.drawText(text, {
        x,
        y,
        size: options?.size ?? 11,
        font: options?.font ?? regularFont,
        color: rgb(color[0], color[1], color[2]),
      });
    };

    page.drawRectangle({ x: 40, y: 728, width: 532, height: 32, color: rgb(0.06, 0.61, 0.87) });
    drawText('STATEMENT OF ACCOUNT', 52, 739, { size: 16, font: boldFont, color: [1, 1, 1] });

    drawText(`SOA No: ${statement.soaNumber || '-'}`, 40, 695, { font: boldFont });
    drawText(`Generated: ${formatDate(statement.generatedAt)}`, 360, 695, { font: boldFont });

    drawText('Customer Information', 40, 664, { size: 12, font: boldFont, color: [0.06, 0.61, 0.87] });
    drawText(`Customer: ${this.selectedCustomer.name || '-'}`, 40, 644);
    drawText(`Address: ${this.selectedCustomer.address || '-'}`, 40, 626);
    drawText(`Contact Person: ${this.selectedCustomer.contact_person || '-'}`, 40, 608);
    drawText(`Contact Number: ${this.selectedCustomer.contact_number || '-'}`, 40, 590);
    drawText(`Email: ${this.selectedCustomer.email || '-'}`, 40, 572);

    drawText('Statement Period', 40, 536, { size: 12, font: boldFont, color: [0.06, 0.61, 0.87] });
    drawText(`From: ${formatDate(statement.periodFrom)}`, 40, 516);
    drawText(`To: ${formatDate(statement.periodTo)}`, 200, 516);
    drawText(`Due Date: ${formatDate(statement.dueDate)}`, 360, 516);

    page.drawRectangle({ x: 40, y: 456, width: 532, height: 24, color: rgb(0.94, 0.97, 0.99) });
    drawText('Opening Balance', 52, 463, { font: boldFont });
    drawText('Charges', 210, 463, { font: boldFont });
    drawText('Payments', 342, 463, { font: boldFont });
    drawText('Closing Balance', 466, 463, { font: boldFont });

    page.drawRectangle({ x: 40, y: 420, width: 532, height: 36, borderWidth: 1, borderColor: rgb(0.85, 0.88, 0.9) });
    drawText(formatAmount(statement.openingBalance), 52, 434);
    drawText(formatAmount(statement.totalCharges), 210, 434);
    drawText(formatAmount(statement.totalPayments), 342, 434);
    drawText(formatAmount(statement.closingBalance), 466, 434, { font: boldFont });

    drawText(`Status: ${String(statement.status || 'draft').toUpperCase()}`, 40, 384, { font: boldFont });
    drawText('Notes', 40, 350, { size: 12, font: boldFont, color: [0.06, 0.61, 0.87] });
    page.drawRectangle({ x: 40, y: 242, width: 532, height: 96, borderWidth: 1, borderColor: rgb(0.85, 0.88, 0.9) });

    const notes = String(statement.notes || '').trim() || 'No notes provided.';
    const noteLines = this.wrapPdfText(notes, 86);
    noteLines.slice(0, 5).forEach((line, index) => {
      drawText(line, 52, 318 - index * 16);
    });

    drawText('This document was generated electronically from HVAC Warehouse and Sales Management System.', 40, 210, { size: 9, color: [0.35, 0.35, 0.35] });

    const pdfBytes = await pdfDoc.save();
    const pdfBuffer = new ArrayBuffer(pdfBytes.byteLength);
    new Uint8Array(pdfBuffer).set(pdfBytes);
    const blob = new Blob([pdfBuffer], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${statement.soaNumber || 'statement-of-account'}.pdf`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  private wrapPdfText(text: string, maxCharsPerLine: number): string[] {
    const words = String(text ?? '').split(/\s+/).filter((word) => word.length > 0);
    const lines: string[] = [];
    let currentLine = '';

    for (const word of words) {
      const nextLine = currentLine ? `${currentLine} ${word}` : word;
      if (nextLine.length <= maxCharsPerLine) {
        currentLine = nextLine;
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

    return lines.length > 0 ? lines : [''];
  }
}
