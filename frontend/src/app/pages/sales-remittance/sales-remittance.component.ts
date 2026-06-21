import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PageBreadcrumbComponent } from '../../shared/components/common/page-breadcrumb/page-breadcrumb.component';
import {
  SalesOrderRow,
  SalesOrderService,
  ProductOption,
} from '../../shared/services/sales-order.service';
import { RbacService } from '../../shared/services/rbac.service';
import { Material, MaterialInventoryService } from '../../shared/services/material-inventory.service';
import { apiClient } from '../../shared/services/api-client';
import axios from 'axios';

type MiscCategory = 'material' | 'excess' | 'electrical' | 'general';

interface MiscItemForm {
  category: MiscCategory;
  itemName: string;
  description: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  isInclusion: boolean;
  remarks: string;
}

const SERVICE_OPTIONS = [
  'CLEANING',
  'DISMANTLE',
  'RELOCATION',
  'CHARGING FREON',
  'SURVEY',
  'CHIPPING',
  'PUMP DOWN',
  'INSTALL ONLY',
  'CHECKUP',
];

@Component({
  selector: 'app-sales-remittance',
  standalone: true,
  imports: [CommonModule, FormsModule, PageBreadcrumbComponent],
  templateUrl: './sales-remittance.component.html',
})
export class SalesRemittanceComponent implements OnInit {
  isLoading = false;
  errorMessage = '';
  orders: SalesOrderRow[] = [];
  selectedOrderIds = new Set<number>();
  search = '';
  page = 1;
  limit = 20;
  total = 0;
  totalPages = 1;

  // Bulk remit state
  isBulkRemitModalOpen = false;
  isBulkRemitting = false;
  isBulkRemitInstallerPromptOpen = false;
  isLoadingInstallerOrders = false;
  bulkRemitInstallerName = '';
  bulkRemitInstallerOrders: Array<{ id: number; soNumber: string; customerName: string; status: string }> = [];

  // Add Misc Items modal state
  isMiscModalOpen = false;
  isSavingMisc = false;
  miscModalOrderId: number | null = null;
  miscModalSoNumber = '';
  miscModalCategory: MiscCategory = 'material';
  miscForm: MiscItemForm = this.createEmptyMiscForm();
  readonly serviceOptions = SERVICE_OPTIONS;
  isServiceDropdownOpen = false;
  showCategorySelector = false;

  // Detail drawer state
  isDetailDrawerOpen = false;
  isDetailLoading = false;
  detailOrder: SalesOrderRow | null = null;
  detailData: any = null;
  detailMiscItems: Array<{ id: number; category: string; itemName: string; quantity: number; unit: string; unitPrice: number; totalPrice: number; isInclusion: boolean; remarks: string | null }> = [];

  // Material search state
  materialOptions: Material[] = [];
  filteredMaterials: Material[] = [];
  isMaterialDropdownOpen = false;
  materialSearchQuery = '';
  selectedMaterialId: number | null = null;

  // Product catalog for resolving names
  catalogProducts: ProductOption[] = [];

  // Error modal
  errorModal = { isOpen: false, title: '', message: '' };

  private searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly salesOrderService: SalesOrderService,
    private readonly rbacService: RbacService,
    private readonly materialInventoryService: MaterialInventoryService,
  ) {}

  ngOnInit(): void {
    void this.loadOrders();
    void this.loadMaterials();
    void this.loadCatalogProducts();
  }

  private async loadCatalogProducts(): Promise<void> {
    try {
      this.catalogProducts = await this.salesOrderService.getProducts();
    } catch {
      this.catalogProducts = [];
    }
  }

  private async loadMaterials(): Promise<void> {
    try {
      this.materialOptions = await this.materialInventoryService.getMaterials();
      this.filteredMaterials = this.materialOptions;
    } catch {
      this.materialOptions = [];
      this.filteredMaterials = [];
    }
  }

  onMaterialSearchChange(query: string): void {
    this.materialSearchQuery = query;
    this.miscForm.itemName = query;
    this.selectedMaterialId = null;
    this.isMaterialDropdownOpen = true;

    if (!query.trim()) {
      this.filteredMaterials = this.materialOptions;
      return;
    }

    const lower = query.toLowerCase();
    this.filteredMaterials = this.materialOptions.filter(m =>
      m.material_name.toLowerCase().includes(lower) ||
      (m.material_code ?? '').toLowerCase().includes(lower)
    );
  }

  selectMaterial(material: Material): void {
    this.miscForm.itemName = material.material_name;
    this.miscForm.unit = material.unit || 'pcs';
    this.miscForm.unitPrice = material.sell_price || material.unit_price || 0;
    this.selectedMaterialId = material.id;
    this.materialSearchQuery = material.material_name;
    this.isMaterialDropdownOpen = false;
  }

  closeMaterialDropdown(): void {
    // Delay to allow click to register
    setTimeout(() => { this.isMaterialDropdownOpen = false; }, 200);
  }

  async loadOrders(): Promise<void> {
    this.isLoading = true;
    this.errorMessage = '';
    this.selectedOrderIds.clear();

    try {
      const result = await this.salesOrderService.getSchedules({
        page: this.page,
        limit: this.limit,
        search: this.search.trim() || undefined,
      });

      // Filter to only show for-delivery orders
      const allItems = (result.items ?? []).map((item: any) => ({
        id: item.id,
        soNumber: item.soNumber ?? '',
        customerName: item.customerName ?? '',
        customerId: item.customerId ?? null,
        installer: item.installer ?? '',
        totalAmount: Number(item.totalAmount) || 0,
        paymentMethod: item.paymentMethod ?? '',
        status: item.status ?? '',
        salesType: item.salesType ?? '',
        projectCode: item.projectCode ?? '',
        projectName: item.projectName ?? '',
        scheduleDate: item.scheduleDate ?? null,
        serialCount: Number(item.serialCount) || 0,
        createdAt: item.createdAt ?? null,
      }));

      this.orders = allItems.filter((o: SalesOrderRow) => {
        const normalized = (o.status ?? '').trim().toLowerCase().replace(/[_ ]/g, '-');
        return normalized === 'for-delivery';
      });

      this.total = result.meta?.total ?? 0;
      this.totalPages = result.meta?.totalPages ?? 1;
    } catch (error: unknown) {
      if (axios.isAxiosError(error)) {
        this.errorMessage = (error.response?.data as any)?.message ?? 'Failed to load sales orders';
      } else {
        this.errorMessage = 'Failed to load sales orders';
      }
      this.orders = [];
    } finally {
      this.isLoading = false;
    }
  }

  onSearchChange(): void {
    if (this.searchDebounceTimer) clearTimeout(this.searchDebounceTimer);
    this.searchDebounceTimer = setTimeout(() => {
      this.page = 1;
      void this.loadOrders();
    }, 400);
  }

  goToPage(p: number): void {
    if (p < 1 || p > this.totalPages) return;
    this.page = p;
    void this.loadOrders();
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

  // ─── Add Misc Items (Materials / Excess / Services) ─────────────────

  openMiscModal(order: SalesOrderRow, category: MiscCategory): void {
    this.miscModalOrderId = order.id;
    this.miscModalSoNumber = order.soNumber;
    this.miscModalCategory = category;
    this.miscForm = this.createEmptyMiscForm();
    this.miscForm.category = category;
    this.isServiceDropdownOpen = false;
    this.isMiscModalOpen = true;
    this.showCategorySelector = category === 'material'; // show selector for Material & Excess button
  }

  closeMiscModal(): void {
    this.isMiscModalOpen = false;
    this.miscModalOrderId = null;
    this.miscModalSoNumber = '';
    this.isServiceDropdownOpen = false;
  }

  // ─── Detail Drawer ──────────────────────────────────────────────────

  async openDetailDrawer(order: SalesOrderRow): Promise<void> {
    this.detailOrder = order;
    this.isDetailDrawerOpen = true;
    this.isDetailLoading = true;
    this.detailData = null;
    this.detailMiscItems = [];

    try {
      const [detailResponse, miscResponse] = await Promise.all([
        this.salesOrderService.getSalesOrderById(order.id),
        apiClient.get<any[]>(`/sales-order/${order.id}/misc-items`),
      ]);

      this.detailData = detailResponse;
      this.detailMiscItems = Array.isArray(miscResponse.data) ? miscResponse.data : [];
    } catch {
      this.detailData = null;
      this.detailMiscItems = [];
    } finally {
      this.isDetailLoading = false;
    }
  }

  closeDetailDrawer(): void {
    this.isDetailDrawerOpen = false;
    this.detailOrder = null;
    this.detailData = null;
    this.detailMiscItems = [];
  }

  selectServiceOption(option: string): void {
    this.miscForm.itemName = option;
    this.isServiceDropdownOpen = false;
  }

  getMiscCategoryLabel(): string {
    switch (this.miscModalCategory) {
      case 'material': return 'Material';
      case 'excess': return 'Excess';
      case 'electrical': return 'Electrical';
      case 'general': return 'Other Service';
      default: return 'Item';
    }
  }

  async saveMiscItem(): Promise<void> {
    if (!this.miscModalOrderId || !this.miscForm.itemName.trim()) {
      this.openErrorModalDialog('Validation', 'Item name is required.');
      return;
    }

    this.isSavingMisc = true;
    try {
      const response = await apiClient.post(`/sales-order/${this.miscModalOrderId}/misc-items`, {
        category: this.miscForm.category,
        itemName: this.miscForm.itemName.trim(),
        description: this.miscForm.description.trim() || undefined,
        quantity: Number(this.miscForm.quantity) || 1,
        unit: this.miscForm.unit.trim() || 'pcs',
        unitPrice: Number(this.miscForm.unitPrice) || 0,
        isInclusion: this.miscForm.isInclusion,
        remarks: this.miscForm.remarks.trim() || undefined,
        materialId: this.selectedMaterialId || undefined,
      });

      if ((response.data as any)?.success) {
        this.closeMiscModal();
      } else {
        this.openErrorModalDialog('Error', (response.data as any)?.message ?? 'Failed to add item.');
      }
    } catch (error: unknown) {
      if (axios.isAxiosError(error)) {
        this.openErrorModalDialog('Error', (error.response?.data as any)?.message ?? 'Failed to add item.');
      } else {
        this.openErrorModalDialog('Error', 'Failed to add item.');
      }
    } finally {
      this.isSavingMisc = false;
    }
  }

  private createEmptyMiscForm(): MiscItemForm {
    return {
      category: 'material',
      itemName: '',
      description: '',
      quantity: 1,
      unit: 'pcs',
      unitPrice: 0,
      isInclusion: false,
      remarks: '',
    };
  }

  // ─── Bulk Remit ─────────────────────────────────────────────────────

  openBulkRemitModal(): void {
    if (this.selectedOrderIds.size === 0) return;

    // Validation: check for no-serial orders
    const selectedOrders = this.orders.filter(o => this.selectedOrderIds.has(o.id));
    const noSerialOrders = selectedOrders.filter(o => (o.serialCount ?? 0) === 0);

    if (noSerialOrders.length > 0) {
      this.openErrorModalDialog('Cannot Remit', `The following order(s) have no scanned serial numbers: ${noSerialOrders.map(o => o.soNumber).join(', ')}`);
      return;
    }

    // Single order with installer → ask about bulk installer remit
    if (this.selectedOrderIds.size === 1) {
      const orderId = [...this.selectedOrderIds][0];
      const order = this.orders.find(o => o.id === orderId);
      if (order?.installer?.trim()) {
        this.bulkRemitInstallerName = order.installer.trim();
        this.isBulkRemitInstallerPromptOpen = true;
        return;
      }
    }

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

  async confirmRemitAllInstallerOrders(): Promise<void> {
    this.isLoadingInstallerOrders = true;
    try {
      const result = await this.salesOrderService.getInstallerOrdersForToday(this.bulkRemitInstallerName);
      if (result.success && result.orders.length > 0) {
        this.bulkRemitInstallerOrders = result.orders;
        for (const o of result.orders) {
          this.selectedOrderIds.add(o.id);
        }
        this.isBulkRemitInstallerPromptOpen = false;
        this.isBulkRemitModalOpen = true;
      } else {
        this.isBulkRemitInstallerPromptOpen = false;
        this.openErrorModalDialog('No Orders Found', `No "for-delivery" orders found for ${this.bulkRemitInstallerName} today.`);
      }
    } catch {
      this.isBulkRemitInstallerPromptOpen = false;
      this.openErrorModalDialog('Error', 'Failed to fetch installer orders for today.');
    } finally {
      this.isLoadingInstallerOrders = false;
    }
  }

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
        this.selectedOrderIds.clear();
        this.closeBulkRemitModal();
        this.bulkRemitInstallerOrders = [];

        if (result.skipped && result.skipped.length > 0) {
          const skippedDetails = result.skipped.map(s => `${s.soNumber}: ${s.reason}`).join('\n');
          this.openErrorModalDialog('Remit Completed (with skipped)', `${result.message}\n\nSkipped orders:\n${skippedDetails}`);
        }

        await this.loadOrders();
      } else {
        this.openErrorModalDialog('Remit Error', result.message || 'Failed to remit orders');
      }
    } catch {
      this.openErrorModalDialog('Remit Error', 'Failed to remit orders');
    } finally {
      this.isBulkRemitting = false;
    }
  }

  // ─── Helpers ────────────────────────────────────────────────────────

  formatDate(value: string | null | undefined): string {
    if (!value) return '-';
    const d = new Date(value);
    if (isNaN(d.getTime())) return value;
    return d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  formatCurrency(value: number): string {
    return '₱' + (value ?? 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  getStatusClasses(status: string): string {
    const normalized = (status ?? '').trim().toLowerCase().replace(/[_ ]/g, '-');
    switch (normalized) {
      case 'for-delivery': return 'bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300';
      case 'pending': return 'bg-warning-50 text-warning-700 dark:bg-warning-900/30 dark:text-warning-300';
      case 'remitted': return 'bg-success-50 text-success-700 dark:bg-success-900/30 dark:text-success-300';
      default: return 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300';
    }
  }

  private openErrorModalDialog(title: string, message: string): void {
    this.errorModal = { isOpen: true, title, message };
  }

  closeErrorModal(): void {
    this.errorModal.isOpen = false;
  }

  getSerialEntries(serialNumbers: Record<string, string[]> | null | undefined): Array<{ label: string; serials: string[] }> {
    if (!serialNumbers || typeof serialNumbers !== 'object') return [];
    return Object.entries(serialNumbers)
      .filter(([label]) => label.toLowerCase() !== 'status')
      .map(([label, serials]) => ({ label, serials: Array.isArray(serials) ? serials : [] }));
  }

  resolveProductName(productId: string | number): string {
    const product = this.catalogProducts.find(p => String(p.id) === String(productId));
    return product?.name ?? `Product #${productId}`;
  }

  resolveCapacityName(productId: string | number, capacityId: string | number): string {
    const product = this.catalogProducts.find(p => String(p.id) === String(productId));
    const capacity = product?.capacities?.find(c => String(c.id) === String(capacityId));
    return capacity?.name ?? '';
  }
}
