import { BadRequestException, Injectable } from '@nestjs/common';
import { CreateSalesOrderDto } from './dto/create-sales-order.dto';
import { UpdateSalesOrderDto } from './dto/update-sales-order.dto';
import { DatabaseService } from 'src/database/database.service';
import { PoolClient } from 'pg';
import { randomUUID } from 'crypto';
import { ListSalesOrderQueryDto } from './dto/list-sales-order-query.dto';
import { MaterialStockService } from 'src/inventory/material-stock/material-stock.service';

type SalesMode =
  | 'deliveries'
  | 'approvals'
  | 'master-data'
  | 'schedules'
  | 'services'
  | 'projects'
  | 'distribution'
  | 'sales-receivable'
  | 'remitted-sales';

type SalesPaymentMethod =
  | 'Cash'
  | 'Bank Transfer'
  | 'Terms'
  | 'Terms with DP'
  | 'Cheque'
  | 'Credit Card'
  | 'Installment';

@Injectable()
export class SalesOrderService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly materialStockService: MaterialStockService,
  ) {}

  private async getTableColumns(
    executor: { query: PoolClient['query'] },
    tableName: string,
  ): Promise<string[]> {
    const result = await executor.query<{ column_name: string }>(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = current_schema()
         AND table_name = $1`,
      [tableName],
    );

    return result.rows.map((row) => row.column_name);
  }

  private pickColumn(availableColumns: string[], candidates: string[]): string | undefined {
    const lower = new Set(availableColumns.map((c) => c.toLowerCase()));
    return candidates.find((candidate) => lower.has(candidate.toLowerCase()));
  }

  private async runInsert(
    executor: { query: PoolClient['query'] },
    tableName: string,
    record: Record<string, unknown>,
  ) {
    const columns = Object.keys(record);
    const values = Object.values(record);
    const quotedColumns = columns.map((column) => `"${column}"`).join(', ');
    const placeholders = values.map((_, index) => `$${index + 1}`).join(', ');

    return executor.query<{ id: number | string }>(
      `INSERT INTO ${tableName} (${quotedColumns}) VALUES (${placeholders}) RETURNING id`,
      values,
    );
  }

  private toOptionalNumber(value: unknown): number | null {
    if (value === null || value === undefined || value === '') {
      return null;
    }

    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private toIsoDateOrNull(value: unknown): string | null {
    if (!value) {
      return null;
    }

    const raw = String(value).trim();
    const ddMmYyyyMatch = raw.match(/^(\d{2})-(\d{2})-(\d{4})$/);
    if (ddMmYyyyMatch) {
      const day = Number(ddMmYyyyMatch[1]);
      const month = Number(ddMmYyyyMatch[2]);
      const year = Number(ddMmYyyyMatch[3]);
      const parsed = new Date(Date.UTC(year, month - 1, day));
      if (!Number.isNaN(parsed.getTime())) {
        return parsed.toISOString();
      }
    }

    const date = new Date(raw);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  private normalizeSerialNumber(value: unknown): string {
    return String(value ?? '')
      .trim()
      .replace(/\s+/g, ' ');
  }

  private toSalesPaymentMethod(value: unknown): SalesPaymentMethod {
    const normalized = String(value ?? '')
      .trim()
      .toLowerCase();

    if (normalized === 'cash') return 'Cash';
    if (normalized === 'bank transfer' || normalized === 'bank_transfer') return 'Bank Transfer';
    if (normalized === 'terms') return 'Terms';
    if (normalized === 'terms with dp' || normalized === 'terms_with_dp') return 'Terms with DP';
    if (normalized === 'cheque' || normalized === 'check') return 'Cheque';
    if (normalized === 'credit card' || normalized === 'credit_card') return 'Credit Card';
    if (normalized === 'installment') return 'Installment';

    throw new BadRequestException(`Invalid payment method: ${String(value ?? '')}`);
  }

  private hasPaymentValue(value: unknown): boolean {
    if (value === null || value === undefined) {
      return false;
    }

    if (typeof value === 'number') {
      if (!Number.isFinite(value)) {
        return false;
      }

      return value !== 0;
    }

    if (typeof value === 'string') {
      return value.trim().length > 0;
    }

    return true;
  }

  private getAutoPaymentStatus(method: SalesPaymentMethod): string {
    if (method === 'Terms' || method === 'Terms with DP' || method === 'Installment') {
      return 'unpaid';
    }

    return 'paid';
  }

  private validateSalesPaymentDetails(
    paymentDetails: Record<string, unknown>,
    index: number,
  ): SalesPaymentMethod {
    const method = this.toSalesPaymentMethod(paymentDetails.method);

    const allowedFieldsByMethod: Record<SalesPaymentMethod, Set<string>> = {
      Cash: new Set(['amount', 'paymentDate']),
      'Bank Transfer': new Set(['amount', 'bankName', 'referenceNo']),
      Terms: new Set(['amount', 'terms', 'termsDueDate']),
      'Terms with DP': new Set(['amount', 'terms', 'termsDueDate', 'downPayment']),
      Cheque: new Set(['amount', 'checkNo', 'issuedBy', 'bankName', 'bankAccount', 'postDated']),
      'Credit Card': new Set(['amount', 'ccCharge', 'referenceNo', 'paymentDate']),
      Installment: new Set(['amount', 'terms', 'termsDueDate', 'downPayment']),
    };

    const optionalFields = [
      'terms',
      'termsDueDate',
      'referenceNo',
      'paymentDate',
      'issuedBy',
      'ccCharge',
      'checkNo',
      'bankName',
      'bankAccount',
      'postDated',
      'downPayment',
    ] as const;

    const disallowedFields = optionalFields.filter(
      (field) =>
        this.hasPaymentValue(paymentDetails[field]) && !allowedFieldsByMethod[method].has(field),
    );

    if (disallowedFields.length > 0) {
      throw new BadRequestException(
        `paymentDetails[${index}] has invalid field(s) for method ${method}: ${disallowedFields.join(', ')}`,
      );
    }

    return method;
  }

  private normalizePage(value: unknown): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 1) {
      return 1;
    }

    return Math.floor(parsed);
  }

  private normalizeLimit(value: unknown): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 1) {
      return 10;
    }

    return Math.min(100, Math.floor(parsed));
  }

  private normalizeUnitTypesQty(value: unknown): Array<{ label: string; value: number }> {
    if (Array.isArray(value)) {
      return value
        .map((entry) => {
          if (typeof entry === 'string') {
            const [labelRaw, valueRaw] = entry.split(':');
            const label = String(labelRaw ?? '').trim().toLowerCase();
            const parsedValue = Number(valueRaw);
            return {
              label: label || 'set',
              value: Number.isFinite(parsedValue) ? parsedValue : 0,
            };
          }

          if (entry && typeof entry === 'object') {
            const payload = entry as Record<string, unknown>;
            const label = String(payload.label ?? payload.unitType ?? 'set').trim().toLowerCase();
            const parsedValue = Number(payload.value ?? payload.qty ?? 0);
            return {
              label: label || 'set',
              value: Number.isFinite(parsedValue) ? parsedValue : 0,
            };
          }

          return null;
        })
        .filter((entry): entry is { label: string; value: number } => !!entry);
    }

    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        return this.normalizeUnitTypesQty(parsed);
      } catch {
        return [];
      }
    }

    return [];
  }

  private normalizeWorkflowStatus(value: unknown): string {
    return String(value ?? '')
      .trim()
      .toLowerCase()
      .replace(/[\s_]+/g, '-');
  }

  private async updateLinkedSalesSerialStatuses(
    executor: { query: PoolClient['query'] },
    salesOrderId: number,
    nextStatus: string,
    fromStatuses?: string[],
  ): Promise<number> {
    const serialColumns = await this.getTableColumns(executor, 'tblserial_numbers');
    const serialSalesIdColumn = this.pickColumn(serialColumns, ['salesId', 'sales_id']);
    const serialStatusColumn = this.pickColumn(serialColumns, ['status']);

    if (!serialSalesIdColumn || !serialStatusColumn) {
      throw new Error('Sales/status columns are not configured in tblserial_numbers');
    }

    const normalizedFromStatuses = (fromStatuses ?? [])
      .map((status) => this.normalizeWorkflowStatus(status))
      .filter((status) => status.length > 0);

    const params: unknown[] = [nextStatus, String(salesOrderId)];
    const whereParts = [`"${serialSalesIdColumn}"::text = $2`];

    if (normalizedFromStatuses.length > 0) {
      params.push(normalizedFromStatuses);
      whereParts.push(
        `REPLACE(REPLACE(LOWER(COALESCE("${serialStatusColumn}"::text, '')), '_', '-'), ' ', '-') = ANY($3::text[])`,
      );
    }

    const result = await executor.query(
      `UPDATE tblserial_numbers
       SET "${serialStatusColumn}" = $1
       WHERE ${whereParts.join(' AND ')}`,
      params,
    );

    return result.rowCount ?? 0;
  }

  private async fetchByMode(mode: SalesMode, query: ListSalesOrderQueryDto) {
    const page = this.normalizePage(query.page);
    const limit = this.normalizeLimit(query.limit);
    const offset = (page - 1) * limit;
    const search = String(query.search ?? '').trim().toLowerCase();

    const params: unknown[] = [];
    const whereParts: string[] = [];

    if (mode === 'deliveries') {
      whereParts.push(`LOWER(COALESCE(base.original_status, '')) NOT IN (
        'for_approval', 'for approval', 'approval', 'approved', 'complete', 'completed', 'cancelled', 'rejected'
      )`);
    } else if (mode === 'approvals') {
      whereParts.push(`LOWER(COALESCE(base.original_status, '')) IN (
        'for_approval', 'for approval', 'approval', 'pending_approval', 'pending approval'
      )`);
    } else if (mode === 'schedules') {
      whereParts.push(`REPLACE(REPLACE(LOWER(BTRIM(COALESCE(base.original_status, ''))), '_', '-'), ' ', '-') IN (
        'pending',
        'for-delivery',
        'to-remit'
      )`);
      whereParts.push(`LOWER(COALESCE(base.sales_type, '')) IN (
        'sales',
        'sales and service',
        'sales & service',
        'sales-and-service',
        'sales_and_service'
      )`);
    } else if (mode === 'services') {
      whereParts.push(`LOWER(COALESCE(base.sales_type, '')) = 'services'`);
    } else if (mode === 'projects') {
      whereParts.push(`LOWER(COALESCE(base.sales_type, '')) = 'projects'`);
    } else if (mode === 'distribution') {
      whereParts.push(`LOWER(COALESCE(base.sales_type, '')) = 'distribution'`);
    } else if (mode === 'sales-receivable') {
      whereParts.push(`COALESCE(base.remaining_amount, 0) > 0`);
      whereParts.push(`LOWER(COALESCE(base.original_status, '')) IN (
        'approved', 'released', 'delivered', 'partial', 'remitted'
      )`);
    } else if (mode === 'remitted-sales') {
      whereParts.push(`(
        LOWER(COALESCE(base.original_status, '')) IN ('complete', 'completed')
        OR (
          COALESCE(base.remaining_amount, 0) <= 0
          AND LOWER(COALESCE(base.original_status, '')) IN (
            'approved', 'released', 'delivered', 'partial', 'paid', 'remitted'
          )
        )
      )`);
    }

    if (search) {
      params.push(`%${search}%`);
      const searchIndex = params.length;
      whereParts.push(`(
        LOWER(COALESCE(base.so_number, '')) LIKE $${searchIndex}
        OR LOWER(COALESCE(base.customer_name, '')) LIKE $${searchIndex}
        OR LOWER(COALESCE(base.computed_status, '')) LIKE $${searchIndex}
        OR LOWER(COALESCE(base.sales_type, '')) LIKE $${searchIndex}
      )`);
    }

    const whereSql = whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : '';

    const computedStatusExpression =
      mode === 'deliveries'
        ? `CASE
             WHEN COALESCE(sc.serial_count, 0) > 0 THEN 'in-progress'
             ELSE 'pending'
           END`
        : `COALESCE(so.status, 'pending')`;

    const baseCte = `
      WITH serial_counts AS (
        SELECT
          COALESCE(
            to_jsonb(sn)->>'salesId',
            to_jsonb(sn)->>'sales_id'
          ) AS so_id,
          COUNT(*)::int AS serial_count
        FROM tblserial_numbers sn
        WHERE COALESCE(
          to_jsonb(sn)->>'salesId',
          to_jsonb(sn)->>'sales_id'
        ) IS NOT NULL
        GROUP BY COALESCE(
          to_jsonb(sn)->>'salesId',
          to_jsonb(sn)->>'sales_id'
        )
      ),
      payment_totals AS (
        SELECT
          COALESCE(
            to_jsonb(sp)->>'so_id',
            to_jsonb(sp)->>'soId'
          ) AS so_id,
          COALESCE(
            SUM(
              COALESCE(
                NULLIF(to_jsonb(sp)->>'amount', '')::numeric,
                0
              )
            ),
            0
          ) AS paid_amount
        FROM tblso_payments sp
        GROUP BY COALESCE(
          to_jsonb(sp)->>'so_id',
          to_jsonb(sp)->>'soId'
        )
      ),
      base AS (
        SELECT
          so.id,
          COALESCE(
            to_jsonb(so)->>'so_number',
            to_jsonb(so)->>'soNumber',
            ''
          ) AS so_number,
          COALESCE(
            to_jsonb(so)->>'customer_id',
            to_jsonb(so)->>'customerId',
            ''
          ) AS customer_id,
          COALESCE(
            to_jsonb(c)->>'name',
            to_jsonb(c)->>'customer_name',
            ''
          ) AS customer_name,
          COALESCE(
            to_jsonb(so)->>'total_amount',
            to_jsonb(so)->>'totalAmount',
            '0'
          ) AS total_amount,
          COALESCE(so.status, 'pending') AS original_status,
          COALESCE(
            to_jsonb(so)->>'scheduleDate',
            to_jsonb(so)->>'schedule_date',
            null
          ) AS schedule_date,
          COALESCE(
            to_jsonb(so)->>'created_at',
            to_jsonb(so)->>'createdAt',
            null
          ) AS created_at,
          COALESCE(
            to_jsonb(so)->>'salesType',
            to_jsonb(so)->>'sales_type',
            ''
          ) AS sales_type,
          COALESCE(sc.serial_count, 0)::int AS serial_count,
          COALESCE(pt.paid_amount, 0) AS paid_amount,
          GREATEST(
            COALESCE(
              NULLIF(
                COALESCE(
                  to_jsonb(so)->>'total_amount',
                  to_jsonb(so)->>'totalAmount',
                  '0'
                ),
                ''
              )::numeric,
              0
            ) - COALESCE(pt.paid_amount, 0),
            0
          ) AS remaining_amount,
          ${computedStatusExpression} AS computed_status
        FROM tblsales_order so
        LEFT JOIN tblcustomer c
          ON c.id::text = COALESCE(
            to_jsonb(so)->>'customer_id',
            to_jsonb(so)->>'customerId',
            ''
          )
        LEFT JOIN serial_counts sc
          ON sc.so_id = so.id::text
        LEFT JOIN payment_totals pt
          ON pt.so_id = so.id::text
      )
    `;

    const countSql = `
      ${baseCte}
      SELECT COUNT(*)::text AS total
      FROM base
      ${whereSql}
    `;

    const countResult = await this.databaseService.query<{ total: string }>(countSql, params);
    const total = Number(countResult.rows[0]?.total ?? 0);

    params.push(limit);
    params.push(offset);
    const limitIndex = params.length - 1;
    const offsetIndex = params.length;

    const listSql = `
      ${baseCte}
      SELECT
        base.id,
        base.so_number AS "soNumber",
        base.customer_id AS "customerId",
        base.customer_name AS "customerName",
        COALESCE(base.total_amount, '0')::numeric AS "totalAmount",
        base.computed_status AS status,
        base.sales_type AS "salesType",
        base.schedule_date AS "scheduleDate",
        base.created_at AS "createdAt",
        base.serial_count AS "serialCount"
      FROM base
      ${whereSql}
      ORDER BY base.id DESC
      LIMIT $${limitIndex}
      OFFSET $${offsetIndex}
    `;

    const listResult = await this.databaseService.query<{
      id: number;
      soNumber: string;
      customerId: string | null;
      customerName: string;
      totalAmount: string | number | null;
      status: string | null;
      salesType: string | null;
      scheduleDate: string | null;
      createdAt: string | null;
      serialCount: number;
    }>(listSql, params);

    return {
      success: true,
      items: listResult.rows.map((row) => ({
        id: row.id,
        soNumber: row.soNumber,
        customerId: row.customerId,
        customerName: row.customerName,
        totalAmount: Number(row.totalAmount ?? 0),
        status: row.status ?? 'pending',
        salesType: row.salesType ?? '',
        scheduleDate: row.scheduleDate,
        createdAt: row.createdAt,
        serialCount: Number(row.serialCount ?? 0),
      })),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  async create(createSalesOrderDto: CreateSalesOrderDto, userId?: number, branchId?: number) {
    const payload = createSalesOrderDto;
    const status = String(payload.status ?? 'pending').trim() || 'pending';
    const productItems = Array.isArray(payload.productItems) ? payload.productItems : [];

    if (productItems.length === 0) {
      return { success: false, message: 'At least one sales product item is required' };
    }

    try {
      const result = await this.databaseService.withTransaction(async (client) => {
        let customerId = String(payload.customer_id ?? '').trim();
        const customerColumns = await this.getTableColumns(client, 'tblcustomer');
        const customerIdColumn = this.pickColumn(customerColumns, ['id']);
        const customerNameColumn = this.pickColumn(customerColumns, ['name']);
        const customerAddressColumn = this.pickColumn(customerColumns, ['address']);
        const customerContactPersonColumn = this.pickColumn(customerColumns, [
          'contact_person',
          'contactPerson',
        ]);
        const customerContactNumberColumn = this.pickColumn(customerColumns, [
          'contact_number',
          'contactNumber',
        ]);
        const customerEmailColumn = this.pickColumn(customerColumns, ['email']);
        const customerTinColumn = this.pickColumn(customerColumns, ['tin_number', 'tinNumber']);

        if (customerId) {
          const existingCustomer = await client.query<{ id: string }>(
            `SELECT id FROM tblcustomer WHERE id::text = $1 LIMIT 1`,
            [customerId],
          );

          if (existingCustomer.rowCount === 0) {
            customerId = '';
          }
        }

        if (!customerId) {
          const customerName = String(payload.customer?.name ?? '').trim();
          if (!customerName) {
            throw new Error('customer_id or customer.name is required');
          }
          if (!customerNameColumn) {
            throw new Error('tblcustomer name column is missing');
          }

          const customerRecord: Record<string, unknown> = {
            [customerNameColumn]: customerName,
          };

          if (customerIdColumn) {
            customerRecord[customerIdColumn] = randomUUID();
          }

          const customerAddress = String(payload.customer?.address ?? '').trim();
          const customerContactPerson = String(payload.customer?.contact_person ?? '').trim();
          const customerContactNumber = String(payload.customer?.contact_number ?? '').trim();
          const customerEmail = String(payload.customer?.email ?? '').trim();
          const customerTin = String(payload.customer?.tin_number ?? '').trim();

          if (customerAddressColumn && customerAddress) {
            customerRecord[customerAddressColumn] = customerAddress;
          }
          if (customerContactPersonColumn && customerContactPerson) {
            customerRecord[customerContactPersonColumn] = customerContactPerson;
          }
          if (customerContactNumberColumn && customerContactNumber) {
            customerRecord[customerContactNumberColumn] = customerContactNumber;
          }
          if (customerEmailColumn && customerEmail) {
            customerRecord[customerEmailColumn] = customerEmail;
          }
          if (customerTinColumn && customerTin) {
            customerRecord[customerTinColumn] = customerTin;
          }

          const insertedCustomer = await this.runInsert(client, 'tblcustomer', customerRecord);
          if (insertedCustomer.rowCount === 0) {
            throw new Error('Failed to create customer');
          }

          customerId = String(insertedCustomer.rows[0].id);
        }

        let computedTotalAmount = 0;
        for (const item of productItems) {
          const unitPrice = this.toOptionalNumber(item.unitPrice) ?? 0;
          const sellPrice = this.toOptionalNumber(item.sellPrice) ?? 0;
          const discountPrice = this.toOptionalNumber(item.discountPrice) ?? 0;
          const qty = this.toOptionalNumber(item.totalSetQty) ?? 0;
          const priceToUse = discountPrice > 0 ? discountPrice : sellPrice > 0 ? sellPrice : unitPrice;
          computedTotalAmount += priceToUse * qty;
        }

        const fallbackTotal = this.toOptionalNumber(payload.totalAmount) ?? 0;
        const totalAmount = computedTotalAmount > 0 ? computedTotalAmount : fallbackTotal;

        const salesColumns = await this.getTableColumns(client, 'tblsales_order');
        const soNumberColumn = this.pickColumn(salesColumns, ['so_number', 'soNumber']);
        const salesCustomerIdColumn = this.pickColumn(salesColumns, ['customer_id', 'customerId']);
        const totalAmountColumn = this.pickColumn(salesColumns, ['total_amount', 'totalAmount']);
        const scheduleDateColumn = this.pickColumn(salesColumns, ['scheduleDate', 'schedule_date']);
        const salesTypeColumn = this.pickColumn(salesColumns, ['salesType', 'sales_type']);
        const installerColumn = this.pickColumn(salesColumns, ['installer']);
        const remarksColumn = this.pickColumn(salesColumns, ['remarks']);
        const statusColumn = this.pickColumn(salesColumns, ['status']);
        const createdByColumn = this.pickColumn(salesColumns, ['created_by', 'createdBy']);
        const branchColumn = this.pickColumn(salesColumns, ['branchId', 'branch_id']);

        if (!salesCustomerIdColumn || !totalAmountColumn || !statusColumn) {
          throw new Error('tblsales_order columns are not aligned with expected fields');
        }

        const salesRecord: Record<string, unknown> = {
          [salesCustomerIdColumn]: customerId,
          [totalAmountColumn]: totalAmount,
          [statusColumn]: status,
        };

        if (createdByColumn && userId) {
          salesRecord[createdByColumn] = userId;
        }
        if (branchColumn && branchId) {
          salesRecord[branchColumn] = branchId;
        }
        if (soNumberColumn && payload['so_number']) {
          salesRecord[soNumberColumn] = payload['so_number'];
        }
        if (scheduleDateColumn && payload.scheduleDate !== undefined) {
          salesRecord[scheduleDateColumn] = this.toIsoDateOrNull(payload.scheduleDate);
        }
        if (salesTypeColumn && payload.salesType !== undefined) {
          salesRecord[salesTypeColumn] = String(payload.salesType ?? '').trim();
        }
        if (installerColumn && payload.installer !== undefined) {
          salesRecord[installerColumn] = String(payload.installer ?? '').trim();
        }
        if (remarksColumn && payload.remarks !== undefined) {
          salesRecord[remarksColumn] = String(payload.remarks ?? '');
        }

        const insertedSales = await this.runInsert(client, 'tblsales_order', salesRecord);
        if (insertedSales.rowCount === 0) {
          throw new Error('Failed to create sales order');
        }

        const salesOrderId = Number(insertedSales.rows[0].id);

        const paymentDetailsInput = payload.paymentDetails;
        const paymentDetailsList = Array.isArray(paymentDetailsInput)
          ? paymentDetailsInput
          : paymentDetailsInput
            ? [paymentDetailsInput]
            : [];

        if (paymentDetailsList.length > 0) {
          const paymentColumns = await this.getTableColumns(client, 'tblso_payments');
          const soIdColumn = this.pickColumn(paymentColumns, ['so_id', 'soId']);
          const methodColumn = this.pickColumn(paymentColumns, ['method']);
          const amountColumn = this.pickColumn(paymentColumns, ['amount']);
          const termsColumn = this.pickColumn(paymentColumns, ['terms']);
          const termsDueDateColumn = this.pickColumn(paymentColumns, ['termsDueDate', 'terms_due_date']);
          const paymentStatusColumn = this.pickColumn(paymentColumns, ['status']);
          const referenceNoColumn = this.pickColumn(paymentColumns, ['referenceNo', 'reference_no']);
          const paymentDateColumn = this.pickColumn(paymentColumns, ['paymentDate', 'payment_date']);
          const issuedByColumn = this.pickColumn(paymentColumns, ['issuedBy', 'issued_by']);
          const ccChargeColumn = this.pickColumn(paymentColumns, ['ccCharge', 'cc_charge']);
          const checkNoColumn = this.pickColumn(paymentColumns, ['checkNo', 'check_no']);
          const bankNameColumn = this.pickColumn(paymentColumns, ['bankName', 'bank_name']);
          const bankAccountColumn = this.pickColumn(paymentColumns, ['bankAccount', 'bank_account']);
          const postDatedColumn = this.pickColumn(paymentColumns, ['postDated', 'post_dated']);
          const downPaymentColumn = this.pickColumn(paymentColumns, ['downPayment', 'down_payment']);

          if (soIdColumn) {
            for (const [paymentIndex, paymentDetails] of paymentDetailsList.entries()) {
              if (!paymentDetails || typeof paymentDetails !== 'object') {
                throw new BadRequestException(`paymentDetails[${paymentIndex}] must be an object`);
              }

              const paymentPayload = paymentDetails as Record<string, unknown>;
              const method = this.validateSalesPaymentDetails(paymentPayload, paymentIndex);

              const paymentRecord: Record<string, unknown> = {
                [soIdColumn]: salesOrderId,
              };

              const amount = this.toOptionalNumber(paymentPayload.amount) ?? totalAmount;

              if (methodColumn) {
                paymentRecord[methodColumn] = method;
              }
              if (amountColumn) {
                paymentRecord[amountColumn] = amount;
              }
              if (termsColumn && paymentPayload.terms) {
                paymentRecord[termsColumn] = String(paymentPayload.terms).trim();
              }
              if (termsDueDateColumn) {
                paymentRecord[termsDueDateColumn] =
                  this.toIsoDateOrNull(paymentPayload.termsDueDate) ?? null;
              }
              if (paymentStatusColumn) {
                paymentRecord[paymentStatusColumn] = this.getAutoPaymentStatus(method);
              }
              if (referenceNoColumn && paymentPayload.referenceNo) {
                paymentRecord[referenceNoColumn] = String(paymentPayload.referenceNo).trim();
              }
              if (paymentDateColumn) {
                paymentRecord[paymentDateColumn] =
                  this.toIsoDateOrNull(paymentPayload.paymentDate) ?? null;
              }
              if (issuedByColumn && paymentPayload.issuedBy) {
                paymentRecord[issuedByColumn] = String(paymentPayload.issuedBy).trim();
              }
              if (ccChargeColumn && paymentPayload.ccCharge) {
                paymentRecord[ccChargeColumn] = String(paymentPayload.ccCharge).trim();
              }
              if (checkNoColumn && paymentPayload.checkNo) {
                paymentRecord[checkNoColumn] = String(paymentPayload.checkNo).trim();
              }
              if (bankNameColumn && paymentPayload.bankName) {
                paymentRecord[bankNameColumn] = String(paymentPayload.bankName).trim();
              }
              if (bankAccountColumn && paymentPayload.bankAccount) {
                paymentRecord[bankAccountColumn] = String(paymentPayload.bankAccount).trim();
              }
              if (postDatedColumn && paymentPayload.postDated) {
                paymentRecord[postDatedColumn] = String(paymentPayload.postDated).trim();
              }

              const downPayment = this.toOptionalNumber(paymentPayload.downPayment);
              if (downPaymentColumn && downPayment !== null) {
                paymentRecord[downPaymentColumn] = downPayment;
              }

              await this.runInsert(client, 'tblso_payments', paymentRecord);
            }
          }
        }

        const serialColumns = await this.getTableColumns(client, 'tblserial_numbers');
        const serialCustomerIdColumn = this.pickColumn(serialColumns, ['customerId', 'customer_id']);

        const transactionItemColumns = await this.getTableColumns(client, 'tbltransaction_product_items');
        if (transactionItemColumns.length > 0) {
          const transTypeColumn = this.pickColumn(transactionItemColumns, ['transType', 'trans_type']);
          const productIdColumn = this.pickColumn(transactionItemColumns, ['productId', 'product_id']);
          const capacityIdColumn = this.pickColumn(transactionItemColumns, ['capacityId', 'capacity_id']);
          const unitPriceColumn = this.pickColumn(transactionItemColumns, ['unitPrice', 'unit_price']);
          const sellPriceColumn = this.pickColumn(transactionItemColumns, ['sellPrice', 'sell_price']);
          const discountPriceColumn = this.pickColumn(transactionItemColumns, ['discountPrice', 'discount_price']);
          const unitTypesQtyColumn = this.pickColumn(transactionItemColumns, ['unitTypesQty', 'unit_types_qty']);
          const totalSetQtyColumn = this.pickColumn(transactionItemColumns, ['totalSetQty', 'total_set_qty']);
          const purchaseIdColumn = this.pickColumn(transactionItemColumns, ['purchaseId', 'purchase_id', 'po_id']);
          const salesIdColumn = this.pickColumn(transactionItemColumns, ['salesId', 'sales_id']);
          const itemStatusColumn = this.pickColumn(transactionItemColumns, ['status']);

          for (const item of productItems) {
            const transType = String(item.transType ?? 'sales').trim().toLowerCase();
            const productId = this.toOptionalNumber(item.productId);
            const capacityId = this.toOptionalNumber(item.capacityId);

            if (productId === null || capacityId === null) {
              throw new Error('productId and capacityId are required for sales items');
            }

            const itemRecord: Record<string, unknown> = {};
            if (transTypeColumn) itemRecord[transTypeColumn] = transType;
            if (productIdColumn) itemRecord[productIdColumn] = productId;
            if (capacityIdColumn) itemRecord[capacityIdColumn] = capacityId;
            if (unitPriceColumn) itemRecord[unitPriceColumn] = this.toOptionalNumber(item.unitPrice) ?? 0;
            if (sellPriceColumn) itemRecord[sellPriceColumn] = this.toOptionalNumber(item.sellPrice) ?? 0;
            if (discountPriceColumn) itemRecord[discountPriceColumn] = this.toOptionalNumber(item.discountPrice) ?? 0;
            if (unitTypesQtyColumn) {
              itemRecord[unitTypesQtyColumn] = JSON.stringify(item.unitTypesQty ?? []);
            }
            if (totalSetQtyColumn) itemRecord[totalSetQtyColumn] = this.toOptionalNumber(item.totalSetQty) ?? 0;
            if (purchaseIdColumn) itemRecord[purchaseIdColumn] = this.toOptionalNumber(item.purchaseId);
            if (salesIdColumn) itemRecord[salesIdColumn] = salesOrderId;
            if (itemStatusColumn) itemRecord[itemStatusColumn] = status;

            await this.runInsert(client, 'tbltransaction_product_items', itemRecord);

            const serialPayload =
              item.serialNumbers && typeof item.serialNumbers === 'object'
                ? (item.serialNumbers as Record<string, unknown>)
                : {};
            const serialStatus =
              String((serialPayload.status as string | undefined) ?? 'reserved')
                .trim()
                .toLowerCase() || 'reserved';

            for (const [unitTypeKey, values] of Object.entries(serialPayload)) {
              if (unitTypeKey.toLowerCase() === 'status') {
                continue;
              }

              const serialList = Array.isArray(values) ? values : [];
              for (const serialRaw of serialList) {
                const normalizedSerial = this.normalizeSerialNumber(serialRaw);
                if (!normalizedSerial) {
                  continue;
                }

                const existingSerialResult = await client.query<{ id: number; sales_id: string | null }>(
                  `SELECT
                     sn.id,
                     sn."salesId"::text AS sales_id
                   FROM tblserial_numbers sn
                   WHERE LOWER(
                     regexp_replace(BTRIM(COALESCE(sn."serialNumber", '')), '\\s+', ' ', 'g')
                   ) = LOWER($1)
                   LIMIT 1`,
                  [normalizedSerial],
                );

                if (existingSerialResult.rowCount === 0) {
                  throw new Error(`Serial number ${normalizedSerial} was not found in inventory`);
                }

                const existingSerial = existingSerialResult.rows[0];
                if (
                  existingSerial.sales_id &&
                  Number(existingSerial.sales_id) !== salesOrderId
                ) {
                  throw new Error(
                    `Serial number ${normalizedSerial} is already linked to sales order ${existingSerial.sales_id}`,
                  );
                }

                if (serialCustomerIdColumn) {
                  await client.query(
                    `UPDATE tblserial_numbers
                     SET
                       "branchId" = COALESCE($1, "branchId"),
                       "salesId" = $2,
                       "productId" = $3,
                       "capacityId" = $4,
                       "unitType" = $5,
                       status = $6,
                       "${serialCustomerIdColumn}" = $7,
                       created_by = COALESCE($8, created_by)
                     WHERE id = $9`,
                    [
                      branchId ?? null,
                      salesOrderId,
                      productId,
                      capacityId,
                      unitTypeKey,
                      serialStatus,
                      customerId,
                      userId ?? null,
                      existingSerial.id,
                    ],
                  );
                } else {
                  await client.query(
                    `UPDATE tblserial_numbers
                     SET
                       "branchId" = COALESCE($1, "branchId"),
                       "salesId" = $2,
                       "productId" = $3,
                       "capacityId" = $4,
                       "unitType" = $5,
                       status = $6,
                       created_by = COALESCE($7, created_by)
                     WHERE id = $8`,
                    [
                      branchId ?? null,
                      salesOrderId,
                      productId,
                      capacityId,
                      unitTypeKey,
                      serialStatus,
                      userId ?? null,
                      existingSerial.id,
                    ],
                  );
                }
              }
            }
          }
        }

        return {
          salesOrderId,
          customerId,
          totalAmount,
          status,
        };
      });

      return {
        success: true,
        message: 'Sales order created successfully',
        data: result,
      };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to create sales order',
      };
    }
  }

  findAll(query: ListSalesOrderQueryDto) {
    return this.getMasterData(query);
  }

  getDeliveries(query: ListSalesOrderQueryDto) {
    return this.fetchByMode('deliveries', query);
  }

  getApprovals(query: ListSalesOrderQueryDto) {
    return this.fetchByMode('approvals', query);
  }

  getMasterData(query: ListSalesOrderQueryDto) {
    return this.fetchByMode('master-data', query);
  }

  getSchedules(query: ListSalesOrderQueryDto) {
    return this.fetchByMode('schedules', query);
  }

  getServices(query: ListSalesOrderQueryDto) {
    return this.fetchByMode('services', query);
  }

  getProjects(query: ListSalesOrderQueryDto) {
    return this.fetchByMode('projects', query);
  }

  getDistribution(query: ListSalesOrderQueryDto) {
    return this.fetchByMode('distribution', query);
  }

  getSalesReceivable(query: ListSalesOrderQueryDto) {
    return this.fetchByMode('sales-receivable', query);
  }

  getRemittedSales(query: ListSalesOrderQueryDto) {
    return this.fetchByMode('remitted-sales', query);
  }

  async getCustomers(search?: string) {
    const normalizedSearch = String(search ?? '').trim();

    try {
      const params: unknown[] = [];
      let whereClause = '';

      if (normalizedSearch) {
        params.push(`%${normalizedSearch}%`);
        whereClause = `WHERE LOWER(COALESCE(to_jsonb(c)->>'name', to_jsonb(c)->>'customer_name', '')) LIKE LOWER($1)`;
      }

      const result = await this.databaseService.query<{
        id: string;
        name: string | null;
        address: string | null;
        contactPerson: string | null;
        contactNumber: string | null;
        email: string | null;
        tinNumber: string | null;
      }>(
        `SELECT
           c.id::text AS id,
           COALESCE(to_jsonb(c)->>'name', to_jsonb(c)->>'customer_name') AS name,
           COALESCE(to_jsonb(c)->>'address', '') AS address,
           COALESCE(to_jsonb(c)->>'contact_person', to_jsonb(c)->>'contactPerson', '') AS "contactPerson",
           COALESCE(to_jsonb(c)->>'contact_number', to_jsonb(c)->>'contactNumber', '') AS "contactNumber",
           COALESCE(to_jsonb(c)->>'email', '') AS email,
           COALESCE(to_jsonb(c)->>'tin_number', to_jsonb(c)->>'tinNumber', '') AS "tinNumber"
         FROM tblcustomer c
         ${whereClause}
         ORDER BY COALESCE(to_jsonb(c)->>'name', to_jsonb(c)->>'customer_name') ASC
         LIMIT 50`,
        params,
      );

      return {
        success: true,
        items: result.rows.map((row) => ({
          id: row.id,
          name: row.name ?? row.id,
          address: row.address ?? '',
          contact_person: row.contactPerson ?? '',
          contact_number: row.contactNumber ?? '',
          email: row.email ?? '',
          tin_number: row.tinNumber ?? '',
        })),
      };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to load customers',
        items: [],
      };
    }
  }

  async findOne(id: number) {
    if (!Number.isFinite(id) || id <= 0) {
      return {
        success: false,
        message: 'Invalid sales order id',
      };
    }

    try {
      const salesResult = await this.databaseService.query<{
        id: number;
        soNumber: string | null;
        customerId: string | null;
        customerName: string | null;
        customerAddress: string | null;
        customerContactPerson: string | null;
        customerContactNumber: string | null;
        customerEmail: string | null;
        customerTinNumber: string | null;
        totalAmount: string | null;
        status: string | null;
        scheduleDate: string | null;
        salesType: string | null;
        installer: string | null;
        remarks: string | null;
        createdAt: string | null;
      }>(
        `SELECT
           so.id,
           COALESCE(to_jsonb(so)->>'so_number', to_jsonb(so)->>'soNumber') AS "soNumber",
           COALESCE(to_jsonb(so)->>'customer_id', to_jsonb(so)->>'customerId') AS "customerId",
           COALESCE(to_jsonb(c)->>'name', to_jsonb(c)->>'customer_name', '') AS "customerName",
           COALESCE(to_jsonb(c)->>'address', '') AS "customerAddress",
           COALESCE(to_jsonb(c)->>'contact_person', to_jsonb(c)->>'contactPerson', '') AS "customerContactPerson",
           COALESCE(to_jsonb(c)->>'contact_number', to_jsonb(c)->>'contactNumber', '') AS "customerContactNumber",
           COALESCE(to_jsonb(c)->>'email', '') AS "customerEmail",
           COALESCE(to_jsonb(c)->>'tin_number', to_jsonb(c)->>'tinNumber', '') AS "customerTinNumber",
           COALESCE(to_jsonb(so)->>'total_amount', to_jsonb(so)->>'totalAmount', '0') AS "totalAmount",
           COALESCE(so.status, 'pending') AS status,
           COALESCE(to_jsonb(so)->>'scheduleDate', to_jsonb(so)->>'schedule_date', null) AS "scheduleDate",
           COALESCE(to_jsonb(so)->>'salesType', to_jsonb(so)->>'sales_type', '') AS "salesType",
           COALESCE(to_jsonb(so)->>'installer', '') AS installer,
           COALESCE(to_jsonb(so)->>'remarks', '') AS remarks,
           COALESCE(to_jsonb(so)->>'created_at', to_jsonb(so)->>'createdAt', null) AS "createdAt"
         FROM tblsales_order so
         LEFT JOIN tblcustomer c
           ON c.id::text = COALESCE(to_jsonb(so)->>'customer_id', to_jsonb(so)->>'customerId')
         WHERE so.id = $1
         LIMIT 1`,
        [id],
      );

      if (salesResult.rowCount === 0) {
        return {
          success: false,
          message: `Sales order ${id} not found`,
        };
      }

      const paymentResult = await this.databaseService.query<{
        method: string | null;
        amount: string | null;
        terms: string | null;
        termsDueDate: string | null;
        status: string | null;
        referenceNo: string | null;
        paymentDate: string | null;
        issuedBy: string | null;
        ccCharge: string | null;
        checkNo: string | null;
        bankName: string | null;
        bankAccount: string | null;
        postDated: string | null;
        downPayment: string | null;
      }>(
        `SELECT
           COALESCE(to_jsonb(sp)->>'method', null) AS method,
           COALESCE(NULLIF(to_jsonb(sp)->>'amount', '')::numeric, 0)::text AS amount,
           COALESCE(to_jsonb(sp)->>'terms', null) AS terms,
           COALESCE(to_jsonb(sp)->>'terms_due_date', to_jsonb(sp)->>'termsDueDate', null) AS "termsDueDate",
           COALESCE(to_jsonb(sp)->>'status', null) AS status,
           COALESCE(to_jsonb(sp)->>'reference_no', to_jsonb(sp)->>'referenceNo', null) AS "referenceNo",
           COALESCE(to_jsonb(sp)->>'payment_date', to_jsonb(sp)->>'paymentDate', null) AS "paymentDate",
           COALESCE(to_jsonb(sp)->>'issued_by', to_jsonb(sp)->>'issuedBy', null) AS "issuedBy",
           COALESCE(to_jsonb(sp)->>'cc_charge', to_jsonb(sp)->>'ccCharge', null) AS "ccCharge",
           COALESCE(to_jsonb(sp)->>'check_no', to_jsonb(sp)->>'checkNo', null) AS "checkNo",
           COALESCE(to_jsonb(sp)->>'bank_name', to_jsonb(sp)->>'bankName', null) AS "bankName",
           COALESCE(to_jsonb(sp)->>'bank_account', to_jsonb(sp)->>'bankAccount', null) AS "bankAccount",
           COALESCE(to_jsonb(sp)->>'post_dated', to_jsonb(sp)->>'postDated', null) AS "postDated",
           COALESCE(NULLIF(COALESCE(to_jsonb(sp)->>'down_payment', to_jsonb(sp)->>'downPayment', ''), '')::numeric, 0)::text AS "downPayment"
         FROM tblso_payments sp
         WHERE COALESCE(to_jsonb(sp)->>'so_id', to_jsonb(sp)->>'soId') = $1
         ORDER BY sp.id ASC`,
        [String(id)],
      );

      const productResult = await this.databaseService.query<{
        id: number;
        transType: string | null;
        productId: string | null;
        capacityId: string | null;
        unitPrice: string | null;
        sellPrice: string | null;
        discountPrice: string | null;
        unitTypesQty: unknown;
        totalSetQty: string | null;
        purchaseId: string | null;
        salesId: string | null;
        status: string | null;
      }>(
        `SELECT
           tpi.id,
           COALESCE(to_jsonb(tpi)->>'transType', to_jsonb(tpi)->>'trans_type', 'sales') AS "transType",
           COALESCE(to_jsonb(tpi)->>'productId', to_jsonb(tpi)->>'product_id') AS "productId",
           COALESCE(to_jsonb(tpi)->>'capacityId', to_jsonb(tpi)->>'capacity_id') AS "capacityId",
           COALESCE(NULLIF(COALESCE(to_jsonb(tpi)->>'unitPrice', to_jsonb(tpi)->>'unit_price', ''), '')::numeric, 0)::text AS "unitPrice",
           COALESCE(NULLIF(COALESCE(to_jsonb(tpi)->>'sellPrice', to_jsonb(tpi)->>'sell_price', ''), '')::numeric, 0)::text AS "sellPrice",
           COALESCE(NULLIF(COALESCE(to_jsonb(tpi)->>'discountPrice', to_jsonb(tpi)->>'discount_price', ''), '')::numeric, 0)::text AS "discountPrice",
           COALESCE(to_jsonb(tpi)->'unitTypesQty', to_jsonb(tpi)->'unit_types_qty', '[]'::jsonb) AS "unitTypesQty",
           COALESCE(NULLIF(COALESCE(to_jsonb(tpi)->>'totalSetQty', to_jsonb(tpi)->>'total_set_qty', ''), '')::int, 0)::text AS "totalSetQty",
           COALESCE(to_jsonb(tpi)->>'purchaseId', to_jsonb(tpi)->>'purchase_id', to_jsonb(tpi)->>'po_id') AS "purchaseId",
           COALESCE(to_jsonb(tpi)->>'salesId', to_jsonb(tpi)->>'sales_id') AS "salesId",
           COALESCE(to_jsonb(tpi)->>'status', null) AS status
         FROM tbltransaction_product_items tpi
         WHERE COALESCE(to_jsonb(tpi)->>'salesId', to_jsonb(tpi)->>'sales_id') = $1
           AND LOWER(COALESCE(to_jsonb(tpi)->>'transType', to_jsonb(tpi)->>'trans_type', 'sales')) = 'sales'
         ORDER BY tpi.id ASC`,
        [String(id)],
      );

      const serialResult = await this.databaseService.query<{
        serialNumber: string | null;
        productId: string | null;
        capacityId: string | null;
        unitType: string | null;
      }>(
        `SELECT
           COALESCE(to_jsonb(sn)->>'serialNumber', to_jsonb(sn)->>'serial_number') AS "serialNumber",
           COALESCE(to_jsonb(sn)->>'productId', to_jsonb(sn)->>'product_id') AS "productId",
           COALESCE(to_jsonb(sn)->>'capacityId', to_jsonb(sn)->>'capacity_id') AS "capacityId",
           COALESCE(to_jsonb(sn)->>'unitType', to_jsonb(sn)->>'unit_type') AS "unitType"
         FROM tblserial_numbers sn
         WHERE COALESCE(to_jsonb(sn)->>'salesId', to_jsonb(sn)->>'sales_id') = $1`,
        [String(id)],
      );

      const serialMap = new Map<string, Record<string, string[]>>();
      for (const serialRow of serialResult.rows) {
        const productId = String(serialRow.productId ?? '').trim();
        const capacityId = String(serialRow.capacityId ?? '').trim();
        const serialNumber = this.normalizeSerialNumber(serialRow.serialNumber);

        if (!productId || !capacityId || !serialNumber) {
          continue;
        }

        const unitType = String(serialRow.unitType ?? 'set').trim() || 'set';
        const key = `${productId}::${capacityId}`;
        const existing = serialMap.get(key) ?? {};

        if (!Array.isArray(existing[unitType])) {
          existing[unitType] = [];
        }

        if (!existing[unitType].includes(serialNumber)) {
          existing[unitType].push(serialNumber);
        }

        serialMap.set(key, existing);
      }

      const sales = salesResult.rows[0];

      return {
        success: true,
        item: {
          id: sales.id,
          soNumber: sales.soNumber,
          customerId: sales.customerId,
          customerName: sales.customerName,
          customerAddress: sales.customerAddress,
          customerContactPerson: sales.customerContactPerson,
          customerContactNumber: sales.customerContactNumber,
          customerEmail: sales.customerEmail,
          customerTinNumber: sales.customerTinNumber,
          totalAmount: this.toOptionalNumber(sales.totalAmount) ?? 0,
          status: sales.status ?? 'pending',
          scheduleDate: sales.scheduleDate,
          salesType: sales.salesType ?? '',
          installer: sales.installer ?? '',
          remarks: sales.remarks ?? '',
          paymentDetails: paymentResult.rows.map((payment) => ({
            method: payment.method ?? '',
            amount: this.toOptionalNumber(payment.amount) ?? 0,
            terms: payment.terms ?? '',
            termsDueDate: payment.termsDueDate,
            status: payment.status ?? 'paid',
            referenceNo: payment.referenceNo ?? '',
            paymentDate: payment.paymentDate,
            issuedBy: payment.issuedBy ?? '',
            ccCharge: payment.ccCharge ?? '',
            checkNo: payment.checkNo ?? '',
            bankName: payment.bankName ?? '',
            bankAccount: payment.bankAccount ?? '',
            postDated: payment.postDated ?? '',
            downPayment: this.toOptionalNumber(payment.downPayment) ?? 0,
          })),
          productItems: productResult.rows.map((product) => {
            const normalizedProductId = String(product.productId ?? '').trim();
            const normalizedCapacityId = String(product.capacityId ?? '').trim();
            const serialKey = `${normalizedProductId}::${normalizedCapacityId}`;

            return {
              id: product.id,
              transType: product.transType ?? 'sales',
              productId: normalizedProductId,
              capacityId: normalizedCapacityId,
              unitPrice: this.toOptionalNumber(product.unitPrice) ?? 0,
              sellPrice: this.toOptionalNumber(product.sellPrice) ?? 0,
              discountPrice: this.toOptionalNumber(product.discountPrice) ?? 0,
              unitTypesQty: this.normalizeUnitTypesQty(product.unitTypesQty),
              totalSetQty: this.toOptionalNumber(product.totalSetQty) ?? 0,
              purchaseId: this.toOptionalNumber(product.purchaseId),
              salesId: this.toOptionalNumber(product.salesId) ?? id,
              status: product.status ?? 'pending',
              serialNumbers: serialMap.get(serialKey) ?? {},
            };
          }),
          createdAt: sales.createdAt,
        },
      };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to load sales order detail',
      };
    }
  }

  async update(
    id: number,
    updateSalesOrderDto: UpdateSalesOrderDto,
    userId?: number,
    branchId?: number,
  ) {
    if (!Number.isFinite(id) || id <= 0) {
      return { success: false, message: 'Invalid sales order id' };
    }

    if (!updateSalesOrderDto || typeof updateSalesOrderDto !== 'object') {
      return {
        success: false,
        message:
          'Invalid request body. Ensure JSON object payload is provided to PATCH /sales-order/:id.',
      };
    }

    const payload = updateSalesOrderDto as UpdateSalesOrderDto;

    try {
      const result = await this.databaseService.withTransaction(async (client) => {
        const existingSalesResult = await client.query<{
          id: number;
          customer_id: string | null;
          total_amount: string | null;
          status: string | null;
          installer: string | null;
        }>(
          `SELECT
             so.id,
             so.customer_id::text AS customer_id,
             so.total_amount::text AS total_amount,
             so.status::text AS status,
             COALESCE(to_jsonb(so)->>'installer', '') AS installer
           FROM tblsales_order so
           WHERE so.id = $1
           LIMIT 1`,
          [id],
        );

        if (existingSalesResult.rowCount === 0) {
          throw new Error(`Sales order ${id} not found`);
        }

        const existingSales = existingSalesResult.rows[0];
        let customerId = String(payload.customer_id ?? existingSales.customer_id ?? '').trim();

        const customerColumns = await this.getTableColumns(client, 'tblcustomer');
        const customerIdColumn = this.pickColumn(customerColumns, ['id']);
        const customerNameColumn = this.pickColumn(customerColumns, ['name']);
        const customerAddressColumn = this.pickColumn(customerColumns, ['address']);
        const customerContactPersonColumn = this.pickColumn(customerColumns, [
          'contact_person',
          'contactPerson',
        ]);
        const customerContactNumberColumn = this.pickColumn(customerColumns, [
          'contact_number',
          'contactNumber',
        ]);
        const customerEmailColumn = this.pickColumn(customerColumns, ['email']);
        const customerTinColumn = this.pickColumn(customerColumns, ['tin_number', 'tinNumber']);

        if (customerId) {
          const existingCustomer = await client.query<{ id: string }>(
            `SELECT id FROM tblcustomer WHERE id::text = $1 LIMIT 1`,
            [customerId],
          );

          if (existingCustomer.rowCount === 0) {
            customerId = '';
          }
        }

        if (!customerId && payload.customer) {
          const customerName = String(payload.customer.name ?? '').trim();
          if (!customerName || !customerNameColumn) {
            throw new Error('customer_id or customer.name is required');
          }

          const customerRecord: Record<string, unknown> = {
            [customerNameColumn]: customerName,
          };

          if (customerIdColumn) {
            customerRecord[customerIdColumn] = randomUUID();
          }

          const customerAddress = String(payload.customer.address ?? '').trim();
          const customerContactPerson = String(payload.customer.contact_person ?? '').trim();
          const customerContactNumber = String(payload.customer.contact_number ?? '').trim();
          const customerEmail = String(payload.customer.email ?? '').trim();
          const customerTin = String(payload.customer.tin_number ?? '').trim();

          if (customerAddressColumn && customerAddress) customerRecord[customerAddressColumn] = customerAddress;
          if (customerContactPersonColumn && customerContactPerson) {
            customerRecord[customerContactPersonColumn] = customerContactPerson;
          }
          if (customerContactNumberColumn && customerContactNumber) {
            customerRecord[customerContactNumberColumn] = customerContactNumber;
          }
          if (customerEmailColumn && customerEmail) customerRecord[customerEmailColumn] = customerEmail;
          if (customerTinColumn && customerTin) customerRecord[customerTinColumn] = customerTin;

          const insertedCustomer = await this.runInsert(client, 'tblcustomer', customerRecord);
          customerId = String(insertedCustomer.rows[0].id);
        }

        if (customerId && payload.customer) {
          const updates: string[] = [];
          const params: unknown[] = [];

          const customerName = String(payload.customer.name ?? '').trim();
          const customerAddress = String(payload.customer.address ?? '').trim();
          const customerContactPerson = String(payload.customer.contact_person ?? '').trim();
          const customerContactNumber = String(payload.customer.contact_number ?? '').trim();
          const customerEmail = String(payload.customer.email ?? '').trim();
          const customerTin = String(payload.customer.tin_number ?? '').trim();

          if (customerNameColumn && customerName) {
            params.push(customerName);
            updates.push(`"${customerNameColumn}" = $${params.length}`);
          }
          if (customerAddressColumn && customerAddress) {
            params.push(customerAddress);
            updates.push(`"${customerAddressColumn}" = $${params.length}`);
          }
          if (customerContactPersonColumn && customerContactPerson) {
            params.push(customerContactPerson);
            updates.push(`"${customerContactPersonColumn}" = $${params.length}`);
          }
          if (customerContactNumberColumn && customerContactNumber) {
            params.push(customerContactNumber);
            updates.push(`"${customerContactNumberColumn}" = $${params.length}`);
          }
          if (customerEmailColumn && customerEmail) {
            params.push(customerEmail);
            updates.push(`"${customerEmailColumn}" = $${params.length}`);
          }
          if (customerTinColumn && customerTin) {
            params.push(customerTin);
            updates.push(`"${customerTinColumn}" = $${params.length}`);
          }

          if (updates.length > 0) {
            params.push(customerId);
            await client.query(
              `UPDATE tblcustomer
               SET ${updates.join(', ')}
               WHERE id::text = $${params.length}`,
              params,
            );
          }
        }

        if (!customerId) {
          throw new Error('Unable to resolve customer for sales order update');
        }

        const productItems = Array.isArray(payload.productItems) ? payload.productItems : [];
        let computedTotalAmount = 0;
        for (const item of productItems) {
          const unitPrice = this.toOptionalNumber(item.unitPrice) ?? 0;
          const sellPrice = this.toOptionalNumber(item.sellPrice) ?? 0;
          const discountPrice = this.toOptionalNumber(item.discountPrice) ?? 0;
          const qty = this.toOptionalNumber(item.totalSetQty) ?? 0;
          const priceToUse = discountPrice > 0 ? discountPrice : sellPrice > 0 ? sellPrice : unitPrice;
          computedTotalAmount += priceToUse * qty;
        }

        const fallbackTotal =
          this.toOptionalNumber(payload.totalAmount) ??
          this.toOptionalNumber(existingSales.total_amount) ??
          0;
        const totalAmount = productItems.length > 0 && computedTotalAmount > 0 ? computedTotalAmount : fallbackTotal;
        const status = String(payload.status ?? existingSales.status ?? 'pending').trim() || 'pending';

        const salesColumns = await this.getTableColumns(client, 'tblsales_order');
        const salesCustomerIdColumn = this.pickColumn(salesColumns, ['customer_id', 'customerId']);
        const totalAmountColumn = this.pickColumn(salesColumns, ['total_amount', 'totalAmount']);
        const scheduleDateColumn = this.pickColumn(salesColumns, ['scheduleDate', 'schedule_date']);
        const salesTypeColumn = this.pickColumn(salesColumns, ['salesType', 'sales_type']);
        const installerColumn = this.pickColumn(salesColumns, ['installer']);
        const remarksColumn = this.pickColumn(salesColumns, ['remarks']);
        const statusColumn = this.pickColumn(salesColumns, ['status']);
        const branchColumn = this.pickColumn(salesColumns, ['branchId', 'branch_id']);

        if (!salesCustomerIdColumn || !totalAmountColumn || !statusColumn) {
          throw new Error('tblsales_order columns are not aligned with expected fields');
        }

        const soParams: unknown[] = [customerId, totalAmount, status];
        const soUpdates: string[] = [
          `"${salesCustomerIdColumn}" = $1`,
          `"${totalAmountColumn}" = $2`,
          `"${statusColumn}" = $3`,
        ];

        if (scheduleDateColumn && Object.prototype.hasOwnProperty.call(payload, 'scheduleDate')) {
          soParams.push(this.toIsoDateOrNull(payload.scheduleDate));
          soUpdates.push(`"${scheduleDateColumn}" = $${soParams.length}`);
        }
        if (salesTypeColumn && Object.prototype.hasOwnProperty.call(payload, 'salesType')) {
          soParams.push(String(payload.salesType ?? '').trim());
          soUpdates.push(`"${salesTypeColumn}" = $${soParams.length}`);
        }
        if (installerColumn && Object.prototype.hasOwnProperty.call(payload, 'installer')) {
          soParams.push(String(payload.installer ?? '').trim());
          soUpdates.push(`"${installerColumn}" = $${soParams.length}`);
        }
        if (remarksColumn && Object.prototype.hasOwnProperty.call(payload, 'remarks')) {
          soParams.push(String(payload.remarks ?? ''));
          soUpdates.push(`"${remarksColumn}" = $${soParams.length}`);
        }

        if (branchColumn && branchId) {
          soParams.push(branchId);
          soUpdates.push(`"${branchColumn}" = $${soParams.length}`);
        }

        soParams.push(id);
        await client.query(
          `UPDATE tblsales_order
           SET ${soUpdates.join(', ')}
           WHERE id = $${soParams.length}`,
          soParams,
        );

        if (payload.paymentDetails) {
          const paymentDetailsInput = payload.paymentDetails;
          const paymentDetailsList = Array.isArray(paymentDetailsInput)
            ? paymentDetailsInput
            : paymentDetailsInput
              ? [paymentDetailsInput]
              : [];

          const paymentColumns = await this.getTableColumns(client, 'tblso_payments');
          const soIdColumn = this.pickColumn(paymentColumns, ['so_id', 'soId']);
          const methodColumn = this.pickColumn(paymentColumns, ['method']);
          const amountColumn = this.pickColumn(paymentColumns, ['amount']);
          const termsColumn = this.pickColumn(paymentColumns, ['terms']);
          const termsDueDateColumn = this.pickColumn(paymentColumns, ['termsDueDate', 'terms_due_date']);
          const paymentStatusColumn = this.pickColumn(paymentColumns, ['status']);
          const referenceNoColumn = this.pickColumn(paymentColumns, ['referenceNo', 'reference_no']);
          const paymentDateColumn = this.pickColumn(paymentColumns, ['paymentDate', 'payment_date']);
          const issuedByColumn = this.pickColumn(paymentColumns, ['issuedBy', 'issued_by']);
          const ccChargeColumn = this.pickColumn(paymentColumns, ['ccCharge', 'cc_charge']);
          const checkNoColumn = this.pickColumn(paymentColumns, ['checkNo', 'check_no']);
          const bankNameColumn = this.pickColumn(paymentColumns, ['bankName', 'bank_name']);
          const bankAccountColumn = this.pickColumn(paymentColumns, ['bankAccount', 'bank_account']);
          const postDatedColumn = this.pickColumn(paymentColumns, ['postDated', 'post_dated']);
          const downPaymentColumn = this.pickColumn(paymentColumns, ['downPayment', 'down_payment']);

          if (soIdColumn) {
            await client.query(
              `DELETE FROM tblso_payments p
               WHERE COALESCE(to_jsonb(p)->>'so_id', to_jsonb(p)->>'soId') = $1`,
              [String(id)],
            );

            for (const [paymentIndex, paymentDetails] of paymentDetailsList.entries()) {
              if (!paymentDetails || typeof paymentDetails !== 'object') {
                throw new BadRequestException(`paymentDetails[${paymentIndex}] must be an object`);
              }

              const paymentPayload = paymentDetails as Record<string, unknown>;
              const method = this.validateSalesPaymentDetails(paymentPayload, paymentIndex);

              const paymentRecord: Record<string, unknown> = {
                [soIdColumn]: id,
              };

              const amount = this.toOptionalNumber(paymentPayload.amount) ?? totalAmount;
              if (methodColumn) paymentRecord[methodColumn] = method;
              if (amountColumn) paymentRecord[amountColumn] = amount;
              if (termsColumn && paymentPayload.terms) paymentRecord[termsColumn] = String(paymentPayload.terms).trim();
              if (termsDueDateColumn) paymentRecord[termsDueDateColumn] = this.toIsoDateOrNull(paymentPayload.termsDueDate);
              if (paymentStatusColumn) paymentRecord[paymentStatusColumn] = this.getAutoPaymentStatus(method);
              if (referenceNoColumn && paymentPayload.referenceNo) paymentRecord[referenceNoColumn] = String(paymentPayload.referenceNo).trim();
              if (paymentDateColumn) paymentRecord[paymentDateColumn] = this.toIsoDateOrNull(paymentPayload.paymentDate);
              if (issuedByColumn && paymentPayload.issuedBy) paymentRecord[issuedByColumn] = String(paymentPayload.issuedBy).trim();
              if (ccChargeColumn && paymentPayload.ccCharge) paymentRecord[ccChargeColumn] = String(paymentPayload.ccCharge).trim();
              if (checkNoColumn && paymentPayload.checkNo) paymentRecord[checkNoColumn] = String(paymentPayload.checkNo).trim();
              if (bankNameColumn && paymentPayload.bankName) paymentRecord[bankNameColumn] = String(paymentPayload.bankName).trim();
              if (bankAccountColumn && paymentPayload.bankAccount) paymentRecord[bankAccountColumn] = String(paymentPayload.bankAccount).trim();
              if (postDatedColumn && paymentPayload.postDated) paymentRecord[postDatedColumn] = String(paymentPayload.postDated).trim();
              if (downPaymentColumn) paymentRecord[downPaymentColumn] = this.toOptionalNumber(paymentPayload.downPayment) ?? 0;

              await this.runInsert(client, 'tblso_payments', paymentRecord);
            }
          }
        }

        if (productItems.length > 0) {
          const serialColumns = await this.getTableColumns(client, 'tblserial_numbers');
          const serialCustomerIdColumn = this.pickColumn(serialColumns, ['customerId', 'customer_id']);

          await client.query(
            `DELETE FROM tbltransaction_product_items
             WHERE COALESCE(
               to_jsonb(tbltransaction_product_items)->>'salesId',
               to_jsonb(tbltransaction_product_items)->>'sales_id'
             ) = $1
             AND LOWER(COALESCE(
               to_jsonb(tbltransaction_product_items)->>'transType',
               to_jsonb(tbltransaction_product_items)->>'trans_type',
               'sales'
             )) = 'sales'`,
            [String(id)],
          );

          const transactionItemColumns = await this.getTableColumns(client, 'tbltransaction_product_items');
          const transTypeColumn = this.pickColumn(transactionItemColumns, ['transType', 'trans_type']);
          const productIdColumn = this.pickColumn(transactionItemColumns, ['productId', 'product_id']);
          const capacityIdColumn = this.pickColumn(transactionItemColumns, ['capacityId', 'capacity_id']);
          const unitPriceColumn = this.pickColumn(transactionItemColumns, ['unitPrice', 'unit_price']);
          const sellPriceColumn = this.pickColumn(transactionItemColumns, ['sellPrice', 'sell_price']);
          const discountPriceColumn = this.pickColumn(transactionItemColumns, ['discountPrice', 'discount_price']);
          const unitTypesQtyColumn = this.pickColumn(transactionItemColumns, ['unitTypesQty', 'unit_types_qty']);
          const totalSetQtyColumn = this.pickColumn(transactionItemColumns, ['totalSetQty', 'total_set_qty']);
          const purchaseIdColumn = this.pickColumn(transactionItemColumns, ['purchaseId', 'purchase_id', 'po_id']);
          const salesIdColumn = this.pickColumn(transactionItemColumns, ['salesId', 'sales_id']);
          const itemStatusColumn = this.pickColumn(transactionItemColumns, ['status']);

          for (const item of productItems) {
            const transType = String(item.transType ?? 'sales').trim().toLowerCase();
            if (transType !== 'sales') {
              continue;
            }

            const productId = this.toOptionalNumber(item.productId);
            const capacityId = this.toOptionalNumber(item.capacityId);
            if (productId === null || capacityId === null) {
              throw new Error('productId and capacityId are required for sales items');
            }

            const itemRecord: Record<string, unknown> = {};
            if (transTypeColumn) itemRecord[transTypeColumn] = transType;
            if (productIdColumn) itemRecord[productIdColumn] = productId;
            if (capacityIdColumn) itemRecord[capacityIdColumn] = capacityId;
            if (unitPriceColumn) itemRecord[unitPriceColumn] = this.toOptionalNumber(item.unitPrice) ?? 0;
            if (sellPriceColumn) itemRecord[sellPriceColumn] = this.toOptionalNumber(item.sellPrice) ?? 0;
            if (discountPriceColumn) itemRecord[discountPriceColumn] = this.toOptionalNumber(item.discountPrice) ?? 0;
            if (unitTypesQtyColumn) itemRecord[unitTypesQtyColumn] = JSON.stringify(item.unitTypesQty ?? []);
            if (totalSetQtyColumn) itemRecord[totalSetQtyColumn] = this.toOptionalNumber(item.totalSetQty) ?? 0;
            if (purchaseIdColumn) itemRecord[purchaseIdColumn] = this.toOptionalNumber(item.purchaseId);
            if (salesIdColumn) itemRecord[salesIdColumn] = id;
            if (itemStatusColumn) itemRecord[itemStatusColumn] = status;

            await this.runInsert(client, 'tbltransaction_product_items', itemRecord);

            const serialPayload =
              item.serialNumbers && typeof item.serialNumbers === 'object'
                ? (item.serialNumbers as Record<string, unknown>)
                : {};
            const serialStatus =
              String((serialPayload.status as string | undefined) ?? 'reserved').trim().toLowerCase() || 'reserved';

            for (const [unitTypeKey, values] of Object.entries(serialPayload)) {
              if (unitTypeKey.toLowerCase() === 'status') {
                continue;
              }

              const serialList = Array.isArray(values) ? values : [];
              for (const serialRaw of serialList) {
                const normalizedSerial = this.normalizeSerialNumber(serialRaw);
                if (!normalizedSerial) {
                  continue;
                }

                const existingSerialResult = await client.query<{ id: number; sales_id: string | null }>(
                  `SELECT
                     sn.id,
                     sn."salesId"::text AS sales_id
                   FROM tblserial_numbers sn
                   WHERE LOWER(
                     regexp_replace(BTRIM(COALESCE(sn."serialNumber", '')), '\\s+', ' ', 'g')
                   ) = LOWER($1)
                   LIMIT 1`,
                  [normalizedSerial],
                );

                if (existingSerialResult.rowCount === 0) {
                  throw new Error(`Serial number ${normalizedSerial} was not found in inventory`);
                }

                const existingSerial = existingSerialResult.rows[0];
                if (
                  existingSerial.sales_id &&
                  Number(existingSerial.sales_id) !== id
                ) {
                  throw new Error(
                    `Serial number ${normalizedSerial} is already linked to sales order ${existingSerial.sales_id}`,
                  );
                }

                if (serialCustomerIdColumn) {
                  await client.query(
                    `UPDATE tblserial_numbers
                     SET
                       "branchId" = COALESCE($1, "branchId"),
                       "salesId" = $2,
                       "productId" = $3,
                       "capacityId" = $4,
                       "unitType" = $5,
                       status = $6,
                       "${serialCustomerIdColumn}" = $7,
                       created_by = COALESCE($8, created_by)
                     WHERE id = $9`,
                    [
                      branchId ?? null,
                      id,
                      productId,
                      capacityId,
                      unitTypeKey,
                      serialStatus,
                      customerId,
                      userId ?? null,
                      existingSerial.id,
                    ],
                  );
                } else {
                  await client.query(
                    `UPDATE tblserial_numbers
                     SET
                       "branchId" = COALESCE($1, "branchId"),
                       "salesId" = $2,
                       "productId" = $3,
                       "capacityId" = $4,
                       "unitType" = $5,
                       status = $6,
                       created_by = COALESCE($7, created_by)
                     WHERE id = $8`,
                    [
                      branchId ?? null,
                      id,
                      productId,
                      capacityId,
                      unitTypeKey,
                      serialStatus,
                      userId ?? null,
                      existingSerial.id,
                    ],
                  );
                }
              }
            }
          }
        }

        const normalizedStatus = this.normalizeWorkflowStatus(status);
        const normalizedPreviousStatus = this.normalizeWorkflowStatus(existingSales.status);
        const normalizedRemarks = String(payload.remarks ?? '').trim().toLowerCase();
        const isReturnedToPendingFlow =
          normalizedStatus === 'pending' &&
          normalizedPreviousStatus === 'for-delivery' &&
          normalizedRemarks.startsWith('returned units:');
        const shouldReleaseReturnedSerials =
          normalizedStatus === 'returned' ||
          normalizedStatus === 'return' ||
          isReturnedToPendingFlow;

        if (shouldReleaseReturnedSerials) {
          const serialColumns = await this.getTableColumns(client, 'tblserial_numbers');
          const serialSalesIdColumn = this.pickColumn(serialColumns, ['salesId', 'sales_id']);
          const serialStatusColumn = this.pickColumn(serialColumns, ['status']);
          const serialCustomerIdColumn = this.pickColumn(serialColumns, ['customerId', 'customer_id']);

          if (!serialSalesIdColumn) {
            throw new Error('Sales reference column is not configured in tblserial_numbers');
          }

          const serialResetParams: unknown[] = [null];
          const serialResetSet: string[] = [`"${serialSalesIdColumn}" = $1`];

          if (serialStatusColumn) {
            serialResetParams.push('in-stock');
            serialResetSet.push(`"${serialStatusColumn}" = $${serialResetParams.length}`);
          }

          if (serialCustomerIdColumn) {
            serialResetParams.push(null);
            serialResetSet.push(`"${serialCustomerIdColumn}" = $${serialResetParams.length}`);
          }

          serialResetParams.push(id);

          await client.query(
            `UPDATE tblserial_numbers
             SET ${serialResetSet.join(', ')}
             WHERE "${serialSalesIdColumn}" = $${serialResetParams.length}`,
            serialResetParams,
          );
        }

        if (normalizedStatus === 'for-delivery') {
          await this.updateLinkedSalesSerialStatuses(client, id, 'for-delivery', [
            'reserved',
            'pending',
            'scanned',
          ]);
        }

        if (['remitted', 'complete', 'completed'].includes(normalizedStatus)) {
          await this.updateLinkedSalesSerialStatuses(client, id, 'installed');
        }

        const materialSync = await this.materialStockService.applyFromSalesStatusChange(client, {
          salesOrderId: id,
          previousStatus: existingSales.status,
          nextStatus: status,
          remarks: String(payload.remarks ?? ''),
          userId,
        });

        return {
          salesOrderId: id,
          customerId,
          totalAmount,
          status,
          materialSync,
        };
      });

      return {
        success: true,
        message: 'Sales order updated successfully',
        data: result,
      };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to update sales order',
      };
    }
  }

  remove(id: number) {
    return `This action removes a #${id} salesOrder`;
  }
}
