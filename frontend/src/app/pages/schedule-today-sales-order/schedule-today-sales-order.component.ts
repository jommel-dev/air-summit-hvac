import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PageBreadcrumbComponent } from '../../shared/components/common/page-breadcrumb/page-breadcrumb.component';
import {
  ProductOption,
  SalesOrderDetailItem,
  SalesOrderListItem,
  SalesOrderService,
} from '../../shared/services/sales-order.service';
import { NotificationService } from '../../shared/services/notification.service';
import axios from 'axios';

interface WarehouseUnitTypeScanItem {
  label: string;
  value: number;
  serials: string[];
  scanInput: string;
  scanError: string;
  scanSuccess: string;
  isScanning: boolean;
}

interface WarehouseProductScanItem {
  id: number;
  productId: string;
  productName: string;
  capacityId: string;
  capacityName: string;
  totalSetQty: number;
  unitPrice: number;
  sellPrice: number;
  discountPrice: number;
  unitTypes: WarehouseUnitTypeScanItem[];
}

interface QueuedSalesSerialScan {
  productIndex: number;
  unitLabel: string;
  serialNumber: string;
  salesId: number;
  productId: number;
  capacityId: number;
}

@Component({
  selector: 'app-schedule-today-sales-order',
  imports: [CommonModule, FormsModule, PageBreadcrumbComponent],
  templateUrl: './schedule-today-sales-order.component.html',
})
export class ScheduleTodaySalesOrderComponent implements OnInit {
  isLoading = false;
  loadErrorMessage = '';
  todaySchedules: SalesOrderListItem[] = [];
  selectedOrderId: number | null = null;
  selectedOrderDetail: SalesOrderDetailItem | null = null;
  isDetailOpen = false;
  isDetailLoading = false;
  detailError = '';
  returningOrderIds = new Set<number>();
  movingForDeliveryIds = new Set<number>();
  detailProductItems: WarehouseProductScanItem[] = [];
  selectedUnitTypeByProduct: Record<number, string> = {};
  activeProductTabIndex = 0;
  catalogProducts: ProductOption[] = [];
  private readonly serialScanDebounceMs = 120;
  private readonly serialBatchSize = 20;
  private readonly serialBatchIdleMs = 1000;
  private readonly serialBatchIntervalMs = 5000;
  private serialScanTimers: Record<string, ReturnType<typeof setTimeout>> = {};
  isFlushingQueuedSerials = false;
  private activeSerialFlushCount = 0;
  private queuedSerialScans: QueuedSalesSerialScan[] = [];

  get pendingSerialScanCount(): number {
    return this.queuedSerialScans.length + this.activeSerialFlushCount;
  }
  private queuedSerialFlushTimer: ReturnType<typeof setTimeout> | null = null;
  private queuedSerialIntervalTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly salesOrderService: SalesOrderService,
    private readonly notificationService: NotificationService,
  ) {}

  ngOnInit(): void {
    this.startQueuedSerialAutoFlush();
    void this.loadTodaySchedules();
    void this.loadProducts();
  }

  ngOnDestroy(): void {
    for (const timer of Object.values(this.serialScanTimers)) {
      clearTimeout(timer);
    }
    this.serialScanTimers = {};
    this.clearQueuedSerialFlushTimer();
    this.stopQueuedSerialAutoFlush();
  }

  async selectOrder(orderId: number): Promise<void> {
    if (this.selectedOrderDetail && this.selectedOrderDetail.id !== orderId && this.hasPendingSerialScanWork()) {
      const flushed = await this.flushAllQueuedSerialScans();
      if (!flushed) {
        this.notificationService.warning(
          'Pending Serial Scans',
          'Pending serial scans must finish saving before switching sales orders.',
        );
        return;
      }
    }

    this.selectedOrderId = orderId;
    await this.openDetail(orderId);
  }

  closeDetail(): void {
    this.isDetailOpen = false;
  }

  getSelectedUnitTypeLabel(productIndex: number): string {
    const item = this.detailProductItems[productIndex];
    const selected = this.selectedUnitTypeByProduct[productIndex];
    if (selected && item?.unitTypes.some((entry) => entry.label === selected)) {
      return selected;
    }

    return item?.unitTypes[0]?.label ?? 'set';
  }

  selectUnitType(productIndex: number, label: string): void {
    this.selectedUnitTypeByProduct[productIndex] = label;
    this.focusSerialScanInput(productIndex, label);
  }

  onSerialScanInputChange(productIndex: number, unitLabel: string, value: string): void {
    const item = this.detailProductItems[productIndex];
    if (!item) {
      return;
    }

    const unitEntry = item.unitTypes.find((entry) => entry.label === unitLabel);
    if (!unitEntry) {
      return;
    }

    unitEntry.scanInput = value;
    unitEntry.scanError = '';
    unitEntry.scanSuccess = '';

    const normalizedSerial = this.normalizeSerial(value);
    if (!normalizedSerial) {
      return;
    }

    this.selectedUnitTypeByProduct[productIndex] = unitLabel;

    const timerKey = `${productIndex}::${unitLabel}`;
    const existingTimer = this.serialScanTimers[timerKey];
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    this.serialScanTimers[timerKey] = setTimeout(() => {
      void this.scanSerialForSelectedUnit(productIndex, false);
      delete this.serialScanTimers[timerKey];
    }, this.serialScanDebounceMs);
  }

  selectProductTab(index: number): void {
    if (index < 0 || index >= this.detailProductItems.length) {
      return;
    }

    this.activeProductTabIndex = index;
    const selectedUnitLabel = this.getSelectedUnitTypeLabel(index);
    this.focusSerialScanInput(index, selectedUnitLabel);
  }

  async scanSerialForSelectedUnit(productIndex: number, showEmptyError = false): Promise<void> {
    const detail = this.selectedOrderDetail;
    if (!detail) {
      return;
    }

    const item = this.detailProductItems[productIndex];
    if (!item) {
      return;
    }

    const unitLabel = this.getSelectedUnitTypeLabel(productIndex);
    const unitEntry = item.unitTypes.find((entry) => entry.label === unitLabel);
    if (!unitEntry) {
      return;
    }

    const timerKey = `${productIndex}::${unitLabel}`;
    const existingTimer = this.serialScanTimers[timerKey];
    if (existingTimer) {
      clearTimeout(existingTimer);
      delete this.serialScanTimers[timerKey];
    }

    const serialNumber = this.normalizeSerial(unitEntry.scanInput);
    unitEntry.scanError = '';
    unitEntry.scanSuccess = '';

    if (!serialNumber) {
      if (showEmptyError) {
        unitEntry.scanError = 'Enter serial number before scanning';
      }
      return;
    }

    const productId = Number(item.productId);
    const capacityId = Number(item.capacityId);
    if (!Number.isFinite(productId) || !Number.isFinite(capacityId)) {
      unitEntry.scanError = 'Invalid product/capacity for serial scan';
      return;
    }

    const allowedQty = Number(unitEntry.value) || 0;
    if (allowedQty > 0 && unitEntry.serials.length >= allowedQty) {
      unitEntry.scanError = `Limit reached. ${unitLabel} allows only ${allowedQty} serial number${allowedQty > 1 ? 's' : ''}`;
      return;
    }

    const normalizedIncoming = serialNumber.toLowerCase();
    const existsInOtherUnitType = item.unitTypes.some((entry) => {
      if (entry.label === unitLabel) {
        return false;
      }

      return entry.serials.some(
        (serial) => this.normalizeSerial(serial).toLowerCase() === normalizedIncoming,
      );
    });

    if (existsInOtherUnitType) {
      unitEntry.scanError = 'Serial number already exists in another unit type for this product';
      return;
    }

    const existingInCurrentUnit = unitEntry.serials.some(
      (entry) => this.normalizeSerial(entry).toLowerCase() === normalizedIncoming,
    );
    if (existingInCurrentUnit) {
      unitEntry.scanError = 'Serial number already scanned for this unit type';
      unitEntry.scanInput = '';
      this.focusSerialScanInput(productIndex, unitLabel);
      return;
    }

    unitEntry.serials = [...unitEntry.serials, serialNumber];
    unitEntry.scanInput = '';
    unitEntry.scanSuccess = 'Serial number queued for saving';
    unitEntry.scanError = '';

    this.queueSerialScan({
      productIndex,
      unitLabel,
      serialNumber,
      salesId: detail.id,
      productId,
      capacityId,
    });

    this.focusSerialScanInput(productIndex, unitLabel);
  }

  async removeScannedSerial(productIndex: number, unitLabel: string, serialNumber: string): Promise<void> {
    const detail = this.selectedOrderDetail;
    if (!detail) {
      return;
    }

    const item = this.detailProductItems[productIndex];
    if (!item) {
      return;
    }

    const unitEntry = item.unitTypes.find((entry) => entry.label === unitLabel);
    if (!unitEntry) {
      return;
    }

    const normalizedTarget = this.normalizeSerial(serialNumber).toLowerCase();
    const queuedSerialCountBefore = this.queuedSerialScans.length;
    this.queuedSerialScans = this.queuedSerialScans.filter(
      (entry) =>
        !(
          entry.productIndex === productIndex &&
          entry.unitLabel === unitLabel &&
          this.normalizeSerial(entry.serialNumber).toLowerCase() === normalizedTarget
        ),
    );

    const removedFromQueue = this.queuedSerialScans.length !== queuedSerialCountBefore;
    if (removedFromQueue) {
      this.removeLocalSerial(unitEntry, serialNumber);
      unitEntry.scanSuccess = 'Queued serial number removed';
      unitEntry.scanError = '';
      return;
    }

    unitEntry.scanError = '';
    unitEntry.scanSuccess = '';
    unitEntry.isScanning = true;

    try {
      const response = await this.salesOrderService.removeSalesSerial({
        serialNumber,
        salesId: detail.id,
        unitType: unitLabel,
      });

      if (!response.success) {
        unitEntry.scanError = response.message ?? 'Failed to remove serial number';
        return;
      }

      const normalizedTarget = this.normalizeSerial(serialNumber).toLowerCase();
      unitEntry.serials = unitEntry.serials.filter(
        (entry) => this.normalizeSerial(entry).toLowerCase() !== normalizedTarget,
      );
      unitEntry.scanSuccess = response.message ?? 'Serial number removed successfully';
      this.focusSerialScanInput(productIndex, unitLabel);
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
    }
  }

  isForDeliveryStatus(status: string): boolean {
    const normalized = String(status ?? '').trim().toLowerCase();
    return normalized === 'for-delivery' || normalized === 'for delivery' || normalized === 'for_delivery';
  }

  isReturnedStatus(status: string): boolean {
    const normalized = String(status ?? '').trim().toLowerCase();
    return normalized === 'returned' || normalized === 'return';
  }

  canMoveToForDelivery(status: string): boolean {
    return !this.isForDeliveryStatus(status) && !this.isReturnedStatus(status);
  }

  async moveToForDelivery(order: SalesOrderListItem): Promise<void> {
    if (!this.canMoveToForDelivery(order.status ?? '') || this.movingForDeliveryIds.has(order.id)) {
      return;
    }

    this.movingForDeliveryIds.add(order.id);
    this.loadErrorMessage = '';

    try {
      const flushed = await this.flushAllQueuedSerialScans();
      if (!flushed) {
        this.notificationService.warning(
          'Pending Serial Scans',
          'Pending serial scans must finish saving before moving to For Delivery.',
        );
        return;
      }

      const serialValidation = await this.validateSerialScansForDelivery(order.id);
      if (!serialValidation.ok) {
        this.notificationService.warning('Incomplete Serial Scans', serialValidation.message);
        return;
      }

      const response = await this.salesOrderService.updateSalesOrder(order.id, {
        productItems: [],
        status: 'for-delivery',
      });

      if (!response.success) {
        this.notificationService.error(
          'Move Failed',
          response.message ?? 'Failed to move sales order to for-delivery',
        );
        return;
      }

      this.notificationService.success('Success', 'Sales order moved to For Delivery successfully.');
      await this.loadTodaySchedules();
    } catch (error: unknown) {
      if (axios.isAxiosError(error)) {
        this.notificationService.error(
          'Move Failed',
          (error.response?.data as { message?: string } | undefined)?.message ??
            'Failed to move sales order to for-delivery',
        );
      } else {
        this.notificationService.error('Move Failed', 'Failed to move sales order to for-delivery');
      }
    } finally {
      this.movingForDeliveryIds.delete(order.id);
    }
  }

  private async validateSerialScansForDelivery(
    orderId: number,
  ): Promise<{ ok: true } | { ok: false; message: string }> {
    let detail =
      this.selectedOrderDetail && this.selectedOrderDetail.id === orderId
        ? this.selectedOrderDetail
        : null;

    if (!detail) {
      detail = await this.salesOrderService.getSalesOrderById(orderId);
    }

    if (!detail) {
      return {
        ok: false,
        message: 'Unable to validate serial scans. Please open the SO details and try again.',
      };
    }

    const productItems = this.mapDetailProducts(detail);
    const incompleteItems: string[] = [];

    for (const product of productItems) {
      const missingParts = product.unitTypes
        .filter((unitType) => {
          const requiredQty = Math.max(0, Number(unitType.value) || 0);
          if (requiredQty === 0) {
            return false;
          }

          return (unitType.serials?.length ?? 0) < requiredQty;
        })
        .map((unitType) => {
          const requiredQty = Math.max(0, Number(unitType.value) || 0);
          const scannedQty = unitType.serials?.length ?? 0;
          return `${this.formatReadableLabel(unitType.label)} ${scannedQty}/${requiredQty}`;
        });

      if (missingParts.length > 0) {
        incompleteItems.push(`${product.productName}: ${missingParts.join(', ')}`);
      }
    }

    if (incompleteItems.length > 0) {
      return {
        ok: false,
        message: `Cannot move to For-Delivery. Incomplete serial scans: ${incompleteItems.join(' | ')}`,
      };
    }

    return { ok: true };
  }

  async markReturnedUnits(order: SalesOrderListItem): Promise<void> {
    if (!this.isForDeliveryStatus(order.status ?? '')) {
      return;
    }

    const rawRemarks = window.prompt('Enter reason for returned units:');
    if (rawRemarks === null) {
      return;
    }

    const remarks = rawRemarks.trim();
    if (!remarks) {
      this.notificationService.warning('Missing Input', 'Return remarks are required.');
      return;
    }

    this.returningOrderIds.add(order.id);
    this.loadErrorMessage = '';

    try {
      const response = await this.salesOrderService.updateSalesOrder(order.id, {
        productItems: [],
        status: 'pending',
        remarks: `Returned Units: ${remarks}`,
      });

      if (!response.success) {
        this.notificationService.error(
          'Update Failed',
          response.message ?? 'Failed to mark sales order as returned',
        );
        return;
      }

      this.notificationService.success(
        'Success',
        'Returned units has been recorded and status moved back to Pending.',
      );
      await this.loadTodaySchedules();
    } catch (error: unknown) {
      if (axios.isAxiosError(error)) {
        this.notificationService.error(
          'Update Failed',
          (error.response?.data as { message?: string } | undefined)?.message ??
            'Failed to mark sales order as returned',
        );
      } else {
        this.notificationService.error('Update Failed', 'Failed to mark sales order as returned');
      }
    } finally {
      this.returningOrderIds.delete(order.id);
    }
  }

  formatAmount(value: number): string {
    return new Intl.NumberFormat('en-PH', {
      style: 'currency',
      currency: 'PHP',
      minimumFractionDigits: 2,
    }).format(Number(value ?? 0));
  }

  formatDate(value: string | null): string {
    if (!value) {
      return '-';
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }

    return new Intl.DateTimeFormat('en-PH', {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
    }).format(date);
  }

  formatReadableLabel(value: string | null | undefined): string {
    const normalized = String(value ?? '').trim();
    if (!normalized) {
      return '-';
    }

    return normalized
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .split(' ')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  getUnitTypeSerialCount(unitTypes: WarehouseUnitTypeScanItem[]): number {
    return (unitTypes ?? []).reduce((sum, unitType) => sum + (unitType.serials?.length ?? 0), 0);
  }

  getProductSerialCount(serialNumbers: Record<string, string[]> | null | undefined): number {
    if (!serialNumbers || typeof serialNumbers !== 'object') {
      return 0;
    }

    return Object.values(serialNumbers).reduce((sum, serials) => {
      if (!Array.isArray(serials)) {
        return sum;
      }

      return sum + serials.length;
    }, 0);
  }

  private async loadTodaySchedules(): Promise<void> {
    this.isLoading = true;
    this.loadErrorMessage = '';

    try {
      const response = await this.salesOrderService.getSchedules({
        page: 1,
        limit: 200,
      });

      this.todaySchedules = (response.items ?? []).filter(
        (item) => this.isToday(item.scheduleDate) && this.isPendingStatus(item.status),
      );
      this.selectedOrderId = this.todaySchedules[0]?.id ?? null;
    } catch (error: unknown) {
      if (axios.isAxiosError(error)) {
        this.loadErrorMessage =
          (error.response?.data as { message?: string } | undefined)?.message ??
          'Unable to load today schedules';
      } else {
        this.loadErrorMessage = 'Unable to load today schedules';
      }
      this.todaySchedules = [];
      this.selectedOrderId = null;
    } finally {
      this.isLoading = false;
    }
  }

  private async loadProducts(): Promise<void> {
    try {
      this.catalogProducts = await this.salesOrderService.getProducts();
    } catch {
      this.catalogProducts = [];
    }
  }

  private async openDetail(orderId: number): Promise<void> {
    this.isDetailOpen = true;
    this.isDetailLoading = true;
    this.detailError = '';

    try {
      const detail = await this.salesOrderService.getSalesOrderById(orderId);
      if (!detail) {
        this.detailError = 'Failed to load sales order details';
        this.selectedOrderDetail = null;
        return;
      }

      this.selectedOrderDetail = detail;
      this.detailProductItems = this.mapDetailProducts(detail);
      this.selectedUnitTypeByProduct = {};
      this.detailProductItems.forEach((item, index) => {
        this.selectedUnitTypeByProduct[index] = item.unitTypes[0]?.label ?? 'set';
      });
      this.activeProductTabIndex = 0;
      const defaultUnitLabel = this.getSelectedUnitTypeLabel(0);
      this.focusSerialScanInput(0, defaultUnitLabel);
    } catch (error: unknown) {
      if (axios.isAxiosError(error)) {
        this.detailError =
          (error.response?.data as { message?: string } | undefined)?.message ??
          'Failed to load sales order details';
      } else {
        this.detailError = 'Failed to load sales order details';
      }
      this.selectedOrderDetail = null;
      this.detailProductItems = [];
      this.activeProductTabIndex = 0;
    } finally {
      this.isDetailLoading = false;
    }
  }

  private mapDetailProducts(detail: SalesOrderDetailItem): WarehouseProductScanItem[] {
    return (detail.productItems ?? []).map((product) => {
      const serialNumbers = product.serialNumbers ?? {};
      const normalizedLabels = (product.unitTypesQty ?? [])
        .map((unitType) => String(unitType?.label ?? '').trim().toLowerCase())
        .filter((label) => label.length > 0);

      const labels =
        normalizedLabels.length > 0
          ? normalizedLabels
          : Object.keys(serialNumbers)
              .map((label) => String(label).trim().toLowerCase())
              .filter((label) => label.length > 0);

      const uniqueLabels = labels.length > 0 ? Array.from(new Set(labels)) : ['set'];
      const defaultQty = Math.max(0, Number(product.totalSetQty) || 0);

      const unitTypes = uniqueLabels.map((label) => {
        const serials = Array.isArray(serialNumbers[label]) ? serialNumbers[label] : [];
        const unitTypeQty = (product.unitTypesQty ?? []).find(
          (entry) => String(entry.label ?? '').trim().toLowerCase() === label,
        );

        return {
          label,
          value: Math.max(0, Number(unitTypeQty?.value ?? defaultQty) || 0),
          serials: serials.map((entry) => this.normalizeSerial(entry)).filter(Boolean),
          scanInput: '',
          scanError: '',
          scanSuccess: '',
          isScanning: false,
        };
      });

      return {
        id: product.id,
        productId: String(product.productId ?? ''),
        productName: this.getProductName(String(product.productId ?? '')),
        capacityId: String(product.capacityId ?? ''),
        capacityName: this.getCapacityName(String(product.productId ?? ''), String(product.capacityId ?? '')),
        totalSetQty: Math.max(0, Number(product.totalSetQty) || 0),
        unitPrice: Number(product.unitPrice) || 0,
        sellPrice: Number(product.sellPrice) || 0,
        discountPrice: Number(product.discountPrice) || 0,
        unitTypes,
      };
    });
  }

  private getProductName(productId: string): string {
    const match = this.catalogProducts.find((product) => String(product.id) === String(productId));
    return match?.name?.trim() || productId || '-';
  }

  private getCapacityName(productId: string, capacityId: string): string {
    const product = this.catalogProducts.find((entry) => String(entry.id) === String(productId));
    const capacity = product?.capacities?.find((entry) => String(entry.id) === String(capacityId));
    return capacity?.name?.trim() || capacityId || '-';
  }

  private normalizeSerial(value: unknown): string {
    return String(value ?? '').trim().replace(/\s+/g, ' ');
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

  private async flushAllQueuedSerialScans(): Promise<boolean> {
    this.clearQueuedSerialFlushTimer();

    while (this.queuedSerialScans.length > 0) {
      const flushed = await this.flushQueuedSerialScans();
      if (!flushed) {
        return false;
      }
    }

    return !this.isFlushingQueuedSerials;
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
      batch.forEach((entry, index) => {
        const result = results[index];
        const unitEntry = this.getUnitEntry(entry.productIndex, entry.unitLabel);
        if (!unitEntry) {
          return;
        }

        if (!result?.success) {
          this.removeLocalSerial(unitEntry, entry.serialNumber);
          unitEntry.scanError = result?.message ?? 'Failed to save serial number';
          unitEntry.scanSuccess = '';
          return;
        }

        const normalizedSavedSerial = this.normalizeSerial(
          result.item?.serialNumber ?? entry.serialNumber,
        );
        this.replaceLocalSerial(unitEntry, entry.serialNumber, normalizedSavedSerial);
        unitEntry.scanError = '';
        unitEntry.scanSuccess =
          response.summary && response.summary.successCount > 1
            ? `${response.summary.successCount} serial numbers saved`
            : result.message ?? 'Serial number saved successfully';
      });

      if (!response.success && (response.summary?.failureCount ?? 0) > 0) {
        this.detailError = response.message ?? 'Some serial numbers failed to save.';
      }

      return true;
    } catch (error: unknown) {
      this.queuedSerialScans = [...batch, ...this.queuedSerialScans];
      this.detailError = 'Failed to save scanned serial numbers. Retrying automatically.';
      this.setBatchScanError(batch, 'Failed to save serial numbers. They remain queued.');

      if (axios.isAxiosError(error)) {
        this.detailError =
          (error.response?.data as { message?: string } | undefined)?.message ?? this.detailError;
      }

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
      const unitEntry = this.getUnitEntry(entry.productIndex, entry.unitLabel);
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
      const unitEntry = this.getUnitEntry(entry.productIndex, entry.unitLabel);
      if (unitEntry) {
        unitEntry.scanError = message;
        unitEntry.scanSuccess = '';
      }
    }
  }

  private getUnitEntry(productIndex: number, unitLabel: string): WarehouseUnitTypeScanItem | null {
    const item = this.detailProductItems[productIndex];
    if (!item) {
      return null;
    }

    return item.unitTypes.find((entry) => entry.label === unitLabel) ?? null;
  }

  private removeLocalSerial(unitEntry: WarehouseUnitTypeScanItem, serialNumber: string): void {
    const normalizedTarget = this.normalizeSerial(serialNumber).toLowerCase();
    unitEntry.serials = unitEntry.serials.filter(
      (entry) => this.normalizeSerial(entry).toLowerCase() !== normalizedTarget,
    );
  }

  private replaceLocalSerial(
    unitEntry: WarehouseUnitTypeScanItem,
    oldSerial: string,
    nextSerial: string,
  ): void {
    const normalizedOldSerial = this.normalizeSerial(oldSerial).toLowerCase();
    unitEntry.serials = unitEntry.serials.map((entry) =>
      this.normalizeSerial(entry).toLowerCase() === normalizedOldSerial ? nextSerial : entry,
    );
  }

  private hasPendingSerialScanWork(): boolean {
    return this.queuedSerialScans.length > 0 || this.isFlushingQueuedSerials;
  }

  private focusSerialScanInput(productIndex: number, unitLabel: string): void {
    setTimeout(() => {
      const input = document.getElementById(this.buildScanInputId(productIndex, unitLabel)) as
        | HTMLInputElement
        | null;
      input?.focus();
      input?.select();
    }, 0);
  }

  private buildScanInputId(productIndex: number, unitLabel: string): string {
    return `todayScheduleScanInput_${productIndex}_${unitLabel}`;
  }

  private isToday(value: string | null): boolean {
    if (!value) {
      return false;
    }

    const today = this.toLocalDateToken(new Date());
    const isoDatePart = value.slice(0, 10);

    if (/^\d{4}-\d{2}-\d{2}$/.test(isoDatePart)) {
      return isoDatePart === today;
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return false;
    }

    return this.toLocalDateToken(parsed) === today;
  }

  private isPendingStatus(value: string | null | undefined): boolean {
    return String(value ?? '').trim().toLowerCase() === 'pending';
  }

  private toLocalDateToken(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}
