import { Component, HostListener, OnInit } from '@angular/core';
import { DecimalPipe, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { apiClient } from '../../../shared/services/api-client';
import { RbacService } from '../../../shared/services/rbac.service';
import {
  DashboardActivityItem,
  DashboardKpiCard,
  DashboardMarginItem,
  DashboardOperationDetailMode,
  DashboardOpsItem,
  DashboardReceivableVerificationMode,
  DashboardSalesDetailMode,
  DashboardSettlementMode,
  DashboardService,
} from '../../../shared/services/dashboard.service';

@Component({
  selector: 'app-ecommerce',
  imports: [DecimalPipe, DatePipe, FormsModule],
  templateUrl: './ecommerce.component.html',
})
export class EcommerceComponent implements OnInit {
  isLoadingDashboard = false;
  dashboardError = '';
  todayFocus = '-';
  lastUpdatedLabel = '—';

  topKpis: DashboardKpiCard[] = [
    { label: 'In-Stock Units', value: '0', change: '0%', trend: 'up' },
    { label: 'Open Purchase Orders', value: '0', change: '0%', trend: 'up' },
    { label: 'Dispatch Today', value: '0', change: '0%', trend: 'up' },
    { label: 'Install Queue', value: '0', change: '0%', trend: 'down' },
  ];

  operations: DashboardOpsItem[] = [
    { label: 'Receiving Today', value: '-', hint: '-', level: 'normal' },
    { label: 'For Dispatch', value: '-', hint: '-', level: 'warning' },
    { label: 'For Installation', value: '-', hint: '-', level: 'warning' },
    { label: 'Stock Alerts', value: '-', hint: '-', level: 'critical' },
  ];

  salesSummary: DashboardKpiCard[] = [
    { label: 'Collected Sales', value: '0', change: '0%', trend: 'up' },
    { label: 'Unpaid S.O.', value: '0', change: '0%', trend: 'down' },
    { label: 'Overdues', value: '0', change: '0%', trend: 'down' },
    { label: 'Cheques', value: '0', change: '0%', trend: 'up' },
  ];

  topCustomers = [
    { name: '-', orders: 0, balance: 'PHP 0' },
    { name: '-', orders: 0, balance: 'PHP 0' },
    { name: '-', orders: 0, balance: 'PHP 0' },
  ];

  topCapacities = [
    { label: '-', units: 0, sellThrough: 0 },
    { label: '-', units: 0, sellThrough: 0 },
    { label: '-', units: 0, sellThrough: 0 },
    { label: '-', units: 0, sellThrough: 0 },
  ];

  marginByBrand: DashboardMarginItem[] = [
    { label: '-', margin: 0 },
    { label: '-', margin: 0 },
    { label: '-', margin: 0 },
    { label: '-', margin: 0 },
  ];

  marginByVendor: DashboardMarginItem[] = [
    { label: '-', margin: 0 },
    { label: '-', margin: 0 },
    { label: '-', margin: 0 },
    { label: '-', margin: 0 },
  ];

  activityFeed: DashboardActivityItem[] = [
    { time: '--:--', text: '-', status: 'received' },
    { time: '--:--', text: '-', status: 'dispatch' },
    { time: '--:--', text: '-', status: 'install' },
    { time: '--:--', text: '-', status: 'payment' },
  ];

  // Sales Summary Modal
  expandedSalesSummaryMode: DashboardSalesDetailMode | null = null;
  salesSummaryDetailItems: Array<{ id?: string | number; [key: string]: unknown }> = [];
  salesSummaryLoading = false;
  salesSummaryPage = 1;
  salesSummaryPageSize = 15;
  salesSummaryTotal = 0;
  salesSummaryDateFrom = '';
  salesSummaryDateTo = '';
  salesSummaryReceivableStatus: 'pending' | 'verified' | 'all' = 'pending';
  salesSummaryReceivableAmount = 0;
  salesSummaryReceivedAmount = 0;
  salesSummaryOverallAmount = 0;
  verifyingReceivableId: string | null = null;
  adjustingReceivableId: string | null = null;
  adjustmentTarget: {
    paymentId: string;
    soNumber: string;
    customer: string;
    method: DashboardReceivableVerificationMode;
    methodLabel: string;
    amount: string;
    referenceNo: string;
  } | null = null;
  adjustmentRemarks = '';
  adjustmentPassword = '';
  adjustmentAuthUsername = '';
  adjustmentError = '';
  settlementBusy = false;
  settlementError = '';
  settlementTarget: {
    salesOrderId: number;
    soNumber: string;
    customer: string;
    balance: number;
  } | null = null;
  settlementMode: DashboardSettlementMode = 'partial';
  settlementAmount = '';
  splitBankAmount = '';
  splitChequeAmount = '';
  settlementBankName = '';
  settlementCheckNo = '';
  settlementPostDated = '';

  // Operations Control Modal
  expandedOperationMode: DashboardOperationDetailMode | null = null;
  operationDetailItems: Array<{ id?: string | number; [key: string]: unknown }> = [];
  operationDetailLoading = false;

  private readonly operationModes: DashboardOperationDetailMode[] = [
    'receiving',
    'dispatch',
    'installation',
    'stock-alerts',
  ];

  // Feedback
  feedbackSummary: { total: number; avgRating: number; recommendPercent: number } | null = null;
  feedbackItems: Array<{ id: number; rating: number; wouldRecommend: boolean; insights: string | null; name: string | null; createdAt: string }> = [];
  feedbackLoading = false;

  constructor(
    private readonly dashboardService: DashboardService,
    private readonly rbacService: RbacService,
  ) {}

  ngOnInit(): void {
    void this.loadDashboardOverview();
    void this.loadFeedback();
  }

  async loadFeedback(): Promise<void> {
    this.feedbackLoading = true;
    try {
      const [summaryRes, listRes] = await Promise.all([
        apiClient.get<{ success: boolean; data: { total: number; avgRating: number; recommendPercent: number } }>('/public/feedback/summary'),
        apiClient.get<{ success: boolean; items: Array<{ id: number; rating: number; wouldRecommend: boolean; insights: string | null; name: string | null; createdAt: string }> }>('/public/feedback/list'),
      ]);
      if (summaryRes.data.success) this.feedbackSummary = summaryRes.data.data;
      if (listRes.data.success) this.feedbackItems = listRes.data.items ?? [];
    } catch {}
    finally { this.feedbackLoading = false; }
  }

  getFeedbackStars(rating: number): string[] {
    return [1,2,3,4,5].map(s => s <= rating ? '★' : '☆');
  }

  async loadDashboardOverview(): Promise<void> {
    this.isLoadingDashboard = true;
    this.dashboardError = '';

    try {
      const payload = await this.dashboardService.getOverview();
      this.topKpis = Array.isArray(payload.topKpis) && payload.topKpis.length > 0 ? payload.topKpis : this.topKpis;
      this.operations = Array.isArray(payload.operations) && payload.operations.length > 0 ? payload.operations : this.operations;
      this.salesSummary = Array.isArray(payload.salesSummary) && payload.salesSummary.length > 0 ? payload.salesSummary : this.salesSummary;
      this.topCustomers = Array.isArray(payload.topCustomers) && payload.topCustomers.length > 0 ? payload.topCustomers : this.topCustomers;
      this.topCapacities = Array.isArray(payload.topCapacities) && payload.topCapacities.length > 0 ? payload.topCapacities : this.topCapacities;
      this.marginByBrand = Array.isArray(payload.marginByBrand) && payload.marginByBrand.length > 0 ? payload.marginByBrand : this.marginByBrand;
      this.marginByVendor = Array.isArray(payload.marginByVendor) && payload.marginByVendor.length > 0 ? payload.marginByVendor : this.marginByVendor;
      this.activityFeed = Array.isArray(payload.activityFeed) && payload.activityFeed.length > 0 ? payload.activityFeed : this.activityFeed;
      this.todayFocus = String(payload.todayFocus ?? '').trim() || this.todayFocus;
      this.lastUpdatedLabel = this.formatDateTime(payload.generatedAt);
    } catch (error: unknown) {
      this.dashboardError =
        error instanceof Error ? error.message : 'Unable to load dashboard overview';
      this.lastUpdatedLabel = this.formatDateTime(new Date().toISOString());
    } finally {
      this.isLoadingDashboard = false;
    }
  }

  refreshDashboard(): void {
    void this.loadDashboardOverview();
  }

  getOperationMode(index: number): DashboardOperationDetailMode {
    return this.operationModes[index] ?? 'receiving';
  }

  getTrendClass(trend: 'up' | 'down'): string {
    return trend === 'up'
      ? 'bg-success-50 text-success-700 dark:bg-success-500/15 dark:text-success-400'
      : 'bg-error-50 text-error-700 dark:bg-error-500/15 dark:text-error-400';
  }

  getOpsLevelClass(level: DashboardOpsItem['level']): string {
    if (level === 'critical') {
      return 'border-error-200 bg-error-50/60 dark:border-error-500/30 dark:bg-error-500/10';
    }

    if (level === 'warning') {
      return 'border-warning-200 bg-warning-50/60 dark:border-warning-500/30 dark:bg-warning-500/10';
    }

    return 'border-gray-200 bg-white dark:border-gray-700 dark:bg-white/[0.03]';
  }

  getActivityDotClass(status: DashboardActivityItem['status']): string {
    if (status === 'dispatch') {
      return 'bg-brand-500';
    }

    if (status === 'install') {
      return 'bg-warning-500';
    }

    if (status === 'payment') {
      return 'bg-success-500';
    }

    return 'bg-gray-500';
  }

  // Sales Summary Modal Methods
  openSalesSummaryDetail(mode: DashboardSalesDetailMode): void {
    this.closeOperationDetail();
    this.closeSettlementModal();
    this.expandedSalesSummaryMode = mode;
    this.salesSummaryPage = 1;
    this.salesSummaryDateFrom = '';
    this.salesSummaryDateTo = '';
    this.salesSummaryReceivableStatus = 'pending';
    this.salesSummaryLoading = true;
    void this.fetchSalesSummaryDetail(mode);
  }

  closeSalesSummaryDetail(): void {
    this.expandedSalesSummaryMode = null;
    this.salesSummaryDetailItems = [];
    this.salesSummaryLoading = false;
    this.salesSummaryPage = 1;
    this.salesSummaryTotal = 0;
    this.salesSummaryDateFrom = '';
    this.salesSummaryDateTo = '';
    this.salesSummaryReceivableStatus = 'pending';
    this.salesSummaryReceivableAmount = 0;
    this.salesSummaryReceivedAmount = 0;
    this.salesSummaryOverallAmount = 0;
    this.closeAdjustmentModal();
    this.closeSettlementModal();
  }

  get salesSummaryTotalPages(): number {
    return Math.max(1, Math.ceil(this.salesSummaryTotal / this.salesSummaryPageSize));
  }

  get salesSummaryRangeStart(): number {
    if (this.salesSummaryTotal <= 0) {
      return 0;
    }
    return (this.salesSummaryPage - 1) * this.salesSummaryPageSize + 1;
  }

  get salesSummaryRangeEnd(): number {
    return Math.min(this.salesSummaryPage * this.salesSummaryPageSize, this.salesSummaryTotal);
  }

  onSalesSummaryDateFilterChange(): void {
    this.salesSummaryPage = 1;
    void this.reloadSalesSummaryDetail();
  }

  clearSalesSummaryDateFilter(): void {
    if (!this.salesSummaryDateFrom && !this.salesSummaryDateTo) {
      return;
    }
    this.salesSummaryDateFrom = '';
    this.salesSummaryDateTo = '';
    this.salesSummaryPage = 1;
    void this.reloadSalesSummaryDetail();
  }

  onSalesSummaryReceivableStatusChange(): void {
    this.salesSummaryPage = 1;
    void this.reloadSalesSummaryDetail();
  }

  goToSalesSummaryPage(page: number): void {
    const nextPage = Math.min(this.salesSummaryTotalPages, Math.max(1, Math.floor(page)));
    if (nextPage === this.salesSummaryPage) {
      return;
    }
    this.salesSummaryPage = nextPage;
    void this.reloadSalesSummaryDetail();
  }

  private reloadSalesSummaryDetail(): void {
    if (!this.expandedSalesSummaryMode) {
      return;
    }
    this.salesSummaryLoading = true;
    void this.fetchSalesSummaryDetail(this.expandedSalesSummaryMode);
  }

  openOperationDetail(mode: DashboardOperationDetailMode): void {
    this.closeSalesSummaryDetail();
    this.expandedOperationMode = mode;
    this.operationDetailLoading = true;
    void this.fetchOperationDetail(mode);
  }

  closeOperationDetail(): void {
    this.expandedOperationMode = null;
    this.operationDetailItems = [];
    this.operationDetailLoading = false;
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.adjustmentTarget) {
      this.closeAdjustmentModal();
      return;
    }

    if (this.expandedSalesSummaryMode) {
      this.closeSalesSummaryDetail();
      return;
    }

    if (this.expandedOperationMode) {
      this.closeOperationDetail();
    }
  }

  trackSalesSummaryDetailRow(index: number, item: { id?: string | number; [key: string]: unknown }): string | number {
    return item['id'] ?? index;
  }

  trackOperationDetailRow(index: number, item: { id?: string | number; [key: string]: unknown }): string | number {
    return item['id'] ?? index;
  }

  formatCurrencyValue(value: unknown): string {
    const amount = Number(value);
    if (!Number.isFinite(amount)) {
      return 'PHP 0';
    }

    return `PHP ${amount.toLocaleString('en-PH', { maximumFractionDigits: 0 })}`;
  }

  formatDateValue(value: unknown): string {
    if (!value) {
      return '-';
    }

    const parsed = new Date(String(value));
    if (Number.isNaN(parsed.getTime())) {
      return String(value);
    }

    return parsed.toLocaleDateString('en-PH', {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
    });
  }

  formatDueCountdown(value: unknown, mode: 'unpaid' | 'overdues'): string {
    if (value == null || value === '') {
      return '-';
    }

    const days = Number(value);
    if (!Number.isFinite(days)) {
      return '-';
    }

    if (mode === 'overdues') {
      const overdueDays = Math.max(Math.abs(days), 1);
      return overdueDays === 1 ? '1 day overdue' : `${overdueDays} days overdue`;
    }

    if (days === 0) {
      return 'Due today';
    }

    return days === 1 ? '1 day remaining' : `${days} days remaining`;
  }

  getDueCountdownClass(value: unknown): string {
    const baseClass = 'px-4 py-3 text-sm font-semibold';

    if (value == null || value === '') {
      return `${baseClass} text-gray-500 dark:text-gray-400`;
    }

    const days = Number(value);
    if (!Number.isFinite(days)) {
      return `${baseClass} text-gray-500 dark:text-gray-400`;
    }

    if (days < 0) {
      return `${baseClass} text-error-600 dark:text-error-400`;
    }

    if (days === 0 || days <= 7) {
      return `${baseClass} text-warning-600 dark:text-warning-400`;
    }

    return `${baseClass} text-success-600 dark:text-success-400`;
  }

  formatTextValue(value: unknown, fallback = '-'): string {
    const text = String(value ?? '').trim();
    return text.length > 0 ? text : fallback;
  }

  getSalesStatusClass(status: unknown): string {
    const normalized = String(status ?? '').trim().toLowerCase();

    if (['paid', 'posted', 'cleared', 'approved', 'delivered', 'released', 'remitted', 'verified'].includes(normalized)) {
      return 'bg-success-50 text-success-700 dark:bg-success-500/15 dark:text-success-400';
    }

    if (['pending', 'partial', 'in-progress'].includes(normalized)) {
      return 'bg-warning-50 text-warning-700 dark:bg-warning-500/15 dark:text-warning-400';
    }

    if (['overdue', 'bounced', 'cancelled', 'rejected'].includes(normalized)) {
      return 'bg-error-50 text-error-700 dark:bg-error-500/15 dark:text-error-400';
    }

    return 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300';
  }

  getOperationStatusClass(status: unknown): string {
    return this.getSalesStatusClass(status);
  }

  getSettlementActionClass(mode: DashboardSettlementMode): string {
    return this.settlementMode === mode
      ? 'border-brand-500 bg-brand-50 text-brand-700 dark:border-brand-400 dark:bg-brand-500/15 dark:text-brand-300'
      : 'border-gray-200 bg-white text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300';
  }

  private formatDateTime(value: unknown): string {
    const parsed = new Date(String(value ?? ''));
    if (Number.isNaN(parsed.getTime())) {
      return '—';
    }

    return parsed.toLocaleString('en-PH', {
      month: 'short',
      day: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  getOperationModalTitle(): string {
    if (this.expandedOperationMode === 'receiving') {
      return 'Receiving Today';
    }

    if (this.expandedOperationMode === 'dispatch') {
      return 'For Dispatch';
    }

    if (this.expandedOperationMode === 'installation') {
      return 'For Installation';
    }

    if (this.expandedOperationMode === 'stock-alerts') {
      return 'Stock Alerts';
    }

    return 'Operations Detail';
  }

  openSettlementModal(item: { [key: string]: unknown }): void {
    const salesOrderId = Number(item['soId']);
    const balance = Number(item['balance']);
    if (!Number.isFinite(salesOrderId) || salesOrderId <= 0 || !Number.isFinite(balance) || balance <= 0) {
      return;
    }

    this.settlementTarget = {
      salesOrderId,
      soNumber: this.formatTextValue(item['soNumber']),
      customer: this.formatTextValue(item['customer']),
      balance,
    };
    this.settlementError = '';
    this.setSettlementMode('partial');
  }

  closeSettlementModal(): void {
    this.settlementTarget = null;
    this.settlementMode = 'partial';
    this.settlementAmount = '';
    this.splitBankAmount = '';
    this.splitChequeAmount = '';
    this.settlementBankName = '';
    this.settlementCheckNo = '';
    this.settlementPostDated = '';
    this.settlementError = '';
    this.settlementBusy = false;
  }

  setSettlementMode(mode: DashboardSettlementMode): void {
    this.settlementMode = mode;
    this.settlementError = '';
    const balance = this.settlementTarget?.balance ?? 0;
    if (mode === 'full' || mode === 'cheque') {
      this.settlementAmount = balance > 0 ? String(balance) : '';
      this.splitBankAmount = '';
      this.splitChequeAmount = '';
      return;
    }

    if (mode === 'split') {
      this.settlementAmount = '';
      this.splitBankAmount = '';
      this.splitChequeAmount = balance > 0 ? String(balance) : '';
      return;
    }

    this.settlementAmount = '';
    this.splitBankAmount = '';
    this.splitChequeAmount = '';
  }

  updateSplitBankAmount(value: string): void {
    this.splitBankAmount = value;
    this.settlementError = '';
    const balance = this.settlementTarget?.balance ?? 0;
    const bankAmount = Math.max(Number(value), 0);
    if (!Number.isFinite(bankAmount)) {
      this.splitChequeAmount = '';
      return;
    }

    const chequeAmount = Math.max(balance - bankAmount, 0);
    this.splitChequeAmount = chequeAmount > 0 ? String(Number(chequeAmount.toFixed(2))) : '0';
  }

  async submitSettlement(): Promise<void> {
    if (!this.settlementTarget || this.settlementBusy) {
      return;
    }

    const amount = Number(this.settlementAmount);
    if (this.settlementMode === 'partial' && (!Number.isFinite(amount) || amount <= 0)) {
      this.settlementError = 'Enter a valid partial amount.';
      return;
    }

    const splitBankAmount = Number(this.splitBankAmount);
    const splitChequeAmount = Number(this.splitChequeAmount);
    if (
      this.settlementMode === 'split'
      && (
        !Number.isFinite(splitBankAmount)
        || !Number.isFinite(splitChequeAmount)
        || splitBankAmount <= 0
        || splitChequeAmount <= 0
      )
    ) {
      this.settlementError = 'Enter valid bank and cheque amounts for split settlement.';
      return;
    }

    this.settlementBusy = true;
    this.settlementError = '';

    try {
      await this.dashboardService.settleSalesOrder({
        salesOrderId: this.settlementTarget.salesOrderId,
        mode: this.settlementMode,
        amount: this.settlementMode === 'partial' ? amount : undefined,
        bankAmount: this.settlementMode === 'split' ? splitBankAmount : undefined,
        chequeAmount: this.settlementMode === 'split' ? splitChequeAmount : undefined,
        bankName: ['cheque', 'split'].includes(this.settlementMode) ? this.settlementBankName.trim() || null : undefined,
        checkNo: ['cheque', 'split'].includes(this.settlementMode) ? this.settlementCheckNo.trim() || null : undefined,
        postDated: ['cheque', 'split'].includes(this.settlementMode) ? this.settlementPostDated || null : undefined,
      });

      const currentMode = this.expandedSalesSummaryMode;
      this.closeSettlementModal();
      await this.loadDashboardOverview();
      if (currentMode) {
        this.salesSummaryLoading = true;
        await this.fetchSalesSummaryDetail(currentMode);
      }
    } catch (error: unknown) {
      this.settlementError = error instanceof Error ? error.message : 'Unable to record settlement.';
    } finally {
      this.settlementBusy = false;
    }
  }

  async verifyReceivable(item: { [key: string]: unknown }, force: boolean = false): Promise<void> {
    if (!force && !this.canVerifyReceivable(item)) {
      return;
    }

    const paymentId = String(item['paymentId'] ?? '').trim();
    if (!paymentId || this.verifyingReceivableId === paymentId) {
      return;
    }

    const methodText = String(item['method'] ?? '').trim().toLowerCase();
    const method: DashboardReceivableVerificationMode =
      methodText === 'credit card'
        ? 'credit-card'
        : methodText === 'bank transfer'
          ? 'bank-transfer'
          : 'cheque';
    this.verifyingReceivableId = paymentId;

    try {
      await this.dashboardService.verifyReceivable({ paymentId: paymentId as unknown as number, method });
      const currentMode = this.expandedSalesSummaryMode;
      await this.loadDashboardOverview();
      if (currentMode) {
        this.salesSummaryLoading = true;
        await this.fetchSalesSummaryDetail(currentMode);
      }
    } catch (error) {
      console.error('Failed to verify receivable:', error);
    } finally {
      this.verifyingReceivableId = null;
    }
  }

  get requiresAdminCredentialsForAdjustment(): boolean {
    const roleName = String(this.rbacService.getPayload()?.roleName ?? '')
      .trim()
      .toLowerCase();
    return (
      !roleName.includes('admin') &&
      !roleName.includes('super') &&
      !roleName.includes('owner')
    );
  }

  openAdjustmentModal(item: { [key: string]: unknown }): void {
    if (!this.isReceivableAlreadyVerified(item) || this.adjustingReceivableId) {
      return;
    }

    const paymentId = String(item['paymentId'] ?? '').trim();
    if (!paymentId) {
      return;
    }

    const methodText = String(item['method'] ?? '').trim().toLowerCase();
    const method: DashboardReceivableVerificationMode =
      methodText === 'credit card'
        ? 'credit-card'
        : methodText === 'bank transfer'
          ? 'bank-transfer'
          : 'cheque';

    this.adjustmentTarget = {
      paymentId,
      soNumber: this.formatTextValue(item['soNumber']),
      customer: this.formatTextValue(item['customer']),
      method,
      methodLabel: this.formatTextValue(item['method']),
      amount: this.formatCurrencyValue(item['amount']),
      referenceNo: this.formatTextValue(item['referenceNo']),
    };
    this.adjustmentRemarks = '';
    this.adjustmentPassword = '';
    this.adjustmentAuthUsername = '';
    this.adjustmentError = '';
  }

  closeAdjustmentModal(): void {
    if (this.adjustingReceivableId) {
      return;
    }

    this.adjustmentTarget = null;
    this.adjustmentRemarks = '';
    this.adjustmentPassword = '';
    this.adjustmentAuthUsername = '';
    this.adjustmentError = '';
  }

  async confirmAdjustment(): Promise<void> {
    const target = this.adjustmentTarget;
    if (!target || this.adjustingReceivableId) {
      return;
    }

    const remarks = this.adjustmentRemarks.trim();
    const password = this.adjustmentPassword.trim();
    const authUsername = this.adjustmentAuthUsername.trim();

    if (remarks.length < 5) {
      this.adjustmentError = 'Please enter remarks explaining why this payment should be adjusted.';
      return;
    }

    if (this.requiresAdminCredentialsForAdjustment) {
      if (!authUsername || !password) {
        this.adjustmentError = 'Admin username and password are required to authorize this adjustment.';
        return;
      }
    } else if (!password) {
      this.adjustmentError = 'Your password is required to adjust this receivable.';
      return;
    }

    this.adjustmentError = '';
    this.adjustingReceivableId = target.paymentId;

    try {
      await this.dashboardService.adjustReceivable({
        paymentId: target.paymentId as unknown as number,
        method: target.method,
        password,
        remarks,
        ...(this.requiresAdminCredentialsForAdjustment ? { authUsername } : {}),
      });

      this.adjustingReceivableId = null;
      this.closeAdjustmentModal();

      const currentMode = this.expandedSalesSummaryMode;
      await this.loadDashboardOverview();
      if (currentMode) {
        this.salesSummaryLoading = true;
        await this.fetchSalesSummaryDetail(currentMode);
      }
    } catch (error: unknown) {
      this.adjustmentError = error instanceof Error ? error.message : 'Unable to adjust receivable.';
      this.adjustingReceivableId = null;
    }
  }

  canVerifyReceivable(item: { [key: string]: unknown }): boolean {
    if (this.isReceivableAlreadyVerified(item)) {
      return false;
    }

    const methodText = String(item['method'] ?? '').trim().toLowerCase();
    if (methodText !== 'cheque') {
      return true;
    }

    const rawPostDated = item['postDated'];
    if (!rawPostDated) {
      return true;
    }

    // Parse as local date to avoid UTC midnight shifting the date back by 1 day
    const rawStr = String(rawPostDated);
    const dateOnly = rawStr.slice(0, 10); // "YYYY-MM-DD"
    const [year, month, day] = dateOnly.split('-').map(Number);
    if (!year || !month || !day) {
      return true;
    }

    const postDatedLocal = new Date(year, month - 1, day);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return postDatedLocal <= today;
  }

  isReceivableAlreadyVerified(item: { [key: string]: unknown }): boolean {
    const status = String(item['status'] ?? '').trim().toLowerCase();
    return ['verified', 'paid', 'posted', 'cleared', 'complete', 'completed', 'remitted'].includes(status);
  }

  getReceivableVerifyLabel(item: { [key: string]: unknown }): string {
    if (this.isReceivableAlreadyVerified(item)) {
      return 'Verified';
    }

    if (this.canVerifyReceivable(item)) {
      const paymentId = String(item['paymentId'] ?? '').trim();
      return this.verifyingReceivableId !== null && this.verifyingReceivableId === paymentId ? 'Verifying…' : 'Verify';
    }

    return 'Waiting for date';
  }

  async fetchSalesSummaryDetail(mode: DashboardSalesDetailMode): Promise<void> {
    try {
      const result = await this.dashboardService.getSalesDetail(mode, {
        page: this.salesSummaryPage,
        pageSize: this.salesSummaryPageSize,
        dateFrom: this.salesSummaryDateFrom || undefined,
        dateTo: this.salesSummaryDateTo || undefined,
        status: mode === 'cheques' ? this.salesSummaryReceivableStatus : undefined,
      });
      const lastPage = Math.max(1, Math.ceil((result.total || 0) / (result.pageSize || this.salesSummaryPageSize)));
      if (result.items.length === 0 && result.total > 0 && this.salesSummaryPage > lastPage) {
        this.salesSummaryPage = lastPage;
        await this.fetchSalesSummaryDetail(mode);
        return;
      }
      this.salesSummaryDetailItems = result.items;
      this.salesSummaryTotal = result.total;
      this.salesSummaryPage = result.page;
      this.salesSummaryPageSize = result.pageSize;
      this.salesSummaryReceivableAmount = result.receivableAmount ?? 0;
      this.salesSummaryReceivedAmount = result.receivedAmount ?? 0;
      this.salesSummaryOverallAmount = result.overallAmount ?? 0;
    } catch (error: unknown) {
      console.error('Failed to fetch sales detail:', error);
      this.salesSummaryDetailItems = [];
      this.salesSummaryTotal = 0;
      this.salesSummaryReceivableAmount = 0;
      this.salesSummaryReceivedAmount = 0;
      this.salesSummaryOverallAmount = 0;
    } finally {
      this.salesSummaryLoading = false;
    }
  }

  async fetchOperationDetail(mode: DashboardOperationDetailMode): Promise<void> {
    try {
      const items = await this.dashboardService.getOperationsDetail(mode);
      this.operationDetailItems = items;
    } catch (error: unknown) {
      console.error('Failed to fetch operations detail:', error);
      this.operationDetailItems = [];
    } finally {
      this.operationDetailLoading = false;
    }
  }
}
