import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PageBreadcrumbComponent } from '../../shared/components/common/page-breadcrumb/page-breadcrumb.component';
import {
  ProductOption,
  SalesOrderDetailItem,
  SalesOrderListItem,
  SalesOrderService,
  SalesReturnSerialOptionGroup,
} from '../../shared/services/sales-order.service';
import { NotificationService } from '../../shared/services/notification.service';
import { AuditLogFrontendService } from '../../shared/services/audit-log.service';
import { ModalComponent } from '../../shared/components/ui/modal/modal.component';
import {
  SerialValidationModalComponent,
  SerialValidationModalMode,
  SerialValidationDetails,
} from '../sales-order/serial-validation-modal/serial-validation-modal.component';
import { buildSerialUnitTypeMismatchMessage } from '../../shared/utils/serial-scan-errors';
import axios from 'axios';

interface PendingValidationWarning {
  serialNumber: string;
  productIndex: number;
  unitLabel: string;
  validationStatus: string;
  details: Record<string, unknown>;
  salesId: number;
  productId: number;
  capacityId: number;
}

interface WarehouseUnitTypeScanItem {
  label: string;
  value: number;
  serials: string[];
  scanInput: string;
  scanError: string;
  scanSuccess: string;
  scanInfo: string;
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

type TodayScheduleGuardMode = 'close-confirm' | 'remove-serial-confirm';

interface TodaySchedulePendingSerialRemoval {
  productIndex: number;
  unitLabel: string;
  serialNumber: string;
}

@Component({
  selector: 'app-schedule-today-sales-order',
  imports: [CommonModule, FormsModule, PageBreadcrumbComponent, ModalComponent, SerialValidationModalComponent],
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
  readonly serialsPerPage = 10;
  serialPageByUnitType: Record<string, number> = {};
  guardMode: TodayScheduleGuardMode | null = null;
  isGuardDialogOpen = false;
  pendingSerialRemoval: TodaySchedulePendingSerialRemoval | null = null;
  catalogProducts: ProductOption[] = [];
  errorModal = {
    isOpen: false,
    title: '',
    message: '',
  };

  private openErrorModal(title: string, message: string): void {
    this.errorModal = {
      isOpen: true,
      title,
      message,
    };
  }

  closeErrorModal(): void {
    this.errorModal.isOpen = false;
  }
  private readonly serialScanDebounceMs = 120;
  private readonly serialBatchSize = 50;
  private readonly serialBatchIdleMs = 1500;
  private readonly serialBatchIntervalMs = 5000;
  private serialScanTimers: Record<string, ReturnType<typeof setTimeout>> = {};
  isFlushingQueuedSerials = false;
  private activeSerialFlushCount = 0;
  private queuedSerialScans: QueuedSalesSerialScan[] = [];
  rejectedScanCount: number = 0;
  rejectedScanList: Array<{ serialNumber: string; reason: string; timestamp: Date }> = [];

  // Serial validation warning modal state
  pendingValidationWarnings: PendingValidationWarning[] = [];
  currentValidationWarning: PendingValidationWarning | null = null;
  isValidationModalOpen = false;
  validationModalMode: SerialValidationModalMode | null = null;
  validationModalDetails: SerialValidationDetails = {};

  // Return modal state
  isReturnModalOpen = false;
  isReturnModalLoading = false;
  returnModalError = '';
  pendingReturnOrder: SalesOrderListItem | null = null;
  returnSerialGroups: SalesReturnSerialOptionGroup[] = [];
  returnForm = {
    remarks: '',
  };
  selectedReturnedSerialNumbers = new Set<string>();
  selectedDefectiveSerialNumbers = new Set<string>();

  get pendingSerialScanCount(): number {
    return this.queuedSerialScans.length + this.activeSerialFlushCount;
  }
  private queuedSerialFlushTimer: ReturnType<typeof setTimeout> | null = null;
  private queuedSerialIntervalTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly salesOrderService: SalesOrderService,
    private readonly notificationService: NotificationService,
    private readonly auditLogService: AuditLogFrontendService,
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
    this.closeGuardDialog();
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

  closeDetail(forceClose = false): void {
    if (!forceClose && this.hasPendingSerialScanWork()) {
      this.openGuardDialog('close-confirm');
      return;
    }

    this.isDetailOpen = false;
    this.closeGuardDialog();

    // After closing, reload the SO detail to ensure latest serials are in state
    if (this.selectedOrderId) {
      setTimeout(() => {
        this.salesOrderService.getSalesOrderById(this.selectedOrderId!).then((detail) => {
          if (detail) {
            this.selectedOrderDetail = detail;
            this.detailProductItems = this.mapDetailProducts(detail);
          }
        });
      }, 300);
    }
  }

  requestCloseDetail(): void {
    this.closeDetail();
  }

  getPaginatedSerials(productIndex: number, unitLabel: string): string[] {
    const item = this.detailProductItems[productIndex];
    const unitEntry = item?.unitTypes.find((entry) => entry.label === unitLabel);
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
    const item = this.detailProductItems[productIndex];
    const unitEntry = item?.unitTypes.find((entry) => entry.label === unitLabel);
    const totalSerials = unitEntry?.serials.length ?? 0;
    return Math.max(1, Math.ceil(totalSerials / this.serialsPerPage));
  }

  changeSerialPage(productIndex: number, unitLabel: string, nextPage: number): void {
    const key = this.getSerialPageKey(productIndex, unitLabel);
    const totalPages = this.getTotalSerialPages(productIndex, unitLabel);
    this.serialPageByUnitType[key] = Math.min(Math.max(1, nextPage), totalPages);
  }

  requestRemoveScannedSerial(productIndex: number, unitLabel: string, serialNumber: string): void {
    this.pendingSerialRemoval = {
      productIndex,
      unitLabel,
      serialNumber,
    };
    this.openGuardDialog('remove-serial-confirm');
  }

  async confirmGuardDialog(): Promise<void> {
    if (this.guardMode === 'remove-serial-confirm' && this.pendingSerialRemoval) {
      const { productIndex, unitLabel, serialNumber } = this.pendingSerialRemoval;
      await this.removeScannedSerial(productIndex, unitLabel, serialNumber);
      this.pendingSerialRemoval = null;
      this.closeGuardDialog();
      return;
    }

    if (this.guardMode === 'close-confirm') {
      const flushed = await this.flushAllQueuedSerialScans();
      if (!flushed || this.hasPendingSerialScanWork()) {
        this.detailError = 'Pending serial scans must finish saving before closing this detail.';
        this.closeGuardDialog();
        return;
      }

      this.closeDetail(true);
      return;
    }

    this.closeGuardDialog();
  }

  cancelGuardDialog(): void {
    this.pendingSerialRemoval = null;
    this.closeGuardDialog();
  }

  getGuardDialogTitle(): string {
    if (this.guardMode === 'remove-serial-confirm') {
      return 'Remove serial number?';
    }

    return 'Pending serial scans';
  }

  getGuardDialogMessage(): string {
    if (this.guardMode === 'remove-serial-confirm') {
      return 'Are you sure you want to remove this serial number?';
    }

    return 'Serial scans are still queued or saving. Save pending serial scans before closing this detail.';
  }

  getGuardDialogConfirmText(): string {
    if (this.guardMode === 'remove-serial-confirm') {
      return 'Remove Serial';
    }

    return 'Save & Close';
  }

  getGuardDialogCancelText(): string {
    if (this.guardMode === 'remove-serial-confirm') {
      return 'Cancel';
    }

    return 'Stay';
  }

  getGuardDialogConfirmButtonClasses(): string {
    if (this.guardMode === 'remove-serial-confirm') {
      return 'rounded-lg border border-error-300 bg-error-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-error-600 dark:border-error-500/50 dark:bg-error-500 dark:hover:bg-error-600';
    }

    return 'rounded-lg border border-brand-300 bg-brand-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-600 dark:border-brand-500/50 dark:bg-brand-500 dark:hover:bg-brand-600';
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
    unitEntry.scanInfo = '';

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
    unitEntry.scanInfo = '';

    if (!serialNumber) {
      if (showEmptyError) {
        unitEntry.scanError = 'Enter serial number before scanning';
        void this.auditLogService.createAuditLog({
          action: 'SERIAL_SCAN_FAILURE',
          entityType: 'SalesOrder',
          entityId: detail.id,
          metadata: {
            serialNumber: unitEntry.scanInput,
            reason: 'empty_serial_input',
            message: 'Enter serial number before scanning',
            productIndex,
            unitLabel,
            event: 'ui_validation_failure',
          },
        });
      }
      return;
    }

    const productId = Number(item.productId);
    const capacityId = Number(item.capacityId);
    if (!Number.isFinite(productId) || !Number.isFinite(capacityId)) {
      unitEntry.scanError = 'Invalid product/capacity for serial scan';
      void this.auditLogService.createAuditLog({
        action: 'SERIAL_SCAN_FAILURE',
        entityType: 'SalesOrder',
        entityId: detail.id,
        metadata: {
          serialNumber,
          reason: 'invalid_product_capacity',
          message: 'Invalid product/capacity for serial scan',
          productIndex,
          unitLabel,
          event: 'ui_validation_failure',
        },
      });
      return;
    }

    const allowedQty = Number(unitEntry.value) || 0;
    if (allowedQty > 0 && unitEntry.serials.length >= allowedQty) {
      unitEntry.scanError = `Limit reached. ${unitLabel} allows only ${allowedQty} serial number${allowedQty > 1 ? 's' : ''}`;
      void this.auditLogService.createAuditLog({
        action: 'SERIAL_SCAN_FAILURE',
        entityType: 'SalesOrder',
        entityId: detail.id,
        metadata: {
          serialNumber,
          reason: 'quantity_limit_reached',
          message: `Limit reached. ${unitLabel} allows only ${allowedQty} serial number${allowedQty > 1 ? 's' : ''}`,
          productIndex,
          unitLabel,
          allowedQty,
          currentCount: unitEntry.serials.length,
          event: 'ui_validation_failure',
        },
      });
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
      void this.auditLogService.createAuditLog({
        action: 'SERIAL_SCAN_FAILURE',
        entityType: 'SalesOrder',
        entityId: detail.id,
        metadata: {
          serialNumber,
          reason: 'duplicate_in_other_unit_type',
          message: 'Serial number already exists in another unit type for this product',
          productIndex,
          unitLabel,
          event: 'ui_validation_failure',
        },
      });
      return;
    }

    const existingInCurrentUnit = unitEntry.serials.some(
      (entry) => this.normalizeSerial(entry).toLowerCase() === normalizedIncoming,
    );
    if (existingInCurrentUnit) {
      unitEntry.scanError = 'Serial number already scanned for this unit type';
      unitEntry.scanInput = '';
      this.focusSerialScanInput(productIndex, unitLabel);
      void this.auditLogService.createAuditLog({
        action: 'SERIAL_SCAN_FAILURE',
        entityType: 'SalesOrder',
        entityId: detail.id,
        metadata: {
          serialNumber,
          reason: 'duplicate_in_current_unit_type',
          message: 'Serial number already scanned for this unit type',
          productIndex,
          unitLabel,
          event: 'ui_validation_failure',
        },
      });
      return;
    }

    unitEntry.serials = [...unitEntry.serials, serialNumber];
    this.changeSerialPage(productIndex, unitLabel, this.getTotalSerialPages(productIndex, unitLabel));
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
      this.ensureSerialPageInBounds(productIndex, unitLabel);
      unitEntry.scanSuccess = 'Queued serial number removed';
      unitEntry.scanError = '';
      return;
    }

    unitEntry.scanError = '';
    unitEntry.scanSuccess = '';
    unitEntry.scanInfo = '';
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
      this.ensureSerialPageInBounds(productIndex, unitLabel);
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

    // Check if any product has required unit types with qty > 0
    const hasRequiredSerials = productItems.some((product) =>
      product.unitTypes.some((unitType) => Math.max(0, Number(unitType.value) || 0) > 0),
    );

    if (hasRequiredSerials && this.selectedOrderDetail?.id !== orderId) {
      return {
        ok: false,
        message: 'Please open the SO details and scan the required serial numbers before moving to For-Delivery.',
      };
    }

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

    this.pendingReturnOrder = order;
    this.isReturnModalOpen = true;
    this.isReturnModalLoading = true;
    this.returnModalError = '';
    this.returnForm = { remarks: '' };
    this.selectedReturnedSerialNumbers = new Set<string>();
    this.selectedDefectiveSerialNumbers = new Set<string>();
    this.returnSerialGroups = [];

    try {
      const detail = await this.salesOrderService.getSalesOrderById(order.id);
      this.returnSerialGroups = this.buildReturnSerialGroups(detail);
    } catch (error: unknown) {
      if (axios.isAxiosError(error)) {
        this.returnModalError =
          (error.response?.data as { message?: string } | undefined)?.message ??
          'Failed to load sales order serials';
      } else {
        this.returnModalError = 'Failed to load sales order serials';
      }
    } finally {
      this.isReturnModalLoading = false;
    }
  }

  closeReturnModal(forceClose = false): void {
    if (!forceClose && (this.isReturnModalLoading || this.returningOrderIds.has(this.pendingReturnOrder?.id ?? -1))) {
      return;
    }

    this.isReturnModalOpen = false;
    this.pendingReturnOrder = null;
    this.returnModalError = '';
    this.returnSerialGroups = [];
    this.returnForm = { remarks: '' };
    this.selectedReturnedSerialNumbers = new Set<string>();
    this.selectedDefectiveSerialNumbers = new Set<string>();
  }

  isReturnedSerialSelected(serialNumber: string): boolean {
    return this.selectedReturnedSerialNumbers.has(this.normalizeSerial(serialNumber));
  }

  isReturnedSerialDefective(serialNumber: string): boolean {
    return this.selectedDefectiveSerialNumbers.has(this.normalizeSerial(serialNumber));
  }

  isReturnProductFullySelected(group: SalesReturnSerialOptionGroup): boolean {
    return group.serials.length > 0 && group.serials.every((serial) => this.isReturnedSerialSelected(serial));
  }

  getReturnProductSelectedCount(group: SalesReturnSerialOptionGroup): number {
    return group.serials.filter((serial) => this.isReturnedSerialSelected(serial)).length;
  }

  getReturnDefectiveCount(): number {
    return [...this.selectedDefectiveSerialNumbers].filter((serial) =>
      this.selectedReturnedSerialNumbers.has(serial),
    ).length;
  }

  toggleReturnProductSelection(group: SalesReturnSerialOptionGroup, checked: boolean): void {
    const nextReturned = new Set(this.selectedReturnedSerialNumbers);
    const nextDefective = new Set(this.selectedDefectiveSerialNumbers);
    for (const serial of group.serials) {
      const normalizedSerial = this.normalizeSerial(serial);
      if (!normalizedSerial) {
        continue;
      }

      if (checked) {
        nextReturned.add(normalizedSerial);
      } else {
        nextReturned.delete(normalizedSerial);
        nextDefective.delete(normalizedSerial);
      }
    }
    this.selectedReturnedSerialNumbers = nextReturned;
    this.selectedDefectiveSerialNumbers = nextDefective;
  }

  toggleReturnedSerialSelection(serialNumber: string, checked: boolean): void {
    const normalizedSerial = this.normalizeSerial(serialNumber);
    if (!normalizedSerial) return;

    const nextReturned = new Set(this.selectedReturnedSerialNumbers);
    const nextDefective = new Set(this.selectedDefectiveSerialNumbers);
    if (checked) {
      nextReturned.add(normalizedSerial);
    } else {
      nextReturned.delete(normalizedSerial);
      nextDefective.delete(normalizedSerial);
    }
    this.selectedReturnedSerialNumbers = nextReturned;
    this.selectedDefectiveSerialNumbers = nextDefective;
  }

  toggleReturnedSerialDefective(serialNumber: string): void {
    const normalizedSerial = this.normalizeSerial(serialNumber);
    if (!normalizedSerial) {
      return;
    }

    const nextReturned = new Set(this.selectedReturnedSerialNumbers);
    const nextDefective = new Set(this.selectedDefectiveSerialNumbers);
    if (nextDefective.has(normalizedSerial)) {
      nextDefective.delete(normalizedSerial);
    } else {
      nextReturned.add(normalizedSerial);
      nextDefective.add(normalizedSerial);
    }
    this.selectedReturnedSerialNumbers = nextReturned;
    this.selectedDefectiveSerialNumbers = nextDefective;
  }

  async confirmReturnedUnits(): Promise<void> {
    const order = this.pendingReturnOrder;
    if (!order || !this.isForDeliveryStatus(order.status ?? '')) {
      return;
    }

    const remarks = String(this.returnForm.remarks ?? '').trim();
    if (!remarks) {
      this.returnModalError = 'Return remarks are required.';
      return;
    }

    if (this.selectedReturnedSerialNumbers.size === 0) {
      this.returnModalError = 'Select at least one product, capacity, and serial number to return.';
      return;
    }

    this.returningOrderIds.add(order.id);
    this.loadErrorMessage = '';
    this.returnModalError = '';

    const totalReturnableSerials = this.returnSerialGroups.reduce(
      (sum, group) => sum + group.serials.length,
      0,
    );
    const isPartialReturn = this.selectedReturnedSerialNumbers.size < totalReturnableSerials;

    const defectiveSerialNumbers = [...this.selectedDefectiveSerialNumbers].filter((serial) =>
      this.selectedReturnedSerialNumbers.has(serial),
    );

    try {
      const response = await this.salesOrderService.updateSalesOrder(order.id, {
        productItems: [],
        status: isPartialReturn ? 'for-delivery' : 'pending',
        remarks: `Returned Units: ${remarks}`,
        returnedSerialDetails: {
          serialNumbers: [...this.selectedReturnedSerialNumbers],
          defectiveSerialNumbers,
          defectReason: defectiveSerialNumbers.length > 0 ? remarks : undefined,
          defectDate: defectiveSerialNumbers.length > 0 ? new Date().toISOString() : null,
        },
      });

      if (!response.success) {
        this.returnModalError = response.message ?? 'Failed to mark sales order as returned';
        return;
      }

      const defectiveNote =
        defectiveSerialNumbers.length > 0
          ? ` ${defectiveSerialNumbers.length} serial(s) tagged defective.`
          : '';
      this.notificationService.success(
        'Success',
        isPartialReturn
          ? `Selected units were returned and removed from the SO.${defectiveNote} Remaining products stayed as For Delivery.`
          : `All product items were returned, removed from the SO, and status moved back to Pending.${defectiveNote}`,
      );
      this.closeReturnModal(true);
      await this.loadTodaySchedules();
    } catch (error: unknown) {
      if (axios.isAxiosError(error)) {
        this.returnModalError =
          (error.response?.data as { message?: string } | undefined)?.message ??
          'Failed to mark sales order as returned';
      } else {
        this.returnModalError = 'Failed to mark sales order as returned';
      }
    } finally {
      this.returningOrderIds.delete(order.id);
    }
  }

  private buildReturnSerialGroups(detail: SalesOrderDetailItem): SalesReturnSerialOptionGroup[] {
    return (detail.productItems ?? [])
      .map((item, index) => {
        const unitGroups: SalesReturnSerialOptionGroup['unitGroups'] = [];
        const allSerials: string[] = [];
        const seen = new Set<string>();

        for (const [unitLabel, serials] of Object.entries(item.serialNumbers ?? {})) {
          const normalizedUnitLabel = String(unitLabel ?? '').trim();
          if (!normalizedUnitLabel || normalizedUnitLabel.toLowerCase() === 'status' || !Array.isArray(serials)) {
            continue;
          }

          const unitSerials: string[] = [];
          for (const serial of serials) {
            const normalizedSerial = this.normalizeSerial(serial);
            const normalizedKey = normalizedSerial.toLowerCase();
            if (!normalizedSerial || seen.has(normalizedKey)) continue;
            seen.add(normalizedKey);
            unitSerials.push(normalizedSerial);
            allSerials.push(normalizedSerial);
          }

          if (unitSerials.length > 0) {
            unitGroups.push({ unitLabel: normalizedUnitLabel, serials: unitSerials });
          }
        }

        const productName = this.getProductName(String(item.productId ?? ''));
        const capacityName = this.getCapacityName(String(item.productId ?? ''), String(item.capacityId ?? ''));

        return {
          key: `${item.id || index}::${item.productId}::${item.capacityId}`,
          productItemId: Number(item.id) || index,
          productId: String(item.productId ?? ''),
          capacityId: String(item.capacityId ?? ''),
          productLabel: productName,
          capacityLabel: capacityName,
          totalSetQty: Number(item.totalSetQty) || 0,
          unitGroups,
          serials: allSerials,
        };
      })
      .filter((group) => group.serials.length > 0)
      .sort((left, right) => left.productLabel.localeCompare(right.productLabel));
  }

  formatAmount(value: number): string {
    return new Intl.NumberFormat('en-PH', {
      style: 'currency',
      currency: 'PHP',
      minimumFractionDigits: 2,
    }).format(Number(value ?? 0));
  }

  isDownloadingSoDetails = false;
  downloadingSoId: number | null = null;

  async downloadSoDetails(order: SalesOrderListItem): Promise<void> {
    if (this.isDownloadingSoDetails) return;

    this.isDownloadingSoDetails = true;
    this.downloadingSoId = order.id;

    try {
      const detail = await this.salesOrderService.getSalesOrderById(order.id);
      if (!detail) {
        this.notificationService.error('Export Failed', 'Failed to load SO details for export');
        return;
      }

      const excelJsModule = await import('exceljs').catch(async () => import('exceljs/dist/exceljs.min.js'));
      const WorkbookCtor =
        (excelJsModule as { Workbook?: new () => any }).Workbook ??
        (excelJsModule as { default?: { Workbook?: new () => any } }).default?.Workbook;

      if (!WorkbookCtor) {
        this.notificationService.error('Export Failed', 'Excel export is unavailable.');
        return;
      }

      const workbook = new WorkbookCtor();

      // Sheet 1: SO Summary
      const summarySheet = workbook.addWorksheet('SO Details');
      summarySheet.columns = [{ width: 22 }, { width: 40 }];
      summarySheet.addRow(['SO Number', detail.soNumber ?? '']);
      summarySheet.addRow(['Customer', detail.customerName ?? '']);
      summarySheet.addRow(['Address', detail.customerAddress ?? '']);
      summarySheet.addRow(['Contact Person', detail.customerContactPerson ?? '']);
      summarySheet.addRow(['Contact Number', detail.customerContactNumber ?? '']);
      summarySheet.addRow(['Status', detail.status ?? '']);
      summarySheet.addRow(['Schedule Date', detail.scheduleDate ?? '']);
      summarySheet.addRow(['Sales Type', detail.salesType ?? '']);
      summarySheet.addRow(['Total Amount', detail.totalAmount ?? 0]);
      summarySheet.addRow(['Remarks', detail.remarks ?? '']);
      summarySheet.addRow(['Created At', detail.createdAt ?? '']);
      summarySheet.getColumn(1).font = { bold: true };

      // Sheet 2: Product Items & Serials
      const serialsSheet = workbook.addWorksheet('Product Items & Serials');
      const serialHeaders = ['Product Name', 'Capacity', 'Unit Type', 'Serial Number', 'Unit Price', 'Sell Price', 'Discount Price', 'Qty'];
      const headerRow = serialsSheet.addRow(serialHeaders);
      headerRow.font = { bold: true };
      serialsSheet.columns = serialHeaders.map(() => ({ width: 20 }));

      for (const item of detail.productItems ?? []) {
        const product = this.catalogProducts.find((p) => String(p.id) === String(item.productId));
        const productName = product?.name ?? `Product #${item.productId}`;
        const capacity = product?.capacities?.find((c) => String(c.id) === String(item.capacityId));
        const capacityName = capacity?.name ?? `Capacity #${item.capacityId}`;

        const serialEntries = item.serialNumbers ?? {};
        let hasSerials = false;

        for (const [unitType, serials] of Object.entries(serialEntries)) {
          if (!Array.isArray(serials)) continue;
          for (const serial of serials) {
            serialsSheet.addRow([productName, capacityName, unitType, serial, item.unitPrice, item.sellPrice, item.discountPrice, item.totalSetQty]);
            hasSerials = true;
          }
        }

        if (!hasSerials) {
          serialsSheet.addRow([productName, capacityName, '', '(no serials)', item.unitPrice, item.sellPrice, item.discountPrice, item.totalSetQty]);
        }
      }

      // Sheet 3: Payment Details
      const paymentSheet = workbook.addWorksheet('Payment Details');
      const paymentHeaders = ['Method', 'Amount', 'Status', 'Terms', 'Due Date', 'Bank Name', 'Reference No', 'Check No', 'Down Payment'];
      const paymentHeaderRow = paymentSheet.addRow(paymentHeaders);
      paymentHeaderRow.font = { bold: true };
      paymentSheet.columns = paymentHeaders.map(() => ({ width: 18 }));

      for (const payment of detail.paymentDetails ?? []) {
        paymentSheet.addRow([
          payment.method ?? '',
          payment.amount ?? 0,
          payment.status ?? '',
          payment.terms ?? '',
          payment.termsDueDate ?? '',
          payment.bankName ?? '',
          payment.referenceNo ?? '',
          payment.checkNo ?? '',
          payment.downPayment ?? 0,
        ]);
      }

      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const fileName = `${detail.soNumber ?? `SO-${order.id}`}_details.xlsx`;
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = fileName;
      anchor.click();
      URL.revokeObjectURL(objectUrl);
    } catch (error: unknown) {
      this.notificationService.error('Export Failed', 'Failed to export SO details');
      console.error('downloadSoDetails error', error);
    } finally {
      this.isDownloadingSoDetails = false;
      this.downloadingSoId = null;
    }
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
      const results = await Promise.allSettled([
        this.salesOrderService.getSchedules({ page: 1, limit: 200 }),
        this.salesOrderService.getSubDealers({ page: 1, limit: 200 }),
        this.salesOrderService.getDistribution({ page: 1, limit: 200 }),
        this.salesOrderService.getProjects({ page: 1, limit: 200 }),
      ]);

      const allItems: SalesOrderListItem[] = [];
      const errors: string[] = [];

      for (const result of results) {
        if (result.status === 'fulfilled') {
          allItems.push(...(result.value.items ?? []));
        } else {
          const msg = result.reason instanceof Error ? result.reason.message : String(result.reason ?? '');
          errors.push(msg);
        }
      }

      if (errors.length > 0) {
        console.warn('Some schedule endpoints failed:', errors);
      }

      // Deduplicate by id
      const seen = new Set<number>();
      const deduped = allItems.filter((item) => {
        if (seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
      });

      this.todaySchedules = deduped.filter(
        (item) => this.isActiveWarehouseStatus(item.status) && this.isToday(item.scheduleDate),
      );

      console.log('[Schedule Debug] Total fetched:', deduped.length);
      console.log('[Schedule Debug] Today filter results:', this.todaySchedules.length);
      console.log('[Schedule Debug] Sample items:', deduped.slice(0, 5).map(i => ({ id: i.id, status: i.status, scheduleDate: i.scheduleDate, salesType: i.salesType })));
      console.log('[Schedule Debug] Today token:', this.toLocalDateToken(new Date()));

      this.selectedOrderId = this.todaySchedules[0]?.id ?? null;

      if (this.todaySchedules.length === 0 && errors.length === results.length) {
        this.loadErrorMessage = 'Unable to load today schedules. ' + errors[0];
      }
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
    this.serialPageByUnitType = {};
    this.rejectedScanCount = 0;
    this.rejectedScanList = [];
    this.pendingValidationWarnings = [];
    this.currentValidationWarning = null;
    this.isValidationModalOpen = false;
    this.validationModalMode = null;
    this.validationModalDetails = {};
    this.closeGuardDialog();

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
      this.serialPageByUnitType = {};
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
          scanInfo: '',
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
      const validationPromptStatuses = [
        'not_found',
        'warning_defective',
        'warning_mismatch',
        'warning_reassignment',
        'error_unit_type_mismatch',
      ];

      batch.forEach((entry, index) => {
        const result = results[index];
        const unitEntry = this.getUnitEntry(entry.productIndex, entry.unitLabel);
        if (!unitEntry) {
          return;
        }

        // Check if this result is a validation warning that needs user confirmation
        if (!result?.success && result?.validationStatus && validationPromptStatuses.includes(result.validationStatus)) {
          this.removeLocalSerial(unitEntry, entry.serialNumber);
          unitEntry.scanError = '';
          unitEntry.scanSuccess = '';
          unitEntry.scanInfo = '';
          this.pendingValidationWarnings.push({
            serialNumber: entry.serialNumber,
            productIndex: entry.productIndex,
            unitLabel: entry.unitLabel,
            validationStatus: result.validationStatus,
            details: result.details ?? {},
            salesId: entry.salesId,
            productId: entry.productId,
            capacityId: entry.capacityId,
          });
          return;
        }

        if (!result?.success) {
          this.removeLocalSerial(unitEntry, entry.serialNumber);
          unitEntry.scanError = result?.message ?? 'Failed to save serial number';
          unitEntry.scanSuccess = '';
          unitEntry.scanInfo = '';

          // Increment rejected counter only for hard errors (no validationStatus means it's not a validation warning)
          if (!result?.validationStatus) {
            this.rejectedScanCount++;
            this.rejectedScanList.push({
              serialNumber: entry.serialNumber,
              reason: result?.message ?? 'Failed to save serial number',
              timestamp: new Date(),
            });
          }

          void this.auditLogService.createAuditLog({
            action: 'SERIAL_SCAN_FAILURE',
            entityType: 'SalesOrder',
            entityId: entry.salesId,
            metadata: {
              serialNumber: entry.serialNumber,
              reason: 'api_scan_failure',
              message: result?.message ?? 'Failed to save serial number',
              productIndex: entry.productIndex,
              unitLabel: entry.unitLabel,
              expectedProductId: entry.productId,
              expectedCapacityId: entry.capacityId,
              event: 'api_failure',
            },
          });
          return;
        }

        const normalizedSavedSerial = this.normalizeSerial(
          result.item?.serialNumber ?? entry.serialNumber,
        );
        this.replaceLocalSerial(unitEntry, entry.serialNumber, normalizedSavedSerial);
        unitEntry.scanError = '';

        // Display informational message for scanned-status serial reassignment
        if (
          result.validationStatus === 'info_scanned_status' &&
          result.details?.['previousPoNumber']
        ) {
          unitEntry.scanInfo = `Serial reassigned from PO ${result.details['previousPoNumber']}`;
          unitEntry.scanSuccess = '';
        } else {
          unitEntry.scanInfo = '';
          unitEntry.scanSuccess =
            response.summary && response.summary.successCount > 1
              ? `${response.summary.successCount} serial numbers saved`
              : result.message ?? 'Serial number saved successfully';
        }
      });

      // After processing all batch items, present queued warnings sequentially
      if (this.pendingValidationWarnings.length > 0 && !this.isValidationModalOpen) {
        this.processNextValidationWarning();
      }

      // Only show error modal for genuine hard failures (not validation warnings handled by modals)
      const hardFailureCount = (response.summary?.failureCount ?? 0);
      if (!response.success && hardFailureCount > 0) {
        this.openErrorModal('Scan Failed', response.message ?? 'Some serial numbers failed to save.');
      }

      return true;
    } catch (error: unknown) {
      this.queuedSerialScans = [...batch, ...this.queuedSerialScans];
      let errorMessage = 'Failed to save scanned serial numbers. Retrying automatically.';
      this.setBatchScanError(batch, 'Failed to save serial numbers. They remain queued.');

      if (axios.isAxiosError(error)) {
        errorMessage =
          (error.response?.data as { message?: string } | undefined)?.message ?? errorMessage;
      }

      // Increment rejected scan counter for network/timeout/backend errors
      for (const entry of batch) {
        this.rejectedScanCount++;
        this.rejectedScanList.push({
          serialNumber: entry.serialNumber,
          reason: errorMessage,
          timestamp: new Date(),
        });
      }

      this.openErrorModal('Scan Error', errorMessage);
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
        unitEntry.scanInfo = '';
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

  private getSerialPageKey(productIndex: number, unitLabel: string): string {
    return `${productIndex}::${unitLabel}`;
  }

  private ensureSerialPageInBounds(productIndex: number, unitLabel: string): void {
    const key = this.getSerialPageKey(productIndex, unitLabel);
    const totalPages = this.getTotalSerialPages(productIndex, unitLabel);
    const currentPage = this.serialPageByUnitType[key] ?? 1;
    this.serialPageByUnitType[key] = Math.min(Math.max(1, currentPage), totalPages);
  }

  private openGuardDialog(mode: TodayScheduleGuardMode): void {
    this.guardMode = mode;
    this.isGuardDialogOpen = true;
  }

  private closeGuardDialog(): void {
    this.isGuardDialogOpen = false;
    this.guardMode = null;
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

  // --- Serial Validation Warning Modal Methods ---

  processNextValidationWarning(): void {
    if (this.pendingValidationWarnings.length === 0) {
      this.currentValidationWarning = null;
      this.isValidationModalOpen = false;
      this.validationModalMode = null;
      this.validationModalDetails = {};
      return;
    }

    const warning = this.pendingValidationWarnings[0];
    this.currentValidationWarning = warning;
    this.validationModalMode = this.mapValidationStatusToMode(warning.validationStatus);
    this.validationModalDetails = {
      serialNumber: warning.serialNumber,
      ...(warning.details as SerialValidationDetails),
    };
    this.isValidationModalOpen = true;
  }

  onValidationModalConfirm(): void {
    const warning = this.currentValidationWarning;
    if (!warning) {
      this.isValidationModalOpen = false;
      return;
    }

    // Remove the current warning from queue
    this.pendingValidationWarnings.shift();
    this.isValidationModalOpen = false;

    // Re-send the serial with the appropriate force flag
    const forceFlags = this.getForceFlags(warning.validationStatus);
    void this.rescanWithForce(warning, forceFlags);

    // Process next warning in queue
    this.processNextValidationWarning();
  }

  onValidationModalCancel(): void {
    const warning = this.currentValidationWarning;

    // Discard the serial from the queue
    this.pendingValidationWarnings.shift();
    this.currentValidationWarning = null;
    this.isValidationModalOpen = false;

    if (warning?.validationStatus === 'error_unit_type_mismatch') {
      const unitEntry = this.getUnitEntry(warning.productIndex, warning.unitLabel);
      const expectedUnitType = String(warning.details['expectedUnitType'] ?? warning.unitLabel ?? '');
      const actualUnitType = String(warning.details['actualUnitType'] ?? '');
      const mismatchPrompt = buildSerialUnitTypeMismatchMessage(
        expectedUnitType,
        actualUnitType,
        warning.serialNumber,
      );
      if (unitEntry) {
        unitEntry.scanError = mismatchPrompt.inlineError;
        unitEntry.scanSuccess = '';
        unitEntry.scanInfo = '';
      }
      this.focusSerialScanInput(warning.productIndex, warning.unitLabel);
    } else {
      // Refocus scan input
      const unitLabel = this.getSelectedUnitTypeLabel(this.activeProductTabIndex);
      this.focusSerialScanInput(this.activeProductTabIndex, unitLabel);
    }

    // Process next warning in queue
    this.processNextValidationWarning();
  }

  private mapValidationStatusToMode(status: string): SerialValidationModalMode {
    switch (status) {
      case 'warning_mismatch':
        return 'mismatch-warning';
      case 'warning_defective':
        return 'defective-warning';
      case 'warning_reassignment':
        return 'reassignment-warning';
      case 'not_found':
        return 'force-insert-prompt';
      case 'error_unit_type_mismatch':
        return 'unit-type-mismatch';
      default:
        return 'mismatch-warning';
    }
  }

  private getForceFlags(validationStatus: string): Record<string, boolean> {
    switch (validationStatus) {
      case 'warning_mismatch':
      case 'warning_defective':
        return { forceAssign: true };
      case 'not_found':
        return { forceInsert: true };
      case 'warning_reassignment':
        return { forceReassign: true };
      case 'error_unit_type_mismatch':
        return { forceCorrectUnitType: true };
      default:
        return {};
    }
  }

  private async rescanWithForce(
    warning: PendingValidationWarning,
    forceFlags: Record<string, boolean>,
  ): Promise<void> {
    const unitEntry = this.getUnitEntry(warning.productIndex, warning.unitLabel);

    try {
      const response = await this.salesOrderService.scanSalesSerialBatch({
        items: [
          {
            serialNumber: warning.serialNumber,
            salesId: warning.salesId,
            expectedProductId: warning.productId,
            expectedCapacityId: warning.capacityId,
            expectedUnitType: warning.unitLabel,
            ...forceFlags,
          },
        ],
      });

      const result = response.items?.[0];
      if (result?.success) {
        const normalizedSerial = this.normalizeSerial(
          result.item?.serialNumber ?? warning.serialNumber,
        );

        if (unitEntry) {
          // Add serial back to the local list
          unitEntry.serials = [...unitEntry.serials, normalizedSerial];
          unitEntry.scanError = '';
          unitEntry.scanInfo = '';
          unitEntry.scanSuccess = result.message ?? 'Serial number saved successfully';
        }
      } else {
        if (unitEntry) {
          unitEntry.scanError = result?.message ?? 'Force scan failed';
          unitEntry.scanSuccess = '';
          unitEntry.scanInfo = '';
        }

        this.rejectedScanCount++;
        this.rejectedScanList.push({
          serialNumber: warning.serialNumber,
          reason: result?.message ?? 'Force scan failed',
          timestamp: new Date(),
        });
      }
    } catch (error: unknown) {
      let errorMessage = 'Failed to re-scan serial number';
      if (axios.isAxiosError(error)) {
        errorMessage =
          (error.response?.data as { message?: string } | undefined)?.message ?? errorMessage;
      }

      if (unitEntry) {
        unitEntry.scanError = errorMessage;
        unitEntry.scanSuccess = '';
        unitEntry.scanInfo = '';
      }

      this.rejectedScanCount++;
      this.rejectedScanList.push({
        serialNumber: warning.serialNumber,
        reason: errorMessage,
        timestamp: new Date(),
      });
    }
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

  private isActiveWarehouseStatus(value: string | null | undefined): boolean {
    const normalized = String(value ?? '').trim().toLowerCase().replace(/[_\s]+/g, '-');
    return ['pending', 'for-delivery', 'to-remit', 'in-progress', 'released'].includes(normalized);
  }

  private isPendingStatus(value: string | null | undefined): boolean {
    const normalized = String(value ?? '').trim().toLowerCase().replace(/[_\s]+/g, '-');
    return ['pending', 'for-delivery', 'to-remit'].includes(normalized);
  }

  private toLocalDateToken(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}
