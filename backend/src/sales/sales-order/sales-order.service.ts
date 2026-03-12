import { BadRequestException, Injectable } from '@nestjs/common';
import { CreateSalesOrderDto } from './dto/create-sales-order.dto';
import { CreateStatementOfAccountDto } from './dto/create-statement-of-account.dto';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { UpdateSalesOrderDto } from './dto/update-sales-order.dto';
import { DatabaseService } from 'src/database/database.service';
import { PoolClient } from 'pg';
import { randomUUID } from 'crypto';
import { ListSalesOrderQueryDto } from './dto/list-sales-order-query.dto';
import { MaterialStockService } from 'src/inventory/material-stock/material-stock.service';
import { MaterialTransactionsService } from 'src/inventory/material-transactions/material-transactions.service';
import { MaterialsService } from 'src/inventory/materials/materials.service';

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
    private readonly materialTransactionsService: MaterialTransactionsService,
    private readonly materialsService: MaterialsService,
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
        'sub-dealer',
        'sales and service',
        'sales & service',
        'sales-and-service',
        'sales_and_service'
      )`);
    } else if (mode === 'services') {
      whereParts.push(`(
        LOWER(COALESCE(base.sales_type, '')) IN (
          'service',
          'services',
          'sales and service',
          'sales & service',
          'sales-and-service',
          'sales_and_service'
        )
        OR EXISTS (SELECT 1 FROM tblservice_details sd WHERE sd.sales_id = base.id)
      )`);
    } else if (mode === 'projects') {
      whereParts.push(`(
        LOWER(COALESCE(base.sales_type, '')) IN ('project', 'projects')
        OR EXISTS (SELECT 1 FROM tblproject_details pd WHERE pd.sales_id = base.id)
      )`);
    } else if (mode === 'distribution') {
      whereParts.push(`(
        LOWER(COALESCE(base.sales_type, '')) IN (
          'distribution',
          'transfer',
          'transfers',
          'sub-dealer',
          'sub dealer',
          'sub_dealer'
        )
        OR EXISTS (SELECT 1 FROM tbltransfer_details td WHERE td.sales_id = base.id)
      )`);
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
          COALESCE(
            to_jsonb(so)->>'projectName',
            to_jsonb(so)->>'project_name',
            ''
          ) AS project_name,
          COALESCE(
            to_jsonb(so)->>'projectCode',
            to_jsonb(so)->>'project_code',
            ''
          ) AS project_code,
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
        base.project_name AS "projectName",
        base.project_code AS "projectCode",
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
      projectName: string | null;
      projectCode: string | null;
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
        projectName: row.projectName ?? '',
        projectCode: row.projectCode ?? '',
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
    const serviceItems = Array.isArray(payload.serviceItems) ? payload.serviceItems : [];

    const hasProductItems = productItems.length > 0;
    const hasServiceItems = serviceItems.length > 0;
    const hasProjectInfo = Boolean(
      payload.projectDetails || payload.projectName || payload.projectCode,
    );
    const hasTransferInfo = Boolean(payload.transferDetails);
    const hasConcernInfo = Boolean(payload.concernDetails);

    if (!hasProductItems && !hasServiceItems && !hasProjectInfo && !hasTransferInfo && !hasConcernInfo) {
      return {
        success: false,
        message:
          'At least one sales product item, service item, project detail, transfer detail, or concern detail is required',
      };
    }

    try {
      const result = await this.databaseService.withTransaction(async (client) => {
        let customerId = String(payload.customer_id ?? '').trim();
        const customerColumns = await this.getTableColumns(client, 'tblcustomer');
        const customerIdColumn = this.pickColumn(customerColumns, ['id']);
        const customerNameColumn = this.pickColumn(customerColumns, ['name']);
        const customerTypeColumn = this.pickColumn(customerColumns, ['customer_type', 'customerType']);
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

        const requestedCustomerType = String(payload.customer?.customer_type ?? '').trim();

        if (customerId) {
          const existingCustomer = await client.query<{ id: string }>(
            `SELECT id FROM tblcustomer WHERE id::text = $1 LIMIT 1`,
            [customerId],
          );

          if (existingCustomer.rowCount === 0) {
            customerId = '';
          } else if (customerTypeColumn && requestedCustomerType) {
            // Ensure existing customers are updated if sales type implies a sub-dealer
            await client.query(
              `UPDATE tblcustomer SET ${customerTypeColumn} = $1 WHERE id::text = $2`,
              [requestedCustomerType, customerId],
            );
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
        const customerType = String(payload.customer?.customer_type ?? '').trim();
        const customerTypeColumn = this.pickColumn(customerColumns, ['customer_type', 'customerType']);

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
          if (customerTypeColumn && customerType) {
            customerRecord[customerTypeColumn] = customerType;
          }

          const insertedCustomer = await this.runInsert(client, 'tblcustomer', customerRecord);
          if (insertedCustomer.rowCount === 0) {
            throw new Error('Failed to create customer');
          }

          customerId = String(insertedCustomer.rows[0].id);
        }

        let computedProductTotal = 0;
        for (const item of productItems) {
          const unitPrice = this.toOptionalNumber(item.unitPrice) ?? 0;
          const sellPrice = this.toOptionalNumber(item.sellPrice) ?? 0;
          const discountPrice = this.toOptionalNumber(item.discountPrice) ?? 0;
          const qty = this.toOptionalNumber(item.totalSetQty) ?? 0;
          const priceToUse = discountPrice > 0 ? discountPrice : sellPrice > 0 ? sellPrice : unitPrice;
          computedProductTotal += priceToUse * qty;
        }

        let computedServiceTotal = 0;
        for (const item of serviceItems) {
          const unitPrice = this.toOptionalNumber(item.serviceCost) ?? 0;
          const qty = this.toOptionalNumber(item.serviceDurationHours) ?? 0;
          const total = this.toOptionalNumber(item.serviceCost) ?? 0;

          // Prefer explicit total if provided, otherwise derive from unit price and quantity
          computedServiceTotal += total > 0 ? total : unitPrice * qty;
        }

        const computedTotalAmount = computedProductTotal + computedServiceTotal;
        const fallbackTotal = this.toOptionalNumber(payload.totalAmount) ?? 0;
        const totalAmount = computedTotalAmount > 0 ? computedTotalAmount : fallbackTotal;

        const salesColumns = await this.getTableColumns(client, 'tblsales_order');
        const soNumberColumn = this.pickColumn(salesColumns, ['so_number', 'soNumber']);
        const salesCustomerIdColumn = this.pickColumn(salesColumns, ['customer_id', 'customerId']);
        const totalAmountColumn = this.pickColumn(salesColumns, ['total_amount', 'totalAmount']);
        const scheduleDateColumn = this.pickColumn(salesColumns, ['scheduleDate', 'schedule_date']);
        const salesTypeColumn = this.pickColumn(salesColumns, ['salesType', 'sales_type']);
        const projectNameColumn = this.pickColumn(salesColumns, ['projectName', 'project_name']);
        const projectCodeColumn = this.pickColumn(salesColumns, ['projectCode', 'project_code']);
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
        if (projectNameColumn && payload['projectName'] !== undefined) {
          salesRecord[projectNameColumn] = String(payload['projectName'] ?? '').trim();
        }
        if (projectCodeColumn && payload['projectCode'] !== undefined) {
          salesRecord[projectCodeColumn] = String(payload['projectCode'] ?? '').trim();
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

        // Persist service details (if any)
        if (hasServiceItems) {
          const serviceColumns = await this.getTableColumns(client, 'tblservice_details');
          const serviceSalesIdColumn = this.pickColumn(serviceColumns, ['sales_id', 'salesId']);
          const serviceNameColumn = this.pickColumn(serviceColumns, ['service_name', 'serviceName']);
          const serviceDescriptionColumn = this.pickColumn(serviceColumns, ['service_description', 'serviceDescription']);
          const serviceTypeColumn = this.pickColumn(serviceColumns, ['service_type', 'serviceType']);
          const technicianAssignedColumn = this.pickColumn(serviceColumns, ['technician_assigned', 'technicianAssigned']);
          const serviceDateColumn = this.pickColumn(serviceColumns, ['service_date', 'serviceDate']);
          const serviceDurationHoursColumn = this.pickColumn(serviceColumns, ['service_duration_hours', 'serviceDurationHours']);
          const serviceCostColumn = this.pickColumn(serviceColumns, ['service_cost', 'serviceCost']);
          const partsCostColumn = this.pickColumn(serviceColumns, ['parts_cost', 'partsCost']);
          const laborCostColumn = this.pickColumn(serviceColumns, ['labor_cost', 'laborCost']);
          const serviceStatusColumn = this.pickColumn(serviceColumns, ['service_status', 'serviceStatus']);
          const serviceNotesColumn = this.pickColumn(serviceColumns, ['service_notes', 'serviceNotes']);

          if (serviceSalesIdColumn) {
            for (const item of serviceItems) {
              const record: Record<string, unknown> = {
                [serviceSalesIdColumn]: salesOrderId,
              };

              if (serviceNameColumn && item.serviceName !== undefined) {
                record[serviceNameColumn] = String(item.serviceName ?? '').trim();
              }
              if (serviceDescriptionColumn && item.serviceDescription !== undefined) {
                record[serviceDescriptionColumn] = String(item.serviceDescription ?? '').trim();
              }
              if (serviceTypeColumn && item.serviceType !== undefined) {
                record[serviceTypeColumn] = String(item.serviceType ?? '').trim();
              }
              if (technicianAssignedColumn && item.technicianAssigned !== undefined) {
                record[technicianAssignedColumn] = String(item.technicianAssigned ?? '').trim();
              }
              if (serviceDateColumn && item.serviceDate !== undefined) {
                record[serviceDateColumn] = this.toIsoDateOrNull(item.serviceDate);
              }
              if (serviceDurationHoursColumn && item.serviceDurationHours !== undefined) {
                record[serviceDurationHoursColumn] = this.toOptionalNumber(item.serviceDurationHours);
              }
              if (serviceCostColumn && item.serviceCost !== undefined) {
                record[serviceCostColumn] = this.toOptionalNumber(item.serviceCost) ?? 0;
              }
              if (partsCostColumn && item.partsCost !== undefined) {
                record[partsCostColumn] = this.toOptionalNumber(item.partsCost) ?? 0;
              }
              if (laborCostColumn && item.laborCost !== undefined) {
                record[laborCostColumn] = this.toOptionalNumber(item.laborCost) ?? 0;
              }
              if (serviceStatusColumn && item.serviceStatus !== undefined) {
                record[serviceStatusColumn] = String(item.serviceStatus ?? '').trim();
              }
              if (serviceNotesColumn && item.serviceNotes !== undefined) {
                record[serviceNotesColumn] = String(item.serviceNotes ?? '').trim();
              }

              await this.runInsert(client, 'tblservice_details', record);
            }
          }
        }

        // Persist project details (if provided)
        const projectDetails = payload.projectDetails;
        if (projectDetails || payload.projectName || payload.projectCode) {
          const projectColumns = await this.getTableColumns(client, 'tblproject_details');
          const projectSalesIdColumn = this.pickColumn(projectColumns, ['sales_id', 'salesId']);
          const projectNameColumn = this.pickColumn(projectColumns, ['project_name', 'projectName']);
          const projectCodeColumn = this.pickColumn(projectColumns, ['project_code', 'projectCode']);
          const projectLocationColumn = this.pickColumn(projectColumns, ['project_location', 'projectLocation']);
          const projectStartDateColumn = this.pickColumn(projectColumns, ['project_start_date', 'projectStartDate']);
          const projectEndDateColumn = this.pickColumn(projectColumns, ['project_end_date', 'projectEndDate']);
          const projectManagerColumn = this.pickColumn(projectColumns, ['project_manager', 'projectManager']);
          const projectStatusColumn = this.pickColumn(projectColumns, ['project_status', 'projectStatus']);
          const projectNotesColumn = this.pickColumn(projectColumns, ['project_notes', 'projectNotes']);

          if (projectSalesIdColumn) {
            // Upsert behavior: remove any existing project details for this sales order
            await client.query(
              `DELETE FROM tblproject_details WHERE "${projectSalesIdColumn}" = $1`,
              [salesOrderId],
            );

            const record: Record<string, unknown> = {
              [projectSalesIdColumn]: salesOrderId,
            };

            const details = projectDetails ?? {
              projectName: payload.projectName,
              projectCode: payload.projectCode,
            };

            if (projectNameColumn && details?.projectName !== undefined) {
              record[projectNameColumn] = String(details.projectName ?? '').trim();
            }
            if (projectCodeColumn && details?.projectCode !== undefined) {
              record[projectCodeColumn] = String(details.projectCode ?? '').trim();
            }
            if (projectLocationColumn && details?.projectLocation !== undefined) {
              record[projectLocationColumn] = String(details.projectLocation ?? '').trim();
            }
            if (projectStartDateColumn && details?.projectStartDate !== undefined) {
              record[projectStartDateColumn] = this.toIsoDateOrNull(details.projectStartDate);
            }
            if (projectEndDateColumn && details?.projectEndDate !== undefined) {
              record[projectEndDateColumn] = this.toIsoDateOrNull(details.projectEndDate);
            }
            if (projectManagerColumn && details?.projectManager !== undefined) {
              record[projectManagerColumn] = String(details.projectManager ?? '').trim();
            }
            if (projectStatusColumn && details?.projectStatus !== undefined) {
              record[projectStatusColumn] = String(details.projectStatus ?? '').trim();
            }
            if (projectNotesColumn && details?.projectNotes !== undefined) {
              record[projectNotesColumn] = String(details.projectNotes ?? '').trim();
            }

            await this.runInsert(client, 'tblproject_details', record);
          }
        }

        // Persist transfer details (if provided)
        let transferDetailsId: number | null = null;
        if (payload.transferDetails) {
          const transferColumns = await this.getTableColumns(client, 'tbltransfer_details');
          const transferSalesIdColumn = this.pickColumn(transferColumns, ['sales_id', 'salesId']);
          const fromBranchIdColumn = this.pickColumn(transferColumns, ['from_branch_id', 'fromBranchId']);
          const toBranchIdColumn = this.pickColumn(transferColumns, ['to_branch_id', 'toBranchId']);
          const transferDateColumn = this.pickColumn(transferColumns, ['transfer_date', 'transferDate']);
          const expectedDeliveryDateColumn = this.pickColumn(transferColumns, ['expected_delivery_date', 'expectedDeliveryDate']);
          const actualDeliveryDateColumn = this.pickColumn(transferColumns, ['actual_delivery_date', 'actualDeliveryDate']);
          const transferStatusColumn = this.pickColumn(transferColumns, ['transfer_status', 'transferStatus']);
          const transferNotesColumn = this.pickColumn(transferColumns, ['transfer_notes', 'transferNotes']);
          const sentByColumn = this.pickColumn(transferColumns, ['sent_by', 'sentBy']);
          const receivedByColumn = this.pickColumn(transferColumns, ['received_by', 'receivedBy']);
          const acknowledgedByColumn = this.pickColumn(transferColumns, ['acknowledged_by', 'acknowledgedBy']);
          const acknowledgedAtColumn = this.pickColumn(transferColumns, ['acknowledged_at', 'acknowledgedAt']);

          if (transferSalesIdColumn) {
            await client.query(
              `DELETE FROM tbltransfer_details WHERE "${transferSalesIdColumn}" = $1`,
              [salesOrderId],
            );

            const record: Record<string, unknown> = {
              [transferSalesIdColumn]: salesOrderId,
            };

            const details = payload.transferDetails;
            if (fromBranchIdColumn && details.fromBranchId !== undefined) {
              record[fromBranchIdColumn] = this.toOptionalNumber(details.fromBranchId);
            }
            if (toBranchIdColumn && details.toBranchId !== undefined) {
              record[toBranchIdColumn] = this.toOptionalNumber(details.toBranchId);
            }
            if (transferDateColumn && details.transferDate !== undefined) {
              record[transferDateColumn] = this.toIsoDateOrNull(details.transferDate);
            }
            if (expectedDeliveryDateColumn && details.expectedDeliveryDate !== undefined) {
              record[expectedDeliveryDateColumn] = this.toIsoDateOrNull(details.expectedDeliveryDate);
            }
            if (actualDeliveryDateColumn && details.actualDeliveryDate !== undefined) {
              record[actualDeliveryDateColumn] = this.toIsoDateOrNull(details.actualDeliveryDate);
            }
            if (transferStatusColumn && details.transferStatus !== undefined) {
              record[transferStatusColumn] = String(details.transferStatus ?? '').trim();
            }
            if (transferNotesColumn && details.transferNotes !== undefined) {
              record[transferNotesColumn] = String(details.transferNotes ?? '').trim();
            }
            if (sentByColumn && details.sentBy !== undefined) {
              record[sentByColumn] = this.toOptionalNumber(details.sentBy);
            }
            if (receivedByColumn && details.receivedBy !== undefined) {
              record[receivedByColumn] = this.toOptionalNumber(details.receivedBy);
            }
            if (acknowledgedByColumn && details.acknowledgedBy !== undefined) {
              record[acknowledgedByColumn] = this.toOptionalNumber(details.acknowledgedBy);
            }
            if (acknowledgedAtColumn && details.acknowledgedAt !== undefined) {
              record[acknowledgedAtColumn] = this.toIsoDateOrNull(details.acknowledgedAt);
            }

            const insertedTransfer = await this.runInsert(client, 'tbltransfer_details', record);
            transferDetailsId = Number(insertedTransfer.rows[0]?.id ?? null);
          }
        }

        // Persist expense details (if provided)
        if (payload.expenseDetails && transferDetailsId) {
          const expenseColumns = await this.getTableColumns(client, 'tblexpense_details');
          const expenseSalesIdColumn = this.pickColumn(expenseColumns, ['sales_id', 'salesId']);
          const expenseTransferIdColumn = this.pickColumn(expenseColumns, ['transfer_id', 'transferId']);
          const expenseTypeColumn = this.pickColumn(expenseColumns, ['expense_type', 'expenseType']);
          const expenseDescriptionColumn = this.pickColumn(expenseColumns, ['expense_description', 'expenseDescription']);
          const amountColumn = this.pickColumn(expenseColumns, ['amount']);
          const expenseDateColumn = this.pickColumn(expenseColumns, ['expense_date', 'expenseDate']);
          const paidToColumn = this.pickColumn(expenseColumns, ['paid_to', 'paidTo']);
          const paymentMethodColumn = this.pickColumn(expenseColumns, ['payment_method', 'paymentMethod']);
          const referenceNoColumn = this.pickColumn(expenseColumns, ['reference_no', 'referenceNo']);
          const createdByColumn = this.pickColumn(expenseColumns, ['created_by', 'createdBy']);

          if (expenseSalesIdColumn) {
            await client.query(
              `DELETE FROM tblexpense_details WHERE "${expenseSalesIdColumn}" = $1`,
              [salesOrderId],
            );

            for (const expense of payload.expenseDetails) {
              const record: Record<string, unknown> = {};

              record[expenseSalesIdColumn] = salesOrderId;
              record[expenseTransferIdColumn ?? 'transfer_id'] = transferDetailsId;
              if (expenseTypeColumn && expense.expenseType !== undefined) {
                record[expenseTypeColumn] = String(expense.expenseType ?? '').trim();
              }
              if (expenseDescriptionColumn && expense.expenseDescription !== undefined) {
                record[expenseDescriptionColumn] = String(expense.expenseDescription ?? '').trim();
              }
              if (amountColumn) {
                record[amountColumn] = this.toOptionalNumber(expense.amount) ?? 0;
              }
              if (expenseDateColumn && expense.expenseDate !== undefined) {
                record[expenseDateColumn] = this.toIsoDateOrNull(expense.expenseDate);
              }
              if (paidToColumn && expense.paidTo !== undefined) {
                record[paidToColumn] = String(expense.paidTo ?? '').trim();
              }
              if (paymentMethodColumn && expense.paymentMethod !== undefined) {
                record[paymentMethodColumn] = String(expense.paymentMethod ?? '').trim();
              }
              if (referenceNoColumn && expense.referenceNo !== undefined) {
                record[referenceNoColumn] = String(expense.referenceNo ?? '').trim();
              }
              if (createdByColumn && userId !== undefined) {
                record[createdByColumn] = userId;
              }

              await this.runInsert(client, 'tblexpense_details', record);
            }
          }
        }

        // Persist concern details (if provided)
        if (payload.concernDetails) {
          const concernColumns = await this.getTableColumns(client, 'tblconcern_details');
          const concernSalesIdColumn = this.pickColumn(concernColumns, ['sales_id', 'salesId']);
          const concernCustomerIdColumn = this.pickColumn(concernColumns, ['customer_id', 'customerId']);
          const concernTypeColumn = this.pickColumn(concernColumns, ['concern_type', 'concernType']);
          const concernSubjectColumn = this.pickColumn(concernColumns, ['concern_subject', 'concernSubject']);
          const concernDescriptionColumn = this.pickColumn(concernColumns, ['concern_description', 'concernDescription']);
          const concernStatusColumn = this.pickColumn(concernColumns, ['concern_status', 'concernStatus']);
          const priorityColumn = this.pickColumn(concernColumns, ['priority']);
          const assignedToColumn = this.pickColumn(concernColumns, ['assigned_to', 'assignedTo']);
          const resolutionNotesColumn = this.pickColumn(concernColumns, ['resolution_notes', 'resolutionNotes']);
          const resolvedAtColumn = this.pickColumn(concernColumns, ['resolved_at', 'resolvedAt']);

          if (concernSalesIdColumn) {
            await client.query(
              `DELETE FROM tblconcern_details WHERE "${concernSalesIdColumn}" = $1`,
              [salesOrderId],
            );

            const record: Record<string, unknown> = {
              [concernSalesIdColumn]: salesOrderId,
            };

            const details = payload.concernDetails;
            if (concernCustomerIdColumn && details.customerId !== undefined) {
              record[concernCustomerIdColumn] = String(details.customerId ?? '').trim();
            }
            if (concernTypeColumn && details.concernType !== undefined) {
              record[concernTypeColumn] = String(details.concernType ?? '').trim();
            }
            if (concernSubjectColumn && details.concernSubject !== undefined) {
              record[concernSubjectColumn] = String(details.concernSubject ?? '').trim();
            }
            if (concernDescriptionColumn && details.concernDescription !== undefined) {
              record[concernDescriptionColumn] = String(details.concernDescription ?? '').trim();
            }
            if (concernStatusColumn && details.concernStatus !== undefined) {
              record[concernStatusColumn] = String(details.concernStatus ?? '').trim();
            }
            if (priorityColumn && details.priority !== undefined) {
              record[priorityColumn] = String(details.priority ?? '').trim();
            }
            if (assignedToColumn && details.assignedTo !== undefined) {
              record[assignedToColumn] = this.toOptionalNumber(details.assignedTo);
            }
            if (resolutionNotesColumn && details.resolutionNotes !== undefined) {
              record[resolutionNotesColumn] = String(details.resolutionNotes ?? '').trim();
            }
            if (resolvedAtColumn && details.resolvedAt !== undefined) {
              record[resolvedAtColumn] = this.toIsoDateOrNull(details.resolvedAt);
            }

            await this.runInsert(client, 'tblconcern_details', record);
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

  async listCustomers(options: { search?: string; type?: string; page?: number; limit?: number }) {
    const page = Math.max(1, Number(options.page ?? 1));
    const limit = Math.max(1, Math.min(200, Number(options.limit ?? 50)));
    const offset = (page - 1) * limit;

    const search = String(options.search ?? '').trim();
    const type = String(options.type ?? '').trim();

    try {
      const params: unknown[] = [];
      const whereParts: string[] = [];

      if (search) {
        params.push(`%${search}%`);
        whereParts.push(
          `LOWER(COALESCE(to_jsonb(c)->>'name', to_jsonb(c)->>'customer_name', '')) LIKE LOWER($${
            params.length
          })`,
        );
      }

      if (type) {
        params.push(type);
        whereParts.push(
          `LOWER(COALESCE(to_jsonb(c)->>'customer_type', to_jsonb(c)->>'customerType', 'regular')) = LOWER($${
            params.length
          })`,
        );
      }

      const whereSql = whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : '';

      const countResult = await this.databaseService.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM tblcustomer c ${whereSql}`,
        params,
      );
      const total = Number(countResult.rows[0]?.count ?? 0);
      const totalPages = Math.max(1, Math.ceil(total / limit));

      const listParams = [...params, limit, offset];
      const listResult = await this.databaseService.query<{
        id: string;
        name: string | null;
        customerType: string | null;
        creditLimit: string | null;
        currentBalance: string | null;
        paymentTerms: string | null;
        address: string | null;
        contactPerson: string | null;
        contactNumber: string | null;
        email: string | null;
        tinNumber: string | null;
        createdAt: string | null;
        updatedAt: string | null;
      }>(
        `SELECT
           c.id::text AS id,
           COALESCE(to_jsonb(c)->>'name', to_jsonb(c)->>'customer_name') AS name,
           COALESCE(to_jsonb(c)->>'customer_type', to_jsonb(c)->>'customerType', 'regular') AS "customerType",
           COALESCE(to_jsonb(c)->>'credit_limit', '') AS "creditLimit",
           COALESCE(to_jsonb(c)->>'current_balance', '') AS "currentBalance",
           COALESCE(to_jsonb(c)->>'payment_terms', '') AS "paymentTerms",
           COALESCE(to_jsonb(c)->>'address', '') AS address,
           COALESCE(to_jsonb(c)->>'contact_person', to_jsonb(c)->>'contactPerson', '') AS "contactPerson",
           COALESCE(to_jsonb(c)->>'contact_number', to_jsonb(c)->>'contactNumber', '') AS "contactNumber",
           COALESCE(to_jsonb(c)->>'email', '') AS email,
           COALESCE(to_jsonb(c)->>'tin_number', to_jsonb(c)->>'tinNumber', '') AS "tinNumber",
           COALESCE(to_jsonb(c)->>'created_at', to_jsonb(c)->>'createdAt', null) AS "createdAt",
           COALESCE(to_jsonb(c)->>'updated_at', to_jsonb(c)->>'updatedAt', null) AS "updatedAt"
         FROM tblcustomer c
         ${whereSql}
         ORDER BY COALESCE(to_jsonb(c)->>'name', to_jsonb(c)->>'customer_name', '') ASC
         LIMIT $${listParams.length - 1}
         OFFSET $${listParams.length}`,
        listParams,
      );

      return {
        success: true,
        items: listResult.rows.map((row) => ({
          id: row.id,
          name: row.name ?? row.id,
          customer_type: row.customerType ?? 'regular',
          credit_limit: this.toOptionalNumber(row.creditLimit) ?? 0,
          current_balance: this.toOptionalNumber(row.currentBalance) ?? 0,
          payment_terms: this.toOptionalNumber(row.paymentTerms) ?? 0,
          address: row.address ?? '',
          contact_person: row.contactPerson ?? '',
          contact_number: row.contactNumber ?? '',
          email: row.email ?? '',
          tin_number: row.tinNumber ?? '',
          created_at: row.createdAt ?? null,
          updated_at: row.updatedAt ?? null,
        })),
        meta: {
          page,
          limit,
          total,
          totalPages,
        },
      };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to list customers',
        items: [],
        meta: {
          page,
          limit,
          total: 0,
          totalPages: 1,
        },
      };
    }
  }

  async getCustomer(customerId: string) {
    const id = String(customerId ?? '').trim();
    if (!id) {
      return { success: false, message: 'Invalid customer id' };
    }

    try {
      const result = await this.databaseService.query<{
        id: string;
        name: string | null;
        customerType: string | null;
        creditLimit: string | null;
        currentBalance: string | null;
        paymentTerms: string | null;
        address: string | null;
        contactPerson: string | null;
        contactNumber: string | null;
        email: string | null;
        tinNumber: string | null;
        createdAt: string | null;
        updatedAt: string | null;
      }>(
        `SELECT
           c.id::text AS id,
           COALESCE(to_jsonb(c)->>'name', to_jsonb(c)->>'customer_name') AS name,
           COALESCE(to_jsonb(c)->>'customer_type', to_jsonb(c)->>'customerType', 'regular') AS "customerType",
           COALESCE(to_jsonb(c)->>'credit_limit', '') AS "creditLimit",
           COALESCE(to_jsonb(c)->>'current_balance', '') AS "currentBalance",
           COALESCE(to_jsonb(c)->>'payment_terms', '') AS "paymentTerms",
           COALESCE(to_jsonb(c)->>'address', '') AS address,
           COALESCE(to_jsonb(c)->>'contact_person', to_jsonb(c)->>'contactPerson', '') AS "contactPerson",
           COALESCE(to_jsonb(c)->>'contact_number', to_jsonb(c)->>'contactNumber', '') AS "contactNumber",
           COALESCE(to_jsonb(c)->>'email', '') AS email,
           COALESCE(to_jsonb(c)->>'tin_number', to_jsonb(c)->>'tinNumber', '') AS "tinNumber",
           COALESCE(to_jsonb(c)->>'created_at', to_jsonb(c)->>'createdAt', null) AS "createdAt",
           COALESCE(to_jsonb(c)->>'updated_at', to_jsonb(c)->>'updatedAt', null) AS "updatedAt"
         FROM tblcustomer c
         WHERE c.id::text = $1
         LIMIT 1`,
        [id],
      );

      if (result.rowCount === 0) {
        return { success: false, message: `Customer ${id} not found` };
      }

      const row = result.rows[0];
      return {
        success: true,
        data: {
          id: row.id,
          name: row.name ?? row.id,
          customer_type: row.customerType ?? 'regular',
          credit_limit: this.toOptionalNumber(row.creditLimit) ?? 0,
          current_balance: this.toOptionalNumber(row.currentBalance) ?? 0,
          payment_terms: this.toOptionalNumber(row.paymentTerms) ?? 0,
          address: row.address ?? '',
          contact_person: row.contactPerson ?? '',
          contact_number: row.contactNumber ?? '',
          email: row.email ?? '',
          tin_number: row.tinNumber ?? '',
          created_at: row.createdAt ?? null,
          updated_at: row.updatedAt ?? null,
        },
      };
    } catch (error) {
      return { success: false, message: error instanceof Error ? error.message : 'Failed to get customer' };
    }
  }

  async createCustomer(dto: CreateCustomerDto, userId?: number) {
    try {
      const customerColumns = await this.getTableColumns(this.databaseService, 'tblcustomer');
      const customerIdColumn = this.pickColumn(customerColumns, ['id']);
      const customerNameColumn = this.pickColumn(customerColumns, ['name', 'customer_name']);
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
      const customerTypeColumn = this.pickColumn(customerColumns, ['customer_type', 'customerType']);
      const creditLimitColumn = this.pickColumn(customerColumns, ['credit_limit', 'creditLimit']);
      const paymentTermsColumn = this.pickColumn(customerColumns, ['payment_terms', 'paymentTerms']);
      const createdAtColumn = this.pickColumn(customerColumns, ['created_at', 'createdAt']);

      const name = String(dto.name ?? '').trim();
      if (!name) {
        return { success: false, message: 'Customer name is required' };
      }

      const record: Record<string, unknown> = {};
      if (customerNameColumn) record[customerNameColumn] = name;
      if (customerIdColumn) record[customerIdColumn] = randomUUID();
      if (customerAddressColumn && dto.address) record[customerAddressColumn] = String(dto.address).trim();
      if (customerContactPersonColumn && dto.contactPerson)
        record[customerContactPersonColumn] = String(dto.contactPerson).trim();
      if (customerContactNumberColumn && dto.contactNumber)
        record[customerContactNumberColumn] = String(dto.contactNumber).trim();
      if (customerEmailColumn && dto.email) record[customerEmailColumn] = String(dto.email).trim();
      if (customerTinColumn && dto.tinNumber) record[customerTinColumn] = String(dto.tinNumber).trim();
      if (customerTypeColumn && dto.customerType)
        record[customerTypeColumn] = String(dto.customerType).trim();
      if (creditLimitColumn && dto.creditLimit !== undefined)
        record[creditLimitColumn] = this.toOptionalNumber(dto.creditLimit) ?? 0;
      if (paymentTermsColumn && dto.paymentTerms !== undefined)
        record[paymentTermsColumn] = this.toOptionalNumber(dto.paymentTerms) ?? 0;
      if (createdAtColumn) record[createdAtColumn] = new Date().toISOString();

      const inserted = await this.runInsert(this.databaseService, 'tblcustomer', record);
      return {
        success: true,
        data: { id: String(inserted.rows[0]?.id ?? '') },
      };
    } catch (error) {
      return { success: false, message: error instanceof Error ? error.message : 'Failed to create customer' };
    }
  }

  async updateCustomer(customerId: string, dto: UpdateCustomerDto) {
    const id = String(customerId ?? '').trim();
    if (!id) {
      return { success: false, message: 'Invalid customer id' };
    }

    try {
      const customerColumns = await this.getTableColumns(this.databaseService, 'tblcustomer');
      const customerNameColumn = this.pickColumn(customerColumns, ['name', 'customer_name']);
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
      const customerTypeColumn = this.pickColumn(customerColumns, ['customer_type', 'customerType']);
      const creditLimitColumn = this.pickColumn(customerColumns, ['credit_limit', 'creditLimit']);
      const paymentTermsColumn = this.pickColumn(customerColumns, ['payment_terms', 'paymentTerms']);
      const updatedAtColumn = this.pickColumn(customerColumns, ['updated_at', 'updatedAt']);

      const record: Record<string, unknown> = {};
      if (customerNameColumn && dto.name !== undefined) record[customerNameColumn] = String(dto.name ?? '').trim();
      if (customerAddressColumn && dto.address !== undefined)
        record[customerAddressColumn] = String(dto.address ?? '').trim();
      if (customerContactPersonColumn && dto.contactPerson !== undefined)
        record[customerContactPersonColumn] = String(dto.contactPerson ?? '').trim();
      if (customerContactNumberColumn && dto.contactNumber !== undefined)
        record[customerContactNumberColumn] = String(dto.contactNumber ?? '').trim();
      if (customerEmailColumn && dto.email !== undefined)
        record[customerEmailColumn] = String(dto.email ?? '').trim();
      if (customerTinColumn && dto.tinNumber !== undefined)
        record[customerTinColumn] = String(dto.tinNumber ?? '').trim();
      if (customerTypeColumn && dto.customerType !== undefined)
        record[customerTypeColumn] = String(dto.customerType ?? '').trim();
      if (creditLimitColumn && dto.creditLimit !== undefined)
        record[creditLimitColumn] = this.toOptionalNumber(dto.creditLimit) ?? 0;
      if (paymentTermsColumn && dto.paymentTerms !== undefined)
        record[paymentTermsColumn] = this.toOptionalNumber(dto.paymentTerms) ?? 0;
      if (updatedAtColumn) record[updatedAtColumn] = new Date().toISOString();

      const columns = Object.keys(record);
      if (columns.length === 0) {
        return { success: true, message: 'No changes provided' };
      }

      const setClauses = columns.map((col, idx) => `"${col}" = $${idx + 1}`);
      const values = Object.values(record);
      const result = await this.databaseService.query(
        `UPDATE tblcustomer SET ${setClauses.join(', ')} WHERE id::text = $${values.length + 1}`,
        [...values, id],
      );

      return {
        success: true,
        data: { updated: result.rowCount },
      };
    } catch (error) {
      return { success: false, message: error instanceof Error ? error.message : 'Failed to update customer' };
    }
  }

  async deleteCustomer(customerId: string) {
    const id = String(customerId ?? '').trim();
    if (!id) {
      return { success: false, message: 'Invalid customer id' };
    }

    try {
      const result = await this.databaseService.query(
        `DELETE FROM tblcustomer WHERE id::text = $1`,
        [id],
      );
      return { success: true, data: { deleted: result.rowCount } };
    } catch (error) {
      return { success: false, message: error instanceof Error ? error.message : 'Failed to delete customer' };
    }
  }

  async getCustomerOrders(
    customerId: string,
    query: { page?: number; limit?: number },
  ) {
    const id = String(customerId ?? '').trim();
    if (!id) {
      return { success: false, message: 'Invalid customer id', items: [], meta: { page: 1, limit: 0, total: 0, totalPages: 1 } };
    }

    const page = Math.max(1, Number(query.page ?? 1));
    const limit = Math.max(1, Math.min(200, Number(query.limit ?? 50)));
    const offset = (page - 1) * limit;

    try {
      const countResult = await this.databaseService.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM tblsales_order so
         WHERE COALESCE(to_jsonb(so)->>'customer_id', to_jsonb(so)->>'customerId', '') = $1`,
        [id],
      );
      const total = Number(countResult.rows[0]?.count ?? 0);
      const totalPages = Math.max(1, Math.ceil(total / limit));

      const result = await this.databaseService.query<{
        id: number;
        soNumber: string | null;
        totalAmount: string | null;
        status: string | null;
        salesType: string | null;
        createdAt: string | null;
      }>(
        `SELECT
           so.id,
           COALESCE(to_jsonb(so)->>'so_number', to_jsonb(so)->>'soNumber', '') AS "soNumber",
           COALESCE(to_jsonb(so)->>'total_amount', to_jsonb(so)->>'totalAmount', '0') AS "totalAmount",
           COALESCE(so.status, '') AS status,
           COALESCE(to_jsonb(so)->>'sales_type', to_jsonb(so)->>'salesType', '') AS "salesType",
           COALESCE(to_jsonb(so)->>'created_at', to_jsonb(so)->>'createdAt', NULL) AS "createdAt"
         FROM tblsales_order so
         WHERE COALESCE(to_jsonb(so)->>'customer_id', to_jsonb(so)->>'customerId', '') = $1
         ORDER BY COALESCE(to_jsonb(so)->>'created_at', to_jsonb(so)->>'createdAt', NOW()) DESC
         LIMIT $2
         OFFSET $3`,
        [id, limit, offset],
      );

      return {
        success: true,
        items: result.rows.map((row) => ({
          id: row.id,
          soNumber: row.soNumber ?? '',
          totalAmount: this.toOptionalNumber(row.totalAmount) ?? 0,
          status: row.status ?? '',
          salesType: row.salesType ?? '',
          createdAt: row.createdAt ?? null,
        })),
        meta: { page, limit, total, totalPages },
      };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to load customer orders',
        items: [],
        meta: { page, limit, total: 0, totalPages: 1 },
      };
    }
  }

  async getCustomerPayments(customerId: string) {
    const id = String(customerId ?? '').trim();
    if (!id) {
      return { success: false, message: 'Invalid customer id', items: [] };
    }

    try {
      const result = await this.databaseService.query<{
        id: string;
        paymentDate: string | null;
        paymentAmount: string | null;
        paymentMethod: string | null;
        referenceNo: string | null;
        paymentNotes: string | null;
        createdAt: string | null;
      }>(
        `SELECT
           id::text AS id,
           COALESCE(payment_date::text, '') AS "paymentDate",
           COALESCE(payment_amount::text, '0') AS "paymentAmount",
           COALESCE(payment_method, '') AS "paymentMethod",
           COALESCE(reference_no, '') AS "referenceNo",
           COALESCE(payment_notes, '') AS "paymentNotes",
           COALESCE(created_at::text, '') AS "createdAt"
         FROM tblcustomer_payments
         WHERE customer_id::text = $1
         ORDER BY payment_date DESC, created_at DESC`,
        [id],
      );

      return {
        success: true,
        items: result.rows.map((row) => ({
          id: row.id,
          paymentDate: row.paymentDate ?? null,
          paymentAmount: this.toOptionalNumber(row.paymentAmount) ?? 0,
          paymentMethod: row.paymentMethod ?? '',
          referenceNo: row.referenceNo ?? '',
          paymentNotes: row.paymentNotes ?? '',
          createdAt: row.createdAt ?? null,
        })),
      };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to load customer payments',
        items: [],
      };
    }
  }

  async getCustomerConcerns(customerId: string) {
    const id = String(customerId ?? '').trim();
    if (!id) {
      return { success: false, message: 'Invalid customer id', items: [] };
    }

    try {
      const result = await this.databaseService.query<{
        id: number;
        salesId: number;
        soNumber: string | null;
        concernType: string | null;
        concernSubject: string | null;
        concernDescription: string | null;
        concernStatus: string | null;
        priority: string | null;
        resolutionNotes: string | null;
        resolvedAt: string | null;
      }>(
        `SELECT
           cd.id,
           cd.sales_id AS "salesId",
           COALESCE(to_jsonb(so)->>'so_number', to_jsonb(so)->>'soNumber', '') AS "soNumber",
           COALESCE(cd.concern_type, '') AS "concernType",
           COALESCE(cd.concern_subject, '') AS "concernSubject",
           COALESCE(cd.concern_description, '') AS "concernDescription",
           COALESCE(cd.concern_status, '') AS "concernStatus",
           COALESCE(cd.priority, '') AS priority,
           COALESCE(cd.resolution_notes, '') AS "resolutionNotes",
           COALESCE(cd.resolved_at, NULL) AS "resolvedAt"
         FROM tblconcern_details cd
         LEFT JOIN tblsales_order so ON so.id = cd.sales_id
         WHERE COALESCE(to_jsonb(so)->>'customer_id', to_jsonb(so)->>'customerId', '') = $1
         ORDER BY cd.id DESC`,
        [id],
      );

      return {
        success: true,
        items: result.rows.map((row) => ({
          id: row.id,
          salesId: row.salesId,
          soNumber: row.soNumber ?? '',
          concernType: row.concernType ?? '',
          concernSubject: row.concernSubject ?? '',
          concernDescription: row.concernDescription ?? '',
          concernStatus: row.concernStatus ?? '',
          priority: row.priority ?? '',
          resolutionNotes: row.resolutionNotes ?? '',
          resolvedAt: row.resolvedAt ?? null,
        })),
      };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to load customer concerns',
        items: [],
      };
    }
  }

  async getCustomerStatementOfAccounts(
    customerId: string,
    query: { page?: number; limit?: number },
  ) {
    const id = String(customerId ?? '').trim();
    if (!id) {
      return { success: false, message: 'Invalid customer id', items: [], meta: { page: 1, limit: 0, total: 0, totalPages: 1 } };
    }

    const page = Math.max(1, Number(query.page ?? 1));
    const limit = Math.max(1, Math.min(200, Number(query.limit ?? 50)));
    const offset = (page - 1) * limit;

    try {
      const countResult = await this.databaseService.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM tblstatement_of_account soa WHERE customer_id::text = $1`,
        [id],
      );
      const total = Number(countResult.rows[0]?.count ?? 0);
      const totalPages = Math.max(1, Math.ceil(total / limit));

      const result = await this.databaseService.query<{
        id: number;
        soaNumber: string | null;
        periodFrom: string | null;
        periodTo: string | null;
        openingBalance: string | null;
        totalCharges: string | null;
        totalPayments: string | null;
        closingBalance: string | null;
        status: string | null;
        dueDate: string | null;
        notes: string | null;
        generatedAt: string | null;
      }>(
        `SELECT
           id,
           COALESCE(soa_number, '') AS "soaNumber",
           COALESCE(period_from::text, '') AS "periodFrom",
           COALESCE(period_to::text, '') AS "periodTo",
           COALESCE(opening_balance::text, '') AS "openingBalance",
           COALESCE(total_charges::text, '') AS "totalCharges",
           COALESCE(total_payments::text, '') AS "totalPayments",
           COALESCE(closing_balance::text, '') AS "closingBalance",
           COALESCE(soa_status, '') AS status,
           COALESCE(due_date::text, '') AS "dueDate",
           COALESCE(notes, '') AS notes,
           COALESCE(generated_at::text, '') AS "generatedAt"
         FROM tblstatement_of_account soa
         WHERE customer_id::text = $1
         ORDER BY generated_at DESC
         LIMIT $2
         OFFSET $3`,
        [id, limit, offset],
      );

      return {
        success: true,
        items: result.rows.map((row) => ({
          id: row.id,
          soaNumber: row.soaNumber ?? '',
          periodFrom: row.periodFrom ?? null,
          periodTo: row.periodTo ?? null,
          openingBalance: this.toOptionalNumber(row.openingBalance) ?? 0,
          totalCharges: this.toOptionalNumber(row.totalCharges) ?? 0,
          totalPayments: this.toOptionalNumber(row.totalPayments) ?? 0,
          closingBalance: this.toOptionalNumber(row.closingBalance) ?? 0,
          status: row.status ?? '',
          dueDate: row.dueDate ?? null,
          notes: row.notes ?? '',
          generatedAt: row.generatedAt ?? null,
        })),
        meta: { page, limit, total, totalPages },
      };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to load statement of accounts',
        items: [],
        meta: { page, limit, total: 0, totalPages: 1 },
      };
    }
  }

  async createStatementOfAccountForCustomer(
    customerId: string,
    dto: CreateStatementOfAccountDto,
    userId?: number,
  ) {
    const id = String(customerId ?? '').trim();
    if (!id) {
      return { success: false, message: 'Invalid customer id' };
    }

    try {
      const lastStatementResult = await this.databaseService.query<{ closing_balance: string | null }>(
        `SELECT closing_balance::text AS closing_balance
         FROM tblstatement_of_account
         WHERE customer_id::text = $1
         ORDER BY generated_at DESC
         LIMIT 1`,
        [id],
      );

      const openingBalance = this.toOptionalNumber(lastStatementResult.rows[0]?.closing_balance) ?? 0;

      const chargeResult = await this.databaseService.query<{ total_charges: string | null }>(
        `SELECT COALESCE(SUM(COALESCE(to_jsonb(so)->>'total_amount', to_jsonb(so)->>'totalAmount', '0')::numeric), 0)::text AS total_charges
         FROM tblsales_order so
         WHERE COALESCE(to_jsonb(so)->>'customer_id', to_jsonb(so)->>'customerId', '') = $1
           AND COALESCE(to_jsonb(so)->>'created_at', to_jsonb(so)->>'createdAt', NOW())::date BETWEEN $2::date AND $3::date`,
        [id, dto.periodFrom, dto.periodTo],
      );

      const paymentsResult = await this.databaseService.query<{ total_payments: string | null }>(
        `SELECT COALESCE(SUM(payment_amount), 0)::text AS total_payments
         FROM tblcustomer_payments
         WHERE customer_id::text = $1
           AND payment_date BETWEEN $2::date AND $3::date`,
        [id, dto.periodFrom, dto.periodTo],
      );

      const totalCharges = this.toOptionalNumber(chargeResult.rows[0]?.total_charges) ?? 0;
      const totalPayments = this.toOptionalNumber(paymentsResult.rows[0]?.total_payments) ?? 0;
      const closingBalance = openingBalance + totalCharges - totalPayments;

      const soaColumns = await this.getTableColumns(this.databaseService, 'tblstatement_of_account');
      const customerIdColumn = this.pickColumn(soaColumns, ['customer_id', 'customerId']);
      const periodFromColumn = this.pickColumn(soaColumns, ['period_from', 'periodFrom']);
      const periodToColumn = this.pickColumn(soaColumns, ['period_to', 'periodTo']);
      const openingBalanceColumn = this.pickColumn(soaColumns, ['opening_balance', 'openingBalance']);
      const totalChargesColumn = this.pickColumn(soaColumns, ['total_charges', 'totalCharges']);
      const totalPaymentsColumn = this.pickColumn(soaColumns, ['total_payments', 'totalPayments']);
      const closingBalanceColumn = this.pickColumn(soaColumns, ['closing_balance', 'closingBalance']);
      const statusColumn = this.pickColumn(soaColumns, ['soa_status', 'soaStatus']);
      const generatedByColumn = this.pickColumn(soaColumns, ['generated_by', 'generatedBy']);
      const dueDateColumn = this.pickColumn(soaColumns, ['due_date', 'dueDate']);
      const notesColumn = this.pickColumn(soaColumns, ['notes']);

      const record: Record<string, unknown> = {};
      if (customerIdColumn) record[customerIdColumn] = id;
      if (periodFromColumn) record[periodFromColumn] = this.toIsoDateOrNull(dto.periodFrom);
      if (periodToColumn) record[periodToColumn] = this.toIsoDateOrNull(dto.periodTo);
      if (openingBalanceColumn) record[openingBalanceColumn] = openingBalance;
      if (totalChargesColumn) record[totalChargesColumn] = totalCharges;
      if (totalPaymentsColumn) record[totalPaymentsColumn] = totalPayments;
      if (closingBalanceColumn) record[closingBalanceColumn] = closingBalance;
      if (statusColumn) record[statusColumn] = 'draft';
      if (generatedByColumn && userId !== undefined) record[generatedByColumn] = userId;
      if (dueDateColumn) record[dueDateColumn] = this.toIsoDateOrNull(dto.dueDate);
      if (notesColumn && dto.notes !== undefined) record[notesColumn] = String(dto.notes ?? '').trim();

      const inserted = await this.runInsert(this.databaseService, 'tblstatement_of_account', record);
      return {
        success: true,
        data: { statementOfAccountId: Number(inserted.rows[0]?.id ?? 0) },
      };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to create statement of account',
      };
    }
  }

  async getBranches() {
    try {
      const result = await this.databaseService.query<{
        id: number;
        branchName: string | null;
      }>(
        `SELECT id, COALESCE("branchName", '') AS "branchName" FROM tblbranches ORDER BY COALESCE("branchName", '') ASC`,
      );

      return {
        success: true,
        items: result.rows.map((row) => ({
          id: row.id,
          branchName: row.branchName ?? '',
        })),
      };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to load branches',
        items: [],
      };
    }
  }

  async createStatementOfAccount(
    salesOrderId: number,
    dto: CreateStatementOfAccountDto,
    userId?: number,
  ) {
    try {
      const salesResult = await this.databaseService.query<{ customer_id: string | null }>(
        `SELECT COALESCE(to_jsonb(so)->>'customer_id', to_jsonb(so)->>'customerId', '') AS customer_id
         FROM tblsales_order so
         WHERE so.id = $1
         LIMIT 1`,
        [salesOrderId],
      );

      if (salesResult.rowCount === 0) {
        return { success: false, message: `Sales order ${salesOrderId} not found` };
      }

      const customerId = String(salesResult.rows[0].customer_id ?? '').trim();
      if (!customerId) {
        return { success: false, message: 'Sales order does not have an associated customer' };
      }

      const lastStatementResult = await this.databaseService.query<{ closing_balance: string | null }>(
        `SELECT closing_balance::text AS closing_balance
         FROM tblstatement_of_account
         WHERE customer_id::text = $1
         ORDER BY generated_at DESC
         LIMIT 1`,
        [customerId],
      );

      const openingBalance = this.toOptionalNumber(lastStatementResult.rows[0]?.closing_balance) ?? 0;

      const chargeResult = await this.databaseService.query<{ total_charges: string | null }>(
        `SELECT COALESCE(SUM(COALESCE(to_jsonb(so)->>'total_amount', to_jsonb(so)->>'totalAmount', '0')::numeric), 0)::text AS total_charges
         FROM tblsales_order so
         WHERE COALESCE(to_jsonb(so)->>'customer_id', to_jsonb(so)->>'customerId', '') = $1
           AND COALESCE(to_jsonb(so)->>'created_at', to_jsonb(so)->>'createdAt', NOW())::date BETWEEN $2::date AND $3::date`,
        [customerId, dto.periodFrom, dto.periodTo],
      );

      const paymentsResult = await this.databaseService.query<{ total_payments: string | null }>(
        `SELECT COALESCE(SUM(payment_amount), 0)::text AS total_payments
         FROM tblcustomer_payments
         WHERE customer_id::text = $1
           AND payment_date BETWEEN $2::date AND $3::date`,
        [customerId, dto.periodFrom, dto.periodTo],
      );

      const totalCharges = this.toOptionalNumber(chargeResult.rows[0]?.total_charges) ?? 0;
      const totalPayments = this.toOptionalNumber(paymentsResult.rows[0]?.total_payments) ?? 0;
      const closingBalance = openingBalance + totalCharges - totalPayments;

      const soaColumns = await this.getTableColumns(this.databaseService, 'tblstatement_of_account');
      const customerIdColumn = this.pickColumn(soaColumns, ['customer_id', 'customerId']);
      const periodFromColumn = this.pickColumn(soaColumns, ['period_from', 'periodFrom']);
      const periodToColumn = this.pickColumn(soaColumns, ['period_to', 'periodTo']);
      const openingBalanceColumn = this.pickColumn(soaColumns, ['opening_balance', 'openingBalance']);
      const totalChargesColumn = this.pickColumn(soaColumns, ['total_charges', 'totalCharges']);
      const totalPaymentsColumn = this.pickColumn(soaColumns, ['total_payments', 'totalPayments']);
      const closingBalanceColumn = this.pickColumn(soaColumns, ['closing_balance', 'closingBalance']);
      const statusColumn = this.pickColumn(soaColumns, ['soa_status', 'soaStatus']);
      const generatedByColumn = this.pickColumn(soaColumns, ['generated_by', 'generatedBy']);
      const dueDateColumn = this.pickColumn(soaColumns, ['due_date', 'dueDate']);
      const notesColumn = this.pickColumn(soaColumns, ['notes']);

      const record: Record<string, unknown> = {};
      if (customerIdColumn) record[customerIdColumn] = customerId;
      if (periodFromColumn) record[periodFromColumn] = this.toIsoDateOrNull(dto.periodFrom);
      if (periodToColumn) record[periodToColumn] = this.toIsoDateOrNull(dto.periodTo);
      if (openingBalanceColumn) record[openingBalanceColumn] = openingBalance;
      if (totalChargesColumn) record[totalChargesColumn] = totalCharges;
      if (totalPaymentsColumn) record[totalPaymentsColumn] = totalPayments;
      if (closingBalanceColumn) record[closingBalanceColumn] = closingBalance;
      if (statusColumn) record[statusColumn] = 'draft';
      if (generatedByColumn && userId !== undefined) record[generatedByColumn] = userId;
      if (dueDateColumn) record[dueDateColumn] = this.toIsoDateOrNull(dto.dueDate);
      if (notesColumn && dto.notes !== undefined) record[notesColumn] = String(dto.notes ?? '').trim();

      const inserted = await this.runInsert(this.databaseService, 'tblstatement_of_account', record);
      return {
        success: true,
        data: { statementOfAccountId: Number(inserted.rows[0]?.id ?? 0) },
      };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to create statement of account',
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
           COALESCE(to_jsonb(so)->>'projectName', to_jsonb(so)->>'project_name', '') AS "projectName",
           COALESCE(to_jsonb(so)->>'projectCode', to_jsonb(so)->>'project_code', '') AS "projectCode",
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

      const serviceDetailResult = await this.databaseService.query<{
        id: number;
        serviceName: string | null;
        serviceCost: string | null;
        serviceDurationHours: string | null;
        serviceStatus: string | null;
        serviceNotes: string | null;
      }>(
        `SELECT
           sd.id,
           COALESCE(sd.service_name, '') AS "serviceName",
           COALESCE(sd.service_cost, 0)::text AS "serviceCost",
           COALESCE(sd.service_duration_hours, 0)::text AS "serviceDurationHours",
           COALESCE(sd.service_status, '') AS "serviceStatus",
           COALESCE(sd.service_notes, '') AS "serviceNotes"
         FROM tblservice_details sd
         WHERE sd.sales_id = $1
         ORDER BY sd.id ASC`,
        [String(id)],
      );

      const transferDetailResult = await this.databaseService.query<{
        id: number;
        fromBranchId: string | null;
        toBranchId: string | null;
        transferDate: string | null;
        expectedDeliveryDate: string | null;
        actualDeliveryDate: string | null;
        transferStatus: string | null;
        transferNotes: string | null;
      }>(
        `SELECT
           td.id,
           COALESCE(to_jsonb(td)->>'from_branch_id', to_jsonb(td)->>'fromBranchId') AS "fromBranchId",
           COALESCE(to_jsonb(td)->>'to_branch_id', to_jsonb(td)->>'toBranchId') AS "toBranchId",
           COALESCE(to_jsonb(td)->>'transfer_date', to_jsonb(td)->>'transferDate') AS "transferDate",
           COALESCE(to_jsonb(td)->>'expected_delivery_date', to_jsonb(td)->>'expectedDeliveryDate') AS "expectedDeliveryDate",
           COALESCE(to_jsonb(td)->>'actual_delivery_date', to_jsonb(td)->>'actualDeliveryDate') AS "actualDeliveryDate",
           COALESCE(to_jsonb(td)->>'transfer_status', to_jsonb(td)->>'transferStatus', '') AS "transferStatus",
           COALESCE(to_jsonb(td)->>'transfer_notes', to_jsonb(td)->>'transferNotes', '') AS "transferNotes"
         FROM tbltransfer_details td
         WHERE td.sales_id = $1
         LIMIT 1`,
        [String(id)],
      );

      const concernDetailResult = await this.databaseService.query<{
        id: number;
        concernType: string | null;
        concernSubject: string | null;
        concernDescription: string | null;
        concernStatus: string | null;
        priority: string | null;
        resolutionNotes: string | null;
        resolvedAt: string | null;
      }>(
        `SELECT
           cd.id,
           COALESCE(cd.concern_type, '') AS "concernType",
           COALESCE(cd.concern_subject, '') AS "concernSubject",
           COALESCE(cd.concern_description, '') AS "concernDescription",
           COALESCE(cd.concern_status, '') AS "concernStatus",
           COALESCE(cd.priority, '') AS "priority",
           COALESCE(cd.resolution_notes, '') AS "resolutionNotes",
           COALESCE(cd.resolved_at, NULL) AS "resolvedAt"
         FROM tblconcern_details cd
         WHERE cd.sales_id = $1
         LIMIT 1`,
        [String(id)],
      );

      const expenseDetailResult = await this.databaseService.query<{
        id: string;
        expenseType: string | null;
        expenseDescription: string | null;
        amount: string | null;
        expenseDate: string | null;
        paidTo: string | null;
        paymentMethod: string | null;
        referenceNo: string | null;
      }>(
        `SELECT
           ed.id::text AS id,
           COALESCE(ed.expense_type, '') AS "expenseType",
           COALESCE(ed.expense_description, '') AS "expenseDescription",
           COALESCE(ed.amount, 0)::text AS amount,
           COALESCE(to_jsonb(ed)->>'expense_date', to_jsonb(ed)->>'expenseDate', null) AS "expenseDate",
           COALESCE(ed.paid_to, '') AS "paidTo",
           COALESCE(ed.payment_method, '') AS "paymentMethod",
           COALESCE(ed.reference_no, '') AS "referenceNo"
         FROM tblexpense_details ed
         WHERE ed.sales_id = $1
         ORDER BY ed.created_at ASC`,
        [String(id)],
      );

      let materialItems: any[] = [];
      try {
        materialItems = await this.materialTransactionsService.findBySalesId(id);
      } catch {
        materialItems = [];
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
          serviceItems: serviceDetailResult.rows.map((service) => ({
            id: service.id,
            serviceName: service.serviceName ?? '',
            unitPrice: this.toOptionalNumber(service.serviceCost) ?? 0,
            qty: this.toOptionalNumber(service.serviceDurationHours) ?? 0,
            total: this.toOptionalNumber(service.serviceCost) ?? 0,
          })),
          transferDetails: transferDetailResult.rows[0]
            ? {
                id: transferDetailResult.rows[0].id,
                fromBranchId: this.toOptionalNumber(transferDetailResult.rows[0].fromBranchId),
                toBranchId: this.toOptionalNumber(transferDetailResult.rows[0].toBranchId),
                transferDate: transferDetailResult.rows[0].transferDate,
                expectedDeliveryDate: transferDetailResult.rows[0].expectedDeliveryDate,
                actualDeliveryDate: transferDetailResult.rows[0].actualDeliveryDate,
                transferStatus: transferDetailResult.rows[0].transferStatus ?? '',
                transferNotes: transferDetailResult.rows[0].transferNotes ?? '',
              }
            : null,
          concernDetails: concernDetailResult.rows[0]
            ? {
                id: concernDetailResult.rows[0].id,
                concernType: concernDetailResult.rows[0].concernType ?? '',
                concernSubject: concernDetailResult.rows[0].concernSubject ?? '',
                concernDescription: concernDetailResult.rows[0].concernDescription ?? '',
                concernStatus: concernDetailResult.rows[0].concernStatus ?? '',
                priority: concernDetailResult.rows[0].priority ?? '',
                resolutionNotes: concernDetailResult.rows[0].resolutionNotes ?? '',
                resolvedAt: concernDetailResult.rows[0].resolvedAt,
              }
            : null,
          expenseDetails: expenseDetailResult.rows.map((expense) => ({
            id: expense.id,
            expenseType: expense.expenseType ?? '',
            expenseDescription: expense.expenseDescription ?? '',
            amount: this.toOptionalNumber(expense.amount) ?? 0,
            expenseDate: expense.expenseDate,
            paidTo: expense.paidTo ?? '',
            paymentMethod: expense.paymentMethod ?? '',
            referenceNo: expense.referenceNo ?? '',
          })),
          materialItems: materialItems,
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
        const serviceItems = Array.isArray(payload.serviceItems) ? payload.serviceItems : [];

        let computedProductTotal = 0;
        for (const item of productItems) {
          const unitPrice = this.toOptionalNumber(item.unitPrice) ?? 0;
          const sellPrice = this.toOptionalNumber(item.sellPrice) ?? 0;
          const discountPrice = this.toOptionalNumber(item.discountPrice) ?? 0;
          const qty = this.toOptionalNumber(item.totalSetQty) ?? 0;
          const priceToUse = discountPrice > 0 ? discountPrice : sellPrice > 0 ? sellPrice : unitPrice;
          computedProductTotal += priceToUse * qty;
        }

        let computedServiceTotal = 0;
        for (const item of serviceItems) {
          const unitPrice = this.toOptionalNumber(item.serviceCost) ?? 0;
          const qty = this.toOptionalNumber(item.serviceDurationHours) ?? 0;
          const total = this.toOptionalNumber(item.serviceCost) ?? 0;
          computedServiceTotal += total > 0 ? total : unitPrice * qty;
        }

        const computedTotalAmount = computedProductTotal + computedServiceTotal;

        const fallbackTotal =
          this.toOptionalNumber(payload.totalAmount) ??
          this.toOptionalNumber(existingSales.total_amount) ??
          0;
        const totalAmount = computedTotalAmount > 0 ? computedTotalAmount : fallbackTotal;
        const status = String(payload.status ?? existingSales.status ?? 'pending').trim() || 'pending';

        const salesColumns = await this.getTableColumns(client, 'tblsales_order');
        const salesCustomerIdColumn = this.pickColumn(salesColumns, ['customer_id', 'customerId']);
        const totalAmountColumn = this.pickColumn(salesColumns, ['total_amount', 'totalAmount']);
        const scheduleDateColumn = this.pickColumn(salesColumns, ['scheduleDate', 'schedule_date']);
        const salesTypeColumn = this.pickColumn(salesColumns, ['salesType', 'sales_type']);
        const projectNameColumn = this.pickColumn(salesColumns, ['projectName', 'project_name']);
        const projectCodeColumn = this.pickColumn(salesColumns, ['projectCode', 'project_code']);
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
        if (projectNameColumn && Object.prototype.hasOwnProperty.call(payload, 'projectName')) {
          soParams.push(String(payload.projectName ?? '').trim());
          soUpdates.push(`"${projectNameColumn}" = $${soParams.length}`);
        }
        if (projectCodeColumn && Object.prototype.hasOwnProperty.call(payload, 'projectCode')) {
          soParams.push(String(payload.projectCode ?? '').trim());
          soUpdates.push(`"${projectCodeColumn}" = $${soParams.length}`);
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

        // Update service details
        if (Array.isArray(payload.serviceItems)) {
          const serviceColumns = await this.getTableColumns(client, 'tblservice_details');
          const serviceSalesIdColumn = this.pickColumn(serviceColumns, ['sales_id', 'salesId']);
          const serviceNameColumn = this.pickColumn(serviceColumns, ['service_name', 'serviceName']);
          const serviceDescriptionColumn = this.pickColumn(serviceColumns, ['service_description', 'serviceDescription']);
          const serviceTypeColumn = this.pickColumn(serviceColumns, ['service_type', 'serviceType']);
          const technicianAssignedColumn = this.pickColumn(serviceColumns, ['technician_assigned', 'technicianAssigned']);
          const serviceDateColumn = this.pickColumn(serviceColumns, ['service_date', 'serviceDate']);
          const serviceDurationHoursColumn = this.pickColumn(serviceColumns, ['service_duration_hours', 'serviceDurationHours']);
          const serviceCostColumn = this.pickColumn(serviceColumns, ['service_cost', 'serviceCost']);
          const partsCostColumn = this.pickColumn(serviceColumns, ['parts_cost', 'partsCost']);
          const laborCostColumn = this.pickColumn(serviceColumns, ['labor_cost', 'laborCost']);
          const serviceStatusColumn = this.pickColumn(serviceColumns, ['service_status', 'serviceStatus']);
          const serviceNotesColumn = this.pickColumn(serviceColumns, ['service_notes', 'serviceNotes']);

          if (serviceSalesIdColumn) {
            await client.query(
              `DELETE FROM tblservice_details WHERE "${serviceSalesIdColumn}" = $1`,
              [id],
            );

            for (const item of payload.serviceItems) {
              const record: Record<string, unknown> = {
                [serviceSalesIdColumn]: id,
              };

              if (serviceNameColumn && item.serviceName !== undefined) {
                record[serviceNameColumn] = String(item.serviceName ?? '').trim();
              }
              if (serviceDescriptionColumn && item.serviceDescription !== undefined) {
                record[serviceDescriptionColumn] = String(item.serviceDescription ?? '').trim();
              }
              if (serviceTypeColumn && item.serviceType !== undefined) {
                record[serviceTypeColumn] = String(item.serviceType ?? '').trim();
              }
              if (technicianAssignedColumn && item.technicianAssigned !== undefined) {
                record[technicianAssignedColumn] = String(item.technicianAssigned ?? '').trim();
              }
              if (serviceDateColumn && item.serviceDate !== undefined) {
                record[serviceDateColumn] = this.toIsoDateOrNull(item.serviceDate);
              }
              if (serviceDurationHoursColumn && item.serviceDurationHours !== undefined) {
                record[serviceDurationHoursColumn] = this.toOptionalNumber(item.serviceDurationHours);
              }
              if (serviceCostColumn && item.serviceCost !== undefined) {
                record[serviceCostColumn] = this.toOptionalNumber(item.serviceCost) ?? 0;
              }
              if (partsCostColumn && item.partsCost !== undefined) {
                record[partsCostColumn] = this.toOptionalNumber(item.partsCost) ?? 0;
              }
              if (laborCostColumn && item.laborCost !== undefined) {
                record[laborCostColumn] = this.toOptionalNumber(item.laborCost) ?? 0;
              }
              if (serviceStatusColumn && item.serviceStatus !== undefined) {
                record[serviceStatusColumn] = String(item.serviceStatus ?? '').trim();
              }
              if (serviceNotesColumn && item.serviceNotes !== undefined) {
                record[serviceNotesColumn] = String(item.serviceNotes ?? '').trim();
              }

              await this.runInsert(client, 'tblservice_details', record);
            }
          }
        }

        // Update project details
        if (payload.projectDetails ||
          Object.prototype.hasOwnProperty.call(payload, 'projectName') ||
          Object.prototype.hasOwnProperty.call(payload, 'projectCode')) {
          const projectColumns = await this.getTableColumns(client, 'tblproject_details');
          const projectSalesIdColumn = this.pickColumn(projectColumns, ['sales_id', 'salesId']);
          const projectNameColumn = this.pickColumn(projectColumns, ['project_name', 'projectName']);
          const projectCodeColumn = this.pickColumn(projectColumns, ['project_code', 'projectCode']);
          const projectLocationColumn = this.pickColumn(projectColumns, ['project_location', 'projectLocation']);
          const projectStartDateColumn = this.pickColumn(projectColumns, ['project_start_date', 'projectStartDate']);
          const projectEndDateColumn = this.pickColumn(projectColumns, ['project_end_date', 'projectEndDate']);
          const projectManagerColumn = this.pickColumn(projectColumns, ['project_manager', 'projectManager']);
          const projectStatusColumn = this.pickColumn(projectColumns, ['project_status', 'projectStatus']);
          const projectNotesColumn = this.pickColumn(projectColumns, ['project_notes', 'projectNotes']);

          if (projectSalesIdColumn) {
            await client.query(
              `DELETE FROM tblproject_details WHERE "${projectSalesIdColumn}" = $1`,
              [id],
            );

            const details = payload.projectDetails ?? {
              projectName: payload.projectName,
              projectCode: payload.projectCode,
            };

            const record: Record<string, unknown> = {
              [projectSalesIdColumn]: id,
            };

            if (projectNameColumn && details?.projectName !== undefined) {
              record[projectNameColumn] = String(details.projectName ?? '').trim();
            }
            if (projectCodeColumn && details?.projectCode !== undefined) {
              record[projectCodeColumn] = String(details.projectCode ?? '').trim();
            }
            if (projectLocationColumn && details?.projectLocation !== undefined) {
              record[projectLocationColumn] = String(details.projectLocation ?? '').trim();
            }
            if (projectStartDateColumn && details?.projectStartDate !== undefined) {
              record[projectStartDateColumn] = this.toIsoDateOrNull(details.projectStartDate);
            }
            if (projectEndDateColumn && details?.projectEndDate !== undefined) {
              record[projectEndDateColumn] = this.toIsoDateOrNull(details.projectEndDate);
            }
            if (projectManagerColumn && details?.projectManager !== undefined) {
              record[projectManagerColumn] = String(details.projectManager ?? '').trim();
            }
            if (projectStatusColumn && details?.projectStatus !== undefined) {
              record[projectStatusColumn] = String(details.projectStatus ?? '').trim();
            }
            if (projectNotesColumn && details?.projectNotes !== undefined) {
              record[projectNotesColumn] = String(details.projectNotes ?? '').trim();
            }

            await this.runInsert(client, 'tblproject_details', record);
          }
        }

        // Update transfer details
        let transferDetailsId: number | null = null;
        if (payload.transferDetails) {
          const transferColumns = await this.getTableColumns(client, 'tbltransfer_details');
          const transferSalesIdColumn = this.pickColumn(transferColumns, ['sales_id', 'salesId']);
          const fromBranchIdColumn = this.pickColumn(transferColumns, ['from_branch_id', 'fromBranchId']);
          const toBranchIdColumn = this.pickColumn(transferColumns, ['to_branch_id', 'toBranchId']);
          const transferDateColumn = this.pickColumn(transferColumns, ['transfer_date', 'transferDate']);
          const expectedDeliveryDateColumn = this.pickColumn(transferColumns, ['expected_delivery_date', 'expectedDeliveryDate']);
          const actualDeliveryDateColumn = this.pickColumn(transferColumns, ['actual_delivery_date', 'actualDeliveryDate']);
          const transferStatusColumn = this.pickColumn(transferColumns, ['transfer_status', 'transferStatus']);
          const transferNotesColumn = this.pickColumn(transferColumns, ['transfer_notes', 'transferNotes']);
          const sentByColumn = this.pickColumn(transferColumns, ['sent_by', 'sentBy']);
          const receivedByColumn = this.pickColumn(transferColumns, ['received_by', 'receivedBy']);
          const acknowledgedByColumn = this.pickColumn(transferColumns, ['acknowledged_by', 'acknowledgedBy']);
          const acknowledgedAtColumn = this.pickColumn(transferColumns, ['acknowledged_at', 'acknowledgedAt']);

          if (transferSalesIdColumn) {
            await client.query(
              `DELETE FROM tbltransfer_details WHERE "${transferSalesIdColumn}" = $1`,
              [id],
            );

            const details = payload.transferDetails;
            const record: Record<string, unknown> = {
              [transferSalesIdColumn]: id,
            };

            if (fromBranchIdColumn && details.fromBranchId !== undefined) {
              record[fromBranchIdColumn] = this.toOptionalNumber(details.fromBranchId);
            }
            if (toBranchIdColumn && details.toBranchId !== undefined) {
              record[toBranchIdColumn] = this.toOptionalNumber(details.toBranchId);
            }
            if (transferDateColumn && details.transferDate !== undefined) {
              record[transferDateColumn] = this.toIsoDateOrNull(details.transferDate);
            }
            if (expectedDeliveryDateColumn && details.expectedDeliveryDate !== undefined) {
              record[expectedDeliveryDateColumn] = this.toIsoDateOrNull(details.expectedDeliveryDate);
            }
            if (actualDeliveryDateColumn && details.actualDeliveryDate !== undefined) {
              record[actualDeliveryDateColumn] = this.toIsoDateOrNull(details.actualDeliveryDate);
            }
            if (transferStatusColumn && details.transferStatus !== undefined) {
              record[transferStatusColumn] = String(details.transferStatus ?? '').trim();
            }
            if (transferNotesColumn && details.transferNotes !== undefined) {
              record[transferNotesColumn] = String(details.transferNotes ?? '').trim();
            }
            if (sentByColumn && details.sentBy !== undefined) {
              record[sentByColumn] = this.toOptionalNumber(details.sentBy);
            }
            if (receivedByColumn && details.receivedBy !== undefined) {
              record[receivedByColumn] = this.toOptionalNumber(details.receivedBy);
            }
            if (acknowledgedByColumn && details.acknowledgedBy !== undefined) {
              record[acknowledgedByColumn] = this.toOptionalNumber(details.acknowledgedBy);
            }
            if (acknowledgedAtColumn && details.acknowledgedAt !== undefined) {
              record[acknowledgedAtColumn] = this.toIsoDateOrNull(details.acknowledgedAt);
            }

            const insertedTransfer = await this.runInsert(client, 'tbltransfer_details', record);
            transferDetailsId = Number(insertedTransfer.rows[0]?.id ?? null);
          }
        }

        // Update expense details (if provided)
        if (payload.expenseDetails && transferDetailsId) {
          const expenseColumns = await this.getTableColumns(client, 'tblexpense_details');
          const expenseSalesIdColumn = this.pickColumn(expenseColumns, ['sales_id', 'salesId']);
          const expenseTransferIdColumn = this.pickColumn(expenseColumns, ['transfer_id', 'transferId']);
          const expenseTypeColumn = this.pickColumn(expenseColumns, ['expense_type', 'expenseType']);
          const expenseDescriptionColumn = this.pickColumn(expenseColumns, ['expense_description', 'expenseDescription']);
          const amountColumn = this.pickColumn(expenseColumns, ['amount']);
          const expenseDateColumn = this.pickColumn(expenseColumns, ['expense_date', 'expenseDate']);
          const paidToColumn = this.pickColumn(expenseColumns, ['paid_to', 'paidTo']);
          const paymentMethodColumn = this.pickColumn(expenseColumns, ['payment_method', 'paymentMethod']);
          const referenceNoColumn = this.pickColumn(expenseColumns, ['reference_no', 'referenceNo']);
          const createdByColumn = this.pickColumn(expenseColumns, ['created_by', 'createdBy']);

          if (expenseSalesIdColumn) {
            await client.query(
              `DELETE FROM tblexpense_details WHERE "${expenseSalesIdColumn}" = $1`,
              [id],
            );

            for (const expense of payload.expenseDetails) {
              const record: Record<string, unknown> = {};
              record[expenseSalesIdColumn] = id;
              record[expenseTransferIdColumn ?? 'transfer_id'] = transferDetailsId;

              if (expenseTypeColumn && expense.expenseType !== undefined) {
                record[expenseTypeColumn] = String(expense.expenseType ?? '').trim();
              }
              if (expenseDescriptionColumn && expense.expenseDescription !== undefined) {
                record[expenseDescriptionColumn] = String(expense.expenseDescription ?? '').trim();
              }
              if (amountColumn) {
                record[amountColumn] = this.toOptionalNumber(expense.amount) ?? 0;
              }
              if (expenseDateColumn && expense.expenseDate !== undefined) {
                record[expenseDateColumn] = this.toIsoDateOrNull(expense.expenseDate);
              }
              if (paidToColumn && expense.paidTo !== undefined) {
                record[paidToColumn] = String(expense.paidTo ?? '').trim();
              }
              if (paymentMethodColumn && expense.paymentMethod !== undefined) {
                record[paymentMethodColumn] = String(expense.paymentMethod ?? '').trim();
              }
              if (referenceNoColumn && expense.referenceNo !== undefined) {
                record[referenceNoColumn] = String(expense.referenceNo ?? '').trim();
              }
              if (createdByColumn && userId !== undefined) {
                record[createdByColumn] = userId;
              }

              await this.runInsert(client, 'tblexpense_details', record);
            }
          }
        }

        // Update concern details
        if (payload.concernDetails) {
          const concernColumns = await this.getTableColumns(client, 'tblconcern_details');
          const concernSalesIdColumn = this.pickColumn(concernColumns, ['sales_id', 'salesId']);
          const concernCustomerIdColumn = this.pickColumn(concernColumns, ['customer_id', 'customerId']);
          const concernTypeColumn = this.pickColumn(concernColumns, ['concern_type', 'concernType']);
          const concernSubjectColumn = this.pickColumn(concernColumns, ['concern_subject', 'concernSubject']);
          const concernDescriptionColumn = this.pickColumn(concernColumns, ['concern_description', 'concernDescription']);
          const concernStatusColumn = this.pickColumn(concernColumns, ['concern_status', 'concernStatus']);
          const priorityColumn = this.pickColumn(concernColumns, ['priority']);
          const assignedToColumn = this.pickColumn(concernColumns, ['assigned_to', 'assignedTo']);
          const resolutionNotesColumn = this.pickColumn(concernColumns, ['resolution_notes', 'resolutionNotes']);
          const resolvedAtColumn = this.pickColumn(concernColumns, ['resolved_at', 'resolvedAt']);

          if (concernSalesIdColumn) {
            await client.query(
              `DELETE FROM tblconcern_details WHERE "${concernSalesIdColumn}" = $1`,
              [id],
            );

            const details = payload.concernDetails;
            const record: Record<string, unknown> = {
              [concernSalesIdColumn]: id,
            };

            if (concernCustomerIdColumn && details.customerId !== undefined) {
              record[concernCustomerIdColumn] = String(details.customerId ?? '').trim();
            }
            if (concernTypeColumn && details.concernType !== undefined) {
              record[concernTypeColumn] = String(details.concernType ?? '').trim();
            }
            if (concernSubjectColumn && details.concernSubject !== undefined) {
              record[concernSubjectColumn] = String(details.concernSubject ?? '').trim();
            }
            if (concernDescriptionColumn && details.concernDescription !== undefined) {
              record[concernDescriptionColumn] = String(details.concernDescription ?? '').trim();
            }
            if (concernStatusColumn && details.concernStatus !== undefined) {
              record[concernStatusColumn] = String(details.concernStatus ?? '').trim();
            }
            if (priorityColumn && details.priority !== undefined) {
              record[priorityColumn] = String(details.priority ?? '').trim();
            }
            if (assignedToColumn && details.assignedTo !== undefined) {
              record[assignedToColumn] = this.toOptionalNumber(details.assignedTo);
            }
            if (resolutionNotesColumn && details.resolutionNotes !== undefined) {
              record[resolutionNotesColumn] = String(details.resolutionNotes ?? '').trim();
            }
            if (resolvedAtColumn && details.resolvedAt !== undefined) {
              record[resolvedAtColumn] = this.toIsoDateOrNull(details.resolvedAt);
            }

            await this.runInsert(client, 'tblconcern_details', record);
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

          // Restore stock for returned material items (reverse the earlier deduction)
          await this.releaseReturnedMaterials(client, id, userId);
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

        // const materialSync = await this.materialStockService.applyFromSalesStatusChange(client, {
        //   salesOrderId: id,
        //   previousStatus: existingSales.status,
        //   nextStatus: status,
        //   remarks: String(payload.remarks ?? ''),
        //   userId,
        // });

        return {
          salesOrderId: id,
          customerId,
          totalAmount,
          status,
          // materialSync,
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

  private async releaseReturnedMaterials(client: PoolClient, salesId: number, userId?: number) {
    const materialItems = await this.materialTransactionsService.findBySalesId(salesId);

    for (const item of materialItems) {
      const qty = Number(item.quantity ?? 0);
      if (!Number.isFinite(qty) || qty <= 0) {
        continue;
      }

      // Return stock to inventory
      await this.materialsService.updateStock(item.material_id, qty, userId ?? null, { client });

      // Record a ledger movement for audit/traceability
      await this.materialStockService.recordMovement(
        {
          materialId: item.material_id,
          movementType: 'IN',
          qty,
          sourceType: 'SO',
          sourceId: salesId,
          sourceLineKey: `return-${item.id}`,
          statusSnapshot: JSON.stringify(item),
        },
        { client },
      );
    }
  }
}
