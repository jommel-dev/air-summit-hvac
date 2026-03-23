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

interface ChequeVoucherReleasedRecord {
  cvNo: string;
  voucherType: string;
  payee: string;
  voucherDate: string;
  tinNumber: string;
  address: string;
  zipCode: string;
  particulars: string;
  deposits: ChequeDepositDraft[];
  invoices: InvoiceDraft[];
  accountTitles: AccountTitleDraft[];
  releasedAt: string;
  preparedBy: string | null;
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

interface Tax2307ReportRow {
  referenceNo: string;
  tin: string;
  supplierName: string;
  supplierAddress: string;
  vatableAmount: number;
  taxWithheld: number;
  voucherDate: string;
}

interface Tax2307SupplierSummary {
  tin: string;
  supplierName: string;
  supplierAddress: string;
  references: string[];
  vatableAmount: number;
  taxWithheld: number;
}

@Component({
  selector: 'app-accounting',
  imports: [CommonModule, FormsModule, PageBreadcrumbComponent],
  templateUrl: './accounting.component.html',
})
export class AccountingComponent implements OnInit {
  private readonly reportPermissionPrefix = 'accounting.report.';
  private readonly reportActionPermissionPrefix = 'accounting.report.action.';
  private readonly generateReportPermissionKeys = ['accounting.report.action.generate'];
  private readonly exportReportPermissionKeys = ['accounting.report.action.export'];
  private readonly printReportPermissionKeys = ['accounting.report.action.print'];
  private readonly editDraftReportPermissionKeys = ['accounting.report.action.edit-draft'];

  treeSearch = '';
  selectedReportKey: AccountingReportKey | null = null;
  expandedFolders = new Set<string>();

  isLoadingReport = false;
  reportError = '';

  reportDateFrom = '';
  reportDateTo = '';
  chequeVoucherListDateFrom = '';
  chequeVoucherListDateTo = '';
  tax2307DateFrom = '';
  tax2307DateTo = '';
  tax2307SearchQuery = '';
  tax2307SupplierFilter = '';
  isChequeVoucherDrawerOpen = false;
  isLoadingChequeVoucherDraftData = false;
  isSavingChequeVoucher = false;
  viewingVoucher: ChequeVoucherReleasedRecord | null = null;
  voucherSearchQuery = '';
  isEditingViewingVoucher = false;
  isSavingVoucherEdit = false;
  isPrintPreviewOpen = false;
  editingVoucherForm = {
    cvNo: '',
    voucherType: 'Bank Voucher',
    payee: '',
    voucherDate: '',
    tinNumber: '',
    address: '',
    zipCode: '',
    particulars: '',
    deposits: [] as ChequeDepositDraft[],
    invoices: [] as InvoiceDraft[],
    accountTitles: [] as AccountTitleDraft[],
  };

  readonly chequeVoucherTypeOptions = [
    'Debit Voucher',
    'Credit Voucher',
    'Cash Voucher',
    'Bank Voucher',
    'Journal Voucher',
    'Purchase Voucher',
    'Sales Voucher',
    'Contra Voucher',
    'Debit/Credit Note Voucher',
  ];

  salesRegisterRows: SalesRegisterRow[] = [];
  weeklySalesRows: WeeklySalesRow[] = [];
  dailyUnitReleasedRows: DailyUnitReleasedRow[] = [];
  lowStockRows: LowStockRow[] = [];
  releasedChequeVouchers: ChequeVoucherReleasedRecord[] = [];
  accountTitleCatalog: AccountTitleDraft[] = [];

  chequeVoucherForm = {
    cvNo: '',
    voucherType: 'Bank Voucher',
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

  private readonly defaultAccountTitles: AccountTitleDraft[] = [
    { accountNumber: '11001', description: 'Cash In Bank', debit: 0, credit: 0 },
    { accountNumber: '14001', description: 'Purchases', debit: 0, credit: 0 },
    { accountNumber: '14010', description: 'Input Tax', debit: 0, credit: 0 },
    { accountNumber: '12001', description: 'Expanded Withholding Tax', debit: 0, credit: 0 },
    { accountNumber: '15001', description: 'DC-Outside Services', debit: 0, credit: 0 },
    { accountNumber: '15002', description: 'DC-Materials', debit: 0, credit: 0 },
    { accountNumber: '15003', description: 'DC-Others', debit: 0, credit: 0 },
  ];

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
      description: 'Cheque Voucher is live; other voucher reports remain in progressive rollout.',
      reports: [
        {
          key: 'cheque-voucher',
          name: 'Cheque Voucher',
          description: 'Live workflow with auto-numbering, persisted vouchers, and account title records.',
          permissionKeys: ['accounting.report.cheque-voucher.view'],
          readiness: 'live',
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
          description: 'Register generated from released cheque vouchers.',
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
          description: 'Withholding tax report derived from released cheque voucher account titles.',
          permissionKeys: ['accounting.report.tax-2307-report.view'],
          readiness: 'live',
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
    void this.initializeDraftForms();

    for (const folder of this.visibleReportFolders) {
      this.expandedFolders.add(folder.key);
    }

    const firstVisibleReport = this.visibleReportFolders[0]?.reports[0] ?? null;
    if (firstVisibleReport) {
      this.selectReport(firstVisibleReport.key);
    }
  }

  get filteredReleasedChequeVouchers(): ChequeVoucherReleasedRecord[] {
    const query = this.voucherSearchQuery.trim().toLowerCase();
    return this.releasedChequeVouchers
      .filter((record) => this.isVoucherWithinDateRange(record.voucherDate))
      .filter((record) => {
        if (!query) {
          return true;
        }
        return (
          record.cvNo.toLowerCase().includes(query) ||
          record.payee.toLowerCase().includes(query) ||
          (record.preparedBy ?? '').toLowerCase().includes(query)
        );
      });
  }

  get releasedChequeVoucherAmountTotal(): number {
    return this.filteredReleasedChequeVouchers.reduce((sum, voucher) => {
      return sum + this.getReleasedVoucherAmountTotal(voucher);
    }, 0);
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
    const sourceVouchers = this.releasedChequeVouchers.length > 0
      ? this.filteredReleasedChequeVouchers
      : [{
          cvNo: this.chequeVoucherForm.cvNo,
          voucherDate: this.chequeVoucherForm.voucherDate,
          payee: this.chequeVoucherForm.payee,
          invoices: this.chequeVoucherForm.invoices,
        } as Pick<ChequeVoucherReleasedRecord, 'cvNo' | 'voucherDate' | 'payee' | 'invoices'>];

    return sourceVouchers
      .flatMap((voucher) =>
        voucher.invoices.map((invoice) => ({
          cvNo: String(voucher.cvNo ?? '').trim(),
          voucherDate: String(voucher.voucherDate ?? '').trim(),
          payee: String(voucher.payee ?? '').trim(),
          invoiceNo: String(invoice.invoiceNo ?? '').trim(),
          invoiceDate: String(invoice.invoiceDate ?? '').trim(),
          description: String(invoice.description ?? '').trim(),
          amount: Number(invoice.amount) || 0,
        })),
      )
      .filter((row) => row.invoiceNo || row.description || row.amount > 0);
  }

  get withholdingTaxRows(): Tax2307ReportRow[] {
    const rows = this.getTax2307BaseRows().filter((row) => {
      if (!this.tax2307SupplierFilter) {
        return true;
      }
      return row.supplierName === this.tax2307SupplierFilter;
    });

    const query = this.tax2307SearchQuery.trim().toLowerCase();
    if (!query) {
      return rows;
    }

    return rows.filter((row) => {
      return (
        row.referenceNo.toLowerCase().includes(query) ||
        row.tin.toLowerCase().includes(query) ||
        row.supplierName.toLowerCase().includes(query)
      );
    });
  }

  get tax2307SupplierOptions(): string[] {
    return [...new Set(
      this.getTax2307BaseRows()
        .map((row) => row.supplierName)
        .filter((value) => Boolean(value)),
    )].sort((a, b) => a.localeCompare(b));
  }

  get withholdingTaxTotal(): number {
    return this.withholdingTaxRows.reduce((sum, row) => sum + row.taxWithheld, 0);
  }

  get withholdingVatableTotal(): number {
    return this.withholdingTaxRows.reduce((sum, row) => sum + row.vatableAmount, 0);
  }

  get tax2307MonthLabel(): string {
    const sourceDate = this.tax2307DateFrom || this.tax2307DateTo || new Date().toISOString();
    const parsedDate = new Date(sourceDate);
    if (Number.isNaN(parsedDate.getTime())) {
      return 'Current Month';
    }

    return parsedDate.toLocaleString('en-US', {
      month: 'long',
      year: 'numeric',
    });
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

  canGenerateSelectedReportAction(): boolean {
    if (!this.selectedReportKey || !this.isLiveReport(this.selectedReportKey)) {
      return false;
    }

    return this.canAccessReportAction(this.generateReportPermissionKeys);
  }

  canExportSelectedReportAction(): boolean {
    return this.canAccessReportAction(this.exportReportPermissionKeys) && this.canExportSelectedReport();
  }

  canPrintSelectedReportAction(): boolean {
    return this.canAccessReportAction(this.printReportPermissionKeys);
  }

  canEditSelectedReportDraft(): boolean {
    if (!this.selectedReportKey) {
      return false;
    }

    return !this.isLiveReport(this.selectedReportKey) && this.canAccessReportAction(this.editDraftReportPermissionKeys);
  }

  async reloadSelectedReport(): Promise<void> {
    if (!this.selectedReportKey || !this.isLiveReport(this.selectedReportKey)) {
      return;
    }

    if (!this.canGenerateSelectedReportAction()) {
      this.reportError = 'You do not have permission to generate this report.';
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
    if (!this.canAccessReportAction(this.exportReportPermissionKeys)) {
      this.reportError = 'You do not have permission to export reports.';
      return;
    }

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
    if (!this.canAccessReportAction(this.printReportPermissionKeys)) {
      this.reportError = 'You do not have permission to print reports.';
      return;
    }

    if (typeof window === 'undefined') {
      return;
    }

    if (this.selectedReportKey === 'tax-2307-report') {
      this.printTax2307Report();
      return;
    }

    window.print();
  }

  addChequeDeposit(): void {
    if (!this.canEditSelectedReportDraft()) {
      return;
    }

    this.chequeVoucherForm.deposits = [...this.chequeVoucherForm.deposits, this.createChequeDepositDraft()];
  }

  removeChequeDeposit(index: number): void {
    if (!this.canEditSelectedReportDraft()) {
      return;
    }

    if (this.chequeVoucherForm.deposits.length <= 1) {
      return;
    }

    this.chequeVoucherForm.deposits = this.chequeVoucherForm.deposits.filter((_, itemIndex) => itemIndex !== index);
  }

  addChequeInvoice(): void {
    if (!this.canEditSelectedReportDraft()) {
      return;
    }

    this.chequeVoucherForm.invoices = [...this.chequeVoucherForm.invoices, this.createInvoiceDraft()];
  }

  removeChequeInvoice(index: number): void {
    if (!this.canEditSelectedReportDraft()) {
      return;
    }

    if (this.chequeVoucherForm.invoices.length <= 1) {
      return;
    }

    this.chequeVoucherForm.invoices = this.chequeVoucherForm.invoices.filter((_, itemIndex) => itemIndex !== index);
  }

  addAccountTitle(): void {
    if (!this.canEditSelectedReportDraft()) {
      return;
    }

    this.chequeVoucherForm.accountTitles = [...this.chequeVoucherForm.accountTitles, this.createAccountTitleDraft()];
  }

  async openChequeVoucherDrawer(): Promise<void> {
    this.isChequeVoucherDrawerOpen = true;
    await this.loadNextChequeVoucherNumber();
  }

  closeChequeVoucherDrawer(): void {
    this.isChequeVoucherDrawerOpen = false;
  }

  openVoucherView(voucher: ChequeVoucherReleasedRecord): void {
    this.viewingVoucher = voucher;
    this.isEditingViewingVoucher = false;
  }

  closeVoucherView(): void {
    this.viewingVoucher = null;
    this.isEditingViewingVoucher = false;
  }

  startEditVoucher(): void {
    if (!this.viewingVoucher) {
      return;
    }
    const v = this.viewingVoucher;
    this.editingVoucherForm = {
      cvNo: v.cvNo,
      voucherType: v.voucherType,
      payee: v.payee,
      voucherDate: v.voucherDate,
      tinNumber: v.tinNumber ?? '',
      address: v.address ?? '',
      zipCode: v.zipCode ?? '',
      particulars: v.particulars ?? '',
      deposits: v.deposits.map((d) => ({ ...d })),
      invoices: v.invoices.map((i) => ({ ...i })),
      accountTitles: v.accountTitles.map((t) => ({ ...t })),
    };
    this.isEditingViewingVoucher = true;
  }

  cancelEditVoucher(): void {
    this.isEditingViewingVoucher = false;
  }

  async saveVoucherEdit(): Promise<void> {
    if (this.isSavingVoucherEdit || !this.viewingVoucher) {
      return;
    }

    if (!String(this.editingVoucherForm.payee ?? '').trim()) {
      this.reportError = 'Payee is required.';
      return;
    }

    this.isSavingVoucherEdit = true;
    this.reportError = '';

    try {
      const cvNo = this.viewingVoucher.cvNo;
      const payload = {
        voucherType: this.editingVoucherForm.voucherType,
        payee: this.editingVoucherForm.payee,
        voucherDate: this.editingVoucherForm.voucherDate,
        tinNumber: this.editingVoucherForm.tinNumber,
        address: this.editingVoucherForm.address,
        zipCode: this.editingVoucherForm.zipCode,
        particulars: this.editingVoucherForm.particulars,
        deposits: this.editingVoucherForm.deposits.map((row) => ({
          bankName: row.bankName,
          chequeNo: row.chequeNo,
          chequeDate: row.chequeDate,
          amount: Number(row.amount) || 0,
        })),
        invoices: this.editingVoucherForm.invoices.map((row) => ({
          invoiceNo: row.invoiceNo,
          invoiceDate: row.invoiceDate,
          description: row.description,
          amount: Number(row.amount) || 0,
        })),
        accountTitles: this.editingVoucherForm.accountTitles.map((row) => ({
          accountNumber: row.accountNumber,
          description: row.description,
          debit: Number(row.debit) || 0,
          credit: Number(row.credit) || 0,
        })),
      };

      const response = await apiClient.patch<{ success: boolean; data?: ChequeVoucherReleasedRecord }>(
        `/accounting/cheque-vouchers/${encodeURIComponent(cvNo)}`,
        payload,
      );

      if (!response.data?.success || !response.data.data) {
        this.reportError = 'Unable to save voucher changes.';
        return;
      }

      const updated = response.data.data;
      this.viewingVoucher = updated;
      const idx = this.releasedChequeVouchers.findIndex((v) => v.cvNo === cvNo);
      if (idx >= 0) {
        this.releasedChequeVouchers = [
          ...this.releasedChequeVouchers.slice(0, idx),
          updated,
          ...this.releasedChequeVouchers.slice(idx + 1),
        ];
      }
      this.isEditingViewingVoucher = false;
    } catch (error: unknown) {
      if (axios.isAxiosError(error)) {
        this.reportError =
          (error.response?.data as { message?: string } | undefined)?.message ??
          'Unable to save voucher changes.';
      } else {
        this.reportError = 'Unable to save voucher changes.';
      }
    } finally {
      this.isSavingVoucherEdit = false;
    }
  }

  get editingVoucherDepositTotal(): number {
    return this.editingVoucherForm.deposits.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
  }

  get editingVoucherInvoiceTotal(): number {
    return this.editingVoucherForm.invoices.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
  }

  get editingVoucherDebitTotal(): number {
    return this.editingVoucherForm.accountTitles.reduce((sum, row) => sum + (Number(row.debit) || 0), 0);
  }

  get editingVoucherCreditTotal(): number {
    return this.editingVoucherForm.accountTitles.reduce((sum, row) => sum + (Number(row.credit) || 0), 0);
  }

  addEditDeposit(): void {
    this.editingVoucherForm.deposits = [...this.editingVoucherForm.deposits, this.createChequeDepositDraft()];
  }

  removeEditDeposit(index: number): void {
    if (this.editingVoucherForm.deposits.length <= 1) {
      return;
    }
    this.editingVoucherForm.deposits = this.editingVoucherForm.deposits.filter((_, i) => i !== index);
  }

  addEditInvoice(): void {
    this.editingVoucherForm.invoices = [...this.editingVoucherForm.invoices, this.createInvoiceDraft()];
  }

  removeEditInvoice(index: number): void {
    if (this.editingVoucherForm.invoices.length <= 1) {
      return;
    }
    this.editingVoucherForm.invoices = this.editingVoucherForm.invoices.filter((_, i) => i !== index);
  }

  addEditAccountTitle(): void {
    this.editingVoucherForm.accountTitles = [...this.editingVoucherForm.accountTitles, this.createAccountTitleDraft()];
  }

  removeEditAccountTitle(index: number): void {
    if (this.editingVoucherForm.accountTitles.length <= 1) {
      return;
    }
    this.editingVoucherForm.accountTitles = this.editingVoucherForm.accountTitles.filter((_, i) => i !== index);
  }

  clearChequeVoucherFilters(): void {
    this.applyDefaultChequeVoucherDateRange();
    void this.loadReleasedChequeVouchers();
  }

  applyChequeVoucherFilters(): void {
    void this.loadReleasedChequeVouchers(this.chequeVoucherListDateFrom, this.chequeVoucherListDateTo);
  }

  applyTax2307Filters(): void {
    if (this.tax2307DateFrom && this.tax2307DateTo) {
      const fromDate = new Date(this.tax2307DateFrom);
      const toDate = new Date(this.tax2307DateTo);
      if (!Number.isNaN(fromDate.getTime()) && !Number.isNaN(toDate.getTime()) && fromDate > toDate) {
        this.reportError = 'From date must not be later than To date for 2307 report.';
        return;
      }
    }

    this.reportError = '';
  }

  clearTax2307Filters(): void {
    this.applyDefaultTax2307DateRange();
    this.tax2307SearchQuery = '';
    this.tax2307SupplierFilter = '';
    this.reportError = '';
  }

  async viewTax2307Row(row: Tax2307ReportRow): Promise<void> {
    const summary = this.createSupplierSummaryFromRows([row], {
      supplierName: row.supplierName,
      tin: row.tin,
    });

    if (!summary) {
      this.reportError = 'Unable to prepare 2307 form for the selected row.';
      return;
    }

    await this.generateTax2307FormsPdf([summary], true);
  }

  async generateTax2307Forms(): Promise<void> {
    const summaries = this.getTax2307SupplierSummaries();
    if (summaries.length === 0) {
      this.reportError = 'No supplier rows available for 2307 form generation.';
      return;
    }

    await this.generateTax2307FormsPdf(summaries, false);
  }

  getReleasedVoucherAmountTotal(voucher: ChequeVoucherReleasedRecord): number {
    const invoiceTotal = voucher.invoices.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
    if (invoiceTotal > 0) {
      return invoiceTotal;
    }

    return voucher.deposits.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
  }

  getVoucherAccountTitleDebitTotal(voucher: ChequeVoucherReleasedRecord): number {
    return voucher.accountTitles.reduce((sum, row) => sum + (Number(row.debit) || 0), 0);
  }

  getVoucherAccountTitleCreditTotal(voucher: ChequeVoucherReleasedRecord): number {
    return voucher.accountTitles.reduce((sum, row) => sum + (Number(row.credit) || 0), 0);
  }

  async onAccountTitleBlur(index: number): Promise<void> {
    const item = this.chequeVoucherForm.accountTitles[index];
    if (!item) {
      return;
    }

    const accountNumber = String(item.accountNumber ?? '').trim();
    const description = String(item.description ?? '').trim();
    if (!accountNumber || !description) {
      return;
    }

    const exists = this.accountTitleCatalog.some((entry) =>
      String(entry.accountNumber).trim() === accountNumber &&
      String(entry.description).trim().toLowerCase() === description.toLowerCase(),
    );

    if (exists) {
      return;
    }

    try {
      const response = await apiClient.post<{ success: boolean; data?: { accountNumber?: string; description?: string } }>(
        '/accounting/account-titles',
        {
          accountNumber,
          description,
        },
      );

      if (!response.data?.success) {
        return;
      }

      this.accountTitleCatalog = [...this.accountTitleCatalog, {
        accountNumber,
        description,
        debit: 0,
        credit: 0,
      }];
    } catch {
    }
  }

  async releaseChequeVoucher(): Promise<void> {
    if (!this.canEditSelectedReportDraft()) {
      return;
    }

    if (this.isSavingChequeVoucher) {
      return;
    }

    if (!String(this.chequeVoucherForm.payee ?? '').trim()) {
      this.reportError = 'Payee is required before releasing voucher.';
      return;
    }

    this.isSavingChequeVoucher = true;
    this.reportError = '';

    try {
      const payload = {
        voucherType: this.chequeVoucherForm.voucherType,
        payee: this.chequeVoucherForm.payee,
        voucherDate: this.chequeVoucherForm.voucherDate,
        tinNumber: this.chequeVoucherForm.tinNumber,
        address: this.chequeVoucherForm.address,
        zipCode: this.chequeVoucherForm.zipCode,
        particulars: this.chequeVoucherForm.particulars,
        deposits: this.chequeVoucherForm.deposits.map((row) => ({
          bankName: row.bankName,
          chequeNo: row.chequeNo,
          chequeDate: row.chequeDate,
          amount: Number(row.amount) || 0,
        })),
        invoices: this.chequeVoucherForm.invoices.map((row) => ({
          invoiceNo: row.invoiceNo,
          invoiceDate: row.invoiceDate,
          description: row.description,
          amount: Number(row.amount) || 0,
        })),
        accountTitles: this.chequeVoucherForm.accountTitles.map((row) => ({
          accountNumber: row.accountNumber,
          description: row.description,
          debit: Number(row.debit) || 0,
          credit: Number(row.credit) || 0,
        })),
      };

      const response = await apiClient.post<{ success: boolean; data?: ChequeVoucherReleasedRecord }>(
        '/accounting/cheque-vouchers/release',
        payload,
      );

      if (!response.data?.success || !response.data.data) {
        this.reportError = 'Unable to release cheque voucher.';
        return;
      }

      await this.loadReleasedChequeVouchers(this.chequeVoucherListDateFrom, this.chequeVoucherListDateTo);
      await this.loadAccountTitles();
      await this.resetChequeVoucherDraft();
      this.closeChequeVoucherDrawer();
    } catch (error: unknown) {
      if (axios.isAxiosError(error)) {
        this.reportError =
          (error.response?.data as { message?: string } | undefined)?.message ??
          'Unable to release cheque voucher.';
      } else {
        this.reportError = 'Unable to release cheque voucher.';
      }
    } finally {
      this.isSavingChequeVoucher = false;
    }
  }

  removeAccountTitle(index: number): void {
    if (!this.canEditSelectedReportDraft()) {
      return;
    }

    if (this.chequeVoucherForm.accountTitles.length <= 1) {
      return;
    }

    this.chequeVoucherForm.accountTitles = this.chequeVoucherForm.accountTitles.filter((_, itemIndex) => itemIndex !== index);
  }

  addJournalSundry(): void {
    if (!this.canEditSelectedReportDraft()) {
      return;
    }

    this.generalJournalForm.sundries = [...this.generalJournalForm.sundries, this.createJournalSundryDraft()];
  }

  removeJournalSundry(index: number): void {
    if (!this.canEditSelectedReportDraft()) {
      return;
    }

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

  private async initializeDraftForms(): Promise<void> {
    const today = this.formatDateOnly(new Date().toISOString());
    this.isLoadingChequeVoucherDraftData = true;
    this.applyDefaultChequeVoucherDateRange();
    this.applyDefaultTax2307DateRange();

    await Promise.all([
      this.loadReleasedChequeVouchers(this.chequeVoucherListDateFrom, this.chequeVoucherListDateTo),
      this.loadAccountTitles(),
      this.loadNextChequeVoucherNumber(),
    ]);

    this.chequeVoucherForm.voucherDate = today;
    this.chequeVoucherForm.accountTitles = this.accountTitleCatalog.map((row) => ({ ...row }));
    this.generalJournalForm.journalDate = today;
    this.isLoadingChequeVoucherDraftData = false;
  }

  private applyDefaultChequeVoucherDateRange(): void {
    const currentDate = new Date();
    const firstDateOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
    this.chequeVoucherListDateFrom = this.formatDateOnly(firstDateOfMonth.toISOString());
    this.chequeVoucherListDateTo = this.formatDateOnly(currentDate.toISOString());
  }

  private applyDefaultTax2307DateRange(): void {
    const currentDate = new Date();
    const firstDateOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
    this.tax2307DateFrom = this.formatDateOnly(firstDateOfMonth.toISOString());
    this.tax2307DateTo = this.formatDateOnly(currentDate.toISOString());
  }

  private async loadReleasedChequeVouchers(dateFrom?: string, dateTo?: string): Promise<void> {
    try {
      const response = await apiClient.get<{ success: boolean; data?: ChequeVoucherReleasedRecord[] }>(
        '/accounting/cheque-vouchers',
        {
          params: {
            dateFrom: dateFrom || undefined,
            dateTo: dateTo || undefined,
          },
        },
      );

      if (!response.data?.success) {
        this.releasedChequeVouchers = [];
        return;
      }

      this.releasedChequeVouchers = Array.isArray(response.data.data) ? response.data.data : [];
    } catch {
      this.releasedChequeVouchers = [];
    }
  }

  private async loadAccountTitles(): Promise<void> {
    try {
      const response = await apiClient.get<{ success: boolean; data?: Array<{ accountNumber?: string; description?: string }> }>(
        '/accounting/account-titles',
      );

      if (!response.data?.success) {
        this.accountTitleCatalog = this.defaultAccountTitles.map((item) => ({ ...item }));
        return;
      }

      const rows = Array.isArray(response.data.data) ? response.data.data : [];
      this.accountTitleCatalog = rows.length > 0
        ? rows.map((item) => ({
            accountNumber: String(item.accountNumber ?? '').trim(),
            description: String(item.description ?? '').trim(),
            debit: 0,
            credit: 0,
          }))
        : this.defaultAccountTitles.map((item) => ({ ...item }));
    } catch {
      this.accountTitleCatalog = this.defaultAccountTitles.map((item) => ({ ...item }));
    }
  }

  private async loadNextChequeVoucherNumber(): Promise<void> {
    try {
      const response = await apiClient.get<{ success: boolean; data?: { cvNo?: string } }>(
        '/accounting/cheque-vouchers/next-number',
      );

      this.chequeVoucherForm.cvNo = String(response.data?.data?.cvNo ?? '').trim();
    } catch {
      this.chequeVoucherForm.cvNo = '';
    }
  }

  private async resetChequeVoucherDraft(): Promise<void> {
    const today = this.formatDateOnly(new Date().toISOString());
    await this.loadNextChequeVoucherNumber();

    this.chequeVoucherForm = {
      cvNo: this.chequeVoucherForm.cvNo,
      voucherType: this.chequeVoucherForm.voucherType,
      payee: '',
      voucherDate: today,
      tinNumber: '',
      address: '',
      zipCode: '',
      particulars: '',
      deposits: [this.createChequeDepositDraft()],
      invoices: [this.createInvoiceDraft()],
      accountTitles: this.accountTitleCatalog.map((row) => ({ ...row })),
    };
  }

  private isVoucherWithinDateRange(value: string): boolean {
    const parsedValue = new Date(value);
    if (Number.isNaN(parsedValue.getTime())) {
      return false;
    }

    if (this.chequeVoucherListDateFrom) {
      const parsedFrom = new Date(this.chequeVoucherListDateFrom);
      if (!Number.isNaN(parsedFrom.getTime()) && parsedValue < parsedFrom) {
        return false;
      }
    }

    if (this.chequeVoucherListDateTo) {
      const parsedTo = new Date(this.chequeVoucherListDateTo);
      if (!Number.isNaN(parsedTo.getTime())) {
        parsedTo.setHours(23, 59, 59, 999);
        if (parsedValue > parsedTo) {
          return false;
        }
      }
    }

    return true;
  }

  private isTax2307WithinDateRange(value: string): boolean {
    const parsedValue = new Date(value);
    if (Number.isNaN(parsedValue.getTime())) {
      return false;
    }

    if (this.tax2307DateFrom) {
      const parsedFrom = new Date(this.tax2307DateFrom);
      if (!Number.isNaN(parsedFrom.getTime()) && parsedValue < parsedFrom) {
        return false;
      }
    }

    if (this.tax2307DateTo) {
      const parsedTo = new Date(this.tax2307DateTo);
      if (!Number.isNaN(parsedTo.getTime())) {
        parsedTo.setHours(23, 59, 59, 999);
        if (parsedValue > parsedTo) {
          return false;
        }
      }
    }

    return true;
  }

  private getTax2307BaseRows(): Tax2307ReportRow[] {
    return this.releasedChequeVouchers
      .filter((voucher) => this.isTax2307WithinDateRange(voucher.voucherDate || voucher.releasedAt))
      .map((voucher) => {
        const withholdingRows = voucher.accountTitles.filter((accountTitle) => {
          const normalizedDescription = String(accountTitle.description ?? '').toLowerCase();
          return normalizedDescription.includes('expanded withholding tax') || normalizedDescription.includes('2307');
        });

        const taxWithheld = withholdingRows.reduce((sum, accountTitle) => {
          return sum + Math.max(Number(accountTitle.debit) || 0, Number(accountTitle.credit) || 0);
        }, 0);

        return {
          referenceNo: String(voucher.cvNo ?? '').trim(),
          tin: String(voucher.tinNumber ?? '').trim(),
          supplierName: String(voucher.payee ?? '').trim(),
          supplierAddress: `${String(voucher.address ?? '').trim()}${voucher.zipCode ? `, ${String(voucher.zipCode).trim()}` : ''}`.trim(),
          vatableAmount: this.getReleasedVoucherAmountTotal(voucher),
          taxWithheld,
          voucherDate: String(voucher.voucherDate ?? voucher.releasedAt ?? '').trim(),
        };
      })
      .filter((row) => row.taxWithheld > 0);
  }

  private getTax2307RowsForGeneration(): Tax2307ReportRow[] {
    return this.getTax2307BaseRows().filter((row) => {
      if (!this.tax2307SupplierFilter) {
        return true;
      }
      return row.supplierName === this.tax2307SupplierFilter;
    });
  }

  private getTax2307SupplierSummaries(): Tax2307SupplierSummary[] {
    const rows = this.getTax2307RowsForGeneration();
    const grouped = new Map<string, Tax2307SupplierSummary>();

    for (const row of rows) {
      const key = `${row.supplierName}::${row.tin}`;
      const existing = grouped.get(key) ?? {
        tin: row.tin,
        supplierName: row.supplierName,
        supplierAddress: row.supplierAddress,
        references: [],
        vatableAmount: 0,
        taxWithheld: 0,
      };

      existing.references.push(row.referenceNo);
      existing.vatableAmount += row.vatableAmount;
      existing.taxWithheld += row.taxWithheld;
      if (!existing.supplierAddress && row.supplierAddress) {
        existing.supplierAddress = row.supplierAddress;
      }

      grouped.set(key, existing);
    }

    return [...grouped.values()].sort((a, b) => a.supplierName.localeCompare(b.supplierName));
  }

  private createSupplierSummaryFromRows(rows: Tax2307ReportRow[], selector: { supplierName: string; tin: string }): Tax2307SupplierSummary | null {
    const filteredRows = rows.filter((row) => row.supplierName === selector.supplierName && row.tin === selector.tin);
    if (filteredRows.length === 0) {
      return null;
    }

    return {
      tin: selector.tin,
      supplierName: selector.supplierName,
      supplierAddress: filteredRows.find((row) => row.supplierAddress)?.supplierAddress ?? '',
      references: filteredRows.map((row) => row.referenceNo),
      vatableAmount: filteredRows.reduce((sum, row) => sum + row.vatableAmount, 0),
      taxWithheld: filteredRows.reduce((sum, row) => sum + row.taxWithheld, 0),
    };
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

  private canAccessReportAction(permissionKeys: string[]): boolean {
    const acceptedKeys = permissionKeys ?? [];
    if (acceptedKeys.length === 0) {
      return true;
    }

    const isDenied = acceptedKeys.some((permissionKey) => this.rbacService.hasDeniedPermissionKey(permissionKey));
    if (isDenied) {
      return false;
    }

    const hasAnyAllowedRules = this.rbacService.hasAnyEffectivePermissionWithPrefix(this.reportActionPermissionPrefix);
    const hasAnyDeniedRules = this.rbacService.hasAnyDeniedPermissionWithPrefix(this.reportActionPermissionPrefix);

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
          fileName: `cheque_voucher_${this.chequeVoucherForm.cvNo || 'live'}.xlsx`,
          sheetName: 'Cheque Voucher',
          title: 'Cheque Voucher',
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
          subtitle: `For the Month of ${this.tax2307MonthLabel}`,
          headers: ['Reference No. (CV No.)', 'TIN', 'Supplier Name', 'Vatable Amount', 'Tax Withheld'],
          rows: this.withholdingTaxRows.map((row) => [
            row.referenceNo,
            row.tin,
            row.supplierName,
            row.vatableAmount,
            row.taxWithheld,
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

  private printTax2307Report(): void {
    const printWindow = window.open('', '', 'height=700,width=980');
    if (!printWindow) {
      this.reportError = 'Unable to open print window. Please allow popups and try again.';
      return;
    }

    const htmlContent = this.generateTax2307PrintHTML();
    printWindow.document.open();
    printWindow.document.write(htmlContent);
    printWindow.document.close();

    setTimeout(() => {
      printWindow.focus();
      printWindow.print();
    }, 250);

    printWindow.addEventListener('afterprint', () => {
      printWindow.close();
    }, { once: true });
  }

  private generateTax2307PrintHTML(): string {
    const rows = this.withholdingTaxRows;
    const logoSrc = `${window.location.origin}/images/air-summit-logo.png`;
    const tableRows = rows
      .map((row) => `
        <tr>
          <td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${row.referenceNo || '-'}</td>
          <td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${row.tin || '-'}</td>
          <td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${row.supplierName || '-'}</td>
          <td style="padding: 8px; border-bottom: 1px solid #e5e7eb; text-align: right;">${row.vatableAmount.toFixed(2)}</td>
          <td style="padding: 8px; border-bottom: 1px solid #e5e7eb; text-align: right;">${row.taxWithheld.toFixed(2)}</td>
        </tr>
      `)
      .join('');

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <title>2307 Tax Report</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 20px; color: #111827; }
          .top { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px; border-bottom: 1px solid #d1d5db; padding-bottom: 10px; }
          .logo { width: 140px; height: auto; object-fit: contain; }
          .contacts { color: #1f3f9a; font-size: 11px; line-height: 1.35; font-weight: 600; text-align: right; }
          .doc-title { text-align: right; margin: 8px 0 4px; font-size: 18px; font-weight: 700; color: #111827; }
          .doc-subtitle { text-align: right; margin: 0 0 18px; font-size: 12px; color: #4b5563; }
          table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 12px; }
          th { background-color: #f3f4f6; padding: 10px 8px; text-align: left; font-weight: 700; border-bottom: 2px solid #9ca3af; }
          .empty { padding: 18px; color: #6b7280; text-align: center; border-bottom: 1px solid #e5e7eb; }
          .right { text-align: right; }
          .grand-total td { font-weight: 700; background: #f9fafb; border-top: 2px solid #9ca3af; }
        </style>
      </head>
      <body>
        <div class="top">
          <div>
            <img src="${logoSrc}" class="logo" alt="Air Summit" />
          </div>
          <div class="contacts">
            <div>Contact Us: 0917-137-8744 / 0908-811-2850</div>
            <div>Email: airsummit2022@gmail.com</div>
            <div>Main Office: Lot 15, Blk 14, Bulaon Resettlement, City Of San Fernando Pampanga</div>
            <div>Warehouse: Tramo Mesulo, Arayat Pampanga</div>
          </div>
        </div>

        <div class="doc-title">2307 TAX REPORT</div>
        <div class="doc-subtitle">For the Month of ${this.tax2307MonthLabel}</div>

        <table>
          <thead>
            <tr>
              <th>Reference No. (CV No.)</th>
              <th>TIN</th>
              <th>Supplier Name</th>
              <th class="right">Vatable Amount</th>
              <th class="right">Tax Withheld</th>
            </tr>
          </thead>
          <tbody>
            ${rows.length > 0
              ? `${tableRows}
                <tr class="grand-total">
                  <td colspan="3" style="padding: 10px 8px;">Grand Total</td>
                  <td style="padding: 10px 8px; text-align: right;">${this.withholdingVatableTotal.toFixed(2)}</td>
                  <td style="padding: 10px 8px; text-align: right;">${this.withholdingTaxTotal.toFixed(2)}</td>
                </tr>`
              : '<tr><td colspan="5" class="empty">No 2307 tax lines for the selected date range.</td></tr>'}
          </tbody>
        </table>
      </body>
      </html>
    `;
  }

  private async generateTax2307FormsPdf(summaries: Tax2307SupplierSummary[], openInNewTab: boolean): Promise<void> {
    try {
      const { PDFDocument, rgb, StandardFonts } = await import('pdf-lib');
      const templateBytes = await fetch('/docs/2307Form.pdf').then(async (response) => {
        if (!response.ok) {
          throw new Error('Unable to load 2307 form template.');
        }
        return response.arrayBuffer();
      });

      const templateDoc = await PDFDocument.load(templateBytes);
      const outputDoc = await PDFDocument.create();
      const font = await outputDoc.embedFont(StandardFonts.Helvetica);
      const boldFont = await outputDoc.embedFont(StandardFonts.HelveticaBold);

      for (const summary of summaries) {
        const [page] = await outputDoc.copyPages(templateDoc, [0]);
        outputDoc.addPage(page);

        const width = page.getWidth();
        const height = page.getHeight();
        const yFromTop = (topOffset: number) => height - topOffset;

        const draw = (text: string, x: number, topOffset: number, options?: { size?: number; bold?: boolean }) => {
          page.drawText(String(text || ''), {
            x,
            y: yFromTop(topOffset),
            size: options?.size ?? 9,
            font: options?.bold ? boldFont : font,
            color: rgb(0, 0, 0),
          });
        };

        const fromDate = this.formatDateOnly(this.tax2307DateFrom || new Date().toISOString());
        const toDate = this.formatDateOnly(this.tax2307DateTo || new Date().toISOString());
        const formatForForm = (isoDate: string) => {
          const parsedDate = new Date(isoDate);
          if (Number.isNaN(parsedDate.getTime())) {
            return isoDate;
          }
          const month = String(parsedDate.getMonth() + 1).padStart(2, '0');
          const day = String(parsedDate.getDate()).padStart(2, '0');
          const year = String(parsedDate.getFullYear());
          return `${month}/${day}/${year}`;
        };

        draw(formatForForm(fromDate), width * 0.30, 112, { size: 10 });
        draw(formatForForm(toDate), width * 0.57, 112, { size: 10 });

        draw(summary.tin || '-', width * 0.31, 154, { size: 10 });
        draw(summary.supplierName || '-', width * 0.03, 192, { size: 9 });
        draw(summary.supplierAddress || '-', width * 0.03, 232, { size: 9 });

        draw('00000000000000', width * 0.31, 311, { size: 10 });
        draw('AIR SUMMIT HVAC AND REFRIGERATION SERVICES', width * 0.03, 350, { size: 9 });
        draw('TRAMO MESULO, ARAYAT, PAMPANGA', width * 0.03, 391, { size: 9 });

        draw('WC158', width * 0.30, 435, { size: 9 });
        draw(summary.vatableAmount.toFixed(2), width * 0.67, 435, { size: 9 });
        draw(summary.taxWithheld.toFixed(2), width * 0.83, 435, { size: 9, bold: true });

        const referencesText = `Ref: ${summary.references.filter(Boolean).join(', ')}`;
        draw(referencesText.slice(0, 120), width * 0.03, 543, { size: 8 });
      }

      const pdfBytes = await outputDoc.save();
      const blob = new Blob([pdfBytes.buffer as ArrayBuffer], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);

      if (openInNewTab) {
        window.open(url, '_blank');
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
        return;
      }

      const link = document.createElement('a');
      link.href = url;
      link.download = `2307-Tax-Forms-${this.tax2307MonthLabel.replace(/\s+/g, '-')}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('2307 form generation failed:', error);
      this.reportError = 'Failed to generate 2307 form PDF. Please try again.';
    }
  }

  printVoucher(): void {
    this.isPrintPreviewOpen = true;
  }

  closePrintPreview(): void {
    this.isPrintPreviewOpen = false;
  }

  executePrint(): void {
    const printWindow = window.open('', '', 'height=700,width=980');
    if (!printWindow || !this.viewingVoucher) {
      return;
    }

    const htmlContent = this.generatePrintHTML();
    printWindow.document.open();
    printWindow.document.write(htmlContent);
    printWindow.document.close();

    const triggerPrint = () => {
      printWindow.focus();
      printWindow.print();
    };

    setTimeout(triggerPrint, 250);

    printWindow.addEventListener('afterprint', () => {
      printWindow.close();
    }, { once: true });

    this.closePrintPreview();
  }

  private generatePrintHTML(): string {
    if (!this.viewingVoucher) {
      return '';
    }

    const v = this.viewingVoucher;
    const addressWithZip = `${v.address || 'N/A'}${v.zipCode ? `, ${v.zipCode}` : ''}`;
    const logoSrc = `${window.location.origin}/images/air-summit-logo.png`;
    const depositsHTML = v.deposits
      .map(
        (d) => `
      <tr>
        <td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${d.bankName}</td>
        <td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${d.chequeNo}</td>
        <td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${this.formatDateOnly(d.chequeDate)}</td>
        <td style="padding: 8px; border-bottom: 1px solid #e5e7eb; text-align: right;">${(Number(d.amount) || 0).toFixed(2)}</td>
      </tr>
    `
      )
      .join('');

    const invoicesHTML = v.invoices
      .map(
        (i) => `
      <tr>
        <td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${i.invoiceNo}</td>
        <td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${this.formatDateOnly(i.invoiceDate)}</td>
        <td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${i.description}</td>
        <td style="padding: 8px; border-bottom: 1px solid #e5e7eb; text-align: right;">${(Number(i.amount) || 0).toFixed(2)}</td>
      </tr>
    `
      )
      .join('');

    const accountTitlesHTML = v.accountTitles
      .map(
        (a) => `
      <tr>
        <td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${a.accountNumber}</td>
        <td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${a.description}</td>
        <td style="padding: 8px; border-bottom: 1px solid #e5e7eb; text-align: right;">${(Number(a.debit) || 0).toFixed(2)}</td>
        <td style="padding: 8px; border-bottom: 1px solid #e5e7eb; text-align: right;">${(Number(a.credit) || 0).toFixed(2)}</td>
      </tr>
    `
      )
      .join('');
    const accountTitleDebitTotal = this.getVoucherAccountTitleDebitTotal(v);
    const accountTitleCreditTotal = this.getVoucherAccountTitleCreditTotal(v);

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Cheque Voucher - ${v.cvNo}</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 20px; }
          .top { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px; border-bottom: 1px solid #d1d5db; padding-bottom: 10px; }
          .logo { width: 140px; height: auto; object-fit: contain; }
          .contacts { color: #1f3f9a; font-size: 11px; line-height: 1.35; font-weight: 600; text-align: right; }
          .doc-title { text-align: right; margin: 8px 0 18px; font-size: 16px; font-weight: 600; color: #111827; }
          .details-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 20px; font-size: 12px; }
          .detail-row { margin-bottom: 8px; }
          .detail-label { font-weight: bold; color: #333; }
          .detail-value { color: #666; margin-top: 2px; }
          table { width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 12px; }
          th { background-color: #f3f4f6; padding: 10px; text-align: left; font-weight: bold; border-bottom: 2px solid #333; }
          .footer { margin-top: 30px; border-top: 2px solid #000; padding-top: 15px; font-size: 11px; color: #666; }
          .table-title { font-weight: bold; font-size: 13px; margin-bottom: 10px; margin-top: 15px; }
        </style>
      </head>
      <body>
        <div class="top">
          <div>
            <img src="${logoSrc}" class="logo" alt="Air Summit" />
          </div>
          <div class="contacts">
            <div>Contact Us: 0917-137-8744 / 0908-811-2850</div>
            <div>Email: airsummit2022@gmail.com</div>
            <div>Main Office: Lot 15, Blk 14, Bulaon Resettlement, City Of San Fernando Pampanga</div>
            <div>Warehouse: Tramo Mesulo, Arayat Pampanga</div>
          </div>
        </div>
        <div class="doc-title">Cheque Voucher ${v.cvNo}</div>

        <div class="details-grid">
          <div>
            <div class="detail-row">
              <div class="detail-label">Payee:</div>
              <div class="detail-value">${v.payee}</div>
            </div>
            <div class="detail-row">
              <div class="detail-label">Address:</div>
              <div class="detail-value">${addressWithZip}</div>
            </div>
          </div>
          <div>
            <div class="detail-row">
              <div class="detail-label">Date:</div>
              <div class="detail-value">${this.formatDateOnly(v.voucherDate)}</div>
            </div>
            <div class="detail-row">
              <div class="detail-label">TIN:</div>
              <div class="detail-value">${v.tinNumber || 'N/A'}</div>
            </div>
          </div>
        </div>

        ${v.particulars ? `<div style="margin-bottom: 20px; font-size: 12px; border: 1px solid #e5e7eb; padding: 10px;"><strong>Particulars:</strong><br />${v.particulars.replace(/\n/g, '<br />')}</div>` : ''}

        ${v.deposits.length > 0 ? `
          <div class="table-title">Cheque Deposits</div>
          <table>
            <thead>
              <tr>
                <th>Bank Name</th>
                <th>Cheque No.</th>
                <th>Cheque Date</th>
                <th style="text-align: right;">Amount</th>
              </tr>
            </thead>
            <tbody>
              ${depositsHTML}
            </tbody>
          </table>
        ` : ''}

        ${v.invoices.length > 0 ? `
          <div class="table-title">Invoices</div>
          <table>
            <thead>
              <tr>
                <th>Invoice No.</th>
                <th>Invoice Date</th>
                <th>Description</th>
                <th style="text-align: right;">Amount</th>
              </tr>
            </thead>
            <tbody>
              ${invoicesHTML}
            </tbody>
          </table>
        ` : ''}

        ${v.accountTitles.length > 0 ? `
          <div class="table-title">Account Titles</div>
          <table>
            <thead>
              <tr>
                <th>Account No.</th>
                <th>Description</th>
                <th style="text-align: right;">Debit</th>
                <th style="text-align: right;">Credit</th>
              </tr>
            </thead>
            <tbody>
              ${accountTitlesHTML}
              <tr style="font-weight: 700; background-color: #f9fafb;">
                <td colspan="2" style="padding: 8px; border-top: 2px solid #9ca3af;">Total</td>
                <td style="padding: 8px; border-top: 2px solid #9ca3af; text-align: right;">${accountTitleDebitTotal.toFixed(2)}</td>
                <td style="padding: 8px; border-top: 2px solid #9ca3af; text-align: right;">${accountTitleCreditTotal.toFixed(2)}</td>
              </tr>
            </tbody>
          </table>
        ` : ''}

        <div class="footer">
          <p>Released on: ${this.formatDateOnly(v.releasedAt)}</p>
          <p>Prepared by: ${v.preparedBy || 'N/A'}</p>
        </div>
      </body>
      </html>
    `;
  }

  async exportVoucherPDF(): Promise<void> {
    if (!this.viewingVoucher) {
      return;
    }

    try {
      const { PDFDocument, rgb } = await import('pdf-lib');
      const pdfDoc = await PDFDocument.create();
      const page = pdfDoc.addPage([612, 792]);

      const v = this.viewingVoucher;
      let yPosition = 750;
      const lineHeight = 15;
      const fontSize = 10;

      // Header
      page.drawText('CHEQUE VOUCHER', {
        x: 250,
        y: yPosition,
        size: 18,
        color: rgb(0, 0, 0),
      });
      yPosition -= 20;
      page.drawText(v.cvNo, {
        x: 270,
        y: yPosition,
        size: 12,
        color: rgb(100, 100, 100),
      });
      yPosition -= 30;

      // Details
      const details = [
        { label: 'Voucher Date:', value: this.formatDateOnly(v.voucherDate) },
        { label: 'Payee:', value: v.payee },
        { label: 'TIN Number:', value: v.tinNumber || 'N/A' },
        { label: 'Address:', value: `${v.address || 'N/A'}${v.zipCode ? `, ${v.zipCode}` : ''}` },
      ];

      for (const detail of details) {
        page.drawText(detail.label, {
          x: 50,
          y: yPosition,
          size: fontSize,
          color: rgb(0, 0, 0),
        });
        page.drawText(detail.value, {
          x: 150,
          y: yPosition,
          size: fontSize,
          color: rgb(50, 50, 50),
        });
        yPosition -= lineHeight;
      }

      yPosition -= 10;

      // Particulars
      if (v.particulars) {
        page.drawText('Particulars:', {
          x: 50,
          y: yPosition,
          size: fontSize + 1,
          color: rgb(0, 0, 0),
        });
        yPosition -= lineHeight;
        const particulars = v.particulars.substring(0, 100);
        page.drawText(particulars, {
          x: 50,
          y: yPosition,
          size: fontSize,
          color: rgb(50, 50, 50),
        });
        yPosition -= lineHeight * 2;
      }

      // Deposits summary
      if (v.deposits.length > 0) {
        const depositTotal = v.deposits.reduce((sum, d) => sum + (Number(d.amount) || 0), 0);
        page.drawText(`Deposits Total: ${depositTotal.toFixed(2)}`, {
          x: 50,
          y: yPosition,
          size: fontSize,
          color: rgb(0, 0, 0),
        });
        yPosition -= lineHeight;
      }

      // Invoices summary
      if (v.invoices.length > 0) {
        const invoiceTotal = v.invoices.reduce((sum, i) => sum + (Number(i.amount) || 0), 0);
        page.drawText(`Invoices Total: ${invoiceTotal.toFixed(2)}`, {
          x: 50,
          y: yPosition,
          size: fontSize,
          color: rgb(0, 0, 0),
        });
        yPosition -= lineHeight;
      }

      // Account titles summary
      if (v.accountTitles.length > 0) {
        const debitTotal = v.accountTitles.reduce((sum, a) => sum + (Number(a.debit) || 0), 0);
        const creditTotal = v.accountTitles.reduce((sum, a) => sum + (Number(a.credit) || 0), 0);
        page.drawText(`Debits: ${debitTotal.toFixed(2)} | Credits: ${creditTotal.toFixed(2)}`, {
          x: 50,
          y: yPosition,
          size: fontSize,
          color: rgb(0, 0, 0),
        });
        yPosition -= lineHeight;
      }

      // Footer
      page.drawText(`Released: ${this.formatDateOnly(v.releasedAt)} | Prepared by: ${v.preparedBy || 'N/A'}`, {
        x: 50,
        y: 20,
        size: 9,
        color: rgb(100, 100, 100),
      });

      const pdfBytes = await pdfDoc.save();
      const blob = new Blob([pdfBytes.buffer as ArrayBuffer], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `CV-${v.cvNo}-${new Date().getTime()}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('PDF export failed:', error);
      this.reportError = 'Failed to export PDF. Please try again.';
    }
  }
}
