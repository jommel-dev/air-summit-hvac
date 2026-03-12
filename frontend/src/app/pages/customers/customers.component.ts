import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
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
      await this.salesOrderService.createCustomerStatementOfAccount(this.selectedCustomer.id, payload);
      await this.loadCustomerDetails(this.selectedCustomer.id);
    } catch (error: unknown) {
      this.uiError = (error as Error)?.message || 'Failed to generate statement of account';
    } finally {
      this.isGeneratingSoa = false;
    }
  }
}
