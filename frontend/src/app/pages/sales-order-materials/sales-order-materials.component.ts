import { CommonModule } from '@angular/common';
import { Component, Input, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { SalesOrderMaterialService, MaterialTransactionItem, AddMaterialItemDto } from '../../shared/services/sales-order-material.service';
import { MaterialInventoryService, Material } from '../../shared/services/material-inventory.service';
import { SalesOrderService, SalesOrderListItem, SalesQueryParams } from '../../shared/services/sales-order.service';
import { PageBreadcrumbComponent } from '../../shared/components/common/page-breadcrumb/page-breadcrumb.component';

@Component({
  selector: 'app-sales-order-materials',
  imports: [CommonModule, FormsModule, PageBreadcrumbComponent],
  templateUrl: './sales-order-materials.component.html',
})
export class SalesOrderMaterialsComponent implements OnInit {
  @Input() salesOrderId?: number;

  // Make Math available in template
  Math = Math;

  materialItems: MaterialTransactionItem[] = [];
  availableMaterials: Material[] = [];
  isAddDrawerOpen = false;
  isLoading = false;
  isLoadingSalesOrders = true;

  // Sales order selection
  salesOrders: SalesOrderListItem[] = [];
  salesOrderSearch = '';
  salesOrdersMeta = { page: 1, limit: 20, total: 0, totalPages: 0 };
  selectedSalesOrderId?: number;
  selectedSalesOrder?: SalesOrderListItem;

  // Form state - allow multiple material rows per add transaction
  materialFormRows: AddMaterialItemDto[] = [];

  // Grouped view of material items (aggregates duplicated materials)
  get groupedMaterialItems() {
    const map = new Map<number, {
      material_id: number;
      material_name?: string;
      quantity: number;
      total: number;
      itemIds: number[];
      unit_price: number;
      sell_price: number;
      discount_price: number;
    }>();

    for (const item of this.materialItems) {
      const qty = Number(item.quantity) || 0;
      const price = Number(item.discount_price) > 0 ? Number(item.discount_price) : Number(item.sell_price);
      const lineTotal = price * qty;

      const existing = map.get(item.material_id);
      if (!existing) {
        map.set(item.material_id, {
          material_id: item.material_id,
          material_name: item.material_name,
          quantity: qty,
          total: lineTotal,
          itemIds: [item.id],
          unit_price: Number(item.unit_price),
          sell_price: Number(item.sell_price),
          discount_price: Number(item.discount_price),
        });
      } else {
        existing.quantity += qty;
        existing.total += lineTotal;
        existing.itemIds.push(item.id);
      }
    }

    return Array.from(map.values());
  }

  constructor(
    private salesOrderMaterialService: SalesOrderMaterialService,
    private materialInventoryService: MaterialInventoryService,
    private salesOrderService: SalesOrderService,
    private router: Router,
  ) {}

  ngOnInit() {
    this.selectedSalesOrderId = this.salesOrderId;
    this.loadSalesOrders();
    this.loadAvailableMaterials();

    if (this.selectedSalesOrderId) {
      this.loadSelectedSalesOrder();
      this.loadMaterialItems();
    }
  }

  async selectAndOpenDrawer(salesOrderId: number) {
    this.selectedSalesOrderId = salesOrderId;
    await this.loadSelectedSalesOrder();
    await this.loadMaterialItems();
    this.openAddDrawer();
  }

  clearSelection() {
    this.selectedSalesOrderId = undefined;
    this.selectedSalesOrder = undefined;
    this.materialItems = [];
  }

  async loadMaterialItems() {
    this.isLoading = true;

    const orderId = this.selectedSalesOrderId ?? this.salesOrderId;
    if (!orderId) {
      this.materialItems = [];
      this.isLoading = false;
      return;
    }

    try {
      this.materialItems = await this.salesOrderMaterialService.getMaterialItems(orderId);
    } catch (err) {
      console.error('Failed to load material items:', err);
    } finally {
      this.isLoading = false;
    }
  }

  async loadAvailableMaterials() {
    try {
      this.availableMaterials = await this.materialInventoryService.getMaterials();
    } catch (err) {
      console.error('Failed to load materials:', err);
    }
  }

  async loadSalesOrders(page = 1, limit = 20) {
    this.isLoadingSalesOrders = true;
    try {
      const params: SalesQueryParams = {
        page,
        limit,
        search: this.salesOrderSearch || undefined,
      };
      const result = await this.salesOrderService.getMasterData(params);
      this.salesOrders = result.items;
      this.salesOrdersMeta = result.meta;

      if (this.selectedSalesOrderId) {
        this.selectedSalesOrder = this.salesOrders.find((o) => o.id === this.selectedSalesOrderId);
      }
    } catch (err) {
      console.error('Failed to load sales orders:', err);
    } finally {
      this.isLoadingSalesOrders = false;
    }
  }

  async loadSelectedSalesOrder() {
    if (!this.selectedSalesOrderId) return;

    if (!this.salesOrders.length) {
      await this.loadSalesOrders();
    }

    this.selectedSalesOrder = this.salesOrders.find((o) => o.id === this.selectedSalesOrderId);
  }

  onSalesOrderSelected() {
    this.loadSelectedSalesOrder();
    this.loadMaterialItems();
  }

  goToSalesOrderPage() {
    this.router.navigate(['/users/sales-order']);
  }

  getStatusClass(status: string): string {
    const statusLower = (status || '').toLowerCase();
    switch (statusLower) {
      case 'completed':
      case 'delivered':
        return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300';
      case 'pending':
      case 'processing':
        return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300';
      case 'cancelled':
      case 'failed':
        return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300';
      default:
        return 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300';
    }
  }

  openAddDrawer() {
    this.isAddDrawerOpen = true;
    this.resetForm();
  }

  closeAddDrawer() {
    this.isAddDrawerOpen = false;
    this.resetForm();
  }

  resetForm() {
    this.materialFormRows = [
      {
        material_id: 0,
        quantity: 1,
        unit_price: 0,
        sell_price: 0,
        discount_price: 0,
      },
    ];
  }

  onMaterialSelect(index: number) {
    const row = this.materialFormRows[index];
    const selected = this.availableMaterials.find((m) => m.id === row.material_id);
    if (selected) {
      row.unit_price = selected.unit_price;
      row.sell_price = selected.sell_price;
    }
  }

  addMaterialRow() {
    this.materialFormRows.push({
      material_id: 0,
      quantity: 1,
      unit_price: 0,
      sell_price: 0,
      discount_price: 0,
    });
  }

  removeMaterialRow(index: number) {
    if (this.materialFormRows.length <= 1) {
      return;
    }
    this.materialFormRows.splice(index, 1);
  }

  async saveMaterialItem() {
    const orderId = this.selectedSalesOrderId;
    if (!orderId) {
      alert('Please select a sales order before adding materials.');
      return;
    }

    const validItems = this.materialFormRows.filter(
      (row) => row.material_id > 0 && row.quantity > 0,
    );

    if (validItems.length === 0) {
      alert('Please add at least one material with a valid quantity');
      return;
    }

    try {
      await this.salesOrderMaterialService.addMaterialItems(orderId, validItems);
      await this.loadMaterialItems();
      this.closeAddDrawer();
    } catch (err) {
      console.error('Failed to add material item(s):', err);
      alert('Failed to add material item(s)');
    }
  }

  async removeMaterialItem(itemId: number) {
    const orderId = this.selectedSalesOrderId;
    if (!orderId) {
      alert('Unable to remove material item – no sales order selected.');
      return;
    }

    if (!confirm('Remove this material item?')) return;

    try {
      await this.salesOrderMaterialService.removeMaterialItem(orderId, itemId);
      await this.loadMaterialItems();
    } catch (err) {
      console.error('Failed to remove material item:', err);
      alert('Failed to remove material item');
    }
  }

  async removeGroupedMaterialItem(materialId: number) {
    const orderId = this.selectedSalesOrderId;
    if (!orderId) {
      alert('Unable to remove material item – no sales order selected.');
      return;
    }

    const group = this.groupedMaterialItems.find((g) => g.material_id === materialId);
    if (!group) {
      return;
    }

    if (!confirm('Remove all entries for this material?')) return;

    try {
      await Promise.all(
        group.itemIds.map((id) => this.salesOrderMaterialService.removeMaterialItem(orderId, id)),
      );
      await this.loadMaterialItems();
    } catch (err) {
      console.error('Failed to remove grouped material items:', err);
      alert('Failed to remove material items');
    }
  }

  calculateItemTotal(item: MaterialTransactionItem): number {
    const price = item.discount_price > 0 ? item.discount_price : item.sell_price;
    return price * item.quantity;
  }

  getTotalAmount(): number {
    return this.materialItems.reduce((sum, item) => sum + this.calculateItemTotal(item), 0);
  }

  calculatePreviewTotal(): number {
    return this.materialFormRows.reduce((sum, row) => {
      const discount = row.discount_price ?? 0;
      const sell = row.sell_price ?? 0;
      const unit = row.unit_price ?? 0;
      const qty = row.quantity ?? 0;
      const price = discount > 0 ? discount : sell > 0 ? sell : unit;
      return sum + price * qty;
    }, 0);
  }

  formatCurrency(value: number | null | undefined): string {
    return new Intl.NumberFormat('en-PH', {
      style: 'currency',
      currency: 'PHP',
      minimumFractionDigits: 2,
    }).format(value ?? 0);
  }
}
