import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PageBreadcrumbComponent } from '../../shared/components/common/page-breadcrumb/page-breadcrumb.component';
import { ProductOption, SalesOrderService } from '../../shared/services/sales-order.service';
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

interface SerialEntry {
  serialNumber: string;
  unitType: string;
}

interface CapacityStockSummary {
  productId: number;
  capacityId: number;
  unit: string;
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
}

interface LandCostingReportGroup {
  productName: string;
  capacityName: string;
  vendorName: string;
  poNumber: string;
  poDate: string | null;
  rows: LandCostingReportItemRow[];
}

@Component({
  selector: 'app-accounting',
  imports: [CommonModule, FormsModule, PageBreadcrumbComponent],
  templateUrl: './accounting.component.html',
})
export class AccountingComponent implements OnInit {
  isLoading = false;
  errorMessage = '';

  brandFolders: BrandFolder[] = [];
  treeSearch = '';
  selectedBrandName: string | null = null;
  selectedProductId: number | null = null;
  selectedCapacityId: number | null = null;

  expandedBrands = new Set<string>();
  expandedProducts = new Set<string>();

  isLoadingCapacityStock = false;
  capacityStockError = '';
  capacityStockSummary: CapacityStockSummary | null = null;

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

  constructor(private readonly salesOrderService: SalesOrderService) {}

  ngOnInit(): void {
    this.initializeLandCostingDateRange();
    void this.loadAccountingFolders();
  }

  get selectedBrand(): BrandFolder | null {
    if (!this.selectedBrandName) {
      return null;
    }

    return this.brandFolders.find((folder) => folder.name === this.selectedBrandName) ?? null;
  }

  get selectedProduct(): ProductOption | null {
    const products = this.selectedBrand?.products ?? [];
    return products.find((product) => product.id === this.selectedProductId) ?? null;
  }

  get selectedCapacity() {
    return this.selectedProduct?.capacities.find((capacity) => capacity.id === this.selectedCapacityId) ?? null;
  }

  get selectedNodeTitle(): string {
    if (this.selectedCapacity) {
      return `${this.selectedProduct?.name || 'Product'} - ${this.selectedCapacity.name}`;
    }

    if (this.selectedProduct) {
      return this.selectedProduct.name;
    }

    if (this.selectedBrandName) {
      return this.selectedBrandName;
    }

    return 'Accounting Reports';
  }

  get filteredBrandFolders(): BrandFolder[] {
    const normalizedQuery = this.normalizeSearchText(this.treeSearch);
    if (!normalizedQuery) {
      return this.brandFolders;
    }

    const queryTokens = normalizedQuery.split(' ').filter(Boolean);
    const matches = (value: string): boolean => {
      const normalizedValue = this.normalizeSearchText(value);
      return queryTokens.every((token) => normalizedValue.includes(token));
    };

    return this.brandFolders
      .map((brand) => {
        const brandMatches = matches(brand.name);

        const products = brand.products
          .map((product) => {
            const productMatches = matches(`${brand.name} ${product.name}`);
            const capacities = brandMatches || productMatches
              ? product.capacities
              : product.capacities.filter((capacity) =>
                  matches(`${brand.name} ${product.name} ${capacity.name}`),
                );

            if (brandMatches || productMatches || capacities.length > 0) {
              return {
                ...product,
                capacities,
              };
            }

            return null;
          })
          .filter((product): product is ProductOption => product !== null);

        if (brandMatches || products.length > 0) {
          return {
            ...brand,
            products,
          };
        }

        return null;
      })
      .filter((brand): brand is BrandFolder => brand !== null);
  }

  toggleBrand(brandName: string): void {
    if (this.expandedBrands.has(brandName)) {
      this.expandedBrands.delete(brandName);
      return;
    }

    this.expandedBrands.add(brandName);
  }

  toggleProduct(brandName: string, productId: number): void {
    const key = this.getProductTreeKey(brandName, productId);
    if (this.expandedProducts.has(key)) {
      this.expandedProducts.delete(key);
      return;
    }

    this.expandedProducts.add(key);
  }

  isBrandExpanded(brandName: string): boolean {
    if (this.treeSearch.trim()) {
      return true;
    }

    return this.expandedBrands.has(brandName);
  }

  isProductExpanded(brandName: string, productId: number): boolean {
    if (this.treeSearch.trim()) {
      return true;
    }

    return this.expandedProducts.has(this.getProductTreeKey(brandName, productId));
  }

  selectBrand(brandName: string): void {
    this.selectedBrandName = brandName;
    this.selectedProductId = null;
    this.selectedCapacityId = null;
    this.capacityStockSummary = null;
    this.landCostingGroups = [];
    this.expandedBrands.add(brandName);
  }

  selectProduct(brandName: string, productId: number): void {
    this.selectedBrandName = brandName;
    this.selectedProductId = productId;
    this.selectedCapacityId = null;
    this.capacityStockSummary = null;
    this.landCostingGroups = [];
    this.expandedBrands.add(brandName);
    this.expandedProducts.add(this.getProductTreeKey(brandName, productId));
  }

  selectCapacity(brandName: string, productId: number, capacityId: number): void {
    this.selectedBrandName = brandName;
    this.selectedProductId = productId;
    this.selectedCapacityId = capacityId;
    this.expandedBrands.add(brandName);
    this.expandedProducts.add(this.getProductTreeKey(brandName, productId));

    void this.loadCapacityStockSummary(productId, capacityId);
    void this.loadLandCostingReport(productId, capacityId);
  }

  async reloadReport(): Promise<void> {
    if (!this.selectedProductId || !this.selectedCapacityId) {
      return;
    }

    await this.loadLandCostingReport(this.selectedProductId, this.selectedCapacityId);
  }

  async exportReportAsExcel(): Promise<void> {
    if (this.landCostingGroups.length === 0) {
      this.landCostingError = 'No report rows available to export.';
      return;
    }

    const excelJs = await import('exceljs');
    const workbook = new excelJs.Workbook();
    const worksheet = workbook.addWorksheet('Accounting Report');

    worksheet.addRow(['Accounting Report']);
    worksheet.addRow([`Date Range: ${this.landCostingDateFrom} to ${this.landCostingDateTo}`]);
    worksheet.addRow([]);

    for (const group of this.landCostingGroups) {
      worksheet.addRow([`Product (${group.capacityName}): ${group.productName}`]);
      worksheet.addRow([`Vendor: ${group.vendorName || '-'}`]);
      worksheet.addRow(['No.', 'Indoor Serial', 'Outdoor Serial', 'Landed Cost', 'SRP', 'Margin']);

      const headerRow = worksheet.lastRow;
      if (headerRow) {
        headerRow.font = { bold: true };
      }

      for (const [index, row] of group.rows.entries()) {
        worksheet.addRow([
          index + 1,
          row.indoorSerial || '-',
          row.outdoorSerial || '-',
          row.landedCost,
          row.srp,
          row.marginAmount,
        ]);
      }

      worksheet.addRow([]);
    }

    worksheet.columns = [
      { width: 8 },
      { width: 22 },
      { width: 22 },
      { width: 14 },
      { width: 14 },
      { width: 14 },
    ];

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    this.downloadBlob(blob, `accounting_report_${this.landCostingDateFrom}_${this.landCostingDateTo}.xlsx`);
  }

  async exportReportAsPdf(): Promise<void> {
    if (this.landCostingGroups.length === 0) {
      this.landCostingError = 'No report rows available to export.';
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
      page.drawText('Accounting Report', { x: 40, y, size: 14, font: fontBold });
      y -= 16;
      page.drawText(`Date Range: ${this.landCostingDateFrom} to ${this.landCostingDateTo}`, {
        x: 40,
        y,
        size: 10,
        font,
      });
      y -= 18;
    };

    const ensureSpace = (requiredBottomY: number) => {
      if (y >= requiredBottomY) {
        return;
      }

      page = document.addPage([pageWidth, pageHeight]);
      y = pageHeight - 40;
      drawHeader();
    };

    drawHeader();

    for (const group of this.landCostingGroups) {
      ensureSpace(120);
      page.drawText(`Product (${group.capacityName}): ${group.productName}`, { x: 40, y, size: 10, font: fontBold });
      y -= 14;
      page.drawText(`Vendor: ${group.vendorName || '-'} | PO: ${group.poNumber || '-'} | Date: ${this.formatDateOnly(group.poDate) || '-'}`, {
        x: 40,
        y,
        size: 9,
        font,
      });
      y -= 14;

      const columns = [40, 80, 240, 430, 520, 610];
      page.drawText('No.', { x: columns[0], y, size: 9, font: fontBold });
      page.drawText('Indoor', { x: columns[1], y, size: 9, font: fontBold });
      page.drawText('Outdoor', { x: columns[2], y, size: 9, font: fontBold });
      page.drawText('Landed', { x: columns[3], y, size: 9, font: fontBold });
      page.drawText('SRP', { x: columns[4], y, size: 9, font: fontBold });
      page.drawText('Margin', { x: columns[5], y, size: 9, font: fontBold });
      y -= 12;

      for (const [index, row] of group.rows.entries()) {
        ensureSpace(70);
        page.drawText(String(index + 1), { x: columns[0], y, size: 8, font });
        page.drawText((row.indoorSerial || '-').slice(0, 20), { x: columns[1], y, size: 8, font });
        page.drawText((row.outdoorSerial || '-').slice(0, 20), { x: columns[2], y, size: 8, font });
        page.drawText(Number(row.landedCost ?? 0).toFixed(2), { x: columns[3], y, size: 8, font });
        page.drawText(Number(row.srp ?? 0).toFixed(2), { x: columns[4], y, size: 8, font });
        page.drawText(Number(row.marginAmount ?? 0).toFixed(2), { x: columns[5], y, size: 8, font });
        y -= 10;
      }

      y -= 8;
    }

    const bytes = await document.save();
    this.downloadBlob(new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }), `accounting_report_${this.landCostingDateFrom}_${this.landCostingDateTo}.pdf`);
  }

  private async loadAccountingFolders(): Promise<void> {
    this.isLoading = true;
    this.errorMessage = '';

    try {
      const [products, brands] = await Promise.all([this.salesOrderService.getProducts(), this.getBrands()]);

      const filteredBrands = brands.filter((brand) => String(brand.type ?? '').toLowerCase() !== 'mat');
      const filteredProducts = products.filter((product) => String(product.brandType ?? '').toLowerCase() !== 'mat');

      const groupedByBrand = new Map<string, ProductOption[]>();
      for (const product of filteredProducts) {
        const brandName = String(product.brandName ?? 'Uncategorized').trim() || 'Uncategorized';
        const list = groupedByBrand.get(brandName) ?? [];
        list.push(product);
        groupedByBrand.set(brandName, list);
      }

      const folderMap = new Map<string, BrandFolder>();
      for (const brand of filteredBrands) {
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

      for (const [brandName, productsByBrand] of groupedByBrand.entries()) {
        const sortedProducts = [...productsByBrand].sort((a, b) => a.name.localeCompare(b.name));
        const existing = folderMap.get(brandName);
        if (existing) {
          existing.products = sortedProducts;
        } else {
          folderMap.set(brandName, {
            id: null,
            name: brandName,
            products: sortedProducts,
          });
        }
      }

      this.brandFolders = Array.from(folderMap.values()).sort((a, b) => a.name.localeCompare(b.name));
    } catch (error: unknown) {
      if (axios.isAxiosError(error)) {
        this.errorMessage =
          (error.response?.data as { message?: string } | undefined)?.message ??
          'Unable to load accounting folders';
      } else {
        this.errorMessage = 'Unable to load accounting folders';
      }
    } finally {
      this.isLoading = false;
    }
  }

  private async getBrands(): Promise<BrandOption[]> {
    const response = await apiClient.get<{ success: boolean; items?: BrandOption[] }>('/brands');
    return response.data.items ?? [];
  }

  private async loadCapacityStockSummary(productId: number, capacityId: number): Promise<void> {
    this.isLoadingCapacityStock = true;
    this.capacityStockError = '';

    try {
      const response = await apiClient.get<{
        success: boolean;
        message?: string;
        item?: {
          productId: number;
          capacityId: number;
          unit?: string;
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
        params: { productId, capacityId },
      });

      if (!response.data.success || !response.data.item) {
        this.capacityStockSummary = null;
        this.capacityStockError = response.data.message ?? 'Unable to load stock summary';
        return;
      }

      const item = response.data.item;
      this.capacityStockSummary = {
        productId: Number(item.productId) || productId,
        capacityId: Number(item.capacityId) || capacityId,
        unit: String(item.unit ?? '').trim(),
        unitTypeCount: Number(item.unitTypeCount ?? 0),
        counts: {
          inStock: Number(item.counts?.inStock ?? 0),
          reserved: Number(item.counts?.reserved ?? 0),
          installed: Number(item.counts?.installed ?? item.counts?.delivered ?? 0),
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
          'Unable to load stock summary';
      } else {
        this.capacityStockError = 'Unable to load stock summary';
      }
    } finally {
      this.isLoadingCapacityStock = false;
    }
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
              indoorSerial?: string;
              outdoorSerial?: string;
              landedCost?: number;
              srp?: number;
              marginAmount?: number;
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
        this.landCostingError = response.data.message ?? 'Unable to load accounting report';
        return;
      }

      this.landCostingDateFrom = String(response.data.item.dateFrom ?? this.landCostingDateFrom);
      this.landCostingDateTo = String(response.data.item.dateTo ?? this.landCostingDateTo);

      const groups = Array.isArray(response.data.item.groups) ? response.data.item.groups : [];
      this.landCostingGroups = groups.map((group) => ({
        productName: String(group.productName ?? '').trim(),
        capacityName: String(group.capacityName ?? '').trim(),
        vendorName: String(group.vendorName ?? '').trim(),
        poNumber: String(group.poNumber ?? '').trim(),
        poDate: group.poDate ?? null,
        rows: Array.isArray(group.rows)
          ? group.rows.map((row) => ({
              indoorSerial: String(row.indoorSerial ?? '').trim(),
              outdoorSerial: String(row.outdoorSerial ?? '').trim(),
              landedCost: Number(row.landedCost ?? 0),
              srp: Number(row.srp ?? 0),
              marginAmount: Number(row.marginAmount ?? 0),
            }))
          : [],
      }));

      this.landCostingTotals = {
        serialCount:
          Number(response.data.item.totals?.serialCount) ||
          this.landCostingGroups.reduce((sum, group) => sum + group.rows.length, 0),
        landedCost: Number(response.data.item.totals?.landedCost ?? 0),
        srp: Number(response.data.item.totals?.srp ?? 0),
        marginAmount: Number(response.data.item.totals?.marginAmount ?? 0),
        marginPercent: Number(response.data.item.totals?.marginPercent ?? 0),
      };
    } catch (error: unknown) {
      this.landCostingGroups = [];
      if (axios.isAxiosError(error)) {
        this.landCostingError =
          (error.response?.data as { message?: string } | undefined)?.message ??
          'Unable to load accounting report';
      } else {
        this.landCostingError = 'Unable to load accounting report';
      }
    } finally {
      this.isLoadingLandCostingReport = false;
    }
  }

  private mapSerialEntries(entries: Array<{ serialNumber?: string; unitType?: string }>): SerialEntry[] {
    return entries
      .map((entry) => ({
        serialNumber: String(entry.serialNumber ?? '').trim(),
        unitType: String(entry.unitType ?? '').trim(),
      }))
      .filter((entry) => entry.serialNumber.length > 0);
  }

  private initializeLandCostingDateRange(): void {
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth() - 6, now.getDate());
    this.landCostingDateFrom = this.formatDateOnly(from.toISOString());
    this.landCostingDateTo = this.formatDateOnly(now.toISOString());
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

  private downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  private normalizeSearchText(value: string): string {
    return String(value ?? '').toLowerCase().trim().replace(/\s+/g, ' ');
  }

  private getProductTreeKey(brandName: string, productId: number): string {
    return `${brandName}::${productId}`;
  }
}
