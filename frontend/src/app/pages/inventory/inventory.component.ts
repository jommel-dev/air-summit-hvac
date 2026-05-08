import { CommonModule } from '@angular/common';
import { Component, HostListener, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { PageBreadcrumbComponent } from '../../shared/components/common/page-breadcrumb/page-breadcrumb.component';
import {
  EntityEditFieldConfig,
  EntityEditModalComponent,
} from '../../shared/components/common/entity-edit-modal/entity-edit-modal.component';
import {
  ProductCapacityOption,
  ProductOption,
  SalesOrderService,
} from '../../shared/services/sales-order.service';
import { RbacService } from '../../shared/services/rbac.service';
import { apiClient } from '../../shared/services/api-client';
import axios from 'axios';

interface BrandFolder {
  id: number | null;
  name: string;
  products: ProductOption[];
}

interface BrandOption {
  id: number;
  name: string;
  type?: string;
}

interface ApiMutationResponse {
  success: boolean;
  message?: string;
}

type InventoryNodeType = 'brand' | 'product' | 'capacity';
type CapacitySerialTab = 'in-stock' | 'reserved' | 'installed';
type CreationFormMode = 'all-in-one' | 'brand-only' | 'product-capacity' | 'capacity-only';
type InventoryEditModalMode = 'product' | 'capacity';

interface SerialEntry {
  serialNumber: string;
  unitType: string;
}

interface UnitTypeOption {
  value: string;
  label: string;
  count: number;
}

interface CapacityDraft {
  srp: number | null;
  netPrice: number | null;
  indoorModel: string;
  outdoorModel: string;
}

interface CapacityStockSummary {
  branchId?: number | null;
  productId: number;
  capacityId: number;
  unit: string;
  unitTypes: string[];
  unitTypeCount: number;
  counts: {
    inStock: number;
    reserved: number;
    installed: number;
  };
  serials: {
    inStock: SerialEntry[];
    reserved: SerialEntry[];
    installed: SerialEntry[];
  };
}

interface LandCostingReportItemRow {
  indoorSerial: string;
  outdoorSerial: string;
  landedCost: number;
  srp: number;
  marginAmount: number;
  serialStatus: string;
  isDefective: boolean;
  isReturned: boolean;
}

interface LandCostingReportGroup {
  productName: string;
  capacityName: string;
  vendorName: string;
  poNumber: string;
  poDate: string | null;
  rows: LandCostingReportItemRow[];
  inStockCount: number;
  inStockIndoorCount: number;
  inStockOutdoorCount: number;
}

@Component({
  selector: 'app-inventory',
  imports: [CommonModule, FormsModule, PageBreadcrumbComponent, EntityEditModalComponent],
  templateUrl: './inventory.component.html',
})
export class InventoryComponent implements OnInit {
  private readonly landCostingPermissionPrefix = 'inventory.land-costing.';
  private readonly landCostingViewPermissionKeys = ['inventory.land-costing.view'];
  private readonly landCostingMarginPermissionKeys = ['inventory.land-costing.margin.view'];
  private readonly landCostingExportPermissionKeys = ['inventory.land-costing.export'];

  readonly availableCapacityOptions = [
    '0.5 HP',
    '0.6 HP',
    '0.8 HP',
    '1.0 HP',
    '1.5 HP',
    '2.0 HP',
    '2.5 HP',
    '3.0 HP',
    '3.5 HP',
    '4.0 HP',
    '5.0 HP',
    '6.0 HP',
    '3 TR',
    '4 TR',
    '5 TR',
    '6 TR',
  ];

  readonly availableUnitTypeOptions = ['Indoor', 'Outdoor', 'Window', 'Panel'];

  isLoading = false;
  errorMessage = '';

  brandFolders: BrandFolder[] = [];
  treeSearch = '';
  selectedBrandName: string | null = null;
  selectedProductId: number | null = null;
  selectedCapacityId: number | null = null;

  newCapacityName = '';
  newCapacitySrp: number | null = null;
  newCapacityNetPrice: number | null = null;
  newCapacityIndoorModel = '';
  newCapacityOutdoorModel = '';
  isAddingCapacity = false;
  isUpdatingProduct = false;
  isUpdatingCapacity = false;
  addCapacityError = '';
  addCapacitySuccess = '';

  isLoadingCapacityStock = false;
  capacityStockError = '';
  isLoadingLandCostingReport = false;
  landCostingError = '';
  landCostingDateFrom = '';
  landCostingDateTo = '';
  landCostingGroups: LandCostingReportGroup[] = [];
  landCostingTotals = {
    serialCount: 0,
    landedCost: 0,
    srp: 0,
    marginAmount: 0,
    marginPercent: 0,
  };
  activeCapacitySerialTab: CapacitySerialTab = 'in-stock';
  serialSearch = '';
  selectedSerialUnitType = 'all';
  serialPageSize = 24;
  serialCurrentPage = 1;
  capacityStockSummary: CapacityStockSummary | null = null;

  // Bulk serial selection
  selectedSerials = new Set<string>();
  isBulkUpdating = false;
  bulkUpdateMessage = '';
  bulkUpdateError = '';
  isDeletingInStockSerials = false;
  deleteInStockMessage = '';
  deleteInStockError = '';

  // CSV upload modal
  isCsvModalOpen = false;
  isCsvParsing = false;
  isCsvConfirming = false;
  csvModalTab: 'will-install' | 'already-installed' | 'not-found' | 'other' = 'will-install';
  csvPreviewResult: {
    summary: {
      total: number; toInstall: number; alreadyInstalled: number; notFound: number; otherStatus: number;
      totalSets: number; unitTypeCounts: Record<string, number>; remainingStocks: number;
    };
    toInstall: Array<{ serialNumber: string; csvStatus: string; csvUnitType: string; unitType: string; productName: string; capacityName: string }>;
    alreadyInstalled: Array<{ serialNumber: string; unitType: string; productName: string; capacityName: string }>;
    notFound: Array<{ serialNumber: string; csvStatus: string; csvUnitType: string }>;
    otherStatus: Array<{ serialNumber: string; csvStatus: string; dbStatus: string; unitType: string; productName: string; capacityName: string }>;
  } | null = null;
  csvConfirmMessage = '';
  csvConfirmError = '';

  // Per-tab target status selections
  csvToInstallTargetStatus = 'installed';
  csvAlreadyInstalledTargetStatus = 'in-stock';
  csvNotFoundTargetStatus = 'in-stock';
  csvNotFoundInsert = false;  // whether to insert not-found serials
  isCsvRevertingInstalled = false;
  isCsvInsertingNotFound = false;

  // Cached stock counts for capacities to display in the folder tree
  isLoadingCapacityCounts = false;
  capacityCountsError = '';
  capacityStockCounts: Record<
    number,
    {
      inStock: number;
      reserved: number;
      installed: number;
      total: number;
      unit: string;
      unitTypeCount: number;
    }
  > = {};

  expandedBrands = new Set<string>();
  expandedProducts = new Set<string>();

  brandContextMenuVisible = false;
  brandContextMenuX = 0;
  brandContextMenuY = 0;
  brandContextMenuBrandName: string | null = null;
  isCreationDrawerOpen = false;
  isLandCostingDrawerOpen = false;
  isEditModalOpen = false;
  editModalMode: InventoryEditModalMode | null = null;
  editModalTitle = '';
  editModalDescription = '';
  editModalSubmitLabel = 'Save Changes';
  editModalFields: EntityEditFieldConfig[] = [];
  editModalInitialValues: Record<string, unknown> = {};
  isEditModalSubmitting = false;

  creationFormMode: CreationFormMode = 'all-in-one';
  isSubmittingCreation = false;
  creationError = '';
  creationSuccess = '';

  createBrandName = '';

  allInOneBrandName = '';
  allInOneIncludeProduct = true;
  allInOneProductName = '';
  allInOneUnit = 'SET';
  allInOneSelectedUnitTypes: string[] = ['Indoor', 'Outdoor'];
  allInOneIncludeCapacity = true;
  allInOneSelectedCapacities: string[] = ['1.0 HP'];
  allInOneCapacityDetails: Record<string, CapacityDraft> = {
    '1.0 HP': this.createEmptyCapacityDraft(),
  };

  productFormBrandName = '';
  productFormProductName = '';
  productFormUnit = 'SET';
  productFormSelectedUnitTypes: string[] = ['Indoor', 'Outdoor'];
  productFormIncludeCapacity = true;
  productFormSelectedCapacities: string[] = ['1.0 HP'];
  productFormCapacityDetails: Record<string, CapacityDraft> = {
    '1.0 HP': this.createEmptyCapacityDraft(),
  };

  capacityOnlySelectedCapacities: string[] = ['1.0 HP'];
  capacityOnlyDetails: Record<string, CapacityDraft> = {
    '1.0 HP': this.createEmptyCapacityDraft(),
  };

  constructor(
    private readonly salesOrderService: SalesOrderService,
    private readonly rbacService: RbacService,
    private readonly router: Router,
  ) {}

  goToSerialSearch(): void {
    this.router.navigate(['/users/serial-global-search']);
  }

  // Material creation modal state
  isMaterialModalOpen = false;
  materialForm = { code: '', name: '', unit: '' };
  materialError = '';
  materialSuccess = '';
  openMaterialModal(): void {
    this.isMaterialModalOpen = true;
    this.materialForm = { code: '', name: '', unit: '' };
    this.materialError = '';
    this.materialSuccess = '';
  }

  closeMaterialModal(): void {
    this.isMaterialModalOpen = false;
  }

  async submitMaterial(): Promise<void> {
    this.materialError = '';
    this.materialSuccess = '';
    try {
      const response = await axios.post('/material-items', {
        code: this.materialForm.code,
        name: this.materialForm.name,
        unit: this.materialForm.unit || 'pcs',
      });
      if (response.data) {
        this.materialSuccess = 'Material added successfully!';
        this.closeMaterialModal();
        // Optionally reload inventory or show new material
      } else {
        this.materialError = 'Failed to add material.';
      }
    } catch (err: any) {
      this.materialError = err?.response?.data?.message || 'Error adding material.';
    }
  }

  ngOnInit(): void {
    this.initializeLandCostingDateRange();
    void this.loadInventoryFolders();
  }

  selectBrand(name: string): void {
    this.selectedBrandName = name;
    this.selectedProductId = null;
    this.selectedCapacityId = null;
    this.isLandCostingDrawerOpen = false;
    this.capacityStockCounts = {};
    this.expandedBrands.add(name);
    this.closeBrandContextMenu();
  }

  selectProduct(brandName: string, productId: number): void {
    this.selectedBrandName = brandName;
    this.selectedProductId = productId;
    this.selectedCapacityId = null;
    this.isLandCostingDrawerOpen = false;
    this.resetCapacityFormMessages();
    this.capacityStockSummary = null;
    this.capacityStockError = '';
    this.capacityCountsError = '';
    this.capacityStockCounts = {};
    this.activeCapacitySerialTab = 'in-stock';
    this.serialSearch = '';
    this.selectedSerialUnitType = 'all';
    this.serialCurrentPage = 1;
    this.expandedBrands.add(brandName);
    this.expandedProducts.add(this.getProductTreeKey(brandName, productId));

    void this.loadCapacityStockCountsForProduct(productId);
  }

  selectCapacity(brandName: string, productId: number, capacityId: number): void {
    this.selectedBrandName = brandName;
    this.selectedProductId = productId;
    this.selectedCapacityId = capacityId;
    this.resetCapacityFormMessages();
    this.serialSearch = '';
    this.selectedSerialUnitType = 'all';
    this.serialCurrentPage = 1;
    void this.loadCapacityStockSummary(productId, capacityId);
    void this.loadLandCostingReport(productId, capacityId);
    this.expandedBrands.add(brandName);
    this.expandedProducts.add(this.getProductTreeKey(brandName, productId));
  }

  async reloadLandCostingReport(): Promise<void> {
    if (!this.selectedProductId || !this.selectedCapacityId) {
      return;
    }

    await this.loadLandCostingReport(this.selectedProductId, this.selectedCapacityId);
  }

  openLandCostingDrawer(): void {
    if (!this.selectedProductId || !this.selectedCapacityId) {
      return;
    }

    if (!this.canViewLandCostingReport()) {
      this.landCostingError = 'You do not have permission to view the land costing report.';
      return;
    }

    this.isLandCostingDrawerOpen = true;
  }

  closeLandCostingDrawer(): void {
    this.isLandCostingDrawerOpen = false;
  }

  getSerialStatusColorClass(row: LandCostingReportItemRow): string {
    if (row.isDefective) {
      return 'text-red-700 dark:text-red-400'; // Red for defective
    }
    if (row.isReturned) {
      return 'text-orange-700 dark:text-orange-400'; // Orange for returned
    }
    if ((row.serialStatus ?? '').toLowerCase() === 'installed') {
      return 'text-green-700 dark:text-green-400'; // Green for installed
    }
    return 'text-gray-700 dark:text-gray-300'; // Plain black/gray for in-stock and others
  }

  getSerialStatusText(row: LandCostingReportItemRow): string {
    return row.serialStatus;
  }

  async exportLandCostingAsExcel(): Promise<void> {
    if (!this.canExportLandCostingReport()) {
      this.landCostingError = 'You do not have permission to export land costing reports.';
      return;
    }

    if (this.landCostingGroups.length === 0) {
      this.landCostingError = 'No land costing rows available to export.';
      return;
    }

    const excelJs = await import('exceljs');
    const workbook = new excelJs.Workbook();
    const worksheet = workbook.addWorksheet('Land Costing Report');

    worksheet.addRow(['Air Summit']);
    worksheet.addRow([`Date Range: ${this.landCostingDateFrom} to ${this.landCostingDateTo}`]);
    worksheet.addRow(['Land Costing Report']);
    worksheet.addRow([]);

    const titleRow = worksheet.getRow(1);
    titleRow.font = { bold: true, size: 14 };
    const centerTitleRow = worksheet.getRow(3);
    centerTitleRow.font = { bold: true, size: 12 };

    for (const group of this.landCostingGroups) {
      worksheet.addRow([`Product (${group.capacityName}): ${group.productName}`]);
      worksheet.addRow([`Dealer: ${group.vendorName || '-'}`]);
      worksheet.addRow([
        'No.',
        'Indoor',
        'Outdoor',
        'Landed Cost',
        'SRP',
        'Margin',
      ]);

      const headerRow = worksheet.lastRow;
      if (headerRow) {
        headerRow.font = { bold: true };
      }

      for (const [rowIndex, row] of group.rows.entries()) {
        worksheet.addRow([
          rowIndex + 1,
          row.indoorSerial || '-',
          row.outdoorSerial || '-',
          row.landedCost,
          row.srp,
          row.marginAmount,
        ]);
      }

      worksheet.addRow([`In-Stock Indoor: ${group.inStockIndoorCount} | In-Stock Outdoor: ${group.inStockOutdoorCount}`]);
      worksheet.addRow([]);
    }

    worksheet.columns = [
      { width: 5 },
      { width: 20 },
      { width: 20 },
      { width: 14 },
      { width: 14 },
      { width: 14 },
    ];

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    this.downloadBlob(blob, `land_costing_${this.landCostingDateFrom}_${this.landCostingDateTo}.xlsx`);
  }

  async exportLandCostingAsPdf(): Promise<void> {
    if (!this.canExportLandCostingReport()) {
      this.landCostingError = 'You do not have permission to export land costing reports.';
      return;
    }

    if (this.landCostingGroups.length === 0) {
      this.landCostingError = 'No land costing rows available to export.';
      return;
    }

    const pdfLib = await import('pdf-lib');
    const document = await pdfLib.PDFDocument.create();
    const font = await document.embedFont(pdfLib.StandardFonts.Helvetica);
    const fontBold = await document.embedFont(pdfLib.StandardFonts.HelveticaBold);

    const pageWidth = 842;
    const pageHeight = 595;
    let page = document.addPage([pageWidth, pageHeight]);
    let y = pageHeight - 40;

    const drawHeader = () => {
      page.drawText('Air Summit', { x: 40, y, size: 14, font: fontBold });
      y -= 18;
      page.drawText(`Date Range: ${this.landCostingDateFrom} to ${this.landCostingDateTo}`, {
        x: 40,
        y,
        size: 10,
        font,
      });
      y -= 22;
      const title = 'Land Costing Report';
      const titleWidth = fontBold.widthOfTextAtSize(title, 12);
      page.drawText(title, {
        x: (pageWidth - titleWidth) / 2,
        y,
        size: 12,
        font: fontBold,
      });
      y -= 18;
    };

    const ensureSpace = (required: number) => {
      if (y >= required) {
        return;
      }

      page = document.addPage([pageWidth, pageHeight]);
      y = pageHeight - 40;
      drawHeader();
    };

    const ellipsis = (value: string, max: number) => {
      if (value.length <= max) {
        return value;
      }

      return `${value.slice(0, Math.max(0, max - 3))}...`;
    };

    drawHeader();

    for (const group of this.landCostingGroups) {
      ensureSpace(120);
      page.drawText(`Product (${group.capacityName}): ${group.productName}`, {
        x: 40,
        y,
        size: 10,
        font: fontBold,
      });
      y -= 14;
      page.drawText(`Dealer: ${group.vendorName || '-'} | PO: ${group.poNumber || '-'} | Date: ${this.formatDateOnly(group.poDate) || '-'}`, {
        x: 40,
        y,
        size: 9,
        font,
      });
      y -= 16;

      const columns = [
        { title: 'No.', x: 40, max: 4 },
        { title: 'Indoor', x: 80, max: 18 },
        { title: 'Outdoor', x: 220, max: 18 },
        { title: 'Landed', x: 400, max: 10 },
        { title: 'SRP', x: 480, max: 10 },
        { title: 'Margin', x: 550, max: 10 },
      ];

      for (const column of columns) {
        page.drawText(column.title, { x: column.x, y, size: 9, font: fontBold });
      }
      y -= 12;

      for (const [rowIndex, row] of group.rows.entries()) {
        ensureSpace(70);
        page.drawText((rowIndex + 1).toString(), { x: columns[0].x, y, size: 8, font });
        page.drawText(ellipsis(row.indoorSerial || '-', columns[1].max), { x: columns[1].x, y, size: 8, font });
        page.drawText(ellipsis(row.outdoorSerial || '-', columns[2].max), { x: columns[2].x, y, size: 8, font });
        page.drawText((row.landedCost ?? 0).toFixed(2), { x: columns[3].x, y, size: 8, font });
        page.drawText((row.srp ?? 0).toFixed(2), { x: columns[4].x, y, size: 8, font });
        page.drawText((row.marginAmount ?? 0).toFixed(2), { x: columns[5].x, y, size: 8, font });
        y -= 11;
      }

      ensureSpace(20);
      page.drawText(`In-Stock Indoor: ${group.inStockIndoorCount} | In-Stock Outdoor: ${group.inStockOutdoorCount}`, { x: 40, y, size: 9, font });
      y -= 12;
    }

    ensureSpace(60);
    page.drawText(`Overall Total Margin: ${this.landCostingTotals.marginAmount.toFixed(2)}`, {
      x: 40,
      y,
      size: 11,
      font: fontBold,
    });

    const bytes = await document.save();
    const pdfBytes = new Uint8Array(bytes);
    this.downloadBlob(new Blob([pdfBytes], { type: 'application/pdf' }), `land_costing_${this.landCostingDateFrom}_${this.landCostingDateTo}.pdf`);
  }

  setActiveCapacitySerialTab(tab: CapacitySerialTab): void {
    this.activeCapacitySerialTab = tab;
    this.serialSearch = '';
    this.selectedSerialUnitType = 'all';
    this.serialCurrentPage = 1;
  }

  setSelectedSerialUnitType(unitType: string): void {
    this.selectedSerialUnitType = unitType;
    this.serialCurrentPage = 1;
  }

  onSerialSearchChange(): void {
    this.serialCurrentPage = 1;
  }

  goToPreviousSerialPage(): void {
    if (this.serialCurrentPage > 1) {
      this.serialCurrentPage -= 1;
    }
  }

  goToNextSerialPage(): void {
    if (this.serialCurrentPage < this.serialTotalPages) {
      this.serialCurrentPage += 1;
    }
  }

  setCreationFormMode(mode: CreationFormMode): void {
    this.isCreationDrawerOpen = true;
    this.creationFormMode = mode;
    this.creationError = '';
    this.creationSuccess = '';

    if (mode === 'product-capacity' && this.selectedBrandName) {
      this.productFormBrandName = this.selectedBrandName;
    }

    if (mode === 'capacity-only') {
      this.capacityOnlySelectedCapacities = ['1.0 HP'];
      this.capacityOnlyDetails = {
        '1.0 HP': this.createEmptyCapacityDraft(),
      };
    }
  }

  openCreationDrawer(mode: CreationFormMode = 'all-in-one'): void {
    this.setCreationFormMode(mode);
  }

  closeCreationDrawer(): void {
    this.isCreationDrawerOpen = false;
    this.creationError = '';
    this.creationSuccess = '';
  }

  toggleAllInOneUnitType(unitType: string): void {
    this.allInOneSelectedUnitTypes = this.toggleUnitTypeSelection(
      this.allInOneSelectedUnitTypes,
      unitType,
    );
  }

  toggleProductFormUnitType(unitType: string): void {
    this.productFormSelectedUnitTypes = this.toggleUnitTypeSelection(
      this.productFormSelectedUnitTypes,
      unitType,
    );
  }

  toggleAllInOneCapacity(capacity: string): void {
    const nextSelection = this.toggleUnitTypeSelection(
      this.allInOneSelectedCapacities,
      capacity,
    );

    this.allInOneSelectedCapacities = nextSelection;
    const isSelected = nextSelection.includes(capacity);

    if (isSelected) {
      this.allInOneCapacityDetails[capacity] =
        this.allInOneCapacityDetails[capacity] ?? this.createEmptyCapacityDraft();
      return;
    }

    delete this.allInOneCapacityDetails[capacity];
  }

  toggleProductFormCapacity(capacity: string): void {
    const nextSelection = this.toggleUnitTypeSelection(
      this.productFormSelectedCapacities,
      capacity,
    );

    this.productFormSelectedCapacities = nextSelection;
    const isSelected = nextSelection.includes(capacity);

    if (isSelected) {
      this.productFormCapacityDetails[capacity] =
        this.productFormCapacityDetails[capacity] ?? this.createEmptyCapacityDraft();
      return;
    }

    delete this.productFormCapacityDetails[capacity];
  }

  toggleCapacityOnly(capacity: string): void {
    const nextSelection = this.toggleUnitTypeSelection(
      this.capacityOnlySelectedCapacities,
      capacity,
    );

    this.capacityOnlySelectedCapacities = nextSelection;
    const isSelected = nextSelection.includes(capacity);

    if (isSelected) {
      this.capacityOnlyDetails[capacity] =
        this.capacityOnlyDetails[capacity] ?? this.createEmptyCapacityDraft();
      return;
    }

    delete this.capacityOnlyDetails[capacity];
  }

  openCapacityOnlyDrawer(): void {
    if (!this.selectedProduct || !this.selectedBrandName) {
      this.errorMessage = 'Select a product first to add capacity.';
      return;
    }

    this.errorMessage = '';
    this.setCreationFormMode('capacity-only');
  }

  async submitCreationForm(): Promise<void> {
    this.creationError = '';
    this.creationSuccess = '';
    this.isSubmittingCreation = true;

    try {
      if (this.creationFormMode === 'brand-only') {
        await this.submitBrandOnlyForm();
        return;
      }

      if (this.creationFormMode === 'all-in-one') {
        await this.submitAllInOneForm();
        return;
      }

      if (this.creationFormMode === 'product-capacity') {
        await this.submitProductCapacityForm();
        return;
      }

      if (this.creationFormMode === 'capacity-only') {
        await this.submitCapacityOnlyForm();
        return;
      }

      this.creationError = 'Select a supported creation form';
    } catch (error: unknown) {
      if (axios.isAxiosError(error)) {
        this.creationError =
          (error.response?.data as { message?: string } | undefined)?.message ??
          'Unable to save inventory data';
      } else {
        this.creationError = 'Unable to save inventory data';
      }
    } finally {
      this.isSubmittingCreation = false;
    }
  }

  toggleBrand(name: string): void {
    if (this.expandedBrands.has(name)) {
      this.expandedBrands.delete(name);
      return;
    }

    this.expandedBrands.add(name);
  }

  openBrandContextMenu(event: MouseEvent, brandName: string): void {
    event.preventDefault();
    event.stopPropagation();
    this.brandContextMenuVisible = true;
    this.brandContextMenuX = event.clientX;
    this.brandContextMenuY = event.clientY;
    this.brandContextMenuBrandName = brandName;
  }

  closeBrandContextMenu(): void {
    this.brandContextMenuVisible = false;
    this.brandContextMenuBrandName = null;
  }

  async onBrandContextAction(action: 'add-product' | 'edit-brand' | 'delete-brand'): Promise<void> {
    const brandName = this.brandContextMenuBrandName ?? 'Brand';
    this.closeBrandContextMenu();

    if (action === 'add-product') {
      this.addProductFromBrandContext(brandName);
      return;
    }

    if (action === 'edit-brand') {
      await this.editBrandFromContext(brandName);
      return;
    }

    if (action === 'delete-brand') {
      await this.deleteBrandFromContext(brandName);
      return;
    }
  }

  @HostListener('document:click')
  onDocumentClick(): void {
    this.closeBrandContextMenu();
  }

  @HostListener('document:contextmenu', ['$event'])
  onDocumentContextMenu(event: MouseEvent): void {
    const target = event.target as HTMLElement | null;
    const isBrandContextTarget =
      !!target &&
      (target.closest('[data-brand-context="true"]') !== null ||
        target.closest('[data-brand-context-menu="true"]') !== null);

    if (!isBrandContextTarget) {
      this.closeBrandContextMenu();
    }
  }

  toggleProduct(brandName: string, productId: number): void {
    const key = this.getProductTreeKey(brandName, productId);
    if (this.expandedProducts.has(key)) {
      this.expandedProducts.delete(key);
      return;
    }

    this.expandedProducts.add(key);
  }

  isBrandExpanded(name: string): boolean {
    if (this.hasTreeSearch) {
      return true;
    }

    return this.expandedBrands.has(name);
  }

  isProductExpanded(brandName: string, productId: number): boolean {
    if (this.hasTreeSearch) {
      return true;
    }

    return this.expandedProducts.has(this.getProductTreeKey(brandName, productId));
  }

  isBrandSelected(name: string): boolean {
    return this.selectedNodeType === 'brand' && this.selectedBrandName === name;
  }

  isProductSelected(productId: number): boolean {
    return this.selectedNodeType === 'product' && this.selectedProductId === productId;
  }

  isCapacitySelected(capacityId: number): boolean {
    return this.selectedNodeType === 'capacity' && this.selectedCapacityId === capacityId;
  }

  get selectedNodeType(): InventoryNodeType | null {
    if (this.selectedCapacityId != null) {
      return 'capacity';
    }

    if (this.selectedProductId != null) {
      return 'product';
    }

    if (this.selectedBrandName) {
      return 'brand';
    }

    return null;
  }

  get selectedNodeTitle(): string {
    if (this.selectedNodeType === 'capacity' && this.selectedCapacity) {
      return this.selectedCapacity.name || `Capacity ${this.selectedCapacity.id}`;
    }

    if (this.selectedNodeType === 'product' && this.selectedProduct) {
      return this.selectedProduct.name || `Product ${this.selectedProduct.id}`;
    }

    if (this.selectedNodeType === 'brand' && this.selectedBrandName) {
      return this.selectedBrandName;
    }

    return 'Inventory Overview';
  }

  get selectedNodeDescription(): string {
    if (this.selectedNodeType === 'capacity' && this.selectedCapacity) {
      const capacity = this.selectedCapacity;
      return `Capacity details for ${capacity.name || `#${capacity.id}`}.`;
    }

    if (this.selectedNodeType === 'product' && this.selectedProduct) {
      return `Product with ${this.selectedProduct.capacities.length} available capacities.`;
    }

    if (this.selectedNodeType === 'brand' && this.selectedBrand) {
      return `Brand with ${this.selectedBrand.products.length} products.`;
    }

    return 'Select a brand, product, or capacity from the folder tree.';
  }

  get selectedBrand(): BrandFolder | null {
    if (!this.selectedBrandName) {
      return null;
    }

    return this.brandFolders.find((folder) => folder.name === this.selectedBrandName) ?? null;
  }

  get selectedCapacity(): ProductCapacityOption | null {
    if (this.selectedCapacityId == null) {
      return null;
    }

    const capacity = this.selectedProduct?.capacities.find((item) => item.id === this.selectedCapacityId);
    return capacity ?? null;
  }

  get selectedBrandProducts(): ProductOption[] {
    if (!this.selectedBrandName) {
      return [];
    }

    return (
      this.brandFolders.find((folder) => folder.name === this.selectedBrandName)?.products ??
      []
    );
  }

  get selectedProduct(): ProductOption | null {
    const product = this.selectedBrandProducts.find((item) => item.id === this.selectedProductId);
    return product ?? null;
  }

  get capacitySerialTabs(): Array<{ key: CapacitySerialTab; label: string; count: number }> {
    return [
      { key: 'in-stock', label: 'In-Stock', count: this.getCapacitySerialCount('in-stock') },
      { key: 'reserved', label: 'Reserved', count: this.getCapacitySerialCount('reserved') },
      { key: 'installed', label: 'Installed', count: this.getCapacitySerialCount('installed') },
    ];
  }

  get activeTabSerialCount(): number {
    return this.getCapacitySerialCount(this.activeCapacitySerialTab);
  }

  get activeTabSerialList(): SerialEntry[] {
    const serials = this.capacityStockSummary?.serials;
    if (!serials) {
      return [];
    }

    let list: SerialEntry[] = [];

    if (this.activeCapacitySerialTab === 'in-stock') {
      list = serials.inStock ?? [];
    } else if (this.activeCapacitySerialTab === 'reserved') {
      list = serials.reserved ?? [];
    } else {
      list = serials.installed ?? [];
    }

    if (this.selectedSerialUnitType !== 'all') {
      const targetUnitType = this.normalizeUnitTypeValue(this.selectedSerialUnitType);
      list = list.filter((entry) => {
        const normalizedUnitType = this.normalizeUnitTypeValue(entry.unitType);
        return normalizedUnitType === targetUnitType;
      });
    }

    const normalizedQuery = this.normalizeSearchText(this.serialSearch);
    if (!normalizedQuery) {
      return list;
    }

    const tokens = normalizedQuery.split(' ').filter(Boolean);
    return list.filter((entry) => {
      const searchableText = this.normalizeSearchText(
        `${entry.serialNumber} ${entry.unitType}`,
      );
      return tokens.every((token) => searchableText.includes(token));
    });
  }

  get activeTabFilteredSerialCount(): number {
    return this.activeTabSerialList.length;
  }

  get serialTotalPages(): number {
    if (this.activeTabFilteredSerialCount === 0) {
      return 1;
    }

    return Math.ceil(this.activeTabFilteredSerialCount / this.serialPageSize);
  }

  get paginatedActiveTabSerialList(): SerialEntry[] {
    const page = Math.min(Math.max(this.serialCurrentPage, 1), this.serialTotalPages);
    const start = (page - 1) * this.serialPageSize;
    return this.activeTabSerialList.slice(start, start + this.serialPageSize);
  }

  get serialPageRangeStart(): number {
    if (this.activeTabFilteredSerialCount === 0) {
      return 0;
    }

    const page = Math.min(Math.max(this.serialCurrentPage, 1), this.serialTotalPages);
    return (page - 1) * this.serialPageSize + 1;
  }

  get serialPageRangeEnd(): number {
    if (this.activeTabFilteredSerialCount === 0) {
      return 0;
    }

    return Math.min(this.serialPageRangeStart + this.serialPageSize - 1, this.activeTabFilteredSerialCount);
  }

  get serialUnitTypeOptions(): UnitTypeOption[] {
    const serials = this.capacityStockSummary?.serials;
    if (!serials) {
      return [
        { value: 'all', label: 'All Unit Types', count: 0 },
      ];
    }

    let list: SerialEntry[] = [];
    if (this.activeCapacitySerialTab === 'in-stock') {
      list = serials.inStock ?? [];
    } else if (this.activeCapacitySerialTab === 'reserved') {
      list = serials.reserved ?? [];
    } else {
      list = serials.installed ?? [];
    }

    const counts = new Map<string, number>();
    for (const entry of list) {
      const raw = String(entry.unitType ?? '').trim();
      const normalized = this.normalizeUnitTypeValue(raw);
      if (!normalized) {
        continue;
      }

      counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
    }

    const options: UnitTypeOption[] = [
      { value: 'all', label: 'All Unit Types', count: list.length },
    ];

    const sorted = Array.from(counts.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    for (const [value, count] of sorted) {
      options.push({ value, label: this.formatUnitTypeLabel(value), count });
    }

    return options;
  }

  get activeTabSetCount(): number {
    return this.computeSetCount(this.activeTabSerialCount);
  }

  get activeTabUnpairedCount(): number {
    return this.computeUnpairedCount(this.activeTabSerialCount);
  }

  get activeTabTotalSellingAmount(): number {
    return this.activeTabSetCount * Number(this.selectedCapacity?.sellPrice ?? 0);
  }

  get activeTabTotalCostAmount(): number {
    return this.activeTabSetCount * Number(this.selectedCapacity?.unitPrice ?? 0);
  }

  get activeTabMarginAmount(): number {
    return this.activeTabTotalSellingAmount - this.activeTabTotalCostAmount;
  }

  canViewLandCostingReport(): boolean {
    return this.canAccessInventoryPermission(this.landCostingViewPermissionKeys);
  }

  canViewLandCostingMargin(): boolean {
    return this.canAccessInventoryPermission(this.landCostingMarginPermissionKeys);
  }

  canExportLandCostingReport(): boolean {
    return this.canAccessInventoryPermission(this.landCostingExportPermissionKeys);
  }



  get hasTreeSearch(): boolean {
    return this.normalizeSearchText(this.treeSearch).length > 0;
  }

  get filteredBrandFolders(): BrandFolder[] {
    const normalizedQuery = this.normalizeSearchText(this.treeSearch);
    if (!normalizedQuery) {
      return this.brandFolders;
    }

    const queryTokens = normalizedQuery.split(' ').filter(Boolean);
    const matchesTokens = (value: string): boolean => {
      const normalizedValue = this.normalizeSearchText(value);
      return queryTokens.every((token) => normalizedValue.includes(token));
    };

    return this.brandFolders
      .map((brandFolder) => {
        const brandMatches = matchesTokens(brandFolder.name);

        const filteredProducts = brandFolder.products
          .map((product) => {
            const productMatches = matchesTokens(
              `${brandFolder.name} ${product.name}`,
            );

            const filteredCapacities = brandMatches || productMatches
              ? product.capacities
              : product.capacities.filter((capacity) =>
                  matchesTokens(
                    `${brandFolder.name} ${product.name} ${capacity.name}`,
                  ),
                );

            if (brandMatches || productMatches || filteredCapacities.length > 0) {
              return {
                ...product,
                capacities: filteredCapacities,
              };
            }

            return null;
          })
          .filter((product): product is ProductOption => product !== null);

        if (brandMatches || filteredProducts.length > 0) {
          return {
            ...brandFolder,
            products: filteredProducts,
          };
        }

        return null;
      })
      .filter((brand): brand is BrandFolder => brand !== null);
  }

  async addCapacityToSelectedProduct(): Promise<void> {
    if (!this.selectedProduct || !this.selectedBrandName) {
      return;
    }

    const capacityName = this.newCapacityName.trim();
    if (!capacityName) {
      this.addCapacityError = 'Capacity name is required';
      this.addCapacitySuccess = '';
      return;
    }

    this.isAddingCapacity = true;
    this.addCapacityError = '';
    this.addCapacitySuccess = '';

    try {
      const response = await apiClient.post<{
        success: boolean;
        message?: string;
      }>('/capacity', {
        productId: this.selectedProduct.id,
        capacity: capacityName,
        indoorModel: this.newCapacityIndoorModel.trim(),
        outdoorModel: this.newCapacityOutdoorModel.trim(),
        srp: this.newCapacitySrp ?? 0,
        netPrice: this.newCapacityNetPrice ?? 0,
      });

      if (!response.data.success) {
        this.addCapacityError = response.data.message ?? 'Unable to add capacity';
        return;
      }

      this.addCapacitySuccess = response.data.message ?? 'Capacity added successfully';

      const previousSelection = {
        brandName: this.selectedBrandName,
        productId: this.selectedProduct.id,
      };

      await this.loadInventoryFolders(previousSelection);

      const refreshedProduct = this.selectedProduct;
      const newCapacity = refreshedProduct?.capacities.find(
        (capacity) =>
          this.normalizeSearchText(capacity.name) === this.normalizeSearchText(capacityName),
      );

      if (newCapacity && previousSelection.brandName) {
        this.selectCapacity(previousSelection.brandName, previousSelection.productId, newCapacity.id);
      }

      this.resetCapacityFormFields();
    } catch (error: unknown) {
      if (axios.isAxiosError(error)) {
        this.addCapacityError =
          (error.response?.data as { message?: string } | undefined)?.message ??
          'Unable to add capacity';
      } else {
        this.addCapacityError = 'Unable to add capacity';
      }
    } finally {
      this.isAddingCapacity = false;
    }
  }

  async editSelectedProductDetails(): Promise<void> {
    if (!this.selectedProduct || !this.selectedBrandName) {
      return;
    }

    if (this.isUpdatingProduct) {
      return;
    }

    const product = this.selectedProduct;
    this.editModalMode = 'product';
    this.editModalTitle = 'Edit Product Details';
    this.editModalDescription = 'Update product name, unit, and unit types.';
    this.editModalSubmitLabel = 'Save Product';
    this.editModalFields = [
      {
        key: 'productName',
        label: 'Product Name',
        type: 'text',
        required: true,
        placeholder: 'Enter product name',
      },
      {
        key: 'unit',
        label: 'Unit',
        type: 'text',
        required: true,
        placeholder: 'SET',
      },
      {
        key: 'unitTypes',
        label: 'Unit Types (comma separated)',
        type: 'text',
        required: true,
        placeholder: 'Indoor, Outdoor',
      },
    ];
    this.editModalInitialValues = {
      productName: product.name ?? '',
      unit: product.unit ?? 'SET',
      unitTypes: Array.isArray(product.unitTypes) ? product.unitTypes.join(', ') : '',
    };
    this.isEditModalOpen = true;
  }

  async editSelectedCapacityDetails(): Promise<void> {
    if (!this.selectedCapacity || !this.selectedProduct || !this.selectedBrandName) {
      return;
    }

    if (this.isUpdatingCapacity) {
      return;
    }

    const capacity = this.selectedCapacity;

    this.editModalMode = 'capacity';
    this.editModalTitle = 'Edit Capacity Details';
    this.editModalDescription = 'Update SRP, net price, model numbers, and capacity name.';
    this.editModalSubmitLabel = 'Save Capacity';
    this.editModalFields = [
      {
        key: 'capacityName',
        label: 'Capacity Name',
        type: 'text',
        required: true,
      },
      {
        key: 'srp',
        label: 'SRP',
        type: 'number',
        required: true,
        min: 0,
        step: 0.01,
      },
      {
        key: 'netPrice',
        label: 'Net Price',
        type: 'number',
        required: true,
        min: 0,
        step: 0.01,
      },
      {
        key: 'indoorModel',
        label: 'Indoor Model',
        type: 'text',
      },
      {
        key: 'outdoorModel',
        label: 'Outdoor Model',
        type: 'text',
      },
    ];
    this.editModalInitialValues = {
      capacityName: capacity.name ?? '',
      srp: Number(capacity.sellPrice ?? 0),
      netPrice: Number(capacity.unitPrice ?? 0),
      indoorModel: String(capacity.indoorModel ?? ''),
      outdoorModel: String(capacity.outdoorModel ?? ''),
    };
    this.isEditModalOpen = true;
  }

  closeEditModal(): void {
    if (this.isEditModalSubmitting) {
      return;
    }

    this.isEditModalOpen = false;
    this.editModalMode = null;
    this.editModalTitle = '';
    this.editModalDescription = '';
    this.editModalFields = [];
    this.editModalInitialValues = {};
    this.editModalSubmitLabel = 'Save Changes';
  }

  async onEditModalSave(payload: Record<string, unknown>): Promise<void> {
    if (!this.editModalMode || this.isEditModalSubmitting) {
      return;
    }

    if (this.editModalMode === 'product') {
      await this.submitProductEditFromModal(payload);
      return;
    }

    await this.submitCapacityEditFromModal(payload);
  }

  private async submitProductEditFromModal(payload: Record<string, unknown>): Promise<void> {
    if (!this.selectedProduct || !this.selectedBrandName) {
      return;
    }

    const productId = this.selectedProduct.id;
    const brandName = this.selectedBrandName;

    const productName = String(payload['productName'] ?? '').trim();
    const unit = String(payload['unit'] ?? '').trim().toUpperCase();
    const unitTypes = String(payload['unitTypes'] ?? '')
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);

    if (!productName) {
      this.errorMessage = 'Product name is required';
      return;
    }

    if (!unit) {
      this.errorMessage = 'Unit is required';
      return;
    }

    if (unitTypes.length === 0) {
      this.errorMessage = 'At least one unit type is required';
      return;
    }

    this.isUpdatingProduct = true;
    this.isEditModalSubmitting = true;
    this.errorMessage = '';

    try {
      const response = await apiClient.patch<ApiMutationResponse>(`/products/${productId}`, {
        productName,
        unit,
        unitTypes,
      });

      if (!response.data.success) {
        this.errorMessage = response.data.message ?? 'Unable to update product details';
        return;
      }

      await this.loadInventoryFolders({
        brandName,
        productId,
      });

      this.addCapacitySuccess = response.data.message ?? 'Product details updated successfully';
      this.addCapacityError = '';
      this.closeEditModal();
    } catch (error: unknown) {
      if (axios.isAxiosError(error)) {
        this.errorMessage =
          (error.response?.data as { message?: string } | undefined)?.message ??
          'Unable to update product details';
      } else {
        this.errorMessage = 'Unable to update product details';
      }
    } finally {
      this.isUpdatingProduct = false;
      this.isEditModalSubmitting = false;
    }
  }

  private async submitCapacityEditFromModal(payload: Record<string, unknown>): Promise<void> {
    if (!this.selectedCapacity || !this.selectedProduct || !this.selectedBrandName) {
      return;
    }

    const selectedCapacity = this.selectedCapacity;
    const selectedProduct = this.selectedProduct;
    const brandName = this.selectedBrandName;

    const capacityName = String(payload['capacityName'] ?? '').trim();
    const srp = Number(payload['srp']);
    const netPrice = Number(payload['netPrice']);
    const indoorModel = String(payload['indoorModel'] ?? '').trim();
    const outdoorModel = String(payload['outdoorModel'] ?? '').trim();

    if (!capacityName) {
      this.errorMessage = 'Capacity name is required';
      return;
    }

    if (!Number.isFinite(srp) || !Number.isFinite(netPrice)) {
      this.errorMessage = 'SRP and Net Price must be valid numbers';
      return;
    }

    this.isUpdatingCapacity = true;
    this.isEditModalSubmitting = true;
    this.errorMessage = '';

    try {
      const response = await apiClient.patch<ApiMutationResponse>(`/capacity/${selectedCapacity.id}`, {
        productId: selectedProduct.id,
        capacity: capacityName,
        srp,
        netPrice,
        indoorModel,
        outdoorModel,
      });

      if (!response.data.success) {
        this.errorMessage = response.data.message ?? 'Unable to update capacity details';
        return;
      }

      await this.loadInventoryFolders({
        brandName,
        productId: selectedProduct.id,
        capacityId: selectedCapacity.id,
      });

      this.addCapacitySuccess = response.data.message ?? 'Capacity updated successfully';
      this.addCapacityError = '';
      this.closeEditModal();
    } catch (error: unknown) {
      if (axios.isAxiosError(error)) {
        this.errorMessage =
          (error.response?.data as { message?: string } | undefined)?.message ??
          'Unable to update capacity details';
      } else {
        this.errorMessage = 'Unable to update capacity details';
      }
    } finally {
      this.isUpdatingCapacity = false;
      this.isEditModalSubmitting = false;
    }
  }

  private async submitBrandOnlyForm(): Promise<void> {
    const brandName = this.createBrandName.trim();
    if (!brandName) {
      this.creationError = 'Brand name is required';
      return;
    }

    const response = await apiClient.post<ApiMutationResponse & { item?: { id?: number; name?: string } }>('/brands', {
      name: brandName,
    });

    if (!response.data.success) {
      this.creationError = response.data.message ?? 'Unable to create brand';
      return;
    }

    await this.loadInventoryFolders({ brandName });
    this.selectBrand(brandName);
    this.createBrandName = '';
    this.creationSuccess = response.data.message ?? 'Brand created successfully';
    this.closeCreationDrawer();
  }

  private async submitAllInOneForm(): Promise<void> {
    const brandName = this.allInOneBrandName.trim();
    if (!brandName) {
      this.creationError = 'Brand name is required';
      return;
    }

    const brandResponse = await apiClient.post<ApiMutationResponse & { item?: { id?: number; name?: string } }>('/brands', {
      name: brandName,
    });

    if (!brandResponse.data.success) {
      this.creationError = brandResponse.data.message ?? 'Unable to create brand';
      return;
    }

    const brandId = Number(brandResponse.data.item?.id);
    if (!Number.isFinite(brandId) || brandId <= 0) {
      this.creationError = 'Brand created but brand id is unavailable';
      return;
    }

    if (!this.allInOneIncludeProduct) {
      await this.loadInventoryFolders({ brandName });
      this.selectBrand(brandName);
      this.resetAllInOneFormFields();
      this.creationSuccess = 'Brand created successfully';
      return;
    }

    const productName = this.allInOneProductName.trim();
    if (!productName) {
      this.creationError = 'Product name is required';
      return;
    }

    const unitTypes = this.parseUnitTypes(this.allInOneSelectedUnitTypes);
    if (unitTypes.length === 0) {
      this.creationError = 'Unit types are required';
      return;
    }

    const capacities = this.allInOneIncludeCapacity
      ? this.buildProductCapacityPayload({
          names: this.allInOneSelectedCapacities,
          detailsByName: this.allInOneCapacityDetails,
        })
      : [];

    if (capacities === null) {
      return;
    }

    const productResponse = await apiClient.post<ApiMutationResponse>('/products', {
      brandId,
      productName,
      unit: (String(this.allInOneUnit || 'SET').trim() || 'SET').toUpperCase(),
      unitTypes,
      capacities,
    });

    if (!productResponse.data.success) {
      this.creationError = productResponse.data.message ?? 'Unable to create product';
      return;
    }

    await this.loadInventoryFolders({ brandName });
    this.selectBrand(brandName);
    this.resetAllInOneFormFields();
    this.creationSuccess = 'Brand, product, and capacity created successfully';
    this.closeCreationDrawer();
  }

  private async submitProductCapacityForm(): Promise<void> {
    const brandName = (this.productFormBrandName || this.selectedBrandName || '').trim();
    if (!brandName) {
      this.creationError = 'Select a brand';
      return;
    }

    const brandId = this.findBrandIdByName(brandName);
    if (!brandId) {
      this.creationError = 'Selected brand is not available';
      return;
    }

    const productName = this.productFormProductName.trim();
    if (!productName) {
      this.creationError = 'Product name is required';
      return;
    }

    const unitTypes = this.parseUnitTypes(this.productFormSelectedUnitTypes);
    if (unitTypes.length === 0) {
      this.creationError = 'Unit types are required';
      return;
    }

    const capacities = this.productFormIncludeCapacity
      ? this.buildProductCapacityPayload({
          names: this.productFormSelectedCapacities,
          detailsByName: this.productFormCapacityDetails,
        })
      : [];

    if (capacities === null) {
      return;
    }

    const response = await apiClient.post<ApiMutationResponse>('/products', {
      brandId,
      productName,
      unit: (String(this.productFormUnit || 'SET').trim() || 'SET').toUpperCase(),
      unitTypes,
      capacities,
    });

    if (!response.data.success) {
      this.creationError = response.data.message ?? 'Unable to create product';
      return;
    }

    await this.loadInventoryFolders({ brandName });
    this.selectBrand(brandName);
    this.resetProductFormFields();
    this.creationSuccess = response.data.message ?? 'Product created successfully';
    this.closeCreationDrawer();
  }

  private async submitCapacityOnlyForm(): Promise<void> {
    if (!this.selectedProduct || !this.selectedBrandName) {
      this.creationError = 'Select a product first';
      return;
    }

    const payload = this.buildProductCapacityPayload({
      names: this.capacityOnlySelectedCapacities,
      detailsByName: this.capacityOnlyDetails,
    });

    if (payload === null) {
      return;
    }

    for (const capacity of payload) {
      const response = await apiClient.post<{
        success: boolean;
        message?: string;
      }>('/capacity', {
        productId: this.selectedProduct.id,
        capacity: capacity.capacity,
        indoorModel: capacity.indoorModel,
        outdoorModel: capacity.outdoorModel,
        srp: Number(capacity.srp),
        netPrice: Number(capacity.netPrice),
      });

      if (!response.data.success) {
        this.creationError = response.data.message ?? `Unable to add capacity ${capacity.capacity}`;
        return;
      }
    }

    await this.loadInventoryFolders({
      brandName: this.selectedBrandName,
      productId: this.selectedProduct.id,
    });

    this.creationSuccess = 'Capacity added successfully';
    this.closeCreationDrawer();
  }

  private parseUnitTypes(values: string[]): string[] {
    const toLabel = (entry: string): string => {
      const normalized = entry.trim().replace(/\s+/g, ' ');
      if (!normalized) {
        return '';
      }

      return normalized
        .split(' ')
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
        .join(' ');
    };

    return values
      .map((entry) => toLabel(entry))
      .filter((entry) => entry.length > 0);
  }

  private findBrandIdByName(name: string): number | null {
    const brand = this.brandFolders.find((folder) => this.normalizeSearchText(folder.name) === this.normalizeSearchText(name));
    if (!brand?.id) {
      return null;
    }

    return brand.id;
  }

  private toggleUnitTypeSelection(current: string[], unitType: string): string[] {
    const normalizedUnitType = String(unitType).trim();
    if (!normalizedUnitType) {
      return current;
    }

    if (current.includes(normalizedUnitType)) {
      if (current.length === 1) {
        return current;
      }

      return current.filter((entry) => entry !== normalizedUnitType);
    }

    return [...current, normalizedUnitType];
  }

  private buildProductCapacityPayload(input: {
    names: string[];
    detailsByName: Record<string, CapacityDraft>;
  }): Array<{
    capacity: string;
    indoorModel: string;
    outdoorModel: string;
    srp: string;
    netPrice: string;
    supplierId: string;
    purchaseOrderId: string;
    purchaseOrderNo: string;
  }> | null {
    const capacityNames = input.names
      .map((name) => String(name).trim())
      .filter((name) => name.length > 0);

    if (capacityNames.length === 0) {
      this.creationError = 'Select at least one capacity';
      return null;
    }

    return capacityNames.map((capacityName) => {
      const details = input.detailsByName[capacityName] ?? this.createEmptyCapacityDraft();
      const srp = Number(details.srp ?? 0);
      const netPrice = Number(details.netPrice ?? 0);

      return {
      capacity: capacityName,
      indoorModel: String(details.indoorModel ?? '').trim(),
      outdoorModel: String(details.outdoorModel ?? '').trim(),
      srp: String(Number.isFinite(srp) ? srp : 0),
      netPrice: String(Number.isFinite(netPrice) ? netPrice : 0),
      supplierId: '',
      purchaseOrderId: '',
      purchaseOrderNo: '',
      };
    });
  }

  private createEmptyCapacityDraft(): CapacityDraft {
    return {
      srp: null,
      netPrice: null,
      indoorModel: '',
      outdoorModel: '',
    };
  }

  private resetAllInOneFormFields(): void {
    this.allInOneBrandName = '';
    this.allInOneIncludeProduct = true;
    this.allInOneProductName = '';
    this.allInOneUnit = 'SET';
    this.allInOneSelectedUnitTypes = ['Indoor', 'Outdoor'];
    this.allInOneIncludeCapacity = true;
    this.allInOneSelectedCapacities = ['1.0 HP'];
    this.allInOneCapacityDetails = {
      '1.0 HP': this.createEmptyCapacityDraft(),
    };
  }

  private resetProductFormFields(): void {
    this.productFormProductName = '';
    this.productFormUnit = 'SET';
    this.productFormSelectedUnitTypes = ['Indoor', 'Outdoor'];
    this.productFormIncludeCapacity = true;
    this.productFormSelectedCapacities = ['1.0 HP'];
    this.productFormCapacityDetails = {
      '1.0 HP': this.createEmptyCapacityDraft(),
    };
  }

  private async loadInventoryFolders(selection?: {
    brandName?: string | null;
    productId?: number | null;
    capacityId?: number | null;
  }): Promise<void> {
    this.isLoading = true;
    this.errorMessage = '';

    const requestedBrandName = selection?.brandName ?? this.selectedBrandName;
    const requestedProductId = selection?.productId ?? this.selectedProductId;
    const requestedCapacityId = selection?.capacityId ?? this.selectedCapacityId;

    try {
      const [products, rawBrands] = await Promise.all([
        this.salesOrderService.getProducts(),
        this.getBrands(),
      ]);

      // Hide material brands from the inventory folder tree.
      const brands = rawBrands.filter(
        (brand) => String(brand.type ?? '').toLowerCase() !== 'mat',
      );

      // Do not include material brands in the inventory tree.
      const inventoryProducts = products.filter(
        (product) => String(product.brandType ?? '').toLowerCase() !== 'mat',
      );

      const grouped = new Map<string, ProductOption[]>();

      for (const product of inventoryProducts) {
        const brandName = String(product.brandName ?? 'Uncategorized').trim() || 'Uncategorized';
        const current = grouped.get(brandName) ?? [];
        current.push(product);
        grouped.set(brandName, current);
      }

      const folderMap = new Map<string, BrandFolder>();
      for (const brand of brands) {
        const name = String(brand.name ?? '').trim();
        if (!name) {
          continue;
        }

        folderMap.set(name, {
          id: Number.isFinite(Number(brand.id)) ? Number(brand.id) : null,
          name,
          products: [],
        });
      }

      for (const [name, brandProducts] of grouped.entries()) {
        const existing = folderMap.get(name);
        if (existing) {
          existing.products = [...brandProducts].sort((a, b) => a.name.localeCompare(b.name));
          continue;
        }

        folderMap.set(name, {
          id: null,
          name,
          products: [...brandProducts].sort((a, b) => a.name.localeCompare(b.name)),
        });
      }

      this.brandFolders = Array.from(folderMap.values())
        .sort((a, b) => a.name.localeCompare(b.name));

      const selectedBrand =
        this.brandFolders.find((folder) => folder.name === requestedBrandName) ??
        this.brandFolders[0] ??
        null;

      this.selectedBrandName = selectedBrand?.name ?? null;

      const selectedProduct =
        selectedBrand?.products.find((product) => product.id === requestedProductId) ??
        null;

      this.selectedProductId = selectedProduct?.id ?? null;

      const selectedCapacity =
        selectedProduct?.capacities.find((capacity) => capacity.id === requestedCapacityId) ??
        null;

      this.selectedCapacityId = selectedCapacity?.id ?? null;

      this.expandedBrands = new Set(this.selectedBrandName ? [this.selectedBrandName] : []);
      this.expandedProducts = new Set<string>(
        this.selectedBrandName && this.selectedProductId != null
          ? [this.getProductTreeKey(this.selectedBrandName, this.selectedProductId)]
          : [],
      );
    } catch (error: unknown) {
      if (axios.isAxiosError(error)) {
        this.errorMessage =
          (error.response?.data as { message?: string } | undefined)?.message ??
          'Unable to load inventory folders';
      } else {
        this.errorMessage = 'Unable to load inventory folders';
      }

      this.brandFolders = [];
      this.selectedBrandName = null;
      this.selectedProductId = null;
      this.selectedCapacityId = null;
      this.expandedBrands.clear();
      this.expandedProducts.clear();
    } finally {
      this.isLoading = false;
    }
  }

  private async getBrands(): Promise<BrandOption[]> {
    const response = await apiClient.get<{ success: boolean; items?: BrandOption[]; message?: string }>('/brands');
    return response.data.items ?? [];
  }

  private addProductFromBrandContext(brandName: string): void {
    const brand = this.brandFolders.find((folder) => folder.name === brandName) ?? null;
    if (!brand?.id) {
      this.errorMessage = 'Brand record is not available for this action';
      return;
    }

    this.productFormBrandName = brand.name;
    this.openCreationDrawer('product-capacity');
  }

  private async editBrandFromContext(brandName: string): Promise<void> {
    const brand = this.brandFolders.find((folder) => folder.name === brandName) ?? null;
    if (!brand?.id) {
      this.errorMessage = 'Brand record is not available for this action';
      return;
    }

    const updatedNameInput = window.prompt('Edit Brand Name', brand.name);
    const updatedName = String(updatedNameInput ?? '').trim();

    if (!updatedName || updatedName === brand.name) {
      return;
    }

    this.errorMessage = '';

    try {
      const response = await apiClient.patch<ApiMutationResponse>(`/brands/${brand.id}`, {
        name: updatedName,
      });

      if (!response.data.success) {
        this.errorMessage = response.data.message ?? 'Unable to update brand';
        return;
      }

      await this.loadInventoryFolders({
        brandName: updatedName,
      });
      this.selectBrand(updatedName);
    } catch (error: unknown) {
      if (axios.isAxiosError(error)) {
        this.errorMessage =
          (error.response?.data as { message?: string } | undefined)?.message ??
          'Unable to update brand';
      } else {
        this.errorMessage = 'Unable to update brand';
      }
    }
  }

  private async deleteBrandFromContext(brandName: string): Promise<void> {
    const brand = this.brandFolders.find((folder) => folder.name === brandName) ?? null;
    if (!brand?.id) {
      this.errorMessage = 'Brand record is not available for this action';
      return;
    }

    const confirmed = window.confirm(`Delete brand "${brand.name}"?`);
    if (!confirmed) {
      return;
    }

    this.errorMessage = '';

    try {
      const response = await apiClient.delete<ApiMutationResponse>(`/brands/${brand.id}`);

      if (!response.data.success) {
        this.errorMessage = response.data.message ?? 'Unable to delete brand';
        return;
      }

      await this.loadInventoryFolders();
    } catch (error: unknown) {
      if (axios.isAxiosError(error)) {
        this.errorMessage =
          (error.response?.data as { message?: string } | undefined)?.message ??
          'Unable to delete brand';
      } else {
        this.errorMessage = 'Unable to delete brand';
      }
    }
  }

  private async loadCapacityStockSummary(productId: number, capacityId: number): Promise<void> {
    const normalizedProductId = Number(productId);
    const normalizedCapacityId = Number(capacityId);

    if (!Number.isFinite(normalizedProductId) || !Number.isFinite(normalizedCapacityId)) {
      console.warn('Invalid productId or capacityId for loading capacity stock summary');
      return;
    }

    this.isLoadingCapacityStock = true;
    this.capacityStockError = '';
    this.activeCapacitySerialTab = 'in-stock';
    this.serialSearch = '';
    this.selectedSerialUnitType = 'all';
    this.serialCurrentPage = 1;

    try {
      const response = await apiClient.get<{
        success: boolean;
        message?: string;
        item?: {
          branchId?: number | null;
          productId: number;
          capacityId: number;
          unit?: string;
          unitTypes?: string[];
          unitTypeCount?: number;
          counts?: {
            inStock?: number;
            reserved?: number;
            installed?: number;
            delivered?: number;
          };
          serials?: {
            inStock?: Array<{ serialNumber?: string; unitType?: string }>;
            reserved?: Array<{ serialNumber?: string; unitType?: string }>;
            installed?: Array<{ serialNumber?: string; unitType?: string }>;
            delivered?: Array<{ serialNumber?: string; unitType?: string }>;
          };
        };
      }>('/serial-number/list-by-scope', {
        params: {
          productId: normalizedProductId,
          capacityId: normalizedCapacityId,
        },
      });

      if (!response.data.success) {
        this.capacityStockSummary = null;
        this.capacityStockError = response.data.message ?? 'Unable to load serial stock summary';
        return;
      }

      const item = response.data.item;
      if (!item) {
        this.capacityStockSummary = null;
        this.capacityStockError = 'Unable to load serial stock summary';
        return;
      }

      this.capacityStockSummary = {
        branchId: item.branchId ?? null,
        productId: Number(item.productId) || normalizedProductId,
        capacityId: Number(item.capacityId) || normalizedCapacityId,
        unit: String(item.unit ?? '').trim(),
        unitTypes: Array.isArray(item.unitTypes) ? item.unitTypes : [],
        unitTypeCount: Number(item.unitTypeCount) || 0,
        counts: {
          inStock: Number(item.counts?.inStock) || 0,
          reserved: Number(item.counts?.reserved) || 0,
          installed: Number(item.counts?.installed ?? item.counts?.delivered) || 0,
        },
        serials: {
          inStock: this.mapSerialEntries(item.serials?.inStock ?? []),
          reserved: this.mapSerialEntries(item.serials?.reserved ?? []),
          installed: this.mapSerialEntries(item.serials?.installed ?? item.serials?.delivered ?? []),
        },
      };
    } catch (error: unknown) {
      this.capacityStockSummary = null;
      if (axios.isAxiosError(error)) {
        this.capacityStockError =
          (error.response?.data as { message?: string } | undefined)?.message ??
          'Unable to load serial stock summary';
      } else {
        this.capacityStockError = 'Unable to load serial stock summary';
      }
    } finally {
      this.isLoadingCapacityStock = false;
    }

    // Cache counts so the folder tree can show stock at a glance without selecting the capacity.
    this.capacityStockCounts[normalizedCapacityId] = {
      inStock: this.capacityStockSummary?.counts.inStock ?? 0,
      reserved: this.capacityStockSummary?.counts.reserved ?? 0,
      installed: this.capacityStockSummary?.counts.installed ?? 0,
      total:
        (this.capacityStockSummary?.counts.inStock ?? 0) +
        (this.capacityStockSummary?.counts.reserved ?? 0) +
        (this.capacityStockSummary?.counts.installed ?? 0),
      unit: String(this.capacityStockSummary?.unit ?? '').trim(),
      unitTypeCount: Number(this.capacityStockSummary?.unitTypeCount ?? 0),
    };
  }

  private async loadCapacityStockCountsForProduct(productId: number): Promise<void> {
    const normalizedProductId = Number(productId);
    if (!Number.isFinite(normalizedProductId) || normalizedProductId <= 0) {
      return;
    }

    const capacities = this.selectedProduct?.capacities ?? [];
    if (capacities.length === 0) {
      this.capacityStockCounts = {};
      return;
    }

    this.isLoadingCapacityCounts = true;
    this.capacityCountsError = '';

    const results = await Promise.allSettled(
      capacities.map((capacity) =>
        apiClient
          .get<{
            success: boolean;
            message?: string;
            item?: {
              counts?: {
                inStock?: number;
                reserved?: number;
                installed?: number;
              };
              unit?: string;
              unitTypeCount?: number;
            };
          }>('/serial-number/capacity-stock-summary', {
            params: {
              productId: normalizedProductId,
              capacityId: capacity.id,
            },
          })
          .then((response) => ({ capacityId: capacity.id, data: response.data }))
          .catch((error) => ({ capacityId: capacity.id, error })),
      ),
    );

    const counts: typeof this.capacityStockCounts = {};
    for (const result of results) {
      if (result.status !== 'fulfilled') {
        continue;
      }

      const resolved = result.value;
      if (!('data' in resolved) || !resolved.data) {
        continue;
      }

      const { capacityId, data } = resolved;
      if (!data.success || !data.item?.counts) {
        continue;
      }

      const inStock = Number(data.item.counts.inStock ?? 0);
      const reserved = Number(data.item.counts.reserved ?? 0);
      const installed = Number(data.item.counts.installed ?? 0);
      const unit = String(data.item.unit ?? '').trim();
      const unitTypeCount = Number(data.item.unitTypeCount ?? 0);

      counts[capacityId] = {
        inStock,
        reserved,
        installed,
        total: inStock + reserved + installed,
        unit,
        unitTypeCount,
      };
    }

    this.capacityStockCounts = counts;
    this.isLoadingCapacityCounts = false;
  }

  getCapacityStockLabel(capacityId: number): string | null {
    const counts = this.capacityStockCounts[capacityId];
    if (!counts) {
      return null;
    }

    const normalizedUnit = String(counts.unit ?? '').trim().toLowerCase();
    const divisor = Number(counts.unitTypeCount ?? 0);

    if (normalizedUnit === 'set' && divisor > 0) {
      const setCount = Math.floor(counts.inStock / divisor);
      return `${setCount} SET`;
    }

    return `${counts.inStock} in stock`;
  }

  private async loadLandCostingReport(productId: number, capacityId: number): Promise<void> {
    this.isLoadingLandCostingReport = true;
    this.landCostingError = '';

    try {
      const response = await apiClient.get<{
        success: boolean;
        message?: string;
        item?: {
          dateFrom?: string;
          dateTo?: string;
          totals?: {
            serialCount?: number;
            landedCost?: number;
            srp?: number;
            marginAmount?: number;
            marginPercent?: number;
          };
          groups?: Array<{
            productName?: string;
            capacityName?: string;
            vendorName?: string;
            poNumber?: string;
            poDate?: string | null;
            rows?: Array<{
              category?: string;
              serialNumber?: string;
              indoorSerial?: string;
              outdoorSerial?: string;
              landedCost?: number;
              srp?: number;
              marginAmount?: number;
              status?: string;
              isDefective?: boolean;
              isReturned?: boolean;
              serialStatus?: string;
            }>;
          }>;
        };
      }>('/serial-number/reports/land-costing', {
        params: {
          dateFrom: this.landCostingDateFrom,
          dateTo: this.landCostingDateTo,
          productId,
          capacityId,
        },
      });

      if (!response.data.success || !response.data.item) {
        this.landCostingGroups = [];
        this.landCostingTotals = {
          serialCount: 0,
          landedCost: 0,
          srp: 0,
          marginAmount: 0,
          marginPercent: 0,
        };
        this.landCostingError = response.data.message ?? 'Unable to load land costing report';
        return;
      }

      this.landCostingDateFrom = String(response.data.item.dateFrom ?? this.landCostingDateFrom);
      this.landCostingDateTo = String(response.data.item.dateTo ?? this.landCostingDateTo);

      const groups = Array.isArray(response.data.item.groups) ? response.data.item.groups : [];
      this.landCostingGroups = groups.map((group) => {
        const mappedGroup = {
          productName: String(group.productName ?? '').trim(),
          capacityName: String(group.capacityName ?? '').trim(),
          vendorName: String(group.vendorName ?? '').trim(),
          poNumber: String(group.poNumber ?? '').trim(),
          poDate: group.poDate ?? null,
          rows: Array.isArray(group.rows)
            ? group.rows.map((row) => ({
                indoorSerial: String(row.indoorSerial ?? '').trim(),
                outdoorSerial: String(row.outdoorSerial ?? '').trim(),
                landedCost: Number(row.landedCost) || 0,
                srp: Number(row.srp) || 0,
                marginAmount: Number(row.marginAmount) || 0,
                serialStatus: String(row.serialStatus ?? 'In-Stock').trim(),
                isDefective: Boolean(row.isDefective ?? false),
                isReturned: Boolean(row.isReturned ?? false),
              }))
            : [],
        };
        return {
          ...mappedGroup,
          inStockCount: mappedGroup.rows.filter(row => row.serialStatus.toLowerCase() === 'in-stock').length,
          inStockIndoorCount: mappedGroup.rows.filter(row => row.indoorSerial && row.serialStatus.toLowerCase() === 'in-stock').length,
          inStockOutdoorCount: mappedGroup.rows.filter(row => row.outdoorSerial && row.serialStatus.toLowerCase() === 'in-stock').length,
        };
      });

      this.landCostingTotals = {
        serialCount: Number(response.data.item.totals?.serialCount) || this.landCostingGroups.reduce((total, group) => total + group.rows.length, 0),
        landedCost: Number(response.data.item.totals?.landedCost) || 0,
        srp: Number(response.data.item.totals?.srp) || 0,
        marginAmount: Number(response.data.item.totals?.marginAmount) || 0,
        marginPercent: Number(response.data.item.totals?.marginPercent) || 0,
      };
    } catch (error: unknown) {
      this.landCostingGroups = [];
      this.landCostingTotals = {
        serialCount: 0,
        landedCost: 0,
        srp: 0,
        marginAmount: 0,
        marginPercent: 0,
      };

      if (axios.isAxiosError(error)) {
        this.landCostingError =
          (error.response?.data as { message?: string } | undefined)?.message ??
          'Unable to load land costing report';
      } else {
        this.landCostingError = 'Unable to load land costing report';
      }
    } finally {
      this.isLoadingLandCostingReport = false;
    }
  }

  private formatDateOnly(value: string | null | undefined): string {
    if (!value) {
      return '';
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return String(value);
    }

    const year = parsed.getFullYear();
    const month = String(parsed.getMonth() + 1).padStart(2, '0');
    const day = String(parsed.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private initializeLandCostingDateRange(): void {
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth() - 6, now.getDate());
    this.landCostingDateFrom = this.formatDateOnly(from.toISOString());
    this.landCostingDateTo = this.formatDateOnly(now.toISOString());
  }

  private downloadBlob(blob: Blob, fileName: string): void {
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = fileName;
    anchor.click();
    URL.revokeObjectURL(objectUrl);
  }

  private getCapacitySerialCount(tab: CapacitySerialTab): number {
    const counts = this.capacityStockSummary?.counts;
    if (!counts) {
      return 0;
    }

    if (tab === 'in-stock') {
      return Number(counts.inStock) || 0;
    }

    if (tab === 'reserved') {
      return Number(counts.reserved) || 0;
    }

    return Number(counts.installed) || 0;
  }

  private computeSetCount(serialCount: number): number {
    const normalizedUnit = String(this.capacityStockSummary?.unit ?? '').trim().toLowerCase();
    const divisor = Number(this.capacityStockSummary?.unitTypeCount ?? 0);

    if (normalizedUnit === 'set' && divisor > 0) {
      return Math.floor(serialCount / divisor);
    }

    return serialCount;
  }

  private computeUnpairedCount(serialCount: number): number {
    const normalizedUnit = String(this.capacityStockSummary?.unit ?? '').trim().toLowerCase();
    const divisor = Number(this.capacityStockSummary?.unitTypeCount ?? 0);

    if (normalizedUnit === 'set' && divisor > 0) {
      return serialCount % divisor;
    }

    return 0;
  }

  private normalizeSearchText(value: string): string {
    return value.toLowerCase().trim().replace(/\s+/g, ' ');
  }

  private canAccessInventoryPermission(permissionKeys: string[]): boolean {
    const acceptedKeys = permissionKeys ?? [];
    if (acceptedKeys.length === 0) {
      return true;
    }

    const isDenied = acceptedKeys.some((permissionKey) => this.rbacService.hasDeniedPermissionKey(permissionKey));
    if (isDenied) {
      return false;
    }

    const hasAnyAllowedRules = this.rbacService.hasAnyEffectivePermissionWithPrefix(this.landCostingPermissionPrefix);
    const hasAnyDeniedRules = this.rbacService.hasAnyDeniedPermissionWithPrefix(this.landCostingPermissionPrefix);

    if (!hasAnyAllowedRules && !hasAnyDeniedRules) {
      return this.rbacService.canAccess('inventory', 'canRead');
    }

    const isExplicitlyAllowed = acceptedKeys.some((permissionKey) =>
      this.rbacService.hasEffectivePermissionKey(permissionKey),
    );
    if (isExplicitlyAllowed) {
      return true;
    }

    if (!hasAnyAllowedRules && hasAnyDeniedRules) {
      return true;
    }

    return false;
  }

  private normalizeUnitTypeValue(value: string): string {
    const normalized = this.normalizeSearchText(value)
      .replace(/[\s_-]*qty$/i, '')
      .replace(/quantity$/i, '')
      .trim();

    return normalized;
  }

  private formatUnitTypeLabel(value: string): string {
    const normalized = this.normalizeUnitTypeValue(value);
    if (!normalized) {
      return 'Unknown';
    }

    return normalized
      .split(/[\s_-]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }

  private mapSerialEntries(
    entries: Array<{ serialNumber?: string; unitType?: string }>,
  ): SerialEntry[] {
    return entries
      .map((entry) => ({
        serialNumber: String(entry.serialNumber ?? '').trim(),
        unitType: this.normalizeUnitTypeValue(String(entry.unitType ?? '')),
      }))
      .filter((entry) => entry.serialNumber.length > 0);
  }

  private resetCapacityFormFields(): void {
    this.newCapacityName = '';
    this.newCapacitySrp = null;
    this.newCapacityNetPrice = null;
    this.newCapacityIndoorModel = '';
    this.newCapacityOutdoorModel = '';
  }

  private resetCapacityFormMessages(): void {
    this.addCapacityError = '';
    this.addCapacitySuccess = '';
  }

  get canBulkInstall(): boolean {
    return this.rbacService.isAdminOrSuperAdmin();
  }

  get notFoundInsertableSerials(): Array<{ serialNumber: string; csvStatus: string; csvUnitType: string }> {
    return (this.csvPreviewResult?.notFound ?? []).filter(
      (entry) => String(entry.csvStatus ?? '').trim().toLowerCase() !== 'installed',
    );
  }

  get notFoundInstalledReviewCount(): number {
    return (this.csvPreviewResult?.notFound ?? []).filter(
      (entry) => String(entry.csvStatus ?? '').trim().toLowerCase() === 'installed',
    ).length;
  }

  openCsvModal(): void {
    this.isCsvModalOpen = true;
    this.csvPreviewResult = null;
    this.csvConfirmMessage = '';
    this.csvConfirmError = '';
    this.csvModalTab = 'will-install';
    this.csvToInstallTargetStatus = 'installed';
    this.csvAlreadyInstalledTargetStatus = 'in-stock';
    this.csvNotFoundTargetStatus = 'in-stock';
    this.csvNotFoundInsert = false;
  }

  closeCsvModal(): void {
    this.isCsvModalOpen = false;
    this.csvPreviewResult = null;
    this.csvConfirmMessage = '';
    this.csvConfirmError = '';
  }

  triggerCsvFileInput(): void {
    const input = document.getElementById('csvFileInput') as HTMLInputElement | null;
    input?.click();
  }

  downloadCsvTemplate(): void {
    const rows = [
      'serialNumber,unitType,status',
      'AC-IN-0001,Indoor,in-stock',
      'AC-OUT-0001,Outdoor,in-stock',
    ];

    this.downloadCsvFile(rows, 'inventory-serial-upload-template.csv');
  }

  async onCsvFileSelected(event: Event): Promise<void> {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    this.isCsvParsing = true;
    this.csvPreviewResult = null;
    this.csvConfirmMessage = '';
    this.csvConfirmError = '';
    try {
      const text = await file.text();
      const lines = text.split(/[\r\n]+/).map((l) => l.trim()).filter((l) => l.length > 0);
      // Detect header row
      const hasHeader = lines[0]?.toLowerCase().startsWith('serialnumber') || lines[0]?.toLowerCase().startsWith('serial_number') || lines[0]?.toLowerCase().startsWith('serial number');
      const dataLines = hasHeader ? lines.slice(1) : lines;
      const rows = dataLines
        .map((line) => {
          const parts = line.split(',');
          const has3Cols = parts.length >= 3;
          const serialNumber = (parts[0] ?? '').trim();
          const unitType = has3Cols ? (parts[1] ?? '').trim() : '';
          const status = has3Cols ? (parts[2] ?? '').trim().toLowerCase() : (parts[1] ?? '').trim().toLowerCase();
          return { serialNumber, unitType, status };
        })
        .filter((r) => r.serialNumber.length > 0);
      if (rows.length === 0) {
        this.csvConfirmError = 'No serial numbers found in the file.';
        return;
      }
      const result = await this.salesOrderService.previewCsvSerials(rows);
      if (!result.success) {
        this.csvConfirmError = result.message ?? 'Failed to preview serials';
        return;
      }
      this.csvPreviewResult = {
        summary: result.summary!,
        toInstall: result.toInstall ?? [],
        alreadyInstalled: result.alreadyInstalled ?? [],
        notFound: result.notFound ?? [],
        otherStatus: result.otherStatus ?? [],
      };
      this.csvModalTab = 'will-install';
    } catch {
      this.csvConfirmError = 'Failed to read or process the CSV file.';
    } finally {
      this.isCsvParsing = false;
      (event.target as HTMLInputElement).value = '';
    }
  }

  async confirmCsvInstall(): Promise<void> {
    if (!this.csvPreviewResult || this.isCsvConfirming) return;
    const serials = this.csvPreviewResult.toInstall.map((s) => s.serialNumber);
    if (serials.length === 0) { this.csvConfirmError = 'No serials to update.'; return; }
    this.isCsvConfirming = true;
    this.csvConfirmMessage = '';
    this.csvConfirmError = '';
    try {
      const result = await this.salesOrderService.bulkUpdateSerialStatus(serials, this.csvToInstallTargetStatus);
      if (!result.success) { this.csvConfirmError = result.message ?? 'Failed to update serials'; return; }
      this.csvConfirmMessage = result.message ?? `Updated ${result.updated} serial(s) to ${this.csvToInstallTargetStatus}`;
      this.csvPreviewResult = {
        ...this.csvPreviewResult,
        summary: { ...this.csvPreviewResult.summary, toInstall: 0, alreadyInstalled: this.csvPreviewResult.summary.alreadyInstalled + serials.length },
        alreadyInstalled: [...this.csvPreviewResult.alreadyInstalled, ...this.csvPreviewResult.toInstall.map((s) => ({ serialNumber: s.serialNumber, unitType: s.unitType, productName: s.productName, capacityName: s.capacityName }))],
        toInstall: [],
      };
      if (this.selectedProductId && this.selectedCapacityId) await this.loadCapacityStockSummary(this.selectedProductId, this.selectedCapacityId);
    } catch { this.csvConfirmError = 'Failed to update serial numbers.'; }
    finally { this.isCsvConfirming = false; }
  }

  async revertInstalledToStock(): Promise<void> {
    if (!this.csvPreviewResult || this.isCsvRevertingInstalled) return;
    const serials = this.csvPreviewResult.alreadyInstalled.map((s) => s.serialNumber);
    if (serials.length === 0) { this.csvConfirmError = 'No installed serials to revert.'; return; }
    this.isCsvRevertingInstalled = true;
    this.csvConfirmMessage = '';
    this.csvConfirmError = '';
    try {
      const result = await this.salesOrderService.bulkUpdateSerialStatus(serials, this.csvAlreadyInstalledTargetStatus);
      if (!result.success) { this.csvConfirmError = result.message ?? 'Failed to revert serials'; return; }
      this.csvConfirmMessage = result.message ?? `Reverted ${result.updated} serial(s) to ${this.csvAlreadyInstalledTargetStatus}`;
      this.csvPreviewResult = { ...this.csvPreviewResult, summary: { ...this.csvPreviewResult.summary, alreadyInstalled: 0 }, alreadyInstalled: [] };
      if (this.selectedProductId && this.selectedCapacityId) await this.loadCapacityStockSummary(this.selectedProductId, this.selectedCapacityId);
    } catch { this.csvConfirmError = 'Failed to revert serial numbers.'; }
    finally { this.isCsvRevertingInstalled = false; }
  }

  async insertNotFoundAsInStock(): Promise<void> {
    if (!this.csvPreviewResult || this.isCsvInsertingNotFound) return;
    const serials = this.notFoundInsertableSerials;
    if (serials.length === 0) { this.csvConfirmError = 'No serials to insert.'; return; }
    if (this.csvNotFoundTargetStatus !== 'in-stock') {
      this.csvConfirmError = 'Not-found serials can only be inserted as in-stock.';
      return;
    }
    if (!this.selectedProductId || !this.selectedCapacityId) {
      this.csvConfirmError = 'Select a product and capacity before inserting not-found serials.';
      return;
    }
    this.isCsvInsertingNotFound = true;
    this.csvConfirmMessage = '';
    this.csvConfirmError = '';
    try {
      const result = await this.salesOrderService.insertBulkSerials(
        serials.map((s) => ({
          serialNumber: s.serialNumber,
          unitType: s.csvUnitType,
          status: 'in-stock',
          productId: this.selectedProductId!,
          capacityId: this.selectedCapacityId!,
        }))
      );
      if (!result.success) { this.csvConfirmError = result.message ?? 'Failed to insert serials'; return; }
      this.csvConfirmMessage = result.message ?? `Inserted ${result.inserted} serial(s) as in-stock`;
      this.csvPreviewResult = {
        ...this.csvPreviewResult,
        summary: {
          ...this.csvPreviewResult.summary,
          notFound: this.notFoundInstalledReviewCount,
        },
        notFound: this.csvPreviewResult.notFound.filter(
          (entry) => String(entry.csvStatus ?? '').trim().toLowerCase() === 'installed',
        ),
      };
      if (this.selectedProductId && this.selectedCapacityId) await this.loadCapacityStockSummary(this.selectedProductId, this.selectedCapacityId);
    } catch { this.csvConfirmError = 'Failed to insert serial numbers.'; }
    finally { this.isCsvInsertingNotFound = false; }
  }

  downloadCsvSummary(): void {
    if (!this.csvPreviewResult) return;
    const rows: string[] = ['Serial Number,Unit Type,CSV Status,DB Status,Category,Product,Capacity'];
    for (const s of this.csvPreviewResult.toInstall) {
      rows.push(`${s.serialNumber},${s.unitType},${s.csvStatus},in-stock/reserved,To Install,${s.productName},${s.capacityName}`);
    }
    for (const s of this.csvPreviewResult.alreadyInstalled) {
      rows.push(`${s.serialNumber},${s.unitType},installed,installed,Already Installed,${s.productName},${s.capacityName}`);
    }
    for (const s of this.csvPreviewResult.notFound) {
      rows.push(`${s.serialNumber},,${s.csvStatus},,Not Found in DB,,`);
    }
    for (const s of this.csvPreviewResult.otherStatus) {
      rows.push(`${s.serialNumber},${s.unitType},${s.csvStatus},${s.dbStatus},Other Status,${s.productName},${s.capacityName}`);
    }
    this.downloadCsvFile(rows, `serial-summary-${new Date().toISOString().slice(0, 10)}.csv`);
  }

  private downloadCsvFile(rows: string[], filename: string): void {
    const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  private getProductTreeKey(brandName: string, productId: number): string {
    return `${brandName}::${productId}`;
  }

  toggleSerialSelection(serialNumber: string): void {
    if (this.selectedSerials.has(serialNumber)) {
      this.selectedSerials.delete(serialNumber);
    } else {
      this.selectedSerials.add(serialNumber);
    }
  }

  selectAllVisibleSerials(serials: Array<{ serialNumber: string }>): void {
    const allSelected = serials.every(s => this.selectedSerials.has(s.serialNumber));
    if (allSelected) {
      serials.forEach(s => this.selectedSerials.delete(s.serialNumber));
    } else {
      serials.forEach(s => this.selectedSerials.add(s.serialNumber));
    }
  }

  clearSerialSelection(): void {
    this.selectedSerials.clear();
    this.bulkUpdateMessage = '';
    this.bulkUpdateError = '';
  }

  async deleteAllInStockSerials(): Promise<void> {
    if (!this.selectedProductId || !this.selectedCapacityId || this.isDeletingInStockSerials) {
      return;
    }

    const count = this.capacityStockSummary?.counts.inStock ?? 0;
    if (count === 0) {
      return;
    }

    const confirmed = window.confirm(
      `Delete all ${count} in-stock serial number(s) for ${this.selectedCapacity?.name ?? 'this capacity'}? This is for reinventory purposes and cannot be undone.`,
    );
    if (!confirmed) {
      return;
    }

    this.isDeletingInStockSerials = true;
    this.deleteInStockError = '';
    this.deleteInStockMessage = '';

    try {
      const response = await apiClient.delete<{ success: boolean; message?: string; deleted?: number }>(
        '/serial-number/in-stock',
        { params: { productId: this.selectedProductId, capacityId: this.selectedCapacityId } },
      );

      if (!response.data.success) {
        this.deleteInStockError = response.data.message ?? 'Unable to delete in-stock serials';
        return;
      }

      this.deleteInStockMessage = response.data.message ?? `Deleted ${response.data.deleted ?? count} in-stock serial(s)`;
      await this.loadCapacityStockSummary(this.selectedProductId, this.selectedCapacityId);
    } catch (error: unknown) {
      if (axios.isAxiosError(error)) {
        this.deleteInStockError =
          (error.response?.data as { message?: string } | undefined)?.message ??
          'Unable to delete in-stock serials';
      } else {
        this.deleteInStockError = 'Unable to delete in-stock serials';
      }
    } finally {
      this.isDeletingInStockSerials = false;
    }
  }

  async bulkMarkAsInstalled(): Promise<void> {
    if (this.selectedSerials.size === 0 || this.isBulkUpdating) return;
    this.isBulkUpdating = true;
    this.bulkUpdateMessage = '';
    this.bulkUpdateError = '';
    try {
      const result = await this.salesOrderService.bulkUpdateSerialStatus(
        Array.from(this.selectedSerials), 'installed'
      );
      if (!result.success) {
        this.bulkUpdateError = result.message ?? 'Failed to update serials';
        return;
      }
      this.bulkUpdateMessage = result.message ?? `Updated ${result.updated} serial(s) to installed`;
      this.selectedSerials.clear();
      // Reload the current capacity stock summary
      if (this.selectedProductId && this.selectedCapacityId) {
        await this.loadCapacityStockSummary(this.selectedProductId, this.selectedCapacityId);
      }
    } catch {
      this.bulkUpdateError = 'Failed to update serial numbers';
    } finally {
      this.isBulkUpdating = false;
    }
  }
}
