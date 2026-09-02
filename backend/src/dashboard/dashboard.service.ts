import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import { DatabaseService } from 'src/database/database.service';
import { PoolClient } from 'pg';
import { AuditActorContext, AuditLogService } from 'src/audit-log/audit-log.service';

type Trend = 'up' | 'down';

type KpiCard = {
  label: string;
  value: string;
  change: string;
  trend: Trend;
};

type OpsLevel = 'normal' | 'warning' | 'critical';

type OpsItem = {
  label: string;
  value: string;
  hint: string;
  level: OpsLevel;
};

type MarginItem = {
  label: string;
  margin: number;
};

type ActivityItem = {
  time: string;
  text: string;
  status: 'received' | 'dispatch' | 'install' | 'payment';
};

type DashboardResponse = {
  success: boolean;
  message?: string;
  item?: {
    generatedAt: string;
    topKpis: KpiCard[];
    operations: OpsItem[];
    salesSummary: KpiCard[];
    topCustomers: Array<{ name: string; orders: number; balance: string }>;
    topCapacities: Array<{ label: string; units: number; sellThrough: number }>;
    marginByBrand: MarginItem[];
    marginByVendor: MarginItem[];
    activityFeed: ActivityItem[];
    todayFocus: string;
  };
};

type CountRow = { count: string };
type SalesRow = { todaySales: string; yesterdaySales: string; mtdSales: string; prevMtdSales: string };
type GrossMarginRow = { marginPercent: string };
type ReceivableRow = { amount: string };
type TopCustomerRow = { name: string; orders: string; balance: string };
type TopCapacityRow = { label: string; units: string; sellThrough: string };
type MarginRow = { label: string; margin: string };
type ActivityRow = { eventAt: string | null; text: string; status: 'received' | 'dispatch' | 'install' | 'payment' };
type SalesFinancialSummaryRow = {
  settledAmount: string;
  settledCount: string;
  unpaidAmount: string;
  unpaidCount: string;
  overdueAmount: string;
  overdueCount: string;
  chequeAmount: string;
  chequeCount: string;
};
type DashboardSalesDetailMode = 'sales' | 'unpaid' | 'overdues' | 'cheques';
type DashboardOperationDetailMode = 'receiving' | 'dispatch' | 'installation' | 'stock-alerts';
type DashboardSettlementMode = 'partial' | 'full' | 'cheque' | 'split';
type DashboardReceivableVerificationMode = 'bank-transfer' | 'cheque' | 'credit-card';
type DashboardSalesDetailQuery = {
  page?: number;
  pageSize?: number;
  dateFrom?: string | null;
  dateTo?: string | null;
  status?: string | null;
};
type SalesSettlementStateRow = {
  soId: string;
  totalAmount: string;
  paidAmount: string;
  remainingAmount: string;
  outstandingReceivableAmount: string;
  normalizedStatus: string;
  branchId: string | null;
};

@Injectable()
export class DashboardService {
  private readonly receivableVerificationMethodsSql = `'bank-transfer', 'cheque', 'credit-card'`;

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly auditLogService: AuditLogService,
  ) {}

  private async getSalesSettlementAuditSnapshot(
    salesOrderId: number,
    branchId?: number,
  ): Promise<Record<string, unknown> | null> {
    const branchParam = branchId ? String(branchId) : null;
    const result = await this.databaseService.query<SalesSettlementStateRow>(
      `${this.getSalesDashboardBaseCte()}
       SELECT
         ss.so_id::text AS "soId",
         ss.total_amount::text AS "totalAmount",
         ss.paid_amount::text AS "paidAmount",
         ss.remaining_amount::text AS "remainingAmount",
         ss.outstanding_receivable_amount::text AS "outstandingReceivableAmount",
         ss.normalized_status::text AS "normalizedStatus",
         NULLIF(ss.branch_id, '')::text AS "branchId"
       FROM sales_scope ss
       WHERE ss.so_id = $1::text
         AND ($2::text IS NULL OR ss.branch_id = $2::text)
       LIMIT 1`,
      [String(salesOrderId), branchParam],
    );

    if (result.rowCount === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      salesOrderId: Number(row.soId),
      totalAmount: this.toNumber(row.totalAmount),
      paidAmount: this.toNumber(row.paidAmount),
      remainingAmount: this.toNumber(row.remainingAmount),
      outstandingReceivableAmount: this.toNumber(row.outstandingReceivableAmount),
      normalizedStatus: row.normalizedStatus,
      branchId: row.branchId ? Number(row.branchId) : null,
    };
  }

  private toNumber(value: unknown): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private formatInteger(value: number): string {
    return Math.round(value).toLocaleString('en-PH');
  }

  private formatCurrency(value: number): string {
    return `PHP ${value.toLocaleString('en-PH', { maximumFractionDigits: 0 })}`;
  }

  private formatReceivableMethod(normalized: string): string {
    if (normalized === 'bank-transfer') {
      return 'Bank Transfer';
    }
    if (normalized === 'credit-card') {
      return 'Credit Card';
    }
    return 'Cheque';
  }

  private formatReceivableStatus(normalized: string): string {
    const status = String(normalized ?? '').trim().toLowerCase();
    if (['paid', 'posted', 'cleared', 'complete', 'completed', 'remitted'].includes(status)) {
      return 'verified';
    }
    return status || 'unpaid';
  }

  private isAdminRole(roleName: unknown): boolean {
    const normalized = String(roleName ?? '').trim().toLowerCase();
    return normalized.includes('admin') || normalized.includes('super') || normalized.includes('owner');
  }

  private async assertAdminPasswordForAdjustment(options: {
    userId?: number | null;
    username?: string | null;
    roleName?: string | null;
    password?: string;
    authUsername?: string;
  }): Promise<string> {
    const password = String(options.password ?? '').trim();
    if (!password) {
      throw new BadRequestException('Admin password is required to adjust this receivable');
    }

    const passwordSha1 = createHash('sha1').update(password).digest('hex');
    const isAdmin = this.isAdminRole(options.roleName);

    if (isAdmin) {
      const userId = Number(options.userId);
      if (!Number.isFinite(userId) || userId <= 0) {
        throw new BadRequestException('Invalid current user');
      }

      const adminCheck = await this.databaseService.query<{ id: number }>(
        `SELECT u.id
         FROM tblusers u
         WHERE u.id = $1
           AND u.password = $2
         LIMIT 1`,
        [userId, passwordSha1],
      );

      if (adminCheck.rowCount === 0) {
        throw new BadRequestException('Incorrect admin password. Please try again.');
      }

      return String(options.username ?? options.roleName ?? 'admin').trim() || 'admin';
    }

    const authUsername = String(options.authUsername ?? '').trim();
    if (!authUsername) {
      throw new BadRequestException('Admin username is required to authorize this adjustment');
    }

    const adminCheck = await this.databaseService.query<{ id: number; username: string }>(
      `SELECT
         u.id,
         COALESCE(to_jsonb(u)->>'username', '') AS username
       FROM tblusers u
       LEFT JOIN tblrbac r
         ON r.id::text = COALESCE(
           to_jsonb(u)->>'roleId',
           to_jsonb(u)->>'roleid',
           to_jsonb(u)->>'role_id'
         )
       WHERE LOWER(TRIM(COALESCE(to_jsonb(u)->>'username', ''))) = LOWER(TRIM($1))
         AND u.password = $2
         AND (
           LOWER(COALESCE(to_jsonb(r)->>'roleName', to_jsonb(r)->>'rolename', '')) LIKE '%admin%'
           OR LOWER(COALESCE(to_jsonb(r)->>'roleName', to_jsonb(r)->>'rolename', '')) LIKE '%super%'
           OR LOWER(COALESCE(to_jsonb(r)->>'roleName', to_jsonb(r)->>'rolename', '')) LIKE '%owner%'
         )
       LIMIT 1`,
      [authUsername, passwordSha1],
    );

    if (adminCheck.rowCount === 0) {
      throw new BadRequestException('Invalid admin credentials. Authorization denied.');
    }

    return authUsername;
  }

  private parseDateOnly(value?: string | null): string | null {
    const text = String(value ?? '').trim().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
      return null;
    }

    const parsed = new Date(`${text}T00:00:00`);
    return Number.isNaN(parsed.getTime()) ? null : text;
  }

  private normalizeSalesDetailQuery(query?: DashboardSalesDetailQuery): {
    page: number;
    pageSize: number;
    offset: number;
    dateFrom: string | null;
    dateTo: string | null;
    status: 'pending' | 'verified' | 'all';
  } {
    const page = Math.max(1, Math.floor(Number(query?.page) || 1));
    const pageSize = Math.min(50, Math.max(1, Math.floor(Number(query?.pageSize) || 15)));
    let dateFrom = this.parseDateOnly(query?.dateFrom);
    let dateTo = this.parseDateOnly(query?.dateTo);
    if (dateFrom && dateTo && dateFrom > dateTo) {
      [dateFrom, dateTo] = [dateTo, dateFrom];
    }

    const normalizedStatus = String(query?.status ?? '').trim().toLowerCase();
    const status: 'pending' | 'verified' | 'all' =
      normalizedStatus === 'verified' || normalizedStatus === 'all'
        ? normalizedStatus
        : 'pending';

    return {
      page,
      pageSize,
      offset: (page - 1) * pageSize,
      dateFrom,
      dateTo,
      status,
    };
  }

  private formatPercent(value: number): string {
    return `${value.toFixed(1)}%`;
  }

  private buildDelta(current: number, previous: number): { change: string; trend: Trend } {
    const safePrevious = previous === 0 ? current || 1 : previous;
    const diff = ((current - safePrevious) / safePrevious) * 100;
    const trend: Trend = diff >= 0 ? 'up' : 'down';
    const sign = diff >= 0 ? '+' : '';
    return {
      change: `${sign}${diff.toFixed(1)}%`,
      trend,
    };
  }

  private normalizeStatus(value: unknown): string {
    return String(value ?? '')
      .trim()
      .toLowerCase()
      .replace(/[\s_]+/g, '-');
  }

  private formatActivityTime(value: string | null): string {
    if (!value) {
      return '--:--';
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return '--:--';
    }

    const hours = String(parsed.getHours()).padStart(2, '0');
    const minutes = String(parsed.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
  }

  private async getTableColumns(client: PoolClient, tableName: string): Promise<string[]> {
    const result = await client.query<{ column_name: string }>(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = $1`,
      [tableName],
    );

    return result.rows.map((row) => row.column_name);
  }

  private pickColumn(columns: string[], candidates: string[]): string | null {
    for (const candidate of candidates) {
      if (columns.includes(candidate)) {
        return candidate;
      }
    }

    return null;
  }

  private toIsoDateOrNull(value: unknown): string | null {
    const raw = String(value ?? '').trim();
    if (!raw) {
      return null;
    }

    const date = new Date(raw);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  private async loadSalesSettlementState(
    client: PoolClient,
    salesOrderId: number,
    branchId?: number,
  ): Promise<SalesSettlementStateRow> {
    const branchParam = branchId ? String(branchId) : null;
    const result = await client.query<SalesSettlementStateRow>(
      `${this.getSalesDashboardBaseCte()}
       SELECT
         ss.so_id::text AS "soId",
         ss.total_amount::text AS "totalAmount",
         ss.paid_amount::text AS "paidAmount",
         ss.remaining_amount::text AS "remainingAmount",
         ss.outstanding_receivable_amount::text AS "outstandingReceivableAmount",
         ss.normalized_status::text AS "normalizedStatus",
         NULLIF(ss.branch_id, '')::text AS "branchId"
       FROM sales_scope ss
       WHERE ss.so_id = $1::text
         AND ($2::text IS NULL OR ss.branch_id = $2::text)
       LIMIT 1`,
      [String(salesOrderId), branchParam],
    );

    if (result.rowCount === 0) {
      throw new NotFoundException('Sales order not found for settlement');
    }

    return result.rows[0];
  }

  private async insertSalesPaymentRecord(
    client: PoolClient,
    salesOrderId: number,
    payload: {
      method: string;
      amount: number;
      status: string;
      paymentDate?: string | null;
      referenceNo?: string | null;
      checkNo?: string | null;
      bankName?: string | null;
      bankAccount?: string | null;
      postDated?: string | null;
      termsDueDate?: string | null;
    },
  ): Promise<void> {
    const paymentColumns = await this.getTableColumns(client, 'tblso_payments');
    const soIdColumn = this.pickColumn(paymentColumns, ['so_id', 'soId']);
    const methodColumn = this.pickColumn(paymentColumns, ['method']);
    const amountColumn = this.pickColumn(paymentColumns, ['amount']);
    const statusColumn = this.pickColumn(paymentColumns, ['status']);
    const paymentDateColumn = this.pickColumn(paymentColumns, ['payment_date', 'paymentDate']);
    const referenceNoColumn = this.pickColumn(paymentColumns, ['reference_no', 'referenceNo']);
    const checkNoColumn = this.pickColumn(paymentColumns, ['check_no', 'checkNo']);
    const bankNameColumn = this.pickColumn(paymentColumns, ['bank_name', 'bankName']);
    const bankAccountColumn = this.pickColumn(paymentColumns, ['bank_account', 'bankAccount']);
    const postDatedColumn = this.pickColumn(paymentColumns, ['post_dated', 'postDated']);
    const termsDueDateColumn = this.pickColumn(paymentColumns, ['terms_due_date', 'termsDueDate']);

    if (!soIdColumn || !methodColumn || !amountColumn || !statusColumn) {
      throw new BadRequestException('Sales payment columns are not configured as expected');
    }

    const record: Record<string, unknown> = {
      [soIdColumn]: salesOrderId,
      [methodColumn]: payload.method,
      [amountColumn]: payload.amount,
      [statusColumn]: payload.status,
    };

    if (paymentDateColumn) record[paymentDateColumn] = payload.paymentDate ?? null;
    if (referenceNoColumn && payload.referenceNo !== undefined) record[referenceNoColumn] = payload.referenceNo;
    if (checkNoColumn && payload.checkNo !== undefined) record[checkNoColumn] = payload.checkNo;
    if (bankNameColumn && payload.bankName !== undefined) record[bankNameColumn] = payload.bankName;
    if (bankAccountColumn && payload.bankAccount !== undefined) record[bankAccountColumn] = payload.bankAccount;
    if (postDatedColumn && payload.postDated !== undefined) record[postDatedColumn] = payload.postDated;
    if (termsDueDateColumn && payload.termsDueDate !== undefined) record[termsDueDateColumn] = payload.termsDueDate;

    const columns = Object.keys(record);
    const values = Object.values(record);
    const placeholders = values.map((_, index) => `$${index + 1}`);

    await client.query(
      `INSERT INTO tblso_payments (${columns.map((column) => `"${column}"`).join(', ')})
       VALUES (${placeholders.join(', ')})`,
      values,
    );
  }

  private async updateSalesOrderStatusForSettlement(
    client: PoolClient,
    salesOrderId: number,
    branchId?: number,
    options?: { allowReopenComplete?: boolean },
  ): Promise<void> {
    const state = await this.loadSalesSettlementState(client, salesOrderId, branchId);
    const currentStatus = this.normalizeStatus(state.normalizedStatus);
    if (['cancelled', 'rejected', 'void'].includes(currentStatus)) {
      return;
    }
    if (!options?.allowReopenComplete && ['complete', 'completed'].includes(currentStatus)) {
      return;
    }

    const paidAmount = this.toNumber(state.paidAmount);
    const remainingAmount = this.toNumber(state.remainingAmount);
    const outstandingReceivableAmount = this.toNumber(state.outstandingReceivableAmount);
    const totalAmount = this.toNumber(state.totalAmount);
    let nextStatus = currentStatus || 'pending';

    if (Math.max(totalAmount - paidAmount, 0) <= 0 && outstandingReceivableAmount <= 0) {
      nextStatus = 'complete';
    } else if (remainingAmount <= 0 && outstandingReceivableAmount > 0) {
      nextStatus = 'remitted';
    } else if (paidAmount > 0 || outstandingReceivableAmount > 0 || remainingAmount < totalAmount) {
      nextStatus = 'partial';
    }

    if (nextStatus === currentStatus) {
      return;
    }

    const salesOrderColumns = await this.getTableColumns(client, 'tblsales_order');
    const statusColumn = this.pickColumn(salesOrderColumns, ['status']);
    if (!statusColumn) {
      throw new BadRequestException('Sales order status column is not configured as expected');
    }

    await client.query(
      `UPDATE tblsales_order
       SET "${statusColumn}" = $1
       WHERE id = $2`,
      [nextStatus, salesOrderId],
    );
  }

  private getSalesDashboardBaseCte(): string {
    return `WITH payment_scope AS (
      SELECT
        COALESCE(to_jsonb(sp)->>'so_id', to_jsonb(sp)->>'soId') AS so_id,
        CASE
          WHEN COALESCE(to_jsonb(sp)->>'amount', '0') ~ '^-?\\d+(\\.\\d+)?$'
            THEN COALESCE(to_jsonb(sp)->>'amount', '0')::numeric
          ELSE 0
        END AS amount,
        REPLACE(REPLACE(LOWER(TRIM(COALESCE(to_jsonb(sp)->>'method', ''))), '_', '-'), ' ', '-') AS normalized_method,
        REPLACE(REPLACE(LOWER(TRIM(COALESCE(to_jsonb(sp)->>'status', ''))), '_', '-'), ' ', '-') AS normalized_status,
        CASE
          WHEN REPLACE(REPLACE(LOWER(TRIM(COALESCE(to_jsonb(sp)->>'method', ''))), '_', '-'), ' ', '-') = 'cheque'
            THEN COALESCE(
              NULLIF(to_jsonb(sp)->>'post_dated', ''),
              NULLIF(to_jsonb(sp)->>'postDated', '')
            )::timestamptz
          ELSE COALESCE(
            NULLIF(to_jsonb(sp)->>'terms_due_date', ''),
            NULLIF(to_jsonb(sp)->>'termsDueDate', '')
          )::timestamptz
        END AS due_date
      FROM tblso_payments sp
    ),
    payment_totals AS (
      SELECT
        ps.so_id,
        COALESCE(SUM(ps.amount) FILTER (
          WHERE COALESCE(NULLIF(ps.normalized_status, ''), 'unpaid') IN ('paid', 'posted', 'cleared', 'complete', 'completed', 'remitted')
        ), 0) AS paid_amount,
        COALESCE(SUM(ps.amount) FILTER (
          WHERE ps.normalized_method IN (${this.receivableVerificationMethodsSql})
            AND COALESCE(NULLIF(ps.normalized_status, ''), 'unpaid') NOT IN ('paid', 'posted', 'cleared', 'complete', 'completed', 'remitted')
        ), 0) AS outstanding_receivable_amount,
        COUNT(*) FILTER (
          WHERE ps.normalized_method IN (${this.receivableVerificationMethodsSql})
            AND ps.amount > 0
            AND COALESCE(NULLIF(ps.normalized_status, ''), 'unpaid') NOT IN ('paid', 'posted', 'cleared', 'complete', 'completed', 'remitted')
        )::int AS outstanding_receivable_count,
        MIN(ps.due_date) FILTER (
          WHERE COALESCE(NULLIF(ps.normalized_status, ''), 'unpaid') NOT IN ('paid', 'posted', 'cleared', 'complete', 'completed', 'remitted')
            AND ps.due_date IS NOT NULL
        ) AS next_due_date,
        COALESCE(
          STRING_AGG(
            DISTINCT ps.normalized_method,
            ', ' ORDER BY ps.normalized_method
          ),
          'Unknown'
        ) AS payment_methods,
        COALESCE(
          STRING_AGG(
            DISTINCT CASE
              WHEN ps.normalized_method = 'terms-with-dp' THEN 'Terms with DP'
              WHEN ps.normalized_method = 'installment' THEN 'Installment'
              WHEN ps.normalized_method = 'terms' THEN 'Terms'
              ELSE NULL
            END,
            ', '
          ) FILTER (
            WHERE ps.normalized_method IN ('terms', 'terms-with-dp', 'installment')
          ),
          '-'
        ) AS credit_terms_methods,
        COALESCE(
          STRING_AGG(
            DISTINCT CASE
              WHEN ps.normalized_method = 'bank-transfer' THEN 'Bank Transfer'
              WHEN ps.normalized_method = 'credit-card' THEN 'Credit Card'
              WHEN ps.normalized_method = 'cheque' THEN 'Cheque'
              ELSE NULL
            END,
            ', '
          ) FILTER (
            WHERE ps.normalized_method IN (${this.receivableVerificationMethodsSql})
              AND COALESCE(NULLIF(ps.normalized_status, ''), 'unpaid') NOT IN ('paid', 'posted', 'cleared', 'complete', 'completed', 'remitted')
          ),
          'Unknown'
        ) AS outstanding_payment_methods
      FROM payment_scope ps
      WHERE COALESCE(ps.so_id, '') <> ''
      GROUP BY ps.so_id
    ),
    sales_scope AS (
      SELECT
        so.id::text AS so_id,
        COALESCE(to_jsonb(so)->>'so_number', to_jsonb(so)->>'soNumber', CONCAT('#', so.id::text)) AS so_number,
        COALESCE(to_jsonb(c)->>'name', 'Unknown Customer') AS customer,
        CASE
          WHEN COALESCE(to_jsonb(so)->>'total_amount', to_jsonb(so)->>'totalAmount', '0') ~ '^-?\\d+(\\.\\d+)?$'
            THEN COALESCE(to_jsonb(so)->>'total_amount', to_jsonb(so)->>'totalAmount', '0')::numeric
          ELSE 0
        END AS total_amount,
        REPLACE(REPLACE(LOWER(TRIM(COALESCE(to_jsonb(so)->>'status', COALESCE(so.status, 'pending')))), '_', '-'), ' ', '-') AS normalized_status,
        COALESCE(NULLIF(to_jsonb(so)->>'created_at', ''), NULLIF(to_jsonb(so)->>'createdAt', ''))::timestamptz AS created_at,
        COALESCE(
          COALESCE(NULLIF(to_jsonb(so)->>'due_date', ''), NULLIF(to_jsonb(so)->>'dueDate', ''))::timestamptz,
          pt.next_due_date
        ) AS due_date,
        COALESCE(to_jsonb(so)->>'branchId', to_jsonb(so)->>'branch_id', '') AS branch_id,
        COALESCE(pt.paid_amount, 0) AS paid_amount,
        GREATEST(
          CASE
            WHEN COALESCE(to_jsonb(so)->>'total_amount', to_jsonb(so)->>'totalAmount', '0') ~ '^-?\\d+(\\.\\d+)?$'
              THEN COALESCE(to_jsonb(so)->>'total_amount', to_jsonb(so)->>'totalAmount', '0')::numeric
            ELSE 0
          END - COALESCE(pt.paid_amount, 0) - COALESCE(pt.outstanding_receivable_amount, 0),
          0
        ) AS remaining_amount,
        COALESCE(pt.outstanding_receivable_amount, 0) AS outstanding_receivable_amount,
        COALESCE(pt.outstanding_receivable_count, 0) AS outstanding_receivable_count,
        COALESCE(pt.payment_methods, 'Unknown') AS payment_methods,
        COALESCE(pt.credit_terms_methods, '-') AS credit_terms_methods,
        COALESCE(pt.outstanding_payment_methods, 'Unknown') AS outstanding_payment_methods,
        REPLACE(REPLACE(LOWER(TRIM(COALESCE(
          to_jsonb(so)->>'salesType',
          to_jsonb(so)->>'sales_type',
          ''
        ))), '_', '-'), ' ', '-') AS sales_type
      FROM tblsales_order so
      LEFT JOIN tblcustomer c
        ON c.id::text = COALESCE(to_jsonb(so)->>'customer_id', to_jsonb(so)->>'customerId', '')
      LEFT JOIN payment_totals pt
        ON pt.so_id = so.id::text
    )`;
  }

  private getSettledSalesPredicate(alias: string): string {
    return `(
      ${alias}.normalized_status IN ('complete', 'completed')
      OR (
        GREATEST(${alias}.total_amount - ${alias}.paid_amount, 0) <= 0
        AND ${alias}.normalized_status IN ('approved', 'released', 'delivered', 'partial', 'paid', 'remitted', 'complete', 'completed')
      )
    )`;
  }

  private getRecordedSalesAmountExpression(alias: string): string {
    return `(
      CASE
        WHEN ${alias}.paid_amount > 0 THEN ${alias}.paid_amount
        WHEN ${alias}.remaining_amount <= 0
          AND COALESCE(${alias}.outstanding_receivable_amount, 0) <= 0
          AND ${alias}.normalized_status IN ('paid', 'remitted', 'complete', 'completed')
          THEN ${alias}.total_amount
        ELSE 0
      END
    )`;
  }

  private getRecordedSalesPredicate(alias: string): string {
    // Bank Transfer, Cheque, and Credit Card stay out of Collected Sales until dashboard Verify.
    // Project SOs are SOA/Billing/Settlement based — never count as Collected Sales
    return `(
      ${this.getRecordedSalesAmountExpression(alias)} > 0
      AND ${alias}.normalized_status IN ('remitted', 'complete', 'completed')
      AND COALESCE(${alias}.sales_type, '') <> 'project'
      AND NOT EXISTS (
        SELECT 1 FROM payment_scope ps
        WHERE ps.so_id = ${alias}.so_id
          AND ps.normalized_method IN (${this.receivableVerificationMethodsSql})
          AND COALESCE(NULLIF(ps.normalized_status, ''), 'unpaid') NOT IN ('paid', 'posted', 'cleared', 'complete', 'completed', 'remitted')
      )
    )`;
  }

  private getOpenBalancePredicate(alias: string): string {
    return `(
      ${alias}.remaining_amount > 0
      AND ${alias}.normalized_status IN ('remitted', 'complete', 'completed')
      AND COALESCE(${alias}.credit_terms_methods, '-') <> '-'
    )`;
  }

  private getOverdueDueDatePredicate(alias: string): string {
    return `${alias}.due_date IS NOT NULL AND (${alias}.due_date AT TIME ZONE 'UTC')::date < CURRENT_DATE`;
  }

  private getUnpaidBalancePredicate(alias: string): string {
    return `${this.getOpenBalancePredicate(alias)} AND NOT (${this.getOverdueDueDatePredicate(alias)})`;
  }

  private getOverdueBalancePredicate(alias: string): string {
    return `${this.getOpenBalancePredicate(alias)} AND ${this.getOverdueDueDatePredicate(alias)}`;
  }

  async getOverview(branchId?: number): Promise<DashboardResponse> {
    try {
      const branchParam = branchId ? String(branchId) : null;

      const inStockCountResult = await this.databaseService.query<CountRow>(
        `WITH serial_scope AS (
           SELECT
             COALESCE(to_jsonb(sn)->>'serialNumber', to_jsonb(sn)->>'serial_number', '') AS serial_number,
             REPLACE(REPLACE(LOWER(TRIM(COALESCE(to_jsonb(sn)->>'status', ''))), '_', '-'), ' ', '-') AS normalized_status,
             COALESCE(to_jsonb(sn)->>'branchId', to_jsonb(sn)->>'branch_id', to_jsonb(sn)->>'branchid', '') AS branch_id
           FROM tblserial_numbers sn
         )
         SELECT COUNT(*)::text AS count
         FROM serial_scope ss
         WHERE ss.serial_number <> ''
           AND ss.normalized_status NOT IN (
             'scanned', 'reserved', 'delivered', 'installed', 'sold', 'released', 'out', 'outbound', 'defective'
           )
           AND ($1::text IS NULL OR ss.branch_id = $1::text)`,
        [branchParam],
      );

      const openPoCountResult = await this.databaseService.query<CountRow>(
        `SELECT COUNT(*)::text AS count
         FROM tblpurchase_orders po
         WHERE REPLACE(REPLACE(LOWER(TRIM(COALESCE(to_jsonb(po)->>'status', 'pending'))), '_', '-'), ' ', '-') NOT IN (
           'approved', 'completed', 'cancelled', 'rejected'
         )`,
      );

      const dispatchCountResult = await this.databaseService.query<CountRow>(
        `WITH sales_scope AS (
           SELECT
             REPLACE(REPLACE(LOWER(TRIM(COALESCE(to_jsonb(so)->>'status', 'pending'))), '_', '-'), ' ', '-') AS normalized_status,
             COALESCE(to_jsonb(so)->>'branchId', to_jsonb(so)->>'branch_id', '') AS branch_id
           FROM tblsales_order so
         )
         SELECT COUNT(*)::text AS count
         FROM sales_scope ss
         WHERE ss.normalized_status IN ('pending', 'for-delivery', 'to-remit', 'released', 'in-progress')
           AND ($1::text IS NULL OR ss.branch_id = $1::text)`,
        [branchParam],
      );

      const installQueueCountResult = await this.databaseService.query<CountRow>(
        `WITH sales_scope AS (
           SELECT
             REPLACE(REPLACE(LOWER(TRIM(COALESCE(to_jsonb(so)->>'status', 'pending'))), '_', '-'), ' ', '-') AS normalized_status,
             COALESCE(to_jsonb(so)->>'branchId', to_jsonb(so)->>'branch_id', '') AS branch_id
           FROM tblsales_order so
         )
         SELECT COUNT(*)::text AS count
         FROM sales_scope ss
         WHERE ss.normalized_status LIKE '%install%'
           AND ss.normalized_status NOT IN ('installed', 'completed', 'cancelled')
           AND ($1::text IS NULL OR ss.branch_id = $1::text)`,
        [branchParam],
      );

      const stockAlertsResult = await this.databaseService.query<CountRow>(
        `WITH serial_scope AS (
           SELECT
             COALESCE(to_jsonb(sn)->>'productId', to_jsonb(sn)->>'product_id', '') AS product_id,
             COALESCE(to_jsonb(sn)->>'capacityId', to_jsonb(sn)->>'capacity_id', '') AS capacity_id,
             REPLACE(REPLACE(LOWER(TRIM(COALESCE(to_jsonb(sn)->>'status', ''))), '_', '-'), ' ', '-') AS normalized_status,
             COALESCE(to_jsonb(sn)->>'branchId', to_jsonb(sn)->>'branch_id', '') AS branch_id
           FROM tblserial_numbers sn
         ),
         grouped AS (
           SELECT
             product_id,
             capacity_id,
             COUNT(*) FILTER (
               WHERE normalized_status NOT IN (
                 'scanned', 'reserved', 'delivered', 'installed', 'sold', 'released', 'out', 'outbound', 'defective'
               )
             )::int AS in_stock
           FROM serial_scope
           WHERE product_id <> ''
             AND capacity_id <> ''
             AND ($1::text IS NULL OR branch_id = $1::text)
           GROUP BY product_id, capacity_id
         )
         SELECT COUNT(*)::text AS count
         FROM grouped
         WHERE in_stock <= 5`,
        [branchParam],
      );

      const receivingTodayResult = await this.databaseService.query<CountRow>(
        `SELECT COUNT(*)::text AS count
         FROM tblpurchase_orders po
         WHERE (COALESCE(NULLIF(to_jsonb(po)->>'created_at', ''), NULLIF(to_jsonb(po)->>'createdAt', ''))::timestamptz AT TIME ZONE 'UTC')::date = CURRENT_DATE`,
      );

      const scannedTodayResult = await this.databaseService.query<CountRow>(
        `WITH serial_scope AS (
           SELECT
             COALESCE(to_jsonb(sn)->>'purchaseId', to_jsonb(sn)->>'purchase_id', to_jsonb(sn)->>'po_id', '') AS purchase_id,
             COALESCE(to_jsonb(sn)->>'branchId', to_jsonb(sn)->>'branch_id', '') AS branch_id,
             COALESCE(NULLIF(to_jsonb(sn)->>'created_at', ''), NULLIF(to_jsonb(sn)->>'createdAt', '')) AS created_at
           FROM tblserial_numbers sn
         )
         SELECT COUNT(*)::text AS count
         FROM serial_scope ss
         WHERE ss.purchase_id <> ''
           AND ($1::text IS NULL OR ss.branch_id = $1::text)
           AND (ss.created_at::timestamptz AT TIME ZONE 'UTC')::date = CURRENT_DATE`,
        [branchParam],
      );

      const recordedSalesPredicate = this.getRecordedSalesPredicate('ss');
      const recordedSalesAmountExpression = this.getRecordedSalesAmountExpression('ss');
      const unpaidBalancePredicate = this.getUnpaidBalancePredicate('ss');
      const overdueBalancePredicate = this.getOverdueBalancePredicate('ss');

      const salesSummaryResult = await this.databaseService.query<SalesFinancialSummaryRow>(
        `${this.getSalesDashboardBaseCte()}
         SELECT
           COALESCE(SUM(${recordedSalesAmountExpression}) FILTER (WHERE ${recordedSalesPredicate}), 0)::text AS "settledAmount",
           COUNT(*) FILTER (WHERE ${recordedSalesPredicate})::text AS "settledCount",
           COALESCE(SUM(ss.remaining_amount) FILTER (WHERE ${unpaidBalancePredicate}), 0)::text AS "unpaidAmount",
           COUNT(*) FILTER (WHERE ${unpaidBalancePredicate})::text AS "unpaidCount",
           COALESCE(SUM(ss.remaining_amount) FILTER (WHERE ${overdueBalancePredicate}), 0)::text AS "overdueAmount",
           COUNT(*) FILTER (WHERE ${overdueBalancePredicate})::text AS "overdueCount",
           COALESCE(SUM(ss.outstanding_receivable_amount) FILTER (WHERE ss.normalized_status IN ('remitted', 'complete', 'completed')), 0)::text AS "chequeAmount",
           COALESCE(SUM(ss.outstanding_receivable_count) FILTER (WHERE ss.normalized_status IN ('remitted', 'complete', 'completed')), 0)::text AS "chequeCount"
         FROM sales_scope ss
         WHERE ($1::text IS NULL OR ss.branch_id = $1::text)`,
        [branchParam],
      );

      const grossMarginResult = await this.databaseService.query<GrossMarginRow>(
        `WITH item_scope AS (
           SELECT
             CASE
               WHEN COALESCE(to_jsonb(tpi)->>'unitPrice', to_jsonb(tpi)->>'unit_price', '0') ~ '^-?\\d+(\\.\\d+)?$'
                 THEN COALESCE(to_jsonb(tpi)->>'unitPrice', to_jsonb(tpi)->>'unit_price', '0')::numeric
               ELSE 0
             END AS unit_price,
             CASE
               WHEN COALESCE(to_jsonb(tpi)->>'sellPrice', to_jsonb(tpi)->>'sell_price', '0') ~ '^-?\\d+(\\.\\d+)?$'
                 THEN COALESCE(to_jsonb(tpi)->>'sellPrice', to_jsonb(tpi)->>'sell_price', '0')::numeric
               ELSE 0
             END AS sell_price,
             CASE
               WHEN COALESCE(to_jsonb(tpi)->>'discountPrice', to_jsonb(tpi)->>'discount_price', '0') ~ '^-?\\d+(\\.\\d+)?$'
                 THEN COALESCE(to_jsonb(tpi)->>'discountPrice', to_jsonb(tpi)->>'discount_price', '0')::numeric
               ELSE 0
             END AS discount_price,
             CASE
               WHEN COALESCE(to_jsonb(tpi)->>'totalSetQty', to_jsonb(tpi)->>'total_set_qty', '0') ~ '^-?\\d+(\\.\\d+)?$'
                 THEN COALESCE(to_jsonb(tpi)->>'totalSetQty', to_jsonb(tpi)->>'total_set_qty', '0')::numeric
               ELSE 0
             END AS qty,
             LOWER(COALESCE(to_jsonb(tpi)->>'transType', to_jsonb(tpi)->>'trans_type', 'sales')) AS trans_type
           FROM tbltransaction_product_items tpi
         ),
         totals AS (
           SELECT
             SUM((CASE WHEN discount_price > 0 THEN discount_price ELSE sell_price END) * qty) AS gross_sales,
             SUM(((CASE WHEN discount_price > 0 THEN discount_price ELSE sell_price END) - unit_price) * qty) AS gross_margin
           FROM item_scope
           WHERE trans_type = 'sales'
         )
         SELECT
           COALESCE((gross_margin / NULLIF(gross_sales, 0)) * 100, 0)::text AS "marginPercent"
         FROM totals`,
      );

      const receivableResult = await this.databaseService.query<ReceivableRow>(
        `WITH payment_totals AS (
           SELECT
             COALESCE(to_jsonb(sp)->>'so_id', to_jsonb(sp)->>'soId') AS so_id,
             SUM(
               CASE
                WHEN COALESCE(to_jsonb(sp)->>'amount', '0') ~ '^-?\d+(\.\d+)?$'
                 AND REPLACE(REPLACE(LOWER(TRIM(COALESCE(to_jsonb(sp)->>'status', ''))), '_', '-'), ' ', '-') IN ('paid', 'posted', 'cleared', 'complete', 'completed', 'remitted')
                   THEN COALESCE(to_jsonb(sp)->>'amount', '0')::numeric
                 ELSE 0
               END
             ) AS paid_amount
           FROM tblso_payments sp
           GROUP BY COALESCE(to_jsonb(sp)->>'so_id', to_jsonb(sp)->>'soId')
         ),
         sales_scope AS (
           SELECT
             so.id::text AS so_id,
             CASE
               WHEN COALESCE(to_jsonb(so)->>'total_amount', to_jsonb(so)->>'totalAmount', '0') ~ '^-?\\d+(\\.\\d+)?$'
                 THEN COALESCE(to_jsonb(so)->>'total_amount', to_jsonb(so)->>'totalAmount', '0')::numeric
               ELSE 0
             END AS total_amount,
             REPLACE(REPLACE(LOWER(TRIM(COALESCE(to_jsonb(so)->>'status', 'pending'))), '_', '-'), ' ', '-') AS normalized_status,
             COALESCE(to_jsonb(so)->>'branchId', to_jsonb(so)->>'branch_id', '') AS branch_id
           FROM tblsales_order so
         )
         SELECT COALESCE(SUM(GREATEST(ss.total_amount - COALESCE(pt.paid_amount, 0), 0)), 0)::text AS amount
         FROM sales_scope ss
         LEFT JOIN payment_totals pt
           ON pt.so_id = ss.so_id
         WHERE ss.normalized_status IN ('approved', 'released', 'delivered', 'partial', 'remitted', 'paid')
           AND ($1::text IS NULL OR ss.branch_id = $1::text)`,
        [branchParam],
      );

      const topCustomersResult = await this.databaseService.query<TopCustomerRow>(
        `WITH payment_totals AS (
           SELECT
             COALESCE(to_jsonb(sp)->>'so_id', to_jsonb(sp)->>'soId') AS so_id,
             SUM(
               CASE
                 WHEN COALESCE(to_jsonb(sp)->>'amount', '0') ~ '^-?\\d+(\\.\\d+)?$'
                   THEN COALESCE(to_jsonb(sp)->>'amount', '0')::numeric
                 ELSE 0
               END
             ) AS paid_amount
           FROM tblso_payments sp
           GROUP BY COALESCE(to_jsonb(sp)->>'so_id', to_jsonb(sp)->>'soId')
         ),
         sales_scope AS (
           SELECT
             so.id::text AS so_id,
             COALESCE(to_jsonb(so)->>'customer_id', to_jsonb(so)->>'customerId', '') AS customer_id,
             CASE
               WHEN COALESCE(to_jsonb(so)->>'total_amount', to_jsonb(so)->>'totalAmount', '0') ~ '^-?\\d+(\\.\\d+)?$'
                 THEN COALESCE(to_jsonb(so)->>'total_amount', to_jsonb(so)->>'totalAmount', '0')::numeric
               ELSE 0
             END AS total_amount,
             COALESCE(NULLIF(to_jsonb(so)->>'created_at', ''), NULLIF(to_jsonb(so)->>'createdAt', ''))::timestamptz AS created_at,
             COALESCE(to_jsonb(so)->>'branchId', to_jsonb(so)->>'branch_id', '') AS branch_id
           FROM tblsales_order so
         )
         SELECT
           COALESCE(to_jsonb(c)->>'name', 'Unknown Customer') AS name,
           COUNT(*)::text AS orders,
           COALESCE(SUM(GREATEST(ss.total_amount - COALESCE(pt.paid_amount, 0), 0)), 0)::text AS balance
         FROM sales_scope ss
         LEFT JOIN tblcustomer c
           ON c.id::text = ss.customer_id
         LEFT JOIN payment_totals pt
           ON pt.so_id = ss.so_id
         WHERE ss.created_at >= (CURRENT_DATE - INTERVAL '30 day')::timestamp
           AND ($1::text IS NULL OR ss.branch_id = $1::text)
         GROUP BY COALESCE(to_jsonb(c)->>'name', 'Unknown Customer')
         ORDER BY COUNT(*) DESC, SUM(ss.total_amount) DESC
         LIMIT 3`,
        [branchParam],
      );

      const topCapacitiesResult = await this.databaseService.query<TopCapacityRow>(
        `WITH sold_units AS (
           SELECT
             COALESCE(to_jsonb(tpi)->>'productId', to_jsonb(tpi)->>'product_id', '') AS product_id,
             COALESCE(to_jsonb(tpi)->>'capacityId', to_jsonb(tpi)->>'capacity_id', '') AS capacity_id,
             SUM(
               CASE
                 WHEN COALESCE(to_jsonb(tpi)->>'totalSetQty', to_jsonb(tpi)->>'total_set_qty', '0') ~ '^-?\\d+(\\.\\d+)?$'
                   THEN COALESCE(to_jsonb(tpi)->>'totalSetQty', to_jsonb(tpi)->>'total_set_qty', '0')::numeric
                 ELSE 0
               END
             ) AS units
           FROM tbltransaction_product_items tpi
           WHERE LOWER(COALESCE(to_jsonb(tpi)->>'transType', to_jsonb(tpi)->>'trans_type', 'sales')) = 'sales'
           GROUP BY
             COALESCE(to_jsonb(tpi)->>'productId', to_jsonb(tpi)->>'product_id', ''),
             COALESCE(to_jsonb(tpi)->>'capacityId', to_jsonb(tpi)->>'capacity_id', '')
         ),
         in_stock_units AS (
           SELECT
             COALESCE(to_jsonb(sn)->>'productId', to_jsonb(sn)->>'product_id', '') AS product_id,
             COALESCE(to_jsonb(sn)->>'capacityId', to_jsonb(sn)->>'capacity_id', '') AS capacity_id,
             COUNT(*) FILTER (
               WHERE REPLACE(REPLACE(LOWER(TRIM(COALESCE(to_jsonb(sn)->>'status', ''))), '_', '-'), ' ', '-') NOT IN (
                 'scanned', 'reserved', 'delivered', 'installed', 'sold', 'released', 'out', 'outbound', 'defective'
               )
             )::numeric AS in_stock,
             COALESCE(to_jsonb(sn)->>'branchId', to_jsonb(sn)->>'branch_id', '') AS branch_id
           FROM tblserial_numbers sn
           GROUP BY
             COALESCE(to_jsonb(sn)->>'productId', to_jsonb(sn)->>'product_id', ''),
             COALESCE(to_jsonb(sn)->>'capacityId', to_jsonb(sn)->>'capacity_id', ''),
             COALESCE(to_jsonb(sn)->>'branchId', to_jsonb(sn)->>'branch_id', '')
         )
         SELECT
           TRIM(CONCAT(
             COALESCE(to_jsonb(p)->>'productName', to_jsonb(p)->>'product_name', to_jsonb(p)->>'productname', 'Unknown Product'),
             ' ',
             COALESCE(to_jsonb(c)->>'capacity', to_jsonb(c)->>'capacityValue', to_jsonb(c)->>'capacity_value', '')
           )) AS label,
           COALESCE(su.units, 0)::text AS units,
           COALESCE(
             ROUND((su.units / NULLIF(su.units + COALESCE(SUM(isu.in_stock), 0), 0)) * 100),
             0
           )::text AS "sellThrough"
         FROM sold_units su
         LEFT JOIN tblproducts p
           ON p.id::text = su.product_id
         LEFT JOIN tblcapacity c
           ON c.id::text = su.capacity_id
         LEFT JOIN in_stock_units isu
           ON isu.product_id = su.product_id
          AND isu.capacity_id = su.capacity_id
          AND ($1::text IS NULL OR isu.branch_id = $1::text)
         GROUP BY label, su.units
         ORDER BY su.units DESC
         LIMIT 4`,
        [branchParam],
      );

      const marginByBrandResult = await this.databaseService.query<MarginRow>(
        `WITH item_scope AS (
           SELECT
             COALESCE(to_jsonb(tpi)->>'productId', to_jsonb(tpi)->>'product_id', '') AS product_id,
             CASE
               WHEN COALESCE(to_jsonb(tpi)->>'unitPrice', to_jsonb(tpi)->>'unit_price', '0') ~ '^-?\\d+(\\.\\d+)?$'
                 THEN COALESCE(to_jsonb(tpi)->>'unitPrice', to_jsonb(tpi)->>'unit_price', '0')::numeric
               ELSE 0
             END AS unit_price,
             CASE
               WHEN COALESCE(to_jsonb(tpi)->>'sellPrice', to_jsonb(tpi)->>'sell_price', '0') ~ '^-?\\d+(\\.\\d+)?$'
                 THEN COALESCE(to_jsonb(tpi)->>'sellPrice', to_jsonb(tpi)->>'sell_price', '0')::numeric
               ELSE 0
             END AS sell_price,
             CASE
               WHEN COALESCE(to_jsonb(tpi)->>'discountPrice', to_jsonb(tpi)->>'discount_price', '0') ~ '^-?\\d+(\\.\\d+)?$'
                 THEN COALESCE(to_jsonb(tpi)->>'discountPrice', to_jsonb(tpi)->>'discount_price', '0')::numeric
               ELSE 0
             END AS discount_price,
             CASE
               WHEN COALESCE(to_jsonb(tpi)->>'totalSetQty', to_jsonb(tpi)->>'total_set_qty', '0') ~ '^-?\\d+(\\.\\d+)?$'
                 THEN COALESCE(to_jsonb(tpi)->>'totalSetQty', to_jsonb(tpi)->>'total_set_qty', '0')::numeric
               ELSE 0
             END AS qty
           FROM tbltransaction_product_items tpi
           WHERE LOWER(COALESCE(to_jsonb(tpi)->>'transType', to_jsonb(tpi)->>'trans_type', 'sales')) = 'sales'
         )
         SELECT
           COALESCE(
             NULLIF(TRIM(to_jsonb(b)->>'name'), ''),
             NULLIF(TRIM(to_jsonb(b)->>'brandName'), ''),
             NULLIF(TRIM(to_jsonb(b)->>'brand_name'), ''),
             'Unknown Brand'
           ) AS label,
           COALESCE(
             (SUM(((CASE WHEN item_scope.discount_price > 0 THEN item_scope.discount_price ELSE item_scope.sell_price END) - item_scope.unit_price) * item_scope.qty)
               / NULLIF(SUM((CASE WHEN item_scope.discount_price > 0 THEN item_scope.discount_price ELSE item_scope.sell_price END) * item_scope.qty), 0)
             ) * 100,
             0
           )::text AS margin
         FROM item_scope
         LEFT JOIN tblproducts p
           ON p.id::text = item_scope.product_id
         LEFT JOIN tblbrands b
           ON b.id::text = COALESCE(
             to_jsonb(p)->>'brandId',
             to_jsonb(p)->>'brand_id',
             to_jsonb(p)->>'brandid',
             ''
           )
         GROUP BY 1
         ORDER BY margin DESC
         LIMIT 4`,
      );

      const marginByVendorResult = await this.databaseService.query<MarginRow>(
        `WITH serial_scope AS (
           SELECT
             COALESCE(to_jsonb(sn)->>'productId', to_jsonb(sn)->>'product_id', '') AS product_id,
             COALESCE(to_jsonb(sn)->>'capacityId', to_jsonb(sn)->>'capacity_id', '') AS capacity_id,
             COALESCE(to_jsonb(sn)->>'purchaseId', to_jsonb(sn)->>'purchase_id', to_jsonb(sn)->>'po_id', '') AS purchase_id,
             REPLACE(REPLACE(LOWER(TRIM(COALESCE(to_jsonb(sn)->>'status', ''))), '_', '-'), ' ', '-') AS normalized_status,
             COALESCE(to_jsonb(sn)->>'branchId', to_jsonb(sn)->>'branch_id', '') AS branch_id
           FROM tblserial_numbers sn
         )
         SELECT
           COALESCE(to_jsonb(v)->>'name', 'Unknown Vendor') AS label,
           COALESCE(SUM(
             COALESCE(NULLIF(to_jsonb(c)->>'srp', '')::numeric, 0)
             - COALESCE(NULLIF(COALESCE(to_jsonb(tpi)->>'unitPrice', to_jsonb(tpi)->>'unit_price', ''), '')::numeric, 0)
           ), 0)::text AS margin
         FROM serial_scope ss
         LEFT JOIN tblcapacity c
           ON c.id::text = ss.capacity_id
         LEFT JOIN tblpurchase_orders po
           ON po.id::text = ss.purchase_id
         LEFT JOIN tblvendors v
           ON v.id::text = COALESCE(to_jsonb(po)->>'vendor_id', to_jsonb(po)->>'vendorId', '')
         LEFT JOIN tbltransaction_product_items tpi
           ON COALESCE(to_jsonb(tpi)->>'purchaseId', to_jsonb(tpi)->>'purchase_id', to_jsonb(tpi)->>'po_id', '') = ss.purchase_id
          AND COALESCE(to_jsonb(tpi)->>'productId', to_jsonb(tpi)->>'product_id', '') = ss.product_id
          AND COALESCE(to_jsonb(tpi)->>'capacityId', to_jsonb(tpi)->>'capacity_id', '') = ss.capacity_id
          AND LOWER(COALESCE(to_jsonb(tpi)->>'transType', to_jsonb(tpi)->>'trans_type', 'purchase')) = 'purchase'
         WHERE ss.purchase_id <> ''
           AND ss.normalized_status NOT IN (
             'scanned', 'reserved', 'delivered', 'installed', 'sold', 'released', 'out', 'outbound', 'defective'
           )
           AND ($1::text IS NULL OR ss.branch_id = $1::text)
         GROUP BY COALESCE(to_jsonb(v)->>'name', 'Unknown Vendor')
         ORDER BY margin DESC
         LIMIT 4`,
        [branchParam],
      );

      const activityResult = await this.databaseService.query<ActivityRow>(
        `WITH po_events AS (
           SELECT
             COALESCE(NULLIF(to_jsonb(po)->>'created_at', ''), NULLIF(to_jsonb(po)->>'createdAt', '')) AS "eventAt",
             CONCAT('PO ', COALESCE(to_jsonb(po)->>'po_number', to_jsonb(po)->>'poNumber', CONCAT('#', po.id::text)), ' created') AS text,
             'received'::text AS status
           FROM tblpurchase_orders po
           ORDER BY po.id DESC
           LIMIT 3
         ),
         so_events AS (
           SELECT
             COALESCE(NULLIF(to_jsonb(so)->>'created_at', ''), NULLIF(to_jsonb(so)->>'createdAt', '')) AS "eventAt",
             CONCAT('SO ', COALESCE(to_jsonb(so)->>'so_number', to_jsonb(so)->>'soNumber', CONCAT('#', so.id::text)), ' queued for processing') AS text,
             'dispatch'::text AS status
           FROM tblsales_order so
           WHERE ($1::text IS NULL OR COALESCE(to_jsonb(so)->>'branchId', to_jsonb(so)->>'branch_id', '') = $1::text)
           ORDER BY so.id DESC
           LIMIT 3
         ),
         payment_events AS (
           SELECT
             COALESCE(NULLIF(to_jsonb(sp)->>'created_at', ''), NULLIF(to_jsonb(sp)->>'createdAt', '')) AS "eventAt",
             CONCAT(
               'Payment posted for ',
               COALESCE(to_jsonb(so)->>'so_number', to_jsonb(so)->>'soNumber', CONCAT('SO#', so.id::text))
             ) AS text,
             'payment'::text AS status
           FROM tblso_payments sp
           LEFT JOIN tblsales_order so
             ON so.id::text = COALESCE(to_jsonb(sp)->>'so_id', to_jsonb(sp)->>'soId', '')
           ORDER BY sp.id DESC
           LIMIT 2
         )
         SELECT * FROM po_events
         UNION ALL
         SELECT * FROM so_events
         UNION ALL
         SELECT * FROM payment_events
         LIMIT 8`,
        [branchParam],
      );

      const inStockCount = this.toNumber(inStockCountResult.rows[0]?.count);
      const openPoCount = this.toNumber(openPoCountResult.rows[0]?.count);
      const dispatchCount = this.toNumber(dispatchCountResult.rows[0]?.count);
      const installQueueCount = this.toNumber(installQueueCountResult.rows[0]?.count);
      const stockAlertsCount = this.toNumber(stockAlertsResult.rows[0]?.count);
      const poTodayCount = this.toNumber(receivingTodayResult.rows[0]?.count);
      const scannedTodayCount = this.toNumber(scannedTodayResult.rows[0]?.count);

      const settledSalesAmount = this.toNumber(salesSummaryResult.rows[0]?.settledAmount);
      const settledSalesCount = this.toNumber(salesSummaryResult.rows[0]?.settledCount);
      const unpaidSalesAmount = this.toNumber(salesSummaryResult.rows[0]?.unpaidAmount);
      const unpaidSalesCount = this.toNumber(salesSummaryResult.rows[0]?.unpaidCount);
      const overdueSalesAmount = this.toNumber(salesSummaryResult.rows[0]?.overdueAmount);
      const overdueSalesCount = this.toNumber(salesSummaryResult.rows[0]?.overdueCount);
      const chequeReceivableAmount = this.toNumber(salesSummaryResult.rows[0]?.chequeAmount);
      const chequeReceivableCount = this.toNumber(salesSummaryResult.rows[0]?.chequeCount);
      const grossMarginPercent = this.toNumber(grossMarginResult.rows[0]?.marginPercent);
      const unpaidReceivable = this.toNumber(receivableResult.rows[0]?.amount);

      const inStockDelta = this.buildDelta(inStockCount, inStockCount);
      const openPoDelta = this.buildDelta(openPoCount, openPoCount);
      const dispatchDelta = this.buildDelta(dispatchCount, dispatchCount);
      const installDelta = this.buildDelta(installQueueCount, installQueueCount);
      const topKpis: KpiCard[] = [
        {
          label: 'In-Stock Units',
          value: this.formatInteger(inStockCount),
          change: inStockDelta.change,
          trend: inStockDelta.trend,
        },
        {
          label: 'Open Purchase Orders',
          value: this.formatInteger(openPoCount),
          change: openPoDelta.change,
          trend: openPoDelta.trend,
        },
        {
          label: 'Dispatch Today',
          value: this.formatInteger(dispatchCount),
          change: dispatchDelta.change,
          trend: dispatchDelta.trend,
        },
        {
          label: 'Install Queue',
          value: this.formatInteger(installQueueCount),
          change: installDelta.change,
          trend: installDelta.trend,
        },
      ];

      const operations: OpsItem[] = [
        {
          label: 'Receiving Today',
          value: `${this.formatInteger(poTodayCount)} PO / ${this.formatInteger(scannedTodayCount)} Serials`,
          hint: 'Live from purchase and serial logs',
          level: 'normal',
        },
        {
          label: 'For Dispatch',
          value: `${this.formatInteger(dispatchCount)} Orders`,
          hint: 'Statuses: pending, for-delivery, to-remit',
          level: dispatchCount > 10 ? 'warning' : 'normal',
        },
        {
          label: 'For Installation',
          value: `${this.formatInteger(installQueueCount)} Bookings`,
          hint: 'Statuses containing installation steps',
          level: installQueueCount > 8 ? 'warning' : 'normal',
        },
        {
          label: 'Stock Alerts',
          value: `${this.formatInteger(stockAlertsCount)} capacities low`,
          hint: 'Threshold: <= 5 in-stock units',
          level: stockAlertsCount > 0 ? 'critical' : 'normal',
        },
      ];

      const salesSummary: KpiCard[] = [
        {
          label: 'Collected Sales',
          value: this.formatCurrency(settledSalesAmount),
          change: `${this.formatInteger(settledSalesCount)} paid / remitted`,
          trend: 'up',
        },
        {
          label: 'Unpaid S.O.',
          value: this.formatCurrency(unpaidSalesAmount),
          change: `${this.formatInteger(unpaidSalesCount)} open balances`,
          trend: unpaidSalesAmount > 0 ? 'down' : 'up',
        },
        {
          label: 'Overdues',
          value: this.formatCurrency(overdueSalesAmount),
          change: `${this.formatInteger(overdueSalesCount)} overdue accounts`,
          trend: overdueSalesAmount > 0 ? 'down' : 'up',
        },
        {
          label: 'Cheque & Card Receivables',
          value: this.formatCurrency(chequeReceivableAmount),
          change: `${this.formatInteger(chequeReceivableCount)} awaiting verification`,
          trend: chequeReceivableAmount > 0 ? 'down' : 'up',
        },
      ];

      const topCustomers = topCustomersResult.rows.map((row) => ({
        name: String(row.name || 'Unknown Customer').trim(),
        orders: this.toNumber(row.orders),
        balance: this.formatCurrency(this.toNumber(row.balance)),
      }));

      const topCapacities = topCapacitiesResult.rows.map((row) => ({
        label: String(row.label || 'Unknown Capacity').trim(),
        units: this.toNumber(row.units),
        sellThrough: Math.max(0, Math.min(100, this.toNumber(row.sellThrough))),
      }));

      const marginByBrand = marginByBrandResult.rows.map((row) => ({
        label: String(row.label || 'Unknown Brand').trim(),
        margin: this.toNumber(row.margin),
      }));

      const marginByVendor = marginByVendorResult.rows.map((row) => ({
        label: String(row.label || 'Unknown Vendor').trim(),
        margin: this.toNumber(row.margin) / 1000000,
      }));

      const activityFeed = activityResult.rows
        .map((row) => ({
          time: this.formatActivityTime(row.eventAt),
          text: String(row.text ?? '').trim() || 'System activity recorded',
          status: row.status,
          sortableDate: row.eventAt ? new Date(row.eventAt).getTime() : 0,
        }))
        .sort((a, b) => b.sortableDate - a.sortableDate)
        .slice(0, 6)
        .map(({ time, text, status }) => ({ time, text, status }));

      const focusSegments: string[] = [];
      if (dispatchCount > 0) {
        focusSegments.push(`${this.formatInteger(dispatchCount)} dispatch orders`);
      }
      if (stockAlertsCount > 0) {
        focusSegments.push(`${this.formatInteger(stockAlertsCount)} low-stock capacities`);
      }
      if (installQueueCount > 0) {
        focusSegments.push(`${this.formatInteger(installQueueCount)} installs in queue`);
      }
      if (unpaidReceivable > 0) {
        focusSegments.push(`${this.formatCurrency(unpaidReceivable)} still collectible`);
      }

      return {
        success: true,
        item: {
          generatedAt: new Date().toISOString(),
          topKpis,
          operations,
          salesSummary,
          topCustomers,
          topCapacities,
          marginByBrand,
          marginByVendor,
          activityFeed,
          todayFocus: focusSegments.length > 0 ? focusSegments.join(', ') : 'All core queues are stable today',
        },
      };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Unable to load dashboard overview',
      };
    }
  }

  async getSalesDetail(
    mode: DashboardSalesDetailMode,
    branchId?: number,
    query?: DashboardSalesDetailQuery,
  ): Promise<{
    success: boolean;
    items: unknown[];
    total: number;
    page: number;
    pageSize: number;
    receivableAmount?: number;
    receivedAmount?: number;
    overallAmount?: number;
  }> {
    const empty = {
      success: false,
      items: [],
      total: 0,
      page: 1,
      pageSize: 15,
      receivableAmount: 0,
      receivedAmount: 0,
      overallAmount: 0,
    };
    try {
      const branchParam = branchId ? String(branchId) : null;
      const { page, pageSize, offset, dateFrom, dateTo, status } = this.normalizeSalesDetailQuery(query);
      const queryParams: unknown[] = [branchParam, dateFrom, dateTo, pageSize, offset];
      const recordedSalesPredicate = this.getRecordedSalesPredicate('ss');
      const recordedSalesAmountExpression = this.getRecordedSalesAmountExpression('ss');
      const unpaidBalancePredicate = this.getUnpaidBalancePredicate('ss');
      const overdueBalancePredicate = this.getOverdueBalancePredicate('ss');
      const createdAtDateFilter = `
             AND ($2::date IS NULL OR (ss.created_at AT TIME ZONE 'UTC')::date >= $2::date)
             AND ($3::date IS NULL OR (ss.created_at AT TIME ZONE 'UTC')::date <= $3::date)`;

      if (mode === 'sales') {
        const result = await this.databaseService.query<{
          soNumber: string;
          customer: string;
          amount: string;
          status: string;
          date: string;
          method: string;
          total: string;
        }>(
          `${this.getSalesDashboardBaseCte()}
           SELECT
             ss.so_id::text AS id,
             ss.so_number::text AS "soNumber",
             ss.customer::text AS customer,
             ${recordedSalesAmountExpression}::text AS amount,
             CASE
               WHEN ss.normalized_status IN ('complete', 'completed') THEN ss.normalized_status
               WHEN ss.normalized_status = 'remitted' THEN 'remitted'
               WHEN ss.normalized_status = 'partial' THEN 'partial'
               ELSE 'paid'
             END::text AS status,
             ss.created_at::text AS date,
             ss.payment_methods::text AS method,
             COUNT(*) OVER()::text AS total
           FROM sales_scope ss
           WHERE ${recordedSalesPredicate}
             AND ($1::text IS NULL OR ss.branch_id = $1::text)
             ${createdAtDateFilter}
           ORDER BY ss.created_at DESC
           LIMIT $4 OFFSET $5`,
          queryParams,
        );

        return {
          success: true,
          page,
          pageSize,
          total: this.toNumber(result.rows[0]?.total),
          items: result.rows.map((row) => ({
            id: row.id,
            soNumber: row.soNumber,
            customer: row.customer,
            amount: this.toNumber(row.amount),
            status: row.status,
            date: new Date(row.date),
            method: row.method,
          })),
        };
      }

      if (mode === 'unpaid' || mode === 'overdues') {
        const result = await this.databaseService.query<{
          soId: string;
          soNumber: string;
          customer: string;
          totalAmount: string;
          paidAmount: string;
          downPayment: string;
          method: string;
          dueDate: string;
          daysUntilDue: string | null;
          total: string;
        }>(
          `${this.getSalesDashboardBaseCte()},
           down_payment_scope AS (
             SELECT
               COALESCE(to_jsonb(sp)->>'so_id', to_jsonb(sp)->>'soId') AS so_id,
               COALESCE(SUM(
                 COALESCE(NULLIF(COALESCE(to_jsonb(sp)->>'downPayment', to_jsonb(sp)->>'down_payment', ''), '')::numeric, 0)
               ), 0) AS total_down_payment
             FROM tblso_payments sp
             WHERE LOWER(COALESCE(to_jsonb(sp)->>'status', '')) != 'paid'
               AND COALESCE(NULLIF(COALESCE(to_jsonb(sp)->>'downPayment', to_jsonb(sp)->>'down_payment', ''), '')::numeric, 0) > 0
             GROUP BY COALESCE(to_jsonb(sp)->>'so_id', to_jsonb(sp)->>'soId')
           )
           SELECT
             ss.so_id::text AS "soId",
             ss.so_number::text AS "soNumber",
             ss.customer::text AS customer,
             ss.total_amount::text AS "totalAmount",
             ss.paid_amount::text AS "paidAmount",
             COALESCE(dp.total_down_payment, 0)::text AS "downPayment",
             ss.credit_terms_methods::text AS method,
             ss.due_date::text AS "dueDate",
             CASE
               WHEN ss.due_date IS NULL THEN NULL
               ELSE ((ss.due_date AT TIME ZONE 'UTC')::date - CURRENT_DATE)::text
             END AS "daysUntilDue",
             COUNT(*) OVER()::text AS total
           FROM sales_scope ss
           LEFT JOIN down_payment_scope dp ON dp.so_id = ss.so_id
           WHERE ${mode === 'overdues' ? overdueBalancePredicate : unpaidBalancePredicate}
             AND ($1::text IS NULL OR ss.branch_id = $1::text)
             ${createdAtDateFilter}
           ORDER BY ss.due_date ASC NULLS LAST, ss.created_at DESC
           LIMIT $4 OFFSET $5`,
          queryParams,
        );

        return {
          success: true,
          page,
          pageSize,
          total: this.toNumber(result.rows[0]?.total),
          items: result.rows.map((row) => {
            const totalAmount = this.toNumber(row.totalAmount);
            const paid = this.toNumber(row.paidAmount);
            const dp = this.toNumber(row.downPayment);
            const balance = Math.max(totalAmount - paid - dp, 0);
            return {
              id: row.soId,
              soId: Number(row.soId),
              soNumber: row.soNumber,
              customer: row.customer,
              totalAmount,
              paidAmount: paid,
              downPayment: dp,
              method: row.method,
              balance,
              dueDate: row.dueDate ? new Date(row.dueDate) : null,
              daysUntilDue: row.daysUntilDue == null || row.daysUntilDue === ''
                ? null
                : this.toNumber(row.daysUntilDue),
            };
          }),
        };
      }

      if (mode === 'cheques') {
        const verifiedStatusesSql = `'paid', 'posted', 'cleared', 'complete', 'completed', 'remitted'`;
        const receivableStatusFilter =
          status === 'verified'
            ? `AND COALESCE(NULLIF(rb.normalized_status, ''), 'unpaid') IN (${verifiedStatusesSql})`
            : status === 'all'
              ? ''
              : `AND COALESCE(NULLIF(rb.normalized_status, ''), 'unpaid') NOT IN (${verifiedStatusesSql})`;
        const receivableBaseCte = `WITH payment_scope AS (
             SELECT
               sp.id::text AS payment_id,
               COALESCE(to_jsonb(sp)->>'so_id', to_jsonb(sp)->>'soId') AS so_id,
               CASE
                 WHEN COALESCE(to_jsonb(sp)->>'amount', '0') ~ '^-?\\d+(\\.\\d+)?$'
                   THEN COALESCE(to_jsonb(sp)->>'amount', '0')::numeric
                 ELSE 0
               END AS amount,
               REPLACE(REPLACE(LOWER(TRIM(COALESCE(to_jsonb(sp)->>'method', ''))), '_', '-'), ' ', '-') AS normalized_method,
               REPLACE(REPLACE(LOWER(TRIM(COALESCE(to_jsonb(sp)->>'status', ''))), '_', '-'), ' ', '-') AS normalized_status,
               COALESCE(to_jsonb(sp)->>'reference_no', to_jsonb(sp)->>'referenceNo', '-') AS reference_no,
               COALESCE(to_jsonb(sp)->>'check_no', to_jsonb(sp)->>'checkNo', '-') AS check_no,
               COALESCE(to_jsonb(sp)->>'bank_name', to_jsonb(sp)->>'bankName', '-') AS bank_name,
               COALESCE(to_jsonb(sp)->>'post_dated', to_jsonb(sp)->>'postDated', null) AS post_dated
             FROM tblso_payments sp
           ),
           receivable_base AS (
             SELECT
               ps.payment_id,
               ps.so_id,
               ps.amount,
               ps.normalized_method,
               ps.normalized_status,
               ps.reference_no,
               ps.check_no,
               ps.bank_name,
               ps.post_dated,
               so.id AS so_pk,
               COALESCE(to_jsonb(so)->>'so_number', to_jsonb(so)->>'soNumber', CONCAT('#', so.id::text)) AS so_number,
               COALESCE(to_jsonb(c)->>'name', 'Unknown Customer') AS customer
             FROM payment_scope ps
             LEFT JOIN tblsales_order so ON so.id::text = ps.so_id
             LEFT JOIN tblcustomer c ON c.id::text = COALESCE(to_jsonb(so)->>'customer_id', to_jsonb(so)->>'customerId', '')
             WHERE ps.normalized_method IN (${this.receivableVerificationMethodsSql})
               AND REPLACE(REPLACE(LOWER(TRIM(COALESCE(to_jsonb(so)->>'status', 'pending'))), '_', '-'), ' ', '-') IN ('remitted', 'complete', 'completed')
               AND ($1::text IS NULL OR COALESCE(to_jsonb(so)->>'branchId', to_jsonb(so)->>'branch_id', '') = $1::text)
               AND ($2::date IS NULL OR (
                 COALESCE(NULLIF(to_jsonb(so)->>'created_at', ''), NULLIF(to_jsonb(so)->>'createdAt', ''))::timestamptz AT TIME ZONE 'UTC'
               )::date >= $2::date)
               AND ($3::date IS NULL OR (
                 COALESCE(NULLIF(to_jsonb(so)->>'created_at', ''), NULLIF(to_jsonb(so)->>'createdAt', ''))::timestamptz AT TIME ZONE 'UTC'
               )::date <= $3::date)
           )`;

        const [totalsResult, result] = await Promise.all([
          this.databaseService.query<{
            receivableAmount: string;
            receivedAmount: string;
            overallAmount: string;
          }>(
            `${receivableBaseCte}
             SELECT
               COALESCE(SUM(rb.amount) FILTER (
                 WHERE COALESCE(NULLIF(rb.normalized_status, ''), 'unpaid') NOT IN (${verifiedStatusesSql})
               ), 0)::text AS "receivableAmount",
               COALESCE(SUM(rb.amount) FILTER (
                 WHERE COALESCE(NULLIF(rb.normalized_status, ''), 'unpaid') IN (${verifiedStatusesSql})
               ), 0)::text AS "receivedAmount",
               COALESCE(SUM(rb.amount), 0)::text AS "overallAmount"
             FROM receivable_base rb`,
            [branchParam, dateFrom, dateTo],
          ),
          this.databaseService.query<{
            paymentId: string;
            soNumber: string;
            customer: string;
            method: string;
            referenceNo: string;
            chequeNo: string;
            amount: string;
            bank: string;
            postDated: string;
            status: string;
            total: string;
          }>(
            `${receivableBaseCte}
             SELECT
               rb.payment_id::text AS "paymentId",
               rb.so_number::text AS "soNumber",
               rb.customer::text AS customer,
               rb.normalized_method::text AS method,
               rb.reference_no::text AS "referenceNo",
               rb.check_no::text AS "chequeNo",
               rb.amount::text AS amount,
               rb.bank_name::text AS bank,
               COALESCE(rb.post_dated::text, '') AS "postDated",
               COALESCE(NULLIF(rb.normalized_status, ''), 'unpaid')::text AS status,
               COUNT(*) OVER()::text AS total
             FROM receivable_base rb
             WHERE TRUE
               ${receivableStatusFilter}
             ORDER BY rb.so_pk DESC
             LIMIT $4 OFFSET $5`,
            queryParams,
          ),
        ]);

        const totals = totalsResult.rows[0];
        return {
          success: true,
          page,
          pageSize,
          total: this.toNumber(result.rows[0]?.total),
          receivableAmount: this.toNumber(totals?.receivableAmount),
          receivedAmount: this.toNumber(totals?.receivedAmount),
          overallAmount: this.toNumber(totals?.overallAmount),
          items: result.rows.map((row) => ({
            id: row.paymentId,
            paymentId: row.paymentId,
            soNumber: row.soNumber,
            customer: row.customer,
            method: this.formatReceivableMethod(row.method),
            referenceNo: row.method === 'cheque' ? row.chequeNo : row.referenceNo,
            chequeNo: row.chequeNo,
            amount: this.toNumber(row.amount),
            bank: row.bank,
            postDated: row.postDated ? new Date(row.postDated) : null,
            status: this.formatReceivableStatus(row.status),
          })),
        };
      }

      return { ...empty, page, pageSize };
    } catch (error) {
      return empty;
    }
  }

  async settleSalesOrder(
    payload: {
      salesOrderId?: number;
      mode?: DashboardSettlementMode;
      amount?: number;
      bankAmount?: number;
      chequeAmount?: number;
      bankName?: string | null;
      checkNo?: string | null;
      postDated?: string | null;
    },
    branchId?: number,
    auditActor?: AuditActorContext,
  ): Promise<{ success: boolean; message: string }> {
    const salesOrderId = Number(payload.salesOrderId);
    if (!Number.isFinite(salesOrderId) || salesOrderId <= 0) {
      throw new BadRequestException('A valid salesOrderId is required');
    }

    const beforeSnapshot = await this.getSalesSettlementAuditSnapshot(salesOrderId, branchId);

    const mode = payload.mode;
    if (!mode || !['partial', 'full', 'cheque', 'split'].includes(mode)) {
      throw new BadRequestException('A valid settlement mode is required');
    }

    await this.databaseService.withTransaction(async (client) => {
      const state = await this.loadSalesSettlementState(client, salesOrderId, branchId);
      const remainingAmount = this.toNumber(state.remainingAmount);
      if (remainingAmount <= 0) {
        throw new BadRequestException('This sales order no longer has an open balance');
      }

      if (mode === 'partial' || mode === 'full') {
        const amount = mode === 'full'
          ? remainingAmount
          : Math.min(Math.max(this.toNumber(payload.amount), 0), remainingAmount);

        if (amount <= 0) {
          throw new BadRequestException('Partial settlement amount must be greater than zero');
        }

        await this.insertSalesPaymentRecord(client, salesOrderId, {
          method: 'Bank Transfer',
          amount,
          status: 'paid',
          paymentDate: new Date().toISOString(),
        });
      }

      if (mode === 'cheque') {
        await this.insertSalesPaymentRecord(client, salesOrderId, {
          method: 'Cheque',
          amount: remainingAmount,
          status: 'unpaid',
          checkNo: String(payload.checkNo ?? '').trim() || null,
          bankName: String(payload.bankName ?? '').trim() || null,
          postDated: this.toIsoDateOrNull(payload.postDated),
        });
      }

      if (mode === 'split') {
        const bankAmount = Math.max(this.toNumber(payload.bankAmount), 0);
        const chequeAmount = Math.max(this.toNumber(payload.chequeAmount), 0);

        if (bankAmount <= 0 || chequeAmount <= 0) {
          throw new BadRequestException('Split settlement requires both bank and cheque amounts.');
        }

        if (Math.abs(bankAmount + chequeAmount - remainingAmount) > 0.01) {
          throw new BadRequestException('Split settlement must match the full remaining balance.');
        }

        await this.insertSalesPaymentRecord(client, salesOrderId, {
          method: 'Bank Transfer',
          amount: bankAmount,
          status: 'paid',
          paymentDate: new Date().toISOString(),
        });

        await this.insertSalesPaymentRecord(client, salesOrderId, {
          method: 'Cheque',
          amount: chequeAmount,
          status: 'unpaid',
          checkNo: String(payload.checkNo ?? '').trim() || null,
          bankName: String(payload.bankName ?? '').trim() || null,
          postDated: this.toIsoDateOrNull(payload.postDated),
        });
      }

      await this.updateSalesOrderStatusForSettlement(client, salesOrderId, branchId);
    });

    const afterSnapshot = await this.getSalesSettlementAuditSnapshot(salesOrderId, branchId);
    await this.auditLogService.logMutation({
      action: 'DASHBOARD_SALES_SETTLEMENT',
      entityType: 'sales-settlement',
      entityId: salesOrderId,
      actor: auditActor,
      description: `Recorded ${mode} settlement for sales order #${salesOrderId}`,
      requestBody: payload as Record<string, unknown>,
      before: beforeSnapshot,
      after: afterSnapshot,
      metadata: {
        mode,
      },
    });

    return {
      success: true,
      message:
        mode === 'cheque'
          ? 'Balance transferred to cheque receivables'
          : mode === 'split'
            ? 'Split settlement recorded successfully'
            : 'Settlement recorded successfully',
    };
  }

  async verifySalesReceivable(
    payload: { paymentId?: number; method?: DashboardReceivableVerificationMode },
    branchId?: number,
    auditActor?: AuditActorContext,
  ): Promise<{ success: boolean; message: string }> {
    const paymentId = String(payload.paymentId ?? '').trim();
    if (!paymentId) {
      throw new BadRequestException('A valid paymentId is required');
    }

    const verifiedHolder: {
      current: {
        paymentId: string;
        salesOrderId: string;
        method: string;
      } | null;
    } = { current: null };

    await this.databaseService.withTransaction(async (client) => {
      const result = await client.query<{
        paymentId: string;
        salesOrderId: string;
        method: string;
        branchId: string | null;
      }>(
        `SELECT
           sp.id::text AS "paymentId",
           COALESCE(to_jsonb(sp)->>'so_id', to_jsonb(sp)->>'soId') AS "salesOrderId",
           REPLACE(REPLACE(LOWER(TRIM(COALESCE(to_jsonb(sp)->>'method', ''))), '_', '-'), ' ', '-') AS method,
           NULLIF(COALESCE(to_jsonb(so)->>'branchId', to_jsonb(so)->>'branch_id', ''), '') AS "branchId"
         FROM tblso_payments sp
         LEFT JOIN tblsales_order so
           ON so.id::text = COALESCE(to_jsonb(sp)->>'so_id', to_jsonb(sp)->>'soId')
         WHERE sp.id::text = $1
         LIMIT 1`,
        [paymentId],
      );

      if (result.rowCount === 0) {
        throw new NotFoundException('Receivable payment not found');
      }

      const payment = result.rows[0];
      if (!['bank-transfer', 'cheque', 'credit-card'].includes(payment.method)) {
        throw new BadRequestException('Only bank transfer, cheque, or credit card receivables can be verified here');
      }
      if (branchId && payment.branchId && payment.branchId !== String(branchId)) {
        throw new NotFoundException('Receivable payment not found in the current branch');
      }

      const paymentColumns = await this.getTableColumns(client, 'tblso_payments');
      const statusColumn = this.pickColumn(paymentColumns, ['status']);
      const paymentDateColumn = this.pickColumn(paymentColumns, ['payment_date', 'paymentDate']);
      if (!statusColumn) {
        throw new BadRequestException('Sales payment status column is not configured as expected');
      }

      const updateParams: unknown[] = ['paid'];
      const updates = [`"${statusColumn}" = $1`];
      if (paymentDateColumn) {
        updateParams.push(new Date().toISOString());
        updates.push(`"${paymentDateColumn}" = $${updateParams.length}`);
      }
      updateParams.push(paymentId);

      await client.query(
        `UPDATE tblso_payments
         SET ${updates.join(', ')}
         WHERE id::text = $${updateParams.length}`,
        updateParams,
      );

      await this.updateSalesOrderStatusForSettlement(client, Number(payment.salesOrderId), branchId);
      verifiedHolder.current = {
        paymentId: payment.paymentId,
        salesOrderId: payment.salesOrderId,
        method: payment.method,
      };
    });

    await this.auditLogService.logMutation({
      action: 'DASHBOARD_VERIFY_RECEIVABLE',
      entityType: 'sales-payment',
      entityId: Number(paymentId),
      actor: auditActor,
      description: `Verified ${verifiedHolder.current?.method ?? 'receivable'} payment #${paymentId}`,
      requestBody: payload as Record<string, unknown>,
      before: { status: 'unpaid', ...(verifiedHolder.current ?? {}) },
      after: { status: 'paid', ...(verifiedHolder.current ?? {}) },
      metadata: {
        method: verifiedHolder.current?.method,
        salesOrderId: verifiedHolder.current?.salesOrderId
          ? Number(verifiedHolder.current.salesOrderId)
          : undefined,
      },
    });

    return {
      success: true,
      message: 'Receivable payment verified successfully',
    };
  }

  async adjustSalesReceivable(
    payload: {
      paymentId?: number;
      method?: DashboardReceivableVerificationMode;
      password?: string;
      remarks?: string;
      authUsername?: string;
    },
    branchId?: number,
    auditActor?: AuditActorContext,
  ): Promise<{ success: boolean; message: string }> {
    const paymentId = String(payload.paymentId ?? '').trim();
    if (!paymentId) {
      throw new BadRequestException('A valid paymentId is required');
    }

    const remarks = String(payload.remarks ?? '').trim();
    if (remarks.length < 5) {
      throw new BadRequestException('Please provide remarks explaining why this payment should be adjusted');
    }

    const authorizedBy = await this.assertAdminPasswordForAdjustment({
      userId: auditActor?.userId,
      username: auditActor?.username,
      roleName: auditActor?.roleName,
      password: payload.password,
      authUsername: payload.authUsername,
    });

    const adjustedHolder: {
      current: {
        paymentId: string;
        salesOrderId: string;
        method: string;
        status: string;
      } | null;
    } = { current: null };

    await this.databaseService.withTransaction(async (client) => {
      const result = await client.query<{
        paymentId: string;
        salesOrderId: string;
        method: string;
        status: string;
        branchId: string | null;
      }>(
        `SELECT
           sp.id::text AS "paymentId",
           COALESCE(to_jsonb(sp)->>'so_id', to_jsonb(sp)->>'soId') AS "salesOrderId",
           REPLACE(REPLACE(LOWER(TRIM(COALESCE(to_jsonb(sp)->>'method', ''))), '_', '-'), ' ', '-') AS method,
           REPLACE(REPLACE(LOWER(TRIM(COALESCE(to_jsonb(sp)->>'status', ''))), '_', '-'), ' ', '-') AS status,
           NULLIF(COALESCE(to_jsonb(so)->>'branchId', to_jsonb(so)->>'branch_id', ''), '') AS "branchId"
         FROM tblso_payments sp
         LEFT JOIN tblsales_order so
           ON so.id::text = COALESCE(to_jsonb(sp)->>'so_id', to_jsonb(sp)->>'soId')
         WHERE sp.id::text = $1
         LIMIT 1`,
        [paymentId],
      );

      if (result.rowCount === 0) {
        throw new NotFoundException('Receivable payment not found');
      }

      const payment = result.rows[0];
      if (!['bank-transfer', 'cheque', 'credit-card'].includes(payment.method)) {
        throw new BadRequestException('Only bank transfer, cheque, or credit card receivables can be adjusted here');
      }
      if (!['paid', 'posted', 'cleared', 'complete', 'completed', 'remitted', 'verified'].includes(payment.status)) {
        throw new BadRequestException('Only verified receivables can be adjusted back to pending');
      }
      if (branchId && payment.branchId && payment.branchId !== String(branchId)) {
        throw new NotFoundException('Receivable payment not found in the current branch');
      }

      const paymentColumns = await this.getTableColumns(client, 'tblso_payments');
      const statusColumn = this.pickColumn(paymentColumns, ['status']);
      const paymentDateColumn = this.pickColumn(paymentColumns, ['payment_date', 'paymentDate']);
      if (!statusColumn) {
        throw new BadRequestException('Sales payment status column is not configured as expected');
      }

      const updateParams: unknown[] = ['unpaid'];
      const updates = [`"${statusColumn}" = $1`];
      if (paymentDateColumn) {
        updateParams.push(null);
        updates.push(`"${paymentDateColumn}" = $${updateParams.length}`);
      }
      updateParams.push(paymentId);

      await client.query(
        `UPDATE tblso_payments
         SET ${updates.join(', ')}
         WHERE id::text = $${updateParams.length}`,
        updateParams,
      );

      await this.updateSalesOrderStatusForSettlement(client, Number(payment.salesOrderId), branchId, {
        allowReopenComplete: true,
      });
      adjustedHolder.current = {
        paymentId: payment.paymentId,
        salesOrderId: payment.salesOrderId,
        method: payment.method,
        status: payment.status,
      };
    });

    await this.auditLogService.logMutation({
      action: 'DASHBOARD_ADJUST_RECEIVABLE',
      entityType: 'sales-payment',
      entityId: Number(paymentId),
      actor: auditActor,
      description: `Adjusted ${adjustedHolder.current?.method ?? 'receivable'} payment #${paymentId} back to pending`,
      requestBody: {
        paymentId: payload.paymentId,
        method: payload.method,
        remarks,
        authUsername: payload.authUsername,
      },
      before: { status: 'paid', ...(adjustedHolder.current ?? {}) },
      after: { status: 'unpaid', ...(adjustedHolder.current ?? {}) },
      metadata: {
        method: adjustedHolder.current?.method,
        remarks,
        authorizedBy,
        salesOrderId: adjustedHolder.current?.salesOrderId
          ? Number(adjustedHolder.current.salesOrderId)
          : undefined,
      },
    });

    return {
      success: true,
      message: 'Receivable payment adjusted back to pending',
    };
  }

  async getOperationsDetail(mode: DashboardOperationDetailMode, branchId?: number): Promise<{ success: boolean; items: unknown[] }> {
    try {
      const branchParam = branchId ? String(branchId) : null;

      if (mode === 'receiving') {
        const result = await this.databaseService.query<{
          id: string;
          poNumber: string;
          vendor: string;
          amount: string;
          status: string;
          createdAt: string;
        }>(
          `SELECT
             po.id::text AS id,
             COALESCE(po.po_number::text, CONCAT('#', po.id::text)) AS "poNumber",
             COALESCE(to_jsonb(v)->>'name', 'Unknown Vendor') AS vendor,
             COALESCE(po.total_amount, 0)::text AS amount,
             COALESCE(po.status, 'pending') AS status,
             po.created_at::text AS "createdAt"
           FROM tblpurchase_orders po
           LEFT JOIN tblvendors v
             ON v.id::text = po.vendor_id::text
           WHERE (po.created_at AT TIME ZONE 'UTC')::date = CURRENT_DATE
           ORDER BY po.created_at DESC
           LIMIT 100`,
        );

        return { success: true, items: result.rows };
      }

      if (mode === 'dispatch') {
        const result = await this.databaseService.query<{
          id: string;
          soNumber: string;
          customer: string;
          amount: string;
          status: string;
          scheduleDate: string;
        }>(
          `WITH sales_scope AS (
             SELECT
               so.id::text AS id,
               COALESCE(to_jsonb(so)->>'so_number', to_jsonb(so)->>'soNumber', CONCAT('#', so.id::text)) AS so_number,
               COALESCE(to_jsonb(c)->>'name', 'Unknown Customer') AS customer,
               CASE
                 WHEN COALESCE(to_jsonb(so)->>'total_amount', to_jsonb(so)->>'totalAmount', '0') ~ '^-?\\d+(\\.\\d+)?$'
                   THEN COALESCE(to_jsonb(so)->>'total_amount', to_jsonb(so)->>'totalAmount', '0')::numeric
                 ELSE 0
               END AS total_amount,
               REPLACE(REPLACE(LOWER(TRIM(COALESCE(to_jsonb(so)->>'status', COALESCE(so.status, 'pending')))), '_', '-'), ' ', '-') AS normalized_status,
               COALESCE(to_jsonb(so)->>'scheduleDate', to_jsonb(so)->>'schedule_date', '') AS schedule_date,
               COALESCE(to_jsonb(so)->>'branchId', to_jsonb(so)->>'branch_id', '') AS branch_id
             FROM tblsales_order so
             LEFT JOIN tblcustomer c
               ON c.id::text = COALESCE(to_jsonb(so)->>'customer_id', to_jsonb(so)->>'customerId', '')
           )
           SELECT
             ss.id,
             ss.so_number::text AS "soNumber",
             ss.customer::text AS customer,
             ss.total_amount::text AS amount,
             ss.normalized_status::text AS status,
             ss.schedule_date::text AS "scheduleDate"
           FROM sales_scope ss
           WHERE ss.normalized_status IN ('pending', 'for-delivery', 'to-remit', 'released', 'in-progress')
             AND ($1::text IS NULL OR ss.branch_id = $1::text)
           ORDER BY NULLIF(ss.schedule_date, '') ASC NULLS LAST, ss.id DESC
           LIMIT 100`,
          [branchParam],
        );

        return { success: true, items: result.rows };
      }

      if (mode === 'installation') {
        const result = await this.databaseService.query<{
          id: string;
          soNumber: string;
          customer: string;
          scheduleDate: string;
          installer: string;
          status: string;
        }>(
          `WITH sales_scope AS (
             SELECT
               so.id::text AS id,
               COALESCE(to_jsonb(so)->>'so_number', to_jsonb(so)->>'soNumber', CONCAT('#', so.id::text)) AS so_number,
               COALESCE(to_jsonb(c)->>'name', 'Unknown Customer') AS customer,
               COALESCE(to_jsonb(so)->>'scheduleDate', to_jsonb(so)->>'schedule_date', '') AS schedule_date,
               COALESCE(to_jsonb(so)->>'installer', '') AS installer,
               REPLACE(REPLACE(LOWER(TRIM(COALESCE(to_jsonb(so)->>'status', COALESCE(so.status, 'pending')))), '_', '-'), ' ', '-') AS normalized_status,
               COALESCE(to_jsonb(so)->>'branchId', to_jsonb(so)->>'branch_id', '') AS branch_id
             FROM tblsales_order so
             LEFT JOIN tblcustomer c
               ON c.id::text = COALESCE(to_jsonb(so)->>'customer_id', to_jsonb(so)->>'customerId', '')
           )
           SELECT
             ss.id,
             ss.so_number::text AS "soNumber",
             ss.customer::text AS customer,
             ss.schedule_date::text AS "scheduleDate",
             ss.installer::text AS installer,
             ss.normalized_status::text AS status
           FROM sales_scope ss
           WHERE ss.normalized_status LIKE '%install%'
             AND ss.normalized_status NOT IN ('installed', 'completed', 'cancelled')
             AND ($1::text IS NULL OR ss.branch_id = $1::text)
           ORDER BY NULLIF(ss.schedule_date, '') ASC NULLS LAST, ss.id DESC
           LIMIT 100`,
          [branchParam],
        );

        return { success: true, items: result.rows };
      }

      if (mode === 'stock-alerts') {
        const result = await this.databaseService.query<{
          id: string;
          product: string;
          capacity: string;
          inStock: string;
        }>(
          `WITH serial_scope AS (
             SELECT
               COALESCE(to_jsonb(sn)->>'productId', to_jsonb(sn)->>'product_id', '') AS product_id,
               COALESCE(to_jsonb(sn)->>'capacityId', to_jsonb(sn)->>'capacity_id', '') AS capacity_id,
               REPLACE(REPLACE(LOWER(TRIM(COALESCE(to_jsonb(sn)->>'status', ''))), '_', '-'), ' ', '-') AS normalized_status,
               COALESCE(to_jsonb(sn)->>'branchId', to_jsonb(sn)->>'branch_id', '') AS branch_id
             FROM tblserial_numbers sn
           ),
           grouped AS (
             SELECT
               ss.product_id,
               ss.capacity_id,
               COUNT(*) FILTER (
                 WHERE ss.normalized_status NOT IN (
                   'scanned', 'reserved', 'delivered', 'installed', 'sold', 'released', 'out', 'outbound', 'defective'
                 )
               )::int AS in_stock
             FROM serial_scope ss
             WHERE ss.product_id <> ''
               AND ss.capacity_id <> ''
               AND ($1::text IS NULL OR ss.branch_id = $1::text)
             GROUP BY ss.product_id, ss.capacity_id
           )
           SELECT
             CONCAT(g.product_id, '-', g.capacity_id) AS id,
             COALESCE(to_jsonb(p)->>'productName', to_jsonb(p)->>'product_name', to_jsonb(p)->>'productname', 'Unknown Product') AS product,
             COALESCE(to_jsonb(c)->>'capacity', to_jsonb(c)->>'capacityValue', to_jsonb(c)->>'capacity_value', '-') AS capacity,
             g.in_stock::text AS "inStock"
           FROM grouped g
           LEFT JOIN tblproducts p
             ON p.id::text = g.product_id
           LEFT JOIN tblcapacity c
             ON c.id::text = g.capacity_id
           WHERE g.in_stock <= 5
           ORDER BY g.in_stock ASC, product ASC
           LIMIT 100`,
          [branchParam],
        );

        return { success: true, items: result.rows };
      }

      return { success: false, items: [] };
    } catch (error) {
      return { success: false, items: [] };
    }
  }
}
