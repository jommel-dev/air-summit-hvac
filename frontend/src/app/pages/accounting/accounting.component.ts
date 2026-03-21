import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PageBreadcrumbComponent } from '../../shared/components/common/page-breadcrumb/page-breadcrumb.component';
import {
  SalesOrderListItem,
  SalesOrderService,
} from '../../shared/services/sales-order.service';
import { RbacService } from '../../shared/services/rbac.service';
import { apiClient } from '../../shared/services/api-client';
import axios from 'axios';

type AccountingReportKey =
  | 'cheque-voucher'
  | 'general-journal-register'
  | 'disbursement-register'
  | 'sales-register'
  | 'tax-2307-report'
  | 'weekly-sales'
  | 'daily-unit-released'
  | 'low-stocks-report';

interface AccountingReportDefinition {
  key: AccountingReportKey;
  name: string;
  description: string;
  permissionKeys: string[];
  readiness: 'live' | 'draft';
}

interface AccountingReportFolder {
  key: string;
  name: string;
  description: string;
  reports: AccountingReportDefinition[];
}

interface SalesRegisterRow {
  id: number;
  soNumber: string;
  customerName: string;
  salesType: string;
  status: string;
  releaseDate: string;
  serialCount: number;
  totalAmount: number;
}

interface WeeklySalesRow {
  weekLabel: string;
  weekStart: string;
  weekEnd: string;
  orderCount: number;
  unitCount: number;
  totalAmount: number;
}

interface DailyUnitReleasedRow {
  releaseDate: string;
  orderCount: number;
  unitCount: number;
  totalAmount: number;
}

interface LowStockRow {
  id: number;
  materialCode: string;
  materialName: string;
  brandName: string;
  unit: string;
  onHandStock: number;
  reorderLevel: number;
  sellPrice: number;
}

interface ChequeDepositDraft {
  bankName: string;
  chequeNo: string;
  chequeDate: string;
  amount: number;
}

interface InvoiceDraft {
  invoiceNo: string;
  invoiceDate: string;
  description: string;
  amount: number;
}

interface AccountTitleDraft {
  accountNumber: string;
  description: string;
  debit: number;
  credit: number;
}

interface JournalSundryDraft {
  accountNumber: string;
  description: string;
  debit: number;
  credit: number;
}

interface ExcelExportDefinition {
  fileName: string;
  sheetName: string;
  title: string;
  subtitle?: string;
  headers: string[];
  rows: Array<Array<string | number>>;
}

@Component({
  selector: 'app-accounting',
  imports: [CommonModule, FormsModule, PageBreadcrumbComponent],
  templateUrl: './accounting.component.html',
})
export class AccountingComponent implements OnInit {
  private readonly reportPermissionPrefix = 'accounting.report.';

  treeSearch = '';
  selectedReportKey: AccountingReportKey | null = null;
  expandedFolders = new Set<string>();

  isLoadingReport = false;
  reportError = '';

  reportDateFrom = '';
  reportDateTo = '';

  salesRegisterRows: SalesRegisterRow[] = [];
  weeklySalesRows: WeeklySalesRow[] = [];
  dailyUnitReleasedRows: DailyUnitReleasedRow[] = [];
  lowStockRows: LowStockRow[] = [];

  chequeVoucherForm = {
    cvNo: '',
    payee: '',
    voucherDate: '',
    tinNumber: '',
    address: '',
    zipCode: '',
    particulars: '',
    deposits: [this.createChequeDepositDraft()],
    invoices: [this.createInvoiceDraft()],
    accountTitles: [this.createAccountTitleDraft()],
  };

  generalJournalForm = {
    journalNo: '',
    journalDate: '',
    description: '',
    sundries: [this.createJournalSundryDraft()],
  };

  readonly reportFolders: AccountingReportFolder[] = [
    {
      key: 'voucher-workflows',
      name: 'Voucher Workflows',
      description: 'Manual-entry accounting workflows and preview registers.',
      reports: [
        {
          key: 'cheque-voucher',
          name: 'Cheque Voucher',
          description: 'CV no., payee, deposits, invoices, and account title details.',
          permissionKeys: ['accounting.report.cheque-voucher.view'],
          readiness: 'draft',
        },
        {
          key: 'general-journal-register',
          name: 'General Journal Register',
          description: 'Journal details with debit and credit sundries lines.',
          permissionKeys: ['accounting.report.general-journal-register.view'],
          readiness: 'draft',
        },
        {
          key: 'disbursement-register',
          name: 'Disbursement Register',
          description: 'Preview register generated from the cheque voucher draft.',
          permissionKeys: ['accounting.report.disbursement-register.view'],
          readiness: 'draft',
        },
      ],
    },
    {
      key: 'sales-and-operations',
      name: 'Sales And Operations',
      description: 'Current live reports backed by existing sales and inventory APIs.',
      reports: [
        {
          key: 'sales-register',
          name: 'Sales Register',
          description: 'Remitted and completed sales orders within the selected date range.',
          permissionKeys: ['accounting.report.sales-register.view'],
          readiness: 'live',
        },
        {
          key: 'weekly-sales',
          name: 'Weekly Sales',
          description: 'Weekly sales totals aggregated from remitted and completed sales orders.',
          permissionKeys: ['accounting.report.weekly-sales.view'],
          readiness: 'live',
        },
        {
          key: 'daily-unit-released',
          name: 'Daily Unit Released',
          description: 'Daily released unit counts grouped from remitted and completed sales orders.',
          permissionKeys: ['accounting.report.daily-unit-released.view'],
          readiness: 'live',
        },
        {
          key: 'low-stocks-report',
          name: 'Low Stocks Report',
          description: 'Materials where on-hand stock is at or below reorder level.',
          permissionKeys: ['accounting.report.low-stocks-report.view'],
          readiness: 'live',
        },
      ],
    },
    {
      key: 'tax-and-compliance',
      name: 'Tax And Compliance',
      description: 'Compliance previews awaiting dedicated accounting persistence.',
      reports: [
        {
          key: 'tax-2307-report',
          name: '2307 Tax Report',
          description: 'Preview withholding tax lines derived from cheque voucher account titles.',
          permissionKeys: ['accounting.report.tax-2307-report.view'],
          readiness: 'draft',
        },
      ],
    },
  ];

  constructor(
    private readonly salesOrderService: SalesOrderService,
    private readonly rbacService: RbacService,
  ) {}

  ngOnInit(): void {
    this.initializeDateRange();
    this.initializeDraftForms();

    for (const folder of this.visibleReportFolders) {
      this.expandedFolders.add(folder.key);
    }

    const firstVisibleReport = this.visibleReportFolders[0]?.reports[0] ?? null;
    if (firstVisibleReport) {
      this.selectReport(firstVisibleReport.key);
    }
  }

  get visibleReportFolders(): AccountingReportFolder[] {
    const normalizedQuery = this.normalizeSearchText(this.treeSearch);
    const queryTokens = normalizedQuery.split(' ').filter(Boolean);

    return this.reportFolders
      .map((folder) => {
        const folderMatches = this.matchesSearch(
          `${folder.name} ${folder.description}`,
          queryTokens,
        );

        const reports = folder.reports.filter((report) => {
          if (!this.canAccessReport(report)) {
            return false;
          }

          if (queryTokens.length === 0 || folderMatches) {
            return true;
          }

          return this.matchesSearch(
            `${report.name} ${report.description}`,
            queryTokens,
          );
        });

        if (!folderMatches && reports.length === 0) {
          return null;
        }

        return {
          ...folder,
          reports,
        };
      })
      .filter((folder): folder is AccountingReportFolder => folder !== null && folder.reports.length > 0);
  }

  get selectedReport(): AccountingReportDefinition | null {
    if (!this.selectedReportKey) {
      return null;
    }

    for (const folder of this.reportFolders) {
      const report = folder.reports.find((item) => item.key === this.selectedReportKey);
      if (report && this.canAccessReport(report)) {
        return report;
      }
    }

    return null;
  }

  get salesRegisterTotalAmount(): number {
    return this.salesRegisterRows.reduce((sum, row) => sum + row.totalAmount, 0);
  }

  get salesRegisterUnitCount(): number {
    return this.salesRegisterRows.reduce((sum, row) => sum + row.serialCount, 0);
  }

  get weeklySalesTotalAmount(): number {
    return this.weeklySalesRows.reduce((sum, row) => sum + row.totalAmount, 0);
  }

  get weeklySalesUnitCount(): number {
    return this.weeklySalesRows.reduce((sum, row) => sum + row.unitCount, 0);
  }

  get dailyReleasedTotalAmount(): number {
    return this.dailyUnitReleasedRows.reduce((sum, row) => sum + row.totalAmount, 0);
  }

  get dailyReleasedUnitCount(): number {
    return this.dailyUnitReleasedRows.reduce((sum, row) => sum + row.unitCount, 0);
  }

  get lowStockCriticalCount(): number {
    return this.lowStockRows.filter((row) => row.onHandStock <= row.reorderLevel).length;
  }

  get chequeVoucherDepositTotal(): number {
    return this.chequeVoucherForm.deposits.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
  }

  get chequeVoucherInvoiceTotal(): number {
    return this.chequeVoucherForm.invoices.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
  }

  get chequeVoucherDebitTotal(): number {
    return this.chequeVoucherForm.accountTitles.reduce((sum, item) => sum + (Number(item.debit) || 0), 0);
  }

  get chequeVoucherCreditTotal(): number {
    return this.chequeVoucherForm.accountTitles.reduce((sum, item) => sum + (Number(item.credit) || 0), 0);
  }

  get generalJournalDebitTotal(): number {
    return this.generalJournalForm.sundries.reduce((sum, item) => sum + (Number(item.debit) || 0), 0);
  }

  get generalJournalCreditTotal(): number {
    return this.generalJournalForm.sundries.reduce((sum, item) => sum + (Number(item.credit) || 0), 0);
  }

  get disbursementRegisterRows(): Array<{
    cvNo: string;
    voucherDate: string;
    payee: string;
    invoiceNo: string;
    invoiceDate: string;
    description: string;
    amount: number;
  }> {
    return this.chequeVoucherForm.invoices
      .map((invoice) => ({
        cvNo: this.chequeVoucherForm.cvNo.trim(),
        voucherDate: this.chequeVoucherForm.voucherDate,
        payee: this.chequeVoucherForm.payee.trim(),
        invoiceNo: invoice.invoiceNo.trim(),
        invoiceDate: invoice.invoiceDate,
        description: invoice.description.trim(),
        amount: Number(invoice.amount) || 0,
      }))
      .filter((row) => row.invoiceNo || row.description || row.amount > 0);
  }

  get withholdingTaxRows(): Array<{
    accountNumber: string;
    description: string;
    amount: number;
  }> {
    return this.chequeVoucherForm.accountTitles
      .map((row) => ({
        accountNumber: String(row.accountNumber ?? '').trim(),
        description: String(row.description ?? '').trim(),
        amount: Math.max(Number(row.debit) || 0, Number(row.credit) || 0),
      }))
      .filter((row) => {
        const normalizedDescription = row.description.toLowerCase();
        return (
          normalizedDescription.includes('expanded withholding tax') ||
          normalizedDescription.includes('2307')
        );
      });
  }

  get withholdingTaxTotal(): number {
    return this.withholdingTaxRows.reduce((sum, row) => sum + row.amount, 0);
  }

  isFolderExpanded(folderKey: string): boolean {
    if (this.treeSearch.trim()) {
      return true;
    }

    return this.expandedFolders.has(folderKey);
  }

  toggleFolder(folderKey: string): void {
    if (this.expandedFolders.has(folderKey)) {
      this.expandedFolders.delete(folderKey);
      return;
    }

    this.expandedFolders.add(folderKey);
  }

  isSelectedReport(reportKey: AccountingReportKey): boolean {
    return this.selectedReportKey === reportKey;
  }

  selectReport(reportKey: AccountingReportKey): void {
    this.selectedReportKey = reportKey;
    this.reportError = '';

    if (this.isLiveReport(reportKey)) {
      void this.reloadSelectedReport();
    }
  }

  isLiveReport(reportKey: AccountingReportKey | null): boolean {
    return (
      reportKey === 'sales-register' ||
      reportKey === 'weekly-sales' ||
      reportKey === 'daily-unit-released' ||
      reportKey === 'low-stocks-report'
    );
  }

  reportUsesDateRange(reportKey: AccountingReportKey | null): boolean {
    return (
      reportKey === 'sales-register' ||
      reportKey === 'weekly-sales' ||
      reportKey === 'daily-unit-released'
    );
  }

  canExportSelectedReport(): boolean {
    switch (this.selectedReportKey) {
      case 'sales-register':
        return this.salesRegisterRows.length > 0;
      case 'weekly-sales':
        return this.weeklySalesRows.length > 0;
      case 'daily-unit-released':
        return this.dailyUnitReleasedRows.length > 0;
      case 'low-stocks-report':
        return this.lowStockRows.length > 0;
      case 'cheque-voucher':
      case 'general-journal-register':
      case 'disbursement-register':
      case 'tax-2307-report':
        return true;
      default:
        return false;
    }
  }

  async reloadSelectedReport(): Promise<void> {
    if (!this.selectedReportKey || !this.isLiveReport(this.selectedReportKey)) {
      return;
    }

    this.isLoadingReport = true;
    this.reportError = '';

    try {
      if (this.selectedReportKey === 'low-stocks-report') {
        await this.loadLowStockReport();
        return;
      }

      const salesRegisterRows = await this.loadFilteredSalesRegisterRows();
      this.salesRegisterRows = salesRegisterRows;

      if (this.selectedReportKey === 'weekly-sales') {
        this.weeklySalesRows = this.buildWeeklySalesRows(salesRegisterRows);
      }

      if (this.selectedReportKey === 'daily-unit-released') {
        this.dailyUnitReleasedRows = this.buildDailyUnitReleasedRows(salesRegisterRows);
      }
    } catch (error: unknown) {
      if (axios.isAxiosError(error)) {
        this.reportError =
          (error.response?.data as { message?: string } | undefined)?.message ??
          'Unable to load accounting report';
      } else if (error instanceof Error) {
        this.reportError = error.message;
      } else {
        this.reportError = 'Unable to load accounting report';
      }
    } finally {
      this.isLoadingReport = false;
    }
  }

  async exportSelectedReportAsExcel(): Promise<void> {
    const definition = this.buildExcelExportDefinition();
    if (!definition) {
      this.reportError = 'No rows available to export.';
      return;
    }

    const workbook = await this.createWorkbook();
    const worksheet = workbook.addWorksheet(definition.sheetName);

    worksheet.addRow([definition.title]);
    if (definition.subtitle) {
      worksheet.addRow([definition.subtitle]);
    }
    worksheet.addRow([]);
    worksheet.addRow(definition.headers);

    const headerRow = worksheet.lastRow;
    if (headerRow) {
      headerRow.font = { bold: true };
    }

    for (const row of definition.rows) {
      worksheet.addRow(row);
    }

    worksheet.columns = definition.headers.map(() => ({ width: 22 }));

    const buffer = await workbook.xlsx.writeBuffer();
    this.downloadBlob(
      new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
      definition.fileName,
    );
  }

  printSelectedReport(): void {
    if (typeof window === 'undefined') {
      return;
    }

    window.print();
  }

  addChequeDeposit(): void {
    this.chequeVoucherForm.deposits = [...this.chequeVoucherForm.deposits, this.createChequeDepositDraft()];
  }

  removeChequeDeposit(index: number): void {
    if (this.chequeVoucherForm.deposits.length <= 1) {
      return;
    }

    this.chequeVoucherForm.deposits = this.chequeVoucherForm.deposits.filter((_, itemIndex) => itemIndex !== index);
  }

  addChequeInvoice(): void {
    this.chequeVoucherForm.invoices = [...this.chequeVoucherForm.invoices, this.createInvoiceDraft()];
  }

  removeChequeInvoice(index: number): void {
    if (this.chequeVoucherForm.invoices.length <= 1) {
      return;
    }

    this.chequeVoucherForm.invoices = this.chequeVoucherForm.invoices.filter((_, itemIndex) => itemIndex !== index);
  }

  addAccountTitle(): void {
    this.chequeVoucherForm.accountTitles = [...this.chequeVoucherForm.accountTitles, this.createAccountTitleDraft()];
  }

  removeAccountTitle(index: number): void {
    if (this.chequeVoucherForm.accountTitles.length <= 1) {
      return;
    }

    this.chequeVoucherForm.accountTitles = this.chequeVoucherForm.accountTitles.filter((_, itemIndex) => itemIndex !== index);
  }

  addJournalSundry(): void {
    this.generalJournalForm.sundries = [...this.generalJournalForm.sundries, this.createJournalSundryDraft()];
  }

  removeJournalSundry(index: number): void {
    if (this.generalJournalForm.sundries.length <= 1) {
      return;
    }

    this.generalJournalForm.sundries = this.generalJournalForm.sundries.filter((_, itemIndex) => itemIndex !== index);
  }

  formatDateOnly(value: string | null | undefined): string {
    if (!value) {
      return '-';
    }

    const parsedDate = new Date(value);
    if (Number.isNaN(parsedDate.getTime())) {
      return String(value);
    }

    const year = parsedDate.getFullYear();
    const month = String(parsedDate.getMonth() + 1).padStart(2, '0');
    const day = String(parsedDate.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private initializeDateRange(): void {
    const currentDate = new Date();
    const fromDate = new Date(currentDate.getFullYear(), currentDate.getMonth() - 2, 1);
    this.reportDateFrom = this.formatDateOnly(fromDate.toISOString());
    this.reportDateTo = this.formatDateOnly(currentDate.toISOString());
  }

  private initializeDraftForms(): void {
    const today = this.formatDateOnly(new Date().toISOString());
    this.chequeVoucherForm.voucherDate = today;
    this.generalJournalForm.journalDate = today;
  }

  private canAccessReport(report: AccountingReportDefinition): boolean {
    const acceptedKeys = report.permissionKeys ?? [];
    if (acceptedKeys.length === 0) {
      return true;
    }

    const isDenied = acceptedKeys.some((permissionKey) => this.rbacService.hasDeniedPermissionKey(permissionKey));
    if (isDenied) {
      return false;
    }

    const hasAnyAllowedRules = this.rbacService.hasAnyEffectivePermissionWithPrefix(this.reportPermissionPrefix);
    const hasAnyDeniedRules = this.rbacService.hasAnyDeniedPermissionWithPrefix(this.reportPermissionPrefix);

    if (!hasAnyAllowedRules && !hasAnyDeniedRules) {
      return true;
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

  private matchesSearch(value: string, tokens: string[]): boolean {
    if (tokens.length === 0) {
      return true;
    }

    const normalizedValue = this.normalizeSearchText(value);
    return tokens.every((token) => normalizedValue.includes(token));
  }

  private normalizeSearchText(value: string): string {
    return String(value ?? '').toLowerCase().trim().replace(/\s+/g, ' ');
  }

  private async loadFilteredSalesRegisterRows(): Promise<SalesRegisterRow[]> {
    const salesOrders = await this.loadAllRemittedSalesOrders();
    return salesOrders
      .map((item) => this.mapSalesRegisterRow(item))
      .filter((row) => this.isWithinDateRange(row.releaseDate))
      .sort((left, right) => right.releaseDate.localeCompare(left.releaseDate));
  }

  private async loadAllRemittedSalesOrders(): Promise<SalesOrderListItem[]> {
    const items: SalesOrderListItem[] = [];
    let page = 1;
    let totalPages = 1;

    while (page <= totalPages && page <= 25) {
      const response = await this.salesOrderService.getRemittedSales({
        page,
        limit: 200,
      });

      items.push(...response.items);
      totalPages = Math.max(1, Number(response.meta?.totalPages ?? 1));
      page += 1;
    }

    return items;
  }

  private mapSalesRegisterRow(item: SalesOrderListItem): SalesRegisterRow {
    return {
      id: Number(item.id) || 0,
      soNumber: String(item.soNumber ?? '').trim(),
      customerName: String(item.customerName ?? '').trim(),
      salesType: String(item.salesType ?? '').trim(),
      status: String(item.status ?? '').trim(),
      releaseDate: this.formatDateOnly(item.scheduleDate ?? item.createdAt ?? ''),
      serialCount: Number(item.serialCount ?? 0),
      totalAmount: Number(item.totalAmount ?? 0),
    };
  }

  private buildWeeklySalesRows(rows: SalesRegisterRow[]): WeeklySalesRow[] {
    const weeklyGroups = new Map<string, WeeklySalesRow>();

    for (const row of rows) {
      const parsedDate = new Date(row.releaseDate);
      if (Number.isNaN(parsedDate.getTime())) {
        continue;
      }

      const weekStart = this.getWeekStart(parsedDate);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 6);

      const key = this.formatDateOnly(weekStart.toISOString());
      const current = weeklyGroups.get(key) ?? {
        weekLabel: `Week of ${key}`,
        weekStart: key,
        weekEnd: this.formatDateOnly(weekEnd.toISOString()),
        orderCount: 0,
        unitCount: 0,
        totalAmount: 0,
      };

      current.orderCount += 1;
      current.unitCount += row.serialCount;
      current.totalAmount += row.totalAmount;
      weeklyGroups.set(key, current);
    }

    return [...weeklyGroups.values()].sort((left, right) => right.weekStart.localeCompare(left.weekStart));
  }

  private buildDailyUnitReleasedRows(rows: SalesRegisterRow[]): DailyUnitReleasedRow[] {
    const dailyGroups = new Map<string, DailyUnitReleasedRow>();

    for (const row of rows) {
      const current = dailyGroups.get(row.releaseDate) ?? {
        releaseDate: row.releaseDate,
        orderCount: 0,
        unitCount: 0,
        totalAmount: 0,
      };

      current.orderCount += 1;
      current.unitCount += row.serialCount;
      current.totalAmount += row.totalAmount;
      dailyGroups.set(row.releaseDate, current);
    }

    return [...dailyGroups.values()].sort((left, right) => right.releaseDate.localeCompare(left.releaseDate));
  }

  private async loadLowStockReport(): Promise<void> {
    const response = await apiClient.get<Array<Record<string, unknown>>>('/inventory/materials/low-stock');
    const items = Array.isArray(response.data) ? response.data : [];

    this.lowStockRows = items.map((item) => ({
      id: Number(item['id']) || 0,
      materialCode: String(item['material_code'] ?? item['materialCode'] ?? '').trim(),
      materialName: String(item['material_name'] ?? item['materialName'] ?? '').trim(),
      brandName: String(item['brand_name'] ?? item['brandName'] ?? '').trim(),
      unit: String(item['unit'] ?? '').trim(),
      onHandStock: Number(item['on_hand_stock'] ?? item['onHandStock'] ?? 0),
      reorderLevel: Number(item['reorder_level'] ?? item['reorderLevel'] ?? 0),
      sellPrice: Number(item['sell_price'] ?? item['sellPrice'] ?? 0),
    }));
  }

  private isWithinDateRange(value: string): boolean {
    const parsedValue = new Date(value);
    if (Number.isNaN(parsedValue.getTime())) {
      return false;
    }

    if (this.reportDateFrom) {
      const parsedFrom = new Date(this.reportDateFrom);
      if (!Number.isNaN(parsedFrom.getTime()) && parsedValue < parsedFrom) {
        return false;
      }
    }

    if (this.reportDateTo) {
      const parsedTo = new Date(this.reportDateTo);
      if (!Number.isNaN(parsedTo.getTime())) {
        parsedTo.setHours(23, 59, 59, 999);
        if (parsedValue > parsedTo) {
          return false;
        }
      }
    }

    return true;
  }

  private getWeekStart(value: Date): Date {
    const date = new Date(value);
    date.setHours(0, 0, 0, 0);
    const dayIndex = (date.getDay() + 6) % 7;
    date.setDate(date.getDate() - dayIndex);
    return date;
  }

  private buildExcelExportDefinition(): ExcelExportDefinition | null {
    switch (this.selectedReportKey) {
      case 'sales-register':
        return {
          fileName: `sales_register_${this.reportDateFrom}_${this.reportDateTo}.xlsx`,
          sheetName: 'Sales Register',
          title: 'Sales Register',
          subtitle: `Date Range: ${this.reportDateFrom} to ${this.reportDateTo}`,
          headers: ['Release Date', 'SO Number', 'Customer', 'Sales Type', 'Status', 'Units', 'Total Amount'],
          rows: this.salesRegisterRows.map((row) => [
            row.releaseDate,
            row.soNumber,
            row.customerName,
            row.salesType,
            row.status,
            row.serialCount,
            row.totalAmount,
          ]),
        };
      case 'weekly-sales':
        return {
          fileName: `weekly_sales_${this.reportDateFrom}_${this.reportDateTo}.xlsx`,
          sheetName: 'Weekly Sales',
          title: 'Weekly Sales',
          subtitle: `Date Range: ${this.reportDateFrom} to ${this.reportDateTo}`,
          headers: ['Week Label', 'Week Start', 'Week End', 'Orders', 'Units', 'Total Amount'],
          rows: this.weeklySalesRows.map((row) => [
            row.weekLabel,
            row.weekStart,
            row.weekEnd,
            row.orderCount,
            row.unitCount,
            row.totalAmount,
          ]),
        };
      case 'daily-unit-released':
        return {
          fileName: `daily_unit_released_${this.reportDateFrom}_${this.reportDateTo}.xlsx`,
          sheetName: 'Daily Unit Released',
          title: 'Daily Unit Released',
          subtitle: `Date Range: ${this.reportDateFrom} to ${this.reportDateTo}`,
          headers: ['Release Date', 'Orders', 'Units', 'Total Amount'],
          rows: this.dailyUnitReleasedRows.map((row) => [
            row.releaseDate,
            row.orderCount,
            row.unitCount,
            row.totalAmount,
          ]),
        };
      case 'low-stocks-report':
        return {
          fileName: 'low_stocks_report.xlsx',
          sheetName: 'Low Stocks',
          title: 'Low Stocks Report',
          headers: ['Material Code', 'Material Name', 'Brand', 'Unit', 'On Hand', 'Reorder Level', 'Sell Price'],
          rows: this.lowStockRows.map((row) => [
            row.materialCode,
            row.materialName,
            row.brandName,
            row.unit,
            row.onHandStock,
            row.reorderLevel,
            row.sellPrice,
          ]),
        };
      case 'cheque-voucher':
        return {
          fileName: `cheque_voucher_${this.chequeVoucherForm.cvNo || 'draft'}.xlsx`,
          sheetName: 'Cheque Voucher',
          title: 'Cheque Voucher Draft',
          headers: ['Section', 'Field', 'Value', 'Amount'],
          rows: [
            ['Voucher', 'CV No.', this.chequeVoucherForm.cvNo, ''],
            ['Voucher', 'Payee', this.chequeVoucherForm.payee, ''],
            ['Voucher', 'Voucher Date', this.chequeVoucherForm.voucherDate, ''],
            ['Voucher', 'TIN Number', this.chequeVoucherForm.tinNumber, ''],
            ['Voucher', 'Address', this.chequeVoucherForm.address, ''],
            ['Voucher', 'Zip Code', this.chequeVoucherForm.zipCode, ''],
            ['Voucher', 'Particulars', this.chequeVoucherForm.particulars, ''],
            ...this.chequeVoucherForm.deposits.map((row) => [
              'Deposit',
              `${row.bankName || '-'} / ${row.chequeNo || '-'}`,
              row.chequeDate,
              Number(row.amount) || 0,
            ]),
            ...this.chequeVoucherForm.invoices.map((row) => [
              'Invoice',
              row.invoiceNo,
              row.description,
              Number(row.amount) || 0,
            ]),
            ...this.chequeVoucherForm.accountTitles.map((row) => [
              'Account Title',
              `${row.accountNumber} ${row.description}`.trim(),
              Number(row.debit) > 0 ? 'Debit' : 'Credit',
              Number(row.debit) || Number(row.credit) || 0,
            ]),
          ],
        };
      case 'general-journal-register':
        return {
          fileName: `general_journal_${this.generalJournalForm.journalNo || 'draft'}.xlsx`,
          sheetName: 'General Journal',
          title: 'General Journal Register Draft',
          headers: ['Journal No.', 'Journal Date', 'Description', 'Account Number', 'Account Description', 'Debit', 'Credit'],
          rows: this.generalJournalForm.sundries.map((row) => [
            this.generalJournalForm.journalNo,
            this.generalJournalForm.journalDate,
            this.generalJournalForm.description,
            row.accountNumber,
            row.description,
            Number(row.debit) || 0,
            Number(row.credit) || 0,
          ]),
        };
      case 'disbursement-register':
        return {
          fileName: 'disbursement_register_preview.xlsx',
          sheetName: 'Disbursement Register',
          title: 'Disbursement Register Preview',
          headers: ['CV No.', 'Voucher Date', 'Payee', 'Invoice No.', 'Invoice Date', 'Description', 'Amount'],
          rows: this.disbursementRegisterRows.map((row) => [
            row.cvNo,
            row.voucherDate,
            row.payee,
            row.invoiceNo,
            row.invoiceDate,
            row.description,
            row.amount,
          ]),
        };
      case 'tax-2307-report':
        return {
          fileName: '2307_tax_report_preview.xlsx',
          sheetName: '2307 Tax Report',
          title: '2307 Tax Report Preview',
          headers: ['Account Number', 'Description', 'Amount'],
          rows: this.withholdingTaxRows.map((row) => [
            row.accountNumber,
            row.description,
            row.amount,
          ]),
        };
      default:
        return null;
    }
  }

  private async createWorkbook(): Promise<{
    addWorksheet: (name?: string) => any;
    xlsx: { writeBuffer: () => Promise<ArrayBuffer> };
  }> {
    const excelJsModule = await import('exceljs').catch(async () => import('exceljs/dist/exceljs.min.js'));
    const workbookConstructor =
      (excelJsModule as { Workbook?: new () => any }).Workbook ??
      (excelJsModule as { default?: { Workbook?: new () => any } }).default?.Workbook;

    if (!workbookConstructor) {
      throw new Error('Excel workbook constructor is unavailable.');
    }

    return new workbookConstructor();
  }

  private downloadBlob(blob: Blob, fileName: string): void {
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = fileName;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  }

  private createChequeDepositDraft(): ChequeDepositDraft {
    return {
      bankName: '',
      chequeNo: '',
      chequeDate: '',
      amount: 0,
    };
  }

  private createInvoiceDraft(): InvoiceDraft {
    return {
      invoiceNo: '',
      invoiceDate: '',
      description: '',
      amount: 0,
    };
  }

  private createAccountTitleDraft(): AccountTitleDraft {
    return {
      accountNumber: '',
      description: '',
      debit: 0,
      credit: 0,
    };
  }

  private createJournalSundryDraft(): JournalSundryDraft {
    return {
      accountNumber: '',
      description: '',
      debit: 0,
      credit: 0,
    };
  }
}
