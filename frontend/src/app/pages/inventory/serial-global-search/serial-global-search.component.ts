import { Component, signal, computed, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { apiClient } from '../../../shared/services/api-client';
import { NotificationService } from '../../../shared/services/notification.service';

export interface GlobalSearchResult {
  id: number;
  serialNumber: string;
  status: string | null;
  unitType: string | null;
  brandName: string | null;
  productName: string | null;
  capacity: string | null;
  branchName: string | null;
  poNumber: string | null;
  soNumber: string | null;
  customerName: string | null;
  isDefective: boolean;
  isReturned: boolean;
  createdAt: string;
}

export interface SerialDetailResult {
  id: number;
  serialNumber: string;
  status: string | null;
  unitType: string | null;
  brandName: string | null;
  productName: string | null;
  capacity: string | null;
  indoorModel: string | null;
  outdoorModel: string | null;
  branchName: string | null;
  vendorName: string | null;
  poNumber: string | null;
  soNumber: string | null;
  previousSoNumber: string | null;
  customerName: string | null;
  isDefective: boolean;
  defectReason: string | null;
  defectDate: string | null;
  isReturned: boolean;
  returnReason: string | null;
  returnDate: string | null;
  createdBy: string | null;
  createdAt: string;
}

export interface SerialEvent {
  id: number;
  eventType: string;
  previousStatus: string | null;
  newStatus: string | null;
  previousPurchaseId: number | null;
  newPurchaseId: number | null;
  previousSalesId: number | null;
  newSalesId: number | null;
  previousBranchId: number | null;
  newBranchId: number | null;
  performedByUsername: string | null;
  reason: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface Brand {
  id: number;
  name: string;
  type?: string;
}

export interface Product {
  id: number;
  name: string;
  brandName?: string;
  unit?: string;
  unitTypes?: string[];
  capacities: ProductCapacity[];
}

export interface ProductCapacity {
  id: number;
  name: string;
  sellPrice?: number;
  unitPrice?: number;
  indoorModel?: string;
  outdoorModel?: string;
}

@Component({
  selector: 'app-serial-global-search',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './serial-global-search.component.html',
})
export class SerialGlobalSearchComponent implements OnInit {
  private readonly notificationService: NotificationService;

  // Search state
  searchQuery = signal<string>('');
  results = signal<GlobalSearchResult[]>([]);
  totalResults = signal<number>(0);
  currentPage = signal<number>(1);
  pageSize = signal<number>(20);
  isLoading = signal<boolean>(false);

  // Selection state
  selectedIds = signal<Set<number>>(new Set());

  // Detail panel state
  detailSerial = signal<GlobalSearchResult | null>(null);
  eventHistory = signal<SerialEvent[]>([]);

  // Transfer dialog state
  isTransferDialogOpen = signal<boolean>(false);
  brands = signal<Brand[]>([]);
  products = signal<Product[]>([]);
  capacities = signal<ProductCapacity[]>([]);
  selectedBrandId = signal<number | null>(null);
  selectedProductId = signal<number | null>(null);
  selectedCapacityId = signal<number | null>(null);
  transferReason = signal<string>('');

  // Assign to PO/SO dialog state
  isAssignOrderDialogOpen = signal<boolean>(false);
  assignOrderType = signal<'po' | 'so' | null>(null);
  assignOrderSearch = signal<string>('');
  assignOrderResults = signal<{ id: number; number: string; label: string }[]>([]);
  selectedOrderId = signal<number | null>(null);
  assignReason = signal<string>('');
  isSearchingOrders = signal<boolean>(false);

  // Validation state
  searchValidationError = signal<string>('');

  // Computed: filtered products by selected brand
  filteredProducts = computed(() => {
    const brandId = this.selectedBrandId();
    if (!brandId) return [];
    const brand = this.brands().find(b => b.id === brandId);
    if (!brand) return [];
    return this.products().filter(p => p.brandName === brand.name);
  });

  // Computed: filtered capacities by selected product
  filteredCapacities = computed(() => {
    const productId = this.selectedProductId();
    if (!productId) return [];
    const product = this.products().find(p => p.id === productId);
    if (!product) return [];
    return product.capacities;
  });

  // Computed: total pages
  totalPages = computed(() => {
    const total = this.totalResults();
    const size = this.pageSize();
    return Math.max(1, Math.ceil(total / size));
  });

  // Computed: is all on current page selected
  isAllSelected = computed(() => {
    const currentResults = this.results();
    if (currentResults.length === 0) return false;
    const ids = this.selectedIds();
    return currentResults.every(r => ids.has(r.id));
  });

  // Computed: selected count
  selectedCount = computed(() => this.selectedIds().size);

  constructor(notificationService: NotificationService) {
    this.notificationService = notificationService;
  }

  ngOnInit(): void {
    // No initial load needed - user triggers search
  }

  async onSearch(): Promise<void> {
    const query = this.searchQuery().trim();

    if (query.length < 2) {
      this.searchValidationError.set('Please enter at least 2 characters to search.');
      return;
    }

    this.searchValidationError.set('');
    this.currentPage.set(1);
    this.selectedIds.set(new Set());
    this.detailSerial.set(null);
    this.eventHistory.set([]);

    await this.fetchResults();
  }

  async onPageChange(page: number): Promise<void> {
    if (page < 1 || page > this.totalPages()) return;
    this.currentPage.set(page);
    await this.fetchResults();
  }

  onSelectSerial(id: number): void {
    const current = new Set(this.selectedIds());
    if (current.has(id)) {
      current.delete(id);
    } else {
      current.add(id);
    }
    this.selectedIds.set(current);
  }

  onSelectAll(): void {
    const currentResults = this.results();
    if (this.isAllSelected()) {
      // Deselect all on current page
      const current = new Set(this.selectedIds());
      for (const result of currentResults) {
        current.delete(result.id);
      }
      this.selectedIds.set(current);
    } else {
      // Select all on current page
      const current = new Set(this.selectedIds());
      for (const result of currentResults) {
        current.add(result.id);
      }
      this.selectedIds.set(current);
    }
  }

  isSelected(id: number): boolean {
    return this.selectedIds().has(id);
  }

  async onViewDetail(serial: GlobalSearchResult): Promise<void> {
    this.detailSerial.set(serial);
    this.eventHistory.set([]);

    try {
      const response = await apiClient.get<{ success: boolean; items?: SerialEvent[] }>(
        `/serial-number/${serial.id}/history`
      );

      if (response.data.success) {
        this.eventHistory.set(response.data.items ?? []);
      }
    } catch (err: any) {
      this.notificationService.error(
        'Error',
        err?.response?.data?.message ?? 'Failed to load event history.'
      );
    }
  }

  closeDetail(): void {
    this.detailSerial.set(null);
    this.eventHistory.set([]);
  }

  openTransferDialog(): void {
    if (this.selectedCount() === 0) return;
    this.isTransferDialogOpen.set(true);
    this.selectedBrandId.set(null);
    this.selectedProductId.set(null);
    this.selectedCapacityId.set(null);
    this.transferReason.set('');
    void this.loadBrands();
  }

  closeTransferDialog(): void {
    this.isTransferDialogOpen.set(false);
  }

  openAssignOrderDialog(): void {
    if (this.selectedCount() === 0) return;
    this.isAssignOrderDialogOpen.set(true);
    this.assignOrderType.set(null);
    this.assignOrderSearch.set('');
    this.assignOrderResults.set([]);
    this.selectedOrderId.set(null);
    this.assignReason.set('');
  }

  closeAssignOrderDialog(): void {
    this.isAssignOrderDialogOpen.set(false);
  }

  onAssignOrderTypeChange(type: 'po' | 'so'): void {
    this.assignOrderType.set(type);
    this.assignOrderSearch.set('');
    this.assignOrderResults.set([]);
    this.selectedOrderId.set(null);
  }

  async onSearchOrders(): Promise<void> {
    const type = this.assignOrderType();
    const search = this.assignOrderSearch().trim();
    if (!type || search.length < 1) return;

    this.isSearchingOrders.set(true);

    try {
      if (type === 'po') {
        const response = await apiClient.get<{ success: boolean; items?: { id: number; poNumber: string; vendorName?: string }[] }>(
          '/purchase', { params: { search, page: 1, pageSize: 20 } }
        );
        if (response.data.success && response.data.items) {
          this.assignOrderResults.set(
            response.data.items.map(po => ({
              id: po.id,
              number: po.poNumber ?? `#${po.id}`,
              label: `${po.poNumber ?? `#${po.id}`}${po.vendorName ? ` - ${po.vendorName}` : ''}`,
            }))
          );
        }
      } else {
        const response = await apiClient.get<{ success: boolean; items?: { id: number; soNumber: string; customerName?: string }[] }>(
          '/sales-order', { params: { search, page: 1, pageSize: 20 } }
        );
        if (response.data.success && response.data.items) {
          this.assignOrderResults.set(
            response.data.items.map(so => ({
              id: so.id,
              number: so.soNumber ?? `#${so.id}`,
              label: `${so.soNumber ?? `#${so.id}`}${so.customerName ? ` - ${so.customerName}` : ''}`,
            }))
          );
        }
      }
    } catch (err: any) {
      this.notificationService.error(
        'Search Error',
        err?.response?.data?.message ?? 'Failed to search orders.'
      );
    } finally {
      this.isSearchingOrders.set(false);
    }
  }

  onSelectOrder(orderId: number): void {
    this.selectedOrderId.set(orderId);
  }

  async onConfirmAssignOrder(): Promise<void> {
    const type = this.assignOrderType();
    const orderId = this.selectedOrderId();
    const ids = Array.from(this.selectedIds());

    if (!type || !orderId || ids.length === 0) return;

    this.isLoading.set(true);

    try {
      const response = await apiClient.post<{
        success: boolean;
        message?: string;
        assignedCount?: number;
      }>('/serial-number/bulk-assign-order', {
        serialIds: ids,
        purchaseId: type === 'po' ? orderId : null,
        salesId: type === 'so' ? orderId : null,
        reason: this.assignReason().trim() || undefined,
      });

      if (response.data.success) {
        this.notificationService.success(
          'Assignment Successful',
          response.data.message ?? `${response.data.assignedCount ?? ids.length} serial number(s) assigned successfully.`
        );
        this.isAssignOrderDialogOpen.set(false);
        this.selectedIds.set(new Set());
        await this.fetchResults();
      } else {
        this.notificationService.error(
          'Assignment Failed',
          response.data.message ?? 'An error occurred during the assignment.'
        );
      }
    } catch (err: any) {
      this.notificationService.error(
        'Assignment Failed',
        err?.response?.data?.message ?? 'An error occurred during the assignment.'
      );
    } finally {
      this.isLoading.set(false);
    }
  }

  async loadBrands(): Promise<void> {
    try {
      const [brandsResponse, productsResponse] = await Promise.all([
        apiClient.get<{ success: boolean; items?: Brand[] }>('/brands'),
        apiClient.get<{ success: boolean; items?: Product[] }>('/products'),
      ]);

      if (brandsResponse.data.success) {
        this.brands.set(brandsResponse.data.items ?? []);
      }

      if (productsResponse.data.success) {
        this.products.set(productsResponse.data.items ?? []);
      }
    } catch (err: any) {
      this.notificationService.error(
        'Error',
        err?.response?.data?.message ?? 'Failed to load brands and products.'
      );
    }
  }

  onBrandChange(brandId: number | null): void {
    this.selectedBrandId.set(brandId);
    this.selectedProductId.set(null);
    this.selectedCapacityId.set(null);
  }

  onProductChange(productId: number | null): void {
    this.selectedProductId.set(productId);
    this.selectedCapacityId.set(null);
  }

  onCapacityChange(capacityId: number | null): void {
    this.selectedCapacityId.set(capacityId);
  }

  async onConfirmTransfer(): Promise<void> {
    const productId = this.selectedProductId();
    const capacityId = this.selectedCapacityId();
    const ids = Array.from(this.selectedIds());

    if (!productId || !capacityId || ids.length === 0) return;

    this.isLoading.set(true);

    try {
      const response = await apiClient.post<{
        success: boolean;
        message?: string;
        transferredCount?: number;
      }>('/serial-number/bulk-transfer', {
        serialIds: ids,
        targetProductId: productId,
        targetCapacityId: capacityId,
        reason: this.transferReason().trim() || undefined,
      });

      if (response.data.success) {
        this.notificationService.success(
          'Transfer Successful',
          response.data.message ?? `${response.data.transferredCount ?? ids.length} serial number(s) transferred successfully.`
        );
        this.isTransferDialogOpen.set(false);
        this.selectedIds.set(new Set());
        await this.fetchResults();
      } else {
        this.notificationService.error(
          'Transfer Failed',
          response.data.message ?? 'An error occurred during the transfer.'
        );
      }
    } catch (err: any) {
      this.notificationService.error(
        'Transfer Failed',
        err?.response?.data?.message ?? 'An error occurred during the transfer.'
      );
    } finally {
      this.isLoading.set(false);
    }
  }

  formatDate(dateStr: string | null): string {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    return date.toLocaleDateString();
  }

  formatTimestamp(dateStr: string | null): string {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    return date.toLocaleString();
  }

  formatEventType(eventType: string): string {
    return eventType.replace(/_/g, ' ');
  }

  getStatusBadgeClass(status: string | null): string {
    const statusLower = (status ?? '').toLowerCase();
    switch (statusLower) {
      case 'in-stock':
        return 'bg-green-100 text-green-800';
      case 'reserved':
        return 'bg-yellow-100 text-yellow-800';
      case 'installed':
        return 'bg-blue-100 text-blue-800';
      case 'delivered':
        return 'bg-purple-100 text-purple-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  }

  private async fetchResults(): Promise<void> {
    const query = this.searchQuery().trim();
    if (query.length < 2) return;

    this.isLoading.set(true);

    try {
      const response = await apiClient.get<{
        success: boolean;
        items?: GlobalSearchResult[];
        total?: number;
        page?: number;
        pageSize?: number;
      }>('/serial-number/global-search', {
        params: {
          search: query,
          page: this.currentPage(),
          pageSize: this.pageSize(),
        },
      });

      if (response.data.success) {
        this.results.set(response.data.items ?? []);
        this.totalResults.set(response.data.total ?? 0);
      } else {
        this.results.set([]);
        this.totalResults.set(0);
      }
    } catch (err: any) {
      this.notificationService.error(
        'Search Error',
        err?.response?.data?.message ?? 'Failed to search serial numbers.'
      );
      this.results.set([]);
      this.totalResults.set(0);
    } finally {
      this.isLoading.set(false);
    }
  }
}
