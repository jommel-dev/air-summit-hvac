import { BadRequestException, Injectable } from '@nestjs/common';
import { CreatePurchaseDto } from './dto/create-purchase.dto';
import { UpdatePurchaseDto } from './dto/update-purchase.dto';
import { DatabaseService } from 'src/database/database.service';
import { PurchaseTabItemDto } from './dto/purchase-tab-item.dto';
import { ListPurchaseQueryDto } from './dto/list-purchase-query.dto';
import { PurchaseListResponseDto } from './dto/purchase-list-response.dto';
import { PoolClient } from 'pg';
import { createHash, randomUUID } from 'crypto';
import { MaterialStockService } from 'src/inventory/material-stock/material-stock.service';
import { AuditLogService } from 'src/audit-log/audit-log.service';

type PurchaseRow = {
  id: number;
  poNumber: string | null;
  vendorId: string | null;
  vendorName: string | null;
  vendorAddress: string | null;
  vendorContactPerson: string | null;
  vendorContactNumber: string | null;
  totalAmount: string | null;
  status: string | null;
  paymentDetails: unknown;
  productItems: unknown;
  createdAt: string | null;
  serialCount: number;
};

type PurchaseCountRow = {
  total: string;
};

type PurchaseMode = 'deliveries' | 'approvals' | 'master-data';
type PurchasePaymentMethod =
  | 'Cash'
  | 'Bank Transfer'
  | 'Terms'
  | 'Terms with DP'
  | 'Cheque'
  | 'Credit Card'
  | 'Installment';
type TableColumnMeta = {
  column_name: string;
  data_type: string;
  udt_name: string;
};

type PurchaseDetailRow = {
  id: number;
  poNumber: string | null;
  vendorId: string | null;
  vendorName: string | null;
  vendorAddress: string | null;
  vendorContactPerson: string | null;
  vendorContactNumber: string | null;
  totalAmount: string | null;
  status: string | null;
  createdAt: string | null;
};

type PurchasePaymentRow = {
  method: string | null;
  amount: string | null;
  terms: string | null;
  termsDueDate: string | null;
  status: string | null;
  paymentDate: string | null;
  bankName: string | null;
  referenceNo: string | null;
  checkNo: string | null;
  chequeDate: string | null;
  issuedBy: string | null;
  downPayment: string | null;
};

type PurchaseProductRow = {
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
};

type PurchaseSerialRow = {
  serialNumber: string | null;
  productId: string | null;
  capacityId: string | null;
  unitType: string | null;
};

type CapacityPriceUpdateColumns = {
  idColumn: string;
  productIdColumn?: string;
  netPriceColumn: string;
};

@Injectable()
export class PurchaseService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly materialStockService: MaterialStockService,
    private readonly auditLogService: AuditLogService,
  ) {}

  private async getTableColumns(
    executor: { query: PoolClient['query'] },
    tableName: string,
  ): Promise<string[]> {
    const columnsResult = await executor.query<{ column_name: string }>(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_name = $1
         AND table_schema = current_schema()`,
      [tableName],
    );

    return columnsResult.rows.map((row) => row.column_name);
  }

  private async getColumnMeta(
    executor: { query: PoolClient['query'] },
    tableName: string,
    columnName: string,
  ): Promise<TableColumnMeta | null> {
    const result = await executor.query<TableColumnMeta>(
      `SELECT column_name, data_type, udt_name
       FROM information_schema.columns
       WHERE table_schema = current_schema()
         AND table_name = $1
         AND LOWER(column_name) = LOWER($2)
       LIMIT 1`,
      [tableName, columnName],
    );

    return result.rows[0] ?? null;
  }

  private pickColumn(
    availableColumns: string[],
    candidates: string[],
  ): string | undefined {
    const availableColumnsLower = new Set(
      availableColumns.map((column) => column.toLowerCase()),
    );

    return candidates.find((candidate) =>
      availableColumnsLower.has(candidate.toLowerCase()),
    );
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

    return executor.query<{ id: number }>(
      `INSERT INTO ${tableName} (${quotedColumns}) VALUES (${placeholders}) RETURNING id`,
      values,
    );
  }

  private toRequiredNumber(value: unknown, fieldName: string): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      throw new Error(`${fieldName} must be a valid number`);
    }

    return parsed;
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
    if (Number.isNaN(date.getTime())) {
      return null;
    }

    return date.toISOString();
  }

  private normalizeSerialNumber(value: unknown): string {
    return String(value ?? '')
      .trim()
      .replace(/\s+/g, ' ');
  }

  private toPurchasePaymentMethod(value: unknown): PurchasePaymentMethod {
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

  private getAutoPaymentStatus(method: PurchasePaymentMethod): string {
    if (method === 'Cash' || method === 'Bank Transfer') {
      return 'paid';
    }

    return 'unpaid';
  }

  private toPositiveIntegerOrNull(value: unknown): number | null {
    const raw = String(value ?? '').trim();
    if (!raw) {
      return null;
    }

    const parsed = Number(raw.match(/\d+/)?.[0] ?? Number.NaN);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return null;
    }

    return Math.floor(parsed);
  }

  private deriveTermsDueDate(
    paymentDetails: Record<string, unknown>,
    method: PurchasePaymentMethod,
  ): string | null {
    const explicitDueDate = this.toIsoDateOrNull(paymentDetails.termsDueDate);
    if (explicitDueDate) {
      return explicitDueDate;
    }

    if (method !== 'Terms' && method !== 'Terms with DP') {
      return null;
    }

    const termDays = this.toPositiveIntegerOrNull(paymentDetails.terms);
    if (!termDays) {
      return null;
    }

    const baseDateIso = this.toIsoDateOrNull(paymentDetails.paymentDate) ?? new Date().toISOString();
    const baseDate = new Date(baseDateIso);
    if (Number.isNaN(baseDate.getTime())) {
      return null;
    }

    baseDate.setUTCHours(0, 0, 0, 0);
    baseDate.setUTCDate(baseDate.getUTCDate() + termDays);

    return baseDate.toISOString();
  }

  private resolvePaymentStatusForDisplay(
    methodValue: unknown,
    statusValue: unknown,
    termsDueDateValue: unknown,
    chequeDateValue: unknown,
  ): string {
    const normalizedStatus = String(statusValue ?? '').trim().toLowerCase();
    if (normalizedStatus === 'paid') {
      return 'paid';
    }

    let method: PurchasePaymentMethod | null = null;
    try {
      method = this.toPurchasePaymentMethod(methodValue);
    } catch {
      method = null;
    }

    if (method === 'Terms' || method === 'Terms with DP' || method === 'Cheque') {
      const dueSource = method === 'Cheque' ? chequeDateValue : termsDueDateValue;
      const dueDateIso = this.toIsoDateOrNull(dueSource);
      if (dueDateIso) {
        const dueDate = new Date(dueDateIso);
        const today = new Date();
        today.setUTCHours(0, 0, 0, 0);
        if (!Number.isNaN(dueDate.getTime()) && dueDate < today) {
          return 'overdue';
        }
      }
    }

    return 'unpaid';
  }

  private validatePurchasePaymentDetails(
    paymentDetails: Record<string, unknown>,
    index: number,
  ): PurchasePaymentMethod {
    const method = this.toPurchasePaymentMethod(paymentDetails.method);

    const allowedFieldsByMethod: Record<PurchasePaymentMethod, Set<string>> = {
      Cash: new Set(['amount', 'paymentDate']),
      'Bank Transfer': new Set(['amount', 'bankName', 'referenceNo']),
      Terms: new Set(['amount', 'terms', 'termsDueDate']),
      'Terms with DP': new Set(['amount', 'terms', 'termsDueDate', 'downPayment']),
      Cheque: new Set(['amount', 'bankName', 'checkNo', 'chequeDate', 'issuedBy']),
      'Credit Card': new Set(['amount', 'paymentDate']),
      Installment: new Set(['amount', 'terms', 'termsDueDate', 'downPayment']),
    };

    const optionalFields = [
      'terms',
      'termsDueDate',
      'paymentDate',
      'bankName',
      'referenceNo',
      'checkNo',
      'chequeDate',
      'issuedBy',
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

  private toComparableNumberString(value: unknown): string {
    const parsed = this.toOptionalNumber(value);
    if (parsed === null) {
      return '0';
    }

    return String(parsed);
  }

  private async resolveCapacityNetPriceTable(
    executor: { query: PoolClient['query'] },
  ): Promise<{ tableName: string; columns: string[] } | null> {
    const candidateTables = ['tblcapacity_netprice_history', 'tblcapacity_netprice'];

    for (const tableName of candidateTables) {
      const columns = await this.getTableColumns(executor, tableName);
      if (columns.length > 0) {
        return { tableName, columns };
      }
    }

    return null;
  }

  private async getCapacityLabelById(
    executor: { query: PoolClient['query'] },
    capacityId: number,
  ): Promise<string> {
    const result = await executor.query<{ capacity_label: string | null }>(
      `SELECT COALESCE(
         to_jsonb(c)->>'capacity',
         to_jsonb(c)->>'capacityValue',
         to_jsonb(c)->>'capacity_value'
       ) AS capacity_label
       FROM tblcapacity c
       WHERE c.id::text = $1
       LIMIT 1`,
      [String(capacityId)],
    );

    const label = String(result.rows[0]?.capacity_label ?? '').trim();
    return label || String(capacityId);
  }

  private async recordCapacityNetPriceFromPurchaseItem(
    executor: { query: PoolClient['query'] },
    input: {
      productId: number;
      capacityId: number;
      unitPrice: unknown;
      vendorId?: string | null;
      purchaseOrderId: number;
      purchaseOrderNo?: string | null;
      userId?: number;
    },
  ): Promise<void> {
    const tableMeta = await this.resolveCapacityNetPriceTable(executor);
    if (!tableMeta) {
      return;
    }

    const { tableName, columns } = tableMeta;

    const productIdColumn = this.pickColumn(columns, [
      'prodId',
      'productId',
      'prod_id',
      'product_id',
    ]);
    const capacityColumn = this.pickColumn(columns, [
      'capacity',
      'capacityValue',
      'capacity_value',
    ]);
    const netPriceColumn = this.pickColumn(columns, ['netPrice', 'net_price']);
    const supplierIdColumn = this.pickColumn(columns, ['supplierId', 'supplier_id']);
    const purchaseOrderIdColumn = this.pickColumn(columns, [
      'purchaseOrderId',
      'purchase_order_id',
      'poId',
      'po_id',
    ]);
    const purchaseOrderNoColumn = this.pickColumn(columns, [
      'purchaseOrderNo',
      'purchase_order_no',
      'poNo',
      'po_no',
    ]);
    const createdByColumn = this.pickColumn(columns, [
      'created_by',
      'createdBy',
      'createdby',
    ]);

    if (!productIdColumn || !capacityColumn || !netPriceColumn) {
      return;
    }

    const capacityLabel = await this.getCapacityLabelById(executor, input.capacityId);
    const normalizedNetPrice = this.toOptionalNumber(input.unitPrice) ?? 0;
    const shouldApplyNetPrice = await this.applyApprovedCapacityUnitPriceIfEligible(
      executor,
      input.productId,
      input.capacityId,
      normalizedNetPrice,
    );
    if (!shouldApplyNetPrice) {
      return;
    }

    const normalizedSupplierId = this.toOptionalNumber(input.vendorId);
    const normalizedPoNo = String(input.purchaseOrderNo ?? '').trim();

    const latestNetPriceResult = await executor.query<{ net_price_value: string | null }>(
      `SELECT "${netPriceColumn}"::text AS net_price_value
       FROM ${tableName}
       WHERE "${productIdColumn}"::text = $1::text
         AND LOWER(TRIM("${capacityColumn}"::text)) = LOWER(TRIM($2::text))
       ORDER BY id DESC
       LIMIT 1`,
      [input.productId, capacityLabel],
    );

    const latestComparable = this.toComparableNumberString(
      latestNetPriceResult.rows[0]?.net_price_value,
    );
    const incomingComparable = this.toComparableNumberString(normalizedNetPrice);

    if (latestComparable === incomingComparable) {
      return;
    }

    const historyRecord: Record<string, unknown> = {
      [productIdColumn]: input.productId,
      [capacityColumn]: capacityLabel,
      [netPriceColumn]: normalizedNetPrice,
    };

    if (supplierIdColumn && normalizedSupplierId !== null) {
      historyRecord[supplierIdColumn] = normalizedSupplierId;
    }
    if (purchaseOrderIdColumn) {
      historyRecord[purchaseOrderIdColumn] = input.purchaseOrderId;
    }
    if (purchaseOrderNoColumn && normalizedPoNo) {
      historyRecord[purchaseOrderNoColumn] = normalizedPoNo;
    }
    if (createdByColumn && input.userId) {
      historyRecord[createdByColumn] = input.userId;
    }

    await this.runInsert(executor, tableName, historyRecord);
  }

  private async resolveCapacityPriceUpdateColumns(
    executor: { query: PoolClient['query'] },
  ): Promise<CapacityPriceUpdateColumns | null> {
    const capacityColumns = await this.getTableColumns(executor, 'tblcapacity');
    if (capacityColumns.length === 0) {
      return null;
    }

    const idColumn = this.pickColumn(capacityColumns, ['id']);
    const productIdColumn = this.pickColumn(capacityColumns, [
      'prodId',
      'productId',
      'prod_id',
      'product_id',
    ]);
    const netPriceColumn = this.pickColumn(capacityColumns, [
      'netPrice',
      'net_price',
      'unitPrice',
      'unit_price',
    ]);

    if (!idColumn || !netPriceColumn) {
      return null;
    }

    return {
      idColumn,
      productIdColumn,
      netPriceColumn,
    };
  }

  private shouldUseApprovedPriceForCapacityUpdate(
    currentPrice: number,
    incomingPrice: number,
  ): boolean {
    // Ignore obviously invalid placeholder values from PO input.
    if (!Number.isFinite(incomingPrice) || incomingPrice <= 1) {
      return false;
    }

    if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
      return true;
    }

    if (incomingPrice >= currentPrice) {
      return true;
    }

    // "Close" means within 10% below the current unit price.
    const minimumClosePrice = currentPrice * 0.9;
    return incomingPrice >= minimumClosePrice;
  }

  private async applyApprovedCapacityUnitPriceIfEligible(
    executor: { query: PoolClient['query'] },
    productId: number,
    capacityId: number,
    incomingUnitPrice: number,
  ): Promise<boolean> {
    const columnMeta = await this.resolveCapacityPriceUpdateColumns(executor);
    if (!columnMeta) {
      return false;
    }

    const { idColumn, productIdColumn, netPriceColumn } = columnMeta;

    const whereClauses = [`c."${idColumn}"::text = $1::text`];
    const whereValues: unknown[] = [String(capacityId)];

    if (productIdColumn) {
      whereValues.push(String(productId));
      whereClauses.push(`c."${productIdColumn}"::text = $${whereValues.length}::text`);
    }

    const currentPriceResult = await executor.query<{ current_price: string | null }>(
      `SELECT c."${netPriceColumn}"::text AS current_price
       FROM tblcapacity c
       WHERE ${whereClauses.join(' AND ')}
       LIMIT 1`,
      whereValues,
    );

    if (currentPriceResult.rowCount === 0) {
      return false;
    }

    const currentPrice = this.toOptionalNumber(currentPriceResult.rows[0]?.current_price) ?? 0;
    if (!this.shouldUseApprovedPriceForCapacityUpdate(currentPrice, incomingUnitPrice)) {
      return false;
    }

    const comparableCurrent = this.toComparableNumberString(currentPrice);
    const comparableIncoming = this.toComparableNumberString(incomingUnitPrice);
    if (comparableCurrent === comparableIncoming) {
      return false;
    }

    // UPDATE reserves $1 for the new net price, so shift WHERE placeholders by +1.
    const updateWhereClauses = whereClauses.map((clause) =>
      clause.replace(/\$(\d+)/g, (_, index) => `$${Number(index) + 1}`),
    );

    await executor.query(
      `UPDATE tblcapacity c
       SET "${netPriceColumn}" = $1::double precision
       WHERE ${updateWhereClauses.join(' AND ')}`,
      [incomingUnitPrice, ...whereValues],
    );

    return true;
  }

  private async recordCapacityNetPricesForApprovedPurchase(
    executor: { query: PoolClient['query'] },
    purchaseOrderId: number,
    userId?: number,
  ): Promise<number> {
    const purchaseResult = await executor.query<{
      vendor_id: string | null;
      po_number: string | null;
    }>(
      `SELECT
         po.vendor_id::text AS vendor_id,
         COALESCE(
           to_jsonb(po)->>'po_number',
           to_jsonb(po)->>'poNumber',
           to_jsonb(po)->>'po_no'
         ) AS po_number
       FROM tblpurchase_orders po
       WHERE po.id = $1
       LIMIT 1`,
      [purchaseOrderId],
    );

    if (purchaseResult.rowCount === 0) {
      return 0;
    }

    const vendorId = purchaseResult.rows[0]?.vendor_id;
    const poNumber = purchaseResult.rows[0]?.po_number;

    const itemRows = await executor.query<{
      product_id: string | null;
      capacity_id: string | null;
      unit_price: string | null;
    }>(
      `SELECT
         COALESCE(
           to_jsonb(tpi)->>'productId',
           to_jsonb(tpi)->>'product_id'
         ) AS product_id,
         COALESCE(
           to_jsonb(tpi)->>'capacityId',
           to_jsonb(tpi)->>'capacity_id'
         ) AS capacity_id,
         COALESCE(
           to_jsonb(tpi)->>'unitPrice',
           to_jsonb(tpi)->>'unit_price'
         ) AS unit_price
       FROM tbltransaction_product_items tpi
       WHERE COALESCE(
         to_jsonb(tpi)->>'purchaseId',
         to_jsonb(tpi)->>'purchase_id',
         to_jsonb(tpi)->>'po_id'
       ) = $1
       AND LOWER(COALESCE(
         to_jsonb(tpi)->>'transType',
         to_jsonb(tpi)->>'trans_type',
         'purchase'
       )) = 'purchase'`,
      [String(purchaseOrderId)],
    );

    let processedItems = 0;
    for (const item of itemRows.rows) {
      const productId = this.toOptionalNumber(item.product_id);
      const capacityId = this.toOptionalNumber(item.capacity_id);

      if (productId === null || capacityId === null) {
        continue;
      }

      await this.recordCapacityNetPriceFromPurchaseItem(executor, {
        productId,
        capacityId,
        unitPrice: item.unit_price,
        vendorId,
        purchaseOrderId,
        purchaseOrderNo: poNumber,
        userId,
      });

      processedItems += 1;
    }

    return processedItems;
  }

  async create(createPurchaseDto: CreatePurchaseDto, userId?: number, branchId?: number) {
    const poNumber = String(createPurchaseDto.poNumber ?? '').trim();
    const status = String(createPurchaseDto.status ?? 'pending').trim() || 'pending';

    const productItems = Array.isArray(createPurchaseDto.productItems)
      ? createPurchaseDto.productItems
      : [];

    if (productItems.length === 0) {
      return { success: false, message: 'At least one product item is required' };
    }

    try {
      const result = await this.databaseService.withTransaction(async (client) => {
        let resolvedVendorId = String(createPurchaseDto.vendorId ?? '').trim();
        const vendorName = String(createPurchaseDto.vendor?.name ?? '').trim();
        const vendorColumns = await this.getTableColumns(client, 'tblvendors');
        const vendorIdColumn = this.pickColumn(vendorColumns, ['id']);
        const vendorNameColumn = this.pickColumn(vendorColumns, ['name']);
        const vendorAddressColumn = this.pickColumn(vendorColumns, ['address']);
        const contactPersonColumn = this.pickColumn(vendorColumns, [
          'contact_person',
          'contactPerson',
        ]);
        const contactNumberColumn = this.pickColumn(vendorColumns, [
          'contact_number',
          'contactNumber',
        ]);

        if (resolvedVendorId) {
          const existingVendorResult = await client.query<{ id: string | number }>(
            `SELECT id
             FROM tblvendors
             WHERE id::text = $1
             LIMIT 1`,
            [resolvedVendorId],
          );

          if (existingVendorResult.rowCount === 0) {
            if (!vendorName) {
              throw new Error('Vendor not found for provided vendorId');
            }

            if (!vendorNameColumn) {
              throw new Error('tblvendors name column is missing');
            }

            const vendorRecord: Record<string, unknown> = {
              [vendorNameColumn]: vendorName,
            };

            if (vendorIdColumn) {
              vendorRecord[vendorIdColumn] = resolvedVendorId;
            }

            const vendorAddress = String(createPurchaseDto.vendor?.address ?? '').trim();
            const contactPerson = String(
              createPurchaseDto.vendor?.contact_person ?? '',
            ).trim();
            const contactNumber = String(
              createPurchaseDto.vendor?.contact_number ?? '',
            ).trim();

            if (vendorAddressColumn && vendorAddress) {
              vendorRecord[vendorAddressColumn] = vendorAddress;
            }
            if (contactPersonColumn && contactPerson) {
              vendorRecord[contactPersonColumn] = contactPerson;
            }
            if (contactNumberColumn && contactNumber) {
              vendorRecord[contactNumberColumn] = contactNumber;
            }

            const insertedVendor = await this.runInsert(client, 'tblvendors', vendorRecord);
            if (insertedVendor.rowCount === 0) {
              throw new Error('Failed to create vendor for provided vendorId');
            }
          }
        }

        if (!resolvedVendorId) {
          if (!vendorName) {
            throw new Error('Vendor ID or vendor.name is required');
          }

          if (!vendorNameColumn) {
            throw new Error('tblvendors name column is missing');
          }

          const vendorRecord: Record<string, unknown> = {
            [vendorNameColumn]: vendorName,
          };

          if (vendorIdColumn) {
            vendorRecord[vendorIdColumn] = randomUUID();
          }

          const vendorAddress = String(createPurchaseDto.vendor?.address ?? '').trim();
          const contactPerson = String(
            createPurchaseDto.vendor?.contact_person ?? '',
          ).trim();
          const contactNumber = String(
            createPurchaseDto.vendor?.contact_number ?? '',
          ).trim();

          if (vendorAddressColumn && vendorAddress) {
            vendorRecord[vendorAddressColumn] = vendorAddress;
          }
          if (contactPersonColumn && contactPerson) {
            vendorRecord[contactPersonColumn] = contactPerson;
          }
          if (contactNumberColumn && contactNumber) {
            vendorRecord[contactNumberColumn] = contactNumber;
          }

          const insertedVendor = await this.runInsert(client, 'tblvendors', vendorRecord);
          if (insertedVendor.rowCount === 0) {
            throw new Error('Failed to create vendor');
          }

          resolvedVendorId = String(insertedVendor.rows[0].id);
        }

        let computedTotalAmount = 0;
        for (const item of productItems) {
          const itemUnitPrice = this.toOptionalNumber(item.unitPrice) ?? 0;
          const itemDiscountPrice = this.toOptionalNumber(item.discountPrice) ?? 0;
          const priceToUse = itemDiscountPrice > 0 ? itemDiscountPrice : itemUnitPrice;
          const qty = this.toOptionalNumber(item.totalSetQty) ?? 0;
          computedTotalAmount += priceToUse * qty;
        }

        const fallbackTotal = this.toOptionalNumber(createPurchaseDto.totalAmount) ?? 0;
        const totalAmount = computedTotalAmount > 0 ? computedTotalAmount : fallbackTotal;

        if (poNumber) {
          const duplicatePoResult = await client.query<{ id: number }>(
            `SELECT id
             FROM tblpurchase_orders po
             WHERE LOWER(TRIM(COALESCE(
               to_jsonb(po)->>'po_number',
               to_jsonb(po)->>'poNumber',
               to_jsonb(po)->>'po_no',
               ''
             ))) = LOWER(TRIM($1))
             LIMIT 1`,
            [poNumber],
          );

          if (duplicatePoResult.rowCount > 0) {
            throw new Error('PO number already exists');
          }
        }

        const purchaseColumns = await this.getTableColumns(client, 'tblpurchase_orders');
        const poNumberColumn = this.pickColumn(purchaseColumns, ['po_number', 'poNumber', 'po_no']);
        const purchaseVendorIdColumn = this.pickColumn(purchaseColumns, ['vendor_id', 'vendorId']);
        const totalAmountColumn = this.pickColumn(purchaseColumns, ['total_amount', 'totalAmount']);
        const statusColumn = this.pickColumn(purchaseColumns, ['status']);
        const createdByColumn = this.pickColumn(purchaseColumns, ['created_by', 'createdBy', 'createdby']);
        const branchIdColumn = this.pickColumn(purchaseColumns, ['branch_id', 'branchId']);

        if (!poNumberColumn || !purchaseVendorIdColumn || !totalAmountColumn || !statusColumn) {
          throw new Error('tblpurchase_orders columns are not aligned with expected fields');
        }

        const purchaseRecord: Record<string, unknown> = {
          [purchaseVendorIdColumn]: resolvedVendorId,
          [totalAmountColumn]: totalAmount,
          [statusColumn]: status,
        };

        if (poNumberColumn && poNumber) {
          purchaseRecord[poNumberColumn] = poNumber;
        }

        if (createdByColumn && userId) {
          purchaseRecord[createdByColumn] = userId;
        }

        if (branchIdColumn && Number.isFinite(branchId) && Number(branchId) > 0) {
          purchaseRecord[branchIdColumn] = Number(branchId);
        }

        const purchaseInsertResult = await this.runInsert(
          client,
          'tblpurchase_orders',
          purchaseRecord,
        );

        if (purchaseInsertResult.rowCount === 0) {
          throw new Error('Failed to create purchase order');
        }

        const purchaseOrderId = purchaseInsertResult.rows[0].id;

        const purchaseOrderPoNumberResult = await client.query<{ po_number: string | null }>(
          `SELECT COALESCE(
             to_jsonb(po)->>'po_number',
             to_jsonb(po)->>'poNumber',
             to_jsonb(po)->>'po_no'
           ) AS po_number
           FROM tblpurchase_orders po
           WHERE po.id = $1
           LIMIT 1`,
          [purchaseOrderId],
        );

        const resolvedPoNumber =
          purchaseOrderPoNumberResult.rows[0]?.po_number?.trim() || poNumber;
        const paymentDetailsInput = createPurchaseDto.paymentDetails;
        const paymentDetailsList = Array.isArray(paymentDetailsInput)
          ? paymentDetailsInput
          : paymentDetailsInput
            ? [paymentDetailsInput]
            : [];

        if (paymentDetailsList.length > 0) {
          const paymentColumns = await this.getTableColumns(client, 'tblpo_payments');
          if (paymentColumns.length > 0) {
            const paymentPoIdColumn = this.pickColumn(paymentColumns, [
              'po_id',
              'poId',
              'purchase_id',
              'purchaseId',
              'purchase_order_id',
              'purchaseOrderId',
            ]);
            const amountColumn = this.pickColumn(paymentColumns, [
              'amount',
              'payment_amount',
              'paymentAmount',
            ]);
            const methodColumn = this.pickColumn(paymentColumns, ['method']);
            const paymentDateColumn = this.pickColumn(paymentColumns, [
              'payment_date',
              'paymentDate',
            ]);
            const bankNameColumn = this.pickColumn(paymentColumns, ['bank_name', 'bankName']);
            const referenceNoColumn = this.pickColumn(paymentColumns, ['reference_no', 'referenceNo']);
            const checkNoColumn = this.pickColumn(paymentColumns, ['check_no', 'checkNo']);
            const chequeDateColumn = this.pickColumn(paymentColumns, [
              'cheque_date',
              'chequeDate',
              'post_dated',
              'postDated',
            ]);
            const issuedByColumn = this.pickColumn(paymentColumns, ['issued_by', 'issuedBy']);
            const termsColumn = this.pickColumn(paymentColumns, ['terms']);
            const termsDueDateColumn = this.pickColumn(paymentColumns, [
              'terms_due_date',
              'termsDueDate',
            ]);
            const paymentStatusColumn = this.pickColumn(paymentColumns, ['status']);
            const downPaymentColumn = this.pickColumn(paymentColumns, [
              'down_payment',
              'downPayment',
            ]);

            if (paymentPoIdColumn) {
              for (const [paymentIndex, paymentDetails] of paymentDetailsList.entries()) {
                if (!paymentDetails || typeof paymentDetails !== 'object') {
                  throw new BadRequestException(`paymentDetails[${paymentIndex}] must be an object`);
                }

                const paymentPayload = paymentDetails as Record<string, unknown>;
                const method = this.validatePurchasePaymentDetails(paymentPayload, paymentIndex);
                const paymentRecord: Record<string, unknown> = {
                  [paymentPoIdColumn]: purchaseOrderId,
                };

                const downPayment = this.toOptionalNumber(paymentPayload.downPayment);
                const providedPaymentAmount = this.toOptionalNumber(paymentPayload.amount);

                const resolvedTermsDueDate = this.deriveTermsDueDate(paymentPayload, method);
                const paymentStatus = this.resolvePaymentStatusForDisplay(
                  method,
                  paymentPayload.status ?? this.getAutoPaymentStatus(method),
                  resolvedTermsDueDate,
                  paymentPayload.chequeDate,
                );

                const fallbackPaymentAmount =
                  paymentStatus === 'paid'
                    ? totalAmount
                    : (downPayment ?? 0);

                const paymentAmount =
                  providedPaymentAmount !== null
                    ? providedPaymentAmount
                    : fallbackPaymentAmount;

                if (amountColumn) {
                  paymentRecord[amountColumn] = paymentAmount;
                }
                if (methodColumn) {
                  paymentRecord[methodColumn] = method;
                }

                const paymentDate = this.toIsoDateOrNull(paymentPayload.paymentDate);
                if (paymentDateColumn && paymentDate) {
                  paymentRecord[paymentDateColumn] = paymentDate;
                }
                if (bankNameColumn && paymentPayload.bankName) {
                  paymentRecord[bankNameColumn] = String(paymentPayload.bankName).trim();
                }
                if (referenceNoColumn && paymentPayload.referenceNo) {
                  paymentRecord[referenceNoColumn] = String(paymentPayload.referenceNo).trim();
                }
                if (checkNoColumn && paymentPayload.checkNo) {
                  paymentRecord[checkNoColumn] = String(paymentPayload.checkNo).trim();
                }
                const chequeDate = this.toIsoDateOrNull(paymentPayload.chequeDate);
                if (chequeDateColumn && chequeDate) {
                  paymentRecord[chequeDateColumn] = chequeDate;
                }
                if (issuedByColumn && paymentPayload.issuedBy) {
                  paymentRecord[issuedByColumn] = String(paymentPayload.issuedBy).trim();
                }

                if (termsColumn && paymentPayload.terms) {
                  paymentRecord[termsColumn] = String(paymentPayload.terms).trim();
                }

                if (termsDueDateColumn && resolvedTermsDueDate) {
                  paymentRecord[termsDueDateColumn] = resolvedTermsDueDate;
                }

                if (paymentStatusColumn) {
                  paymentRecord[paymentStatusColumn] = paymentStatus;
                }

                if (downPaymentColumn && downPayment !== null) {
                  paymentRecord[downPaymentColumn] = downPayment;
                }

                await this.runInsert(client, 'tblpo_payments', paymentRecord);
              }
            }
          }
        }

        const transactionItemColumns = await this.getTableColumns(
          client,
          'tbltransaction_product_items',
        );
        if (transactionItemColumns.length > 0) {
          const transTypeColumn = this.pickColumn(transactionItemColumns, [
            'transType',
            'trans_type',
          ]);
          const productIdColumn = this.pickColumn(transactionItemColumns, [
            'productId',
            'product_id',
          ]);
          const capacityIdColumn = this.pickColumn(transactionItemColumns, [
            'capacityId',
            'capacity_id',
          ]);
          const unitPriceColumn = this.pickColumn(transactionItemColumns, [
            'unitPrice',
            'unit_price',
          ]);
          const sellPriceColumn = this.pickColumn(transactionItemColumns, [
            'sellPrice',
            'sell_price',
          ]);
          const discountPriceColumn = this.pickColumn(transactionItemColumns, [
            'discountPrice',
            'discount_price',
          ]);
          const unitTypesQtyColumn = this.pickColumn(transactionItemColumns, [
            'unitTypesQty',
            'unit_types_qty',
          ]);
          const totalSetQtyColumn = this.pickColumn(transactionItemColumns, [
            'totalSetQty',
            'total_set_qty',
          ]);
          const purchaseIdColumn = this.pickColumn(transactionItemColumns, [
            'purchaseId',
            'purchase_id',
            'po_id',
          ]);
          const salesIdColumn = this.pickColumn(transactionItemColumns, [
            'salesId',
            'sales_id',
          ]);
          const statusColumn = this.pickColumn(transactionItemColumns, ['status']);
          const createdByColumn = this.pickColumn(transactionItemColumns, [
            'created_by',
            'createdBy',
            'createdby',
          ]);
          const unitTypesQtyMeta = unitTypesQtyColumn
            ? await this.getColumnMeta(
                client,
                'tbltransaction_product_items',
                unitTypesQtyColumn,
              )
            : null;

          for (const item of productItems) {
            const transType = String(item.transType ?? 'purchase').trim().toLowerCase();
            if (transType !== 'purchase') {
              continue;
            }

            const productId = this.toOptionalNumber(item.productId);
            const capacityId = this.toOptionalNumber(item.capacityId);
            if (productId === null || capacityId === null) {
              throw new Error('productId and capacityId are required for purchase items');
            }

            const productExistsResult = await client.query<{ id: string | number }>(
              `SELECT id
               FROM tblproducts
               WHERE id::text = $1
               LIMIT 1`,
              [String(productId)],
            );

            if (productExistsResult.rowCount === 0) {
              throw new Error(`Product ID ${productId} does not exist in tblproducts`);
            }

            const capacityExistsResult = await client.query<{ id: string | number }>(
              `SELECT id
               FROM tblcapacity
               WHERE id::text = $1
               LIMIT 1`,
              [String(capacityId)],
            );

            if (capacityExistsResult.rowCount === 0) {
              throw new Error(`Capacity ID ${capacityId} does not exist in tblcapacity`);
            }

            const unitTypesQty = Array.isArray(item.unitTypesQty) ? item.unitTypesQty : [];
            const qtyFromList = unitTypesQty.reduce((sum, current) => {
              const parsedQty = this.toOptionalNumber(current.qty ?? current.value) ?? 0;
              return sum + (parsedQty > 0 ? parsedQty : 0);
            }, 0);
            const fallbackTotalQty = this.toOptionalNumber(item.totalSetQty) ?? 0;
            const totalQty = qtyFromList > 0 ? qtyFromList : fallbackTotalQty;

            const itemRecord: Record<string, unknown> = {};
            if (transTypeColumn) {
              itemRecord[transTypeColumn] = transType;
            }
            if (productIdColumn) {
              itemRecord[productIdColumn] = productId;
            }
            if (capacityIdColumn) {
              itemRecord[capacityIdColumn] = capacityId;
            }
            if (unitPriceColumn) {
              itemRecord[unitPriceColumn] = this.toOptionalNumber(item.unitPrice) ?? 0;
            }
            if (sellPriceColumn) {
              itemRecord[sellPriceColumn] = this.toOptionalNumber(item.sellPrice) ?? 0;
            }
            if (discountPriceColumn) {
              itemRecord[discountPriceColumn] =
                this.toOptionalNumber(item.discountPrice) ?? 0;
            }
            if (unitTypesQtyColumn) {
              const normalizedUnitTypesQty = unitTypesQty.map((entry) => ({
                label: String(entry.label ?? entry.unitType ?? 'set').trim() || 'set',
                value: this.toOptionalNumber(entry.value ?? entry.qty) ?? 0,
              }));

              if (
                unitTypesQtyMeta &&
                (unitTypesQtyMeta.data_type === 'ARRAY' ||
                  unitTypesQtyMeta.udt_name.startsWith('_'))
              ) {
                itemRecord[unitTypesQtyColumn] = normalizedUnitTypesQty.map(
                  (entry) => `${entry.label}:${entry.value}`,
                );
              } else {
                itemRecord[unitTypesQtyColumn] = JSON.stringify(normalizedUnitTypesQty);
              }
            }
            if (totalSetQtyColumn) {
              itemRecord[totalSetQtyColumn] = totalQty;
            }
            if (purchaseIdColumn) {
              itemRecord[purchaseIdColumn] =
                this.toOptionalNumber(item.purchaseId) ?? purchaseOrderId;
            }
            if (salesIdColumn) {
              itemRecord[salesIdColumn] = this.toOptionalNumber(item.salesId);
            }
            if (statusColumn) {
              itemRecord[statusColumn] = 'pending';
            }
            if (createdByColumn && userId) {
              itemRecord[createdByColumn] = userId;
            }

            if (Object.keys(itemRecord).length > 0) {
              await this.runInsert(client, 'tbltransaction_product_items', itemRecord);
            }

          }
        }

        return {
          purchaseOrderId,
          poNumber: resolvedPoNumber,
          vendorId: resolvedVendorId,
          computedTotalAmount: totalAmount,
        };
      });

      return {
        success: true,
        message: 'Purchase request created successfully',
        data: result,
      };
    } catch (error) {
      return {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : 'Failed to create purchase request',
      };
    }
  }

  async findAll(query: ListPurchaseQueryDto) {
    return this.getMasterData(query);
  }

  async getDeliveries(query: ListPurchaseQueryDto): Promise<PurchaseListResponseDto> {
    return this.fetchByMode('deliveries', query);
  }

  async getApprovals(query: ListPurchaseQueryDto): Promise<PurchaseListResponseDto> {
    return this.fetchByMode('approvals', query);
  }

  async getMasterData(query: ListPurchaseQueryDto): Promise<PurchaseListResponseDto> {
    return this.fetchByMode('master-data', query);
  }

  private isApprovalStageStatus(status: string | null | undefined): boolean {
    const normalized = String(status ?? '').trim().toLowerCase();
    return [
      'for_approval',
      'for approval',
      'approval',
      'pending_approval',
      'pending approval',
    ].includes(normalized);
  }

  private async transitionPurchaseStatus(
    id: number,
    nextStatus: string,
    userId?: number,
    options?: {
      approvalOnly?: boolean;
      updateSerialsToInStock?: boolean;
      successMessage?: string;
    },
  ) {
    if (!Number.isFinite(id) || id <= 0) {
      return { success: false, message: 'Invalid purchase id' };
    }

    const shouldRequireApprovalStage = options?.approvalOnly ?? false;
    const shouldUpdateSerials = options?.updateSerialsToInStock ?? false;

    try {
      const result = await this.databaseService.withTransaction(async (client) => {
        const existingPurchaseResult = await client.query<{
          id: number;
          status: string | null;
        }>(
          `SELECT
             po.id,
             po.status::text AS status
           FROM tblpurchase_orders po
           WHERE po.id = $1
           LIMIT 1`,
          [id],
        );

        if (existingPurchaseResult.rowCount === 0) {
          throw new Error(`Purchase order ${id} not found`);
        }

        const currentStatus = existingPurchaseResult.rows[0]?.status;
        if (shouldRequireApprovalStage && !this.isApprovalStageStatus(currentStatus)) {
          throw new Error('Purchase order is not in approval stage');
        }

        const purchaseColumns = await this.getTableColumns(client, 'tblpurchase_orders');
        const statusColumn = this.pickColumn(purchaseColumns, ['status']);
        if (!statusColumn) {
          throw new Error('tblpurchase_orders status column is not configured');
        }

        await client.query(
          `UPDATE tblpurchase_orders
           SET "${statusColumn}" = $1
           WHERE id = $2`,
          [nextStatus, id],
        );

        let updatedSerialCount = 0;
        let recordedNetPriceItems = 0;
        let postedMaterialMovements = 0;
        let skippedMaterialMovements = 0;
        if (shouldUpdateSerials) {
          const serialColumns = await this.getTableColumns(client, 'tblserial_numbers');
          const serialStatusColumn = this.pickColumn(serialColumns, ['status']);

          if (!serialStatusColumn) {
            throw new Error('tblserial_numbers status column is not configured');
          }

          const serialPurchaseIdColumn = this.pickColumn(serialColumns, [
            'purchaseId',
            'purchase_id',
            'po_id',
            'purchaseOrderId',
            'purchase_order_id',
          ]);

          const serialUpdateResult = serialPurchaseIdColumn
            ? await client.query(
                `UPDATE tblserial_numbers
                 SET "${serialStatusColumn}" = $1
                 WHERE "${serialPurchaseIdColumn}"::text = $2`,
                ['in-stock', String(id)],
              )
            : await client.query(
                `UPDATE tblserial_numbers sn
                 SET "${serialStatusColumn}" = $1
                 WHERE COALESCE(
                   to_jsonb(sn)->>'purchaseId',
                   to_jsonb(sn)->>'purchase_id',
                   to_jsonb(sn)->>'po_id',
                   to_jsonb(sn)->>'purchaseOrderId',
                   to_jsonb(sn)->>'purchase_order_id'
                 ) = $2`,
                ['in-stock', String(id)],
              );

          updatedSerialCount = serialUpdateResult.rowCount ?? 0;

          recordedNetPriceItems = await this.recordCapacityNetPricesForApprovedPurchase(
            client,
            id,
            userId,
          );

          // const materialResult = await this.materialStockService.applyInboundFromPo(
          //   client,
          //   id,
          //   nextStatus,
          //   userId,
          // );
          // postedMaterialMovements = materialResult.posted;
          // skippedMaterialMovements = materialResult.skipped;
        }

        return {
          purchaseId: id,
          status: nextStatus,
          updatedSerialCount,
          recordedNetPriceItems,
          postedMaterialMovements,
          skippedMaterialMovements,
          updatedBy: userId ?? null,
        };
      });

      return {
        success: true,
        message: options?.successMessage ?? 'Purchase order status updated successfully',
        data: result,
      };
    } catch (error) {
      return {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : 'Failed to update purchase order status',
      };
    }
  }

  async revertInProgress(id: number, userId?: number) {
    return this.transitionPurchaseStatus(id, 'in-progress', userId, {
      approvalOnly: true,
      updateSerialsToInStock: false,
      successMessage: 'Purchase order reverted to in-progress',
    });
  }

  async revertToDeliveries(id: number, userId?: number) {
    return this.transitionPurchaseStatus(id, 'in-progress', userId, {
      approvalOnly: true,
      updateSerialsToInStock: false,
      successMessage: 'Purchase order reverted to deliveries',
    });
  }

  async approve(id: number, userId?: number) {
    return this.transitionPurchaseStatus(id, 'approved', userId, {
      approvalOnly: true,
      updateSerialsToInStock: true,
      successMessage: 'Purchase order approved and serials moved to in-stock',
    });
  }

  async getVendors(search?: string) {
    const normalizedSearch = String(search ?? '').trim();

    try {
      const params: unknown[] = [];
      let whereClause = '';

      if (normalizedSearch) {
        params.push(`%${normalizedSearch}%`);
        whereClause = `WHERE LOWER(COALESCE(to_jsonb(v)->>'name', to_jsonb(v)->>'vendor_name', '')) LIKE LOWER($1)`;
      }

      const result = await this.databaseService.query<{ id: string; name: string | null }>(
        `SELECT
           v.id::text AS id,
           COALESCE(to_jsonb(v)->>'name', to_jsonb(v)->>'vendor_name') AS name
         FROM tblvendors v
         ${whereClause}
         ORDER BY COALESCE(to_jsonb(v)->>'name', to_jsonb(v)->>'vendor_name') ASC
         LIMIT 50`,
        params,
      );

      return {
        success: true,
        items: result.rows.map((row) => ({
          id: row.id,
          name: row.name ?? row.id,
        })),
      };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to load vendors',
        items: [],
      };
    }
  }

  async findOne(id: number) {
    if (!Number.isFinite(id) || id <= 0) {
      return {
        success: false,
        message: 'Invalid purchase id',
      };
    }

    try {
      const purchaseResult = await this.databaseService.query<PurchaseDetailRow>(
        `SELECT
           po.id,
           po.po_number AS "poNumber",
           po.vendor_id::text AS "vendorId",
           COALESCE(to_jsonb(v)->>'name', to_jsonb(v)->>'vendor_name') AS "vendorName",
           COALESCE(to_jsonb(v)->>'address', '') AS "vendorAddress",
           COALESCE(
             to_jsonb(v)->>'contact_person',
             to_jsonb(v)->>'contactPerson',
             ''
           ) AS "vendorContactPerson",
           COALESCE(
             to_jsonb(v)->>'contact_number',
             to_jsonb(v)->>'contactNumber',
             ''
           ) AS "vendorContactNumber",
           po.total_amount::text AS "totalAmount",
           COALESCE(po.status, 'pending') AS status,
           po.created_at::text AS "createdAt"
         FROM tblpurchase_orders po
         LEFT JOIN tblvendors v
           ON v.id::text = po.vendor_id::text
         WHERE po.id = $1
         LIMIT 1`,
        [id],
      );

      if (purchaseResult.rowCount === 0) {
        return {
          success: false,
          message: `Purchase order ${id} not found`,
        };
      }

      const paymentResult = await this.databaseService.query<PurchasePaymentRow>(
        `SELECT
           COALESCE(to_jsonb(pp)->>'method', null) AS method,
           COALESCE(
             NULLIF(
               COALESCE(
                 to_jsonb(pp)->>'amount',
                 to_jsonb(pp)->>'payment_amount',
                 to_jsonb(pp)->>'paymentAmount',
                 ''
               ),
               ''
             )::numeric,
             0
           )::text AS amount,
           COALESCE(to_jsonb(pp)->>'terms', null) AS terms,
           COALESCE(
             to_jsonb(pp)->>'terms_due_date',
             to_jsonb(pp)->>'termsDueDate',
             null
           ) AS "termsDueDate",
           COALESCE(to_jsonb(pp)->>'status', null) AS status,
           COALESCE(
             to_jsonb(pp)->>'payment_date',
             to_jsonb(pp)->>'paymentDate',
             null
           ) AS "paymentDate",
           COALESCE(
             to_jsonb(pp)->>'bank_name',
             to_jsonb(pp)->>'bankName',
             null
           ) AS "bankName",
           COALESCE(
             to_jsonb(pp)->>'reference_no',
             to_jsonb(pp)->>'referenceNo',
             null
           ) AS "referenceNo",
           COALESCE(
             to_jsonb(pp)->>'check_no',
             to_jsonb(pp)->>'checkNo',
             null
           ) AS "checkNo",
           COALESCE(
             to_jsonb(pp)->>'cheque_date',
             to_jsonb(pp)->>'chequeDate',
             to_jsonb(pp)->>'post_dated',
             to_jsonb(pp)->>'postDated',
             null
           ) AS "chequeDate",
           COALESCE(
             to_jsonb(pp)->>'issued_by',
             to_jsonb(pp)->>'issuedBy',
             null
           ) AS "issuedBy",
           COALESCE(
             NULLIF(
               COALESCE(
                 to_jsonb(pp)->>'down_payment',
                 to_jsonb(pp)->>'downPayment',
                 ''
               ),
               ''
             )::numeric,
             0
           )::text AS "downPayment"
         FROM tblpo_payments pp
         WHERE COALESCE(
           to_jsonb(pp)->>'po_id',
           to_jsonb(pp)->>'poId',
           to_jsonb(pp)->>'purchase_id',
           to_jsonb(pp)->>'purchaseId',
           to_jsonb(pp)->>'purchase_order_id',
           to_jsonb(pp)->>'purchaseOrderId'
         ) = $1
         ORDER BY pp.id ASC`,
        [String(id)],
      );

      const productResult = await this.databaseService.query<PurchaseProductRow>(
        `SELECT
           tpi.id,
           COALESCE(
             to_jsonb(tpi)->>'transType',
             to_jsonb(tpi)->>'trans_type',
             'purchase'
           ) AS "transType",
           COALESCE(
             to_jsonb(tpi)->>'productId',
             to_jsonb(tpi)->>'product_id'
           ) AS "productId",
           COALESCE(
             to_jsonb(tpi)->>'capacityId',
             to_jsonb(tpi)->>'capacity_id'
           ) AS "capacityId",
           COALESCE(
             NULLIF(
               COALESCE(to_jsonb(tpi)->>'unitPrice', to_jsonb(tpi)->>'unit_price', ''),
               ''
             )::numeric,
             0
           )::text AS "unitPrice",
           COALESCE(
             NULLIF(
               COALESCE(to_jsonb(tpi)->>'sellPrice', to_jsonb(tpi)->>'sell_price', ''),
               ''
             )::numeric,
             0
           )::text AS "sellPrice",
           COALESCE(
             NULLIF(
               COALESCE(to_jsonb(tpi)->>'discountPrice', to_jsonb(tpi)->>'discount_price', ''),
               ''
             )::numeric,
             0
           )::text AS "discountPrice",
           COALESCE(
             to_jsonb(tpi)->'unitTypesQty',
             to_jsonb(tpi)->'unit_types_qty',
             '[]'::jsonb
           ) AS "unitTypesQty",
           COALESCE(
             NULLIF(
               COALESCE(
                 to_jsonb(tpi)->>'totalSetQty',
                 to_jsonb(tpi)->>'total_set_qty',
                 ''
               ),
               ''
             )::int,
             0
           )::text AS "totalSetQty",
           COALESCE(
             to_jsonb(tpi)->>'purchaseId',
             to_jsonb(tpi)->>'purchase_id',
             to_jsonb(tpi)->>'po_id'
           ) AS "purchaseId",
           COALESCE(
             to_jsonb(tpi)->>'salesId',
             to_jsonb(tpi)->>'sales_id'
           ) AS "salesId",
           COALESCE(to_jsonb(tpi)->>'status', null) AS status
         FROM tbltransaction_product_items tpi
         WHERE COALESCE(
           to_jsonb(tpi)->>'purchaseId',
           to_jsonb(tpi)->>'purchase_id',
           to_jsonb(tpi)->>'po_id'
         ) = $1
         AND LOWER(COALESCE(
           to_jsonb(tpi)->>'transType',
           to_jsonb(tpi)->>'trans_type',
           'purchase'
         )) = 'purchase'
         ORDER BY tpi.id ASC`,
        [String(id)],
      );

      const serialResult = await this.databaseService.query<PurchaseSerialRow>(
        `SELECT
           COALESCE(
             to_jsonb(sn)->>'serialNumber',
             to_jsonb(sn)->>'serial_number'
           ) AS "serialNumber",
           COALESCE(
             to_jsonb(sn)->>'productId',
             to_jsonb(sn)->>'product_id',
             to_jsonb(sn)->>'prodId',
             to_jsonb(sn)->>'prod_id'
           ) AS "productId",
           COALESCE(
             to_jsonb(sn)->>'capacityId',
             to_jsonb(sn)->>'capacity_id',
             to_jsonb(sn)->>'capId',
             to_jsonb(sn)->>'cap_id'
           ) AS "capacityId",
           COALESCE(
             to_jsonb(sn)->>'unitType',
             to_jsonb(sn)->>'unit_type'
           ) AS "unitType"
         FROM tblserial_numbers sn
         WHERE COALESCE(
           to_jsonb(sn)->>'purchaseId',
           to_jsonb(sn)->>'purchase_id',
           to_jsonb(sn)->>'po_id'
         ) = $1`,
        [String(id)],
      );

      const serialMap = new Map<string, Record<string, string[]>>();
      const unresolvedSerialsByUnitType: Record<string, string[]> = {};
      for (const serialRow of serialResult.rows) {
        const productId = String(serialRow.productId ?? '').trim();
        const capacityId = String(serialRow.capacityId ?? '').trim();
        const serialNumber = this.normalizeSerialNumber(serialRow.serialNumber);
        const unitType = String(serialRow.unitType ?? 'set').trim().toLowerCase() || 'set';

        if (!serialNumber) {
          continue;
        }

        if (!productId || !capacityId) {
          if (!Array.isArray(unresolvedSerialsByUnitType[unitType])) {
            unresolvedSerialsByUnitType[unitType] = [];
          }

          if (!unresolvedSerialsByUnitType[unitType].includes(serialNumber)) {
            unresolvedSerialsByUnitType[unitType].push(serialNumber);
          }

          continue;
        }

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

      const purchase = purchaseResult.rows[0];
      const mappedProductItems = productResult.rows.map((product) => {
        const normalizedProductId = String(product.productId ?? '').trim();
        const normalizedCapacityId = String(product.capacityId ?? '').trim();
        const serialKey = `${normalizedProductId}::${normalizedCapacityId}`;

        return {
          id: product.id,
          transType: product.transType ?? 'purchase',
          productId: normalizedProductId,
          capacityId: normalizedCapacityId,
          unitPrice: this.toOptionalNumber(product.unitPrice) ?? 0,
          sellPrice: this.toOptionalNumber(product.sellPrice) ?? 0,
          discountPrice: this.toOptionalNumber(product.discountPrice) ?? 0,
          unitTypesQty: this.normalizeUnitTypesQty(product.unitTypesQty),
          totalSetQty: this.toOptionalNumber(product.totalSetQty) ?? 0,
          purchaseId: this.toOptionalNumber(product.purchaseId) ?? id,
          salesId: this.toOptionalNumber(product.salesId),
          status: product.status ?? 'pending',
          serialNumbers: serialMap.get(serialKey) ?? {},
        };
      });

      if (
        mappedProductItems.length === 1 &&
        Object.keys(unresolvedSerialsByUnitType).length > 0
      ) {
        const onlyItem = mappedProductItems[0];
        const mergedSerialNumbers: Record<string, string[]> = {
          ...(onlyItem.serialNumbers ?? {}),
        };

        for (const [unitType, serials] of Object.entries(unresolvedSerialsByUnitType)) {
          if (!Array.isArray(mergedSerialNumbers[unitType])) {
            mergedSerialNumbers[unitType] = [];
          }

          for (const serial of serials) {
            if (!mergedSerialNumbers[unitType].includes(serial)) {
              mergedSerialNumbers[unitType].push(serial);
            }
          }
        }

        onlyItem.serialNumbers = mergedSerialNumbers;
      }

      return {
        success: true,
        item: {
          id: purchase.id,
          poNumber: purchase.poNumber,
          vendorId: purchase.vendorId,
          vendorName: purchase.vendorName,
          vendorAddress: purchase.vendorAddress,
          vendorContactPerson: purchase.vendorContactPerson,
          vendorContactNumber: purchase.vendorContactNumber,
          totalAmount: this.toOptionalNumber(purchase.totalAmount) ?? 0,
          status: purchase.status,
          paymentDetails: paymentResult.rows.map((payment) => ({
            method: payment.method ?? '',
            amount: this.toOptionalNumber(payment.amount) ?? 0,
            terms: payment.terms ?? '',
            termsDueDate: payment.termsDueDate,
            status: payment.status ?? 'unpaid',
            paymentDate: payment.paymentDate,
            bankName: payment.bankName ?? '',
            referenceNo: payment.referenceNo ?? '',
            checkNo: payment.checkNo ?? '',
            chequeDate: payment.chequeDate,
            issuedBy: payment.issuedBy ?? '',
            downPayment: this.toOptionalNumber(payment.downPayment) ?? 0,
          })),
          productItems: mappedProductItems,
          createdAt: purchase.createdAt,
        },
      };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to load purchase order detail',
      };
    }
  }

  async update(
    id: number,
    updatePurchaseDto: UpdatePurchaseDto,
    userId?: number,
    branchId?: number,
  ) {
    if (!Number.isFinite(id) || id <= 0) {
      return { success: false, message: 'Invalid purchase id' };
    }

    if (!updatePurchaseDto || typeof updatePurchaseDto !== 'object') {
      return {
        success: false,
        message:
          'Invalid request body. Ensure JSON object payload is provided to PATCH /purchase/:id.',
      };
    }

    const payload = updatePurchaseDto as UpdatePurchaseDto;

    try {
      const result = await this.databaseService.withTransaction(async (client) => {
        const existingPurchaseResult = await client.query<{
          id: number;
          vendor_id: string | null;
          po_number: string | null;
          total_amount: string | null;
          status: string | null;
        }>(
          `SELECT
             po.id,
             po.vendor_id::text AS vendor_id,
             po.po_number::text AS po_number,
             po.total_amount::text AS total_amount,
             po.status::text AS status
           FROM tblpurchase_orders po
           WHERE po.id = $1
           LIMIT 1`,
          [id],
        );

        if (existingPurchaseResult.rowCount === 0) {
          throw new Error(`Purchase order ${id} not found`);
        }

        const existingPurchase = existingPurchaseResult.rows[0];
        let resolvedVendorId = String(
          payload.vendorId ?? existingPurchase.vendor_id ?? '',
        ).trim();
        const vendorName = String(payload.vendor?.name ?? '').trim();

        const vendorColumns = await this.getTableColumns(client, 'tblvendors');
        const vendorIdColumn = this.pickColumn(vendorColumns, ['id']);
        const vendorNameColumn = this.pickColumn(vendorColumns, ['name']);
        const vendorAddressColumn = this.pickColumn(vendorColumns, ['address']);
        const contactPersonColumn = this.pickColumn(vendorColumns, [
          'contact_person',
          'contactPerson',
        ]);
        const contactNumberColumn = this.pickColumn(vendorColumns, [
          'contact_number',
          'contactNumber',
        ]);

        if (resolvedVendorId) {
          const existingVendorResult = await client.query<{ id: string | number }>(
            `SELECT id
             FROM tblvendors
             WHERE id::text = $1
             LIMIT 1`,
            [resolvedVendorId],
          );

          if (existingVendorResult.rowCount === 0 && payload.vendor) {
            if (!vendorNameColumn || !vendorName) {
              throw new Error('vendor.name is required when vendorId does not exist');
            }

            const vendorRecord: Record<string, unknown> = {
              [vendorNameColumn]: vendorName,
            };
            if (vendorIdColumn) {
              vendorRecord[vendorIdColumn] = resolvedVendorId;
            }

            const vendorAddress = String(payload.vendor.address ?? '').trim();
            const contactPerson = String(
              payload.vendor.contact_person ?? '',
            ).trim();
            const contactNumber = String(
              payload.vendor.contact_number ?? '',
            ).trim();

            if (vendorAddressColumn && vendorAddress) {
              vendorRecord[vendorAddressColumn] = vendorAddress;
            }
            if (contactPersonColumn && contactPerson) {
              vendorRecord[contactPersonColumn] = contactPerson;
            }
            if (contactNumberColumn && contactNumber) {
              vendorRecord[contactNumberColumn] = contactNumber;
            }

            await this.runInsert(client, 'tblvendors', vendorRecord);
          }

          if (existingVendorResult.rowCount > 0 && payload.vendor) {
            const vendorUpdates: string[] = [];
            const vendorParams: unknown[] = [];

            const vendorAddress = String(payload.vendor.address ?? '').trim();
            const contactPerson = String(
              payload.vendor.contact_person ?? '',
            ).trim();
            const contactNumber = String(
              payload.vendor.contact_number ?? '',
            ).trim();

            if (vendorNameColumn && vendorName) {
              vendorParams.push(vendorName);
              vendorUpdates.push(`"${vendorNameColumn}" = $${vendorParams.length}`);
            }
            if (vendorAddressColumn && vendorAddress) {
              vendorParams.push(vendorAddress);
              vendorUpdates.push(`"${vendorAddressColumn}" = $${vendorParams.length}`);
            }
            if (contactPersonColumn && contactPerson) {
              vendorParams.push(contactPerson);
              vendorUpdates.push(`"${contactPersonColumn}" = $${vendorParams.length}`);
            }
            if (contactNumberColumn && contactNumber) {
              vendorParams.push(contactNumber);
              vendorUpdates.push(`"${contactNumberColumn}" = $${vendorParams.length}`);
            }

            if (vendorUpdates.length > 0) {
              vendorParams.push(resolvedVendorId);
              await client.query(
                `UPDATE tblvendors
                 SET ${vendorUpdates.join(', ')}
                 WHERE id::text = $${vendorParams.length}`,
                vendorParams,
              );
            }
          }
        }

        if (!resolvedVendorId && payload.vendor) {
          if (!vendorNameColumn || !vendorName) {
            throw new Error('vendor.name is required when vendorId is not provided');
          }

          const vendorRecord: Record<string, unknown> = {
            [vendorNameColumn]: vendorName,
          };
          if (vendorIdColumn) {
            vendorRecord[vendorIdColumn] = randomUUID();
          }

          const vendorAddress = String(payload.vendor.address ?? '').trim();
          const contactPerson = String(
            payload.vendor.contact_person ?? '',
          ).trim();
          const contactNumber = String(
            payload.vendor.contact_number ?? '',
          ).trim();

          if (vendorAddressColumn && vendorAddress) {
            vendorRecord[vendorAddressColumn] = vendorAddress;
          }
          if (contactPersonColumn && contactPerson) {
            vendorRecord[contactPersonColumn] = contactPerson;
          }
          if (contactNumberColumn && contactNumber) {
            vendorRecord[contactNumberColumn] = contactNumber;
          }

          const insertedVendor = await this.runInsert(client, 'tblvendors', vendorRecord);
          resolvedVendorId = String(insertedVendor.rows[0].id);
        }

        if (!resolvedVendorId) {
          throw new Error('Unable to resolve vendorId for purchase update');
        }

        const productItems = Array.isArray(payload.productItems)
          ? payload.productItems
          : [];

        let computedTotalAmount = 0;
        for (const item of productItems) {
          const itemUnitPrice = this.toOptionalNumber(item.unitPrice) ?? 0;
          const itemDiscountPrice = this.toOptionalNumber(item.discountPrice) ?? 0;
          const priceToUse = itemDiscountPrice > 0 ? itemDiscountPrice : itemUnitPrice;
          const qty = this.toOptionalNumber(item.totalSetQty) ?? 0;
          computedTotalAmount += priceToUse * qty;
        }

        const fallbackTotal =
          this.toOptionalNumber(payload.totalAmount) ??
          this.toOptionalNumber(existingPurchase.total_amount) ??
          0;
        const totalAmount =
          productItems.length > 0 && computedTotalAmount > 0
            ? computedTotalAmount
            : fallbackTotal;

        const status = String(
          payload.purchaseStatus ?? payload.status ?? existingPurchase.status ?? 'pending',
        ).trim() || 'pending';
        const poNumber = String(payload.poNumber ?? '').trim();

        if (poNumber && poNumber !== (existingPurchase.po_number ?? '').trim()) {
          const duplicatePoResult = await client.query<{ id: number }>(
            `SELECT id
             FROM tblpurchase_orders po
             WHERE LOWER(TRIM(COALESCE(
               to_jsonb(po)->>'po_number',
               to_jsonb(po)->>'poNumber',
               to_jsonb(po)->>'po_no',
               ''
             ))) = LOWER(TRIM($1))
             AND po.id <> $2
             LIMIT 1`,
            [poNumber, id],
          );

          if (duplicatePoResult.rowCount > 0) {
            throw new Error('PO number already exists');
          }
        }

        const purchaseColumns = await this.getTableColumns(client, 'tblpurchase_orders');
        const poNumberColumn = this.pickColumn(purchaseColumns, ['po_number', 'poNumber', 'po_no']);
        const purchaseVendorIdColumn = this.pickColumn(purchaseColumns, ['vendor_id', 'vendorId']);
        const totalAmountColumn = this.pickColumn(purchaseColumns, ['total_amount', 'totalAmount']);
        const statusColumn = this.pickColumn(purchaseColumns, ['status']);

        if (!purchaseVendorIdColumn || !totalAmountColumn || !statusColumn) {
          throw new Error('tblpurchase_orders columns are not aligned with expected fields');
        }

        const purchaseUpdates: string[] = [];
        const purchaseParams: unknown[] = [];

        purchaseParams.push(resolvedVendorId);
        purchaseUpdates.push(`"${purchaseVendorIdColumn}" = $${purchaseParams.length}`);

        purchaseParams.push(totalAmount);
        purchaseUpdates.push(`"${totalAmountColumn}" = $${purchaseParams.length}`);

        purchaseParams.push(status);
        purchaseUpdates.push(`"${statusColumn}" = $${purchaseParams.length}`);

        if (poNumberColumn && poNumber) {
          purchaseParams.push(poNumber);
          purchaseUpdates.push(`"${poNumberColumn}" = $${purchaseParams.length}`);
        }

        purchaseParams.push(id);
        await client.query(
          `UPDATE tblpurchase_orders
           SET ${purchaseUpdates.join(', ')}
           WHERE id = $${purchaseParams.length}`,
          purchaseParams,
        );

        const paymentDetailsInput = payload.paymentDetails;
        const paymentDetailsList = Array.isArray(paymentDetailsInput)
          ? paymentDetailsInput
          : paymentDetailsInput
            ? [paymentDetailsInput]
            : [];

        if (paymentDetailsList.length > 0) {
          const paymentColumns = await this.getTableColumns(client, 'tblpo_payments');
          const paymentPoIdColumn = this.pickColumn(paymentColumns, [
            'po_id',
            'poId',
            'purchase_id',
            'purchaseId',
            'purchase_order_id',
            'purchaseOrderId',
          ]);
          const amountColumn = this.pickColumn(paymentColumns, [
            'amount',
            'payment_amount',
            'paymentAmount',
          ]);
          const methodColumn = this.pickColumn(paymentColumns, ['method']);
          const paymentDateColumn = this.pickColumn(paymentColumns, ['payment_date', 'paymentDate']);
          const bankNameColumn = this.pickColumn(paymentColumns, ['bank_name', 'bankName']);
          const referenceNoColumn = this.pickColumn(paymentColumns, ['reference_no', 'referenceNo']);
          const checkNoColumn = this.pickColumn(paymentColumns, ['check_no', 'checkNo']);
          const chequeDateColumn = this.pickColumn(paymentColumns, [
            'cheque_date',
            'chequeDate',
            'post_dated',
            'postDated',
          ]);
          const issuedByColumn = this.pickColumn(paymentColumns, ['issued_by', 'issuedBy']);
          const termsColumn = this.pickColumn(paymentColumns, ['terms']);
          const termsDueDateColumn = this.pickColumn(paymentColumns, ['terms_due_date', 'termsDueDate']);
          const paymentStatusColumn = this.pickColumn(paymentColumns, ['status']);
          const downPaymentColumn = this.pickColumn(paymentColumns, ['down_payment', 'downPayment']);

          if (paymentPoIdColumn) {
            await client.query(
              `DELETE FROM tblpo_payments pp
               WHERE COALESCE(
                 to_jsonb(pp)->>'po_id',
                 to_jsonb(pp)->>'poId',
                 to_jsonb(pp)->>'purchase_id',
                 to_jsonb(pp)->>'purchaseId',
                 to_jsonb(pp)->>'purchase_order_id',
                 to_jsonb(pp)->>'purchaseOrderId'
               ) = $1`,
              [String(id)],
            );

            for (const [paymentIndex, paymentDetails] of paymentDetailsList.entries()) {
              if (!paymentDetails || typeof paymentDetails !== 'object') {
                throw new BadRequestException(`paymentDetails[${paymentIndex}] must be an object`);
              }

              const paymentPayload = paymentDetails as Record<string, unknown>;
              const method = this.validatePurchasePaymentDetails(paymentPayload, paymentIndex);

              const downPayment = this.toOptionalNumber(paymentPayload.downPayment);
              const providedPaymentAmount = this.toOptionalNumber(paymentPayload.amount);
              const resolvedTermsDueDate = this.deriveTermsDueDate(paymentPayload, method);
              const paymentStatus = this.resolvePaymentStatusForDisplay(
                method,
                paymentPayload.status ?? this.getAutoPaymentStatus(method),
                resolvedTermsDueDate,
                paymentPayload.chequeDate,
              );
              const fallbackPaymentAmount =
                paymentStatus === 'paid' ? totalAmount : downPayment ?? 0;
              const paymentAmount =
                providedPaymentAmount !== null
                  ? providedPaymentAmount
                  : fallbackPaymentAmount;

              const paymentRecord: Record<string, unknown> = {
                [paymentPoIdColumn]: id,
              };

              if (amountColumn) {
                paymentRecord[amountColumn] = paymentAmount;
              }
              if (methodColumn) {
                paymentRecord[methodColumn] = method;
              }

              const paymentDate = this.toIsoDateOrNull(paymentPayload.paymentDate);
              if (paymentDateColumn && paymentDate) {
                paymentRecord[paymentDateColumn] = paymentDate;
              }
              if (bankNameColumn && paymentPayload.bankName) {
                paymentRecord[bankNameColumn] = String(paymentPayload.bankName).trim();
              }
              if (referenceNoColumn && paymentPayload.referenceNo) {
                paymentRecord[referenceNoColumn] = String(paymentPayload.referenceNo).trim();
              }
              if (checkNoColumn && paymentPayload.checkNo) {
                paymentRecord[checkNoColumn] = String(paymentPayload.checkNo).trim();
              }
              const chequeDate = this.toIsoDateOrNull(paymentPayload.chequeDate);
              if (chequeDateColumn && chequeDate) {
                paymentRecord[chequeDateColumn] = chequeDate;
              }
              if (issuedByColumn && paymentPayload.issuedBy) {
                paymentRecord[issuedByColumn] = String(paymentPayload.issuedBy).trim();
              }

              if (termsColumn && paymentPayload.terms) {
                paymentRecord[termsColumn] = String(paymentPayload.terms).trim();
              }

              if (termsDueDateColumn && resolvedTermsDueDate) {
                paymentRecord[termsDueDateColumn] = resolvedTermsDueDate;
              }

              if (paymentStatusColumn) {
                paymentRecord[paymentStatusColumn] = paymentStatus;
              }

              if (downPaymentColumn && downPayment !== null) {
                paymentRecord[downPaymentColumn] = downPayment;
              }

              await this.runInsert(client, 'tblpo_payments', paymentRecord);
            }
          }
        }

        if (productItems.length > 0) {
          const transactionItemColumns = await this.getTableColumns(
            client,
            'tbltransaction_product_items',
          );

          const transTypeColumn = this.pickColumn(transactionItemColumns, [
            'transType',
            'trans_type',
          ]);
          const productIdColumn = this.pickColumn(transactionItemColumns, [
            'productId',
            'product_id',
          ]);
          const capacityIdColumn = this.pickColumn(transactionItemColumns, [
            'capacityId',
            'capacity_id',
          ]);
          const unitPriceColumn = this.pickColumn(transactionItemColumns, [
            'unitPrice',
            'unit_price',
          ]);
          const sellPriceColumn = this.pickColumn(transactionItemColumns, [
            'sellPrice',
            'sell_price',
          ]);
          const discountPriceColumn = this.pickColumn(transactionItemColumns, [
            'discountPrice',
            'discount_price',
          ]);
          const unitTypesQtyColumn = this.pickColumn(transactionItemColumns, [
            'unitTypesQty',
            'unit_types_qty',
          ]);
          const totalSetQtyColumn = this.pickColumn(transactionItemColumns, [
            'totalSetQty',
            'total_set_qty',
          ]);
          const purchaseIdColumn = this.pickColumn(transactionItemColumns, [
            'purchaseId',
            'purchase_id',
            'po_id',
          ]);
          const salesIdColumn = this.pickColumn(transactionItemColumns, [
            'salesId',
            'sales_id',
          ]);
          const itemStatusColumn = this.pickColumn(transactionItemColumns, ['status']);
          const itemCreatedByColumn = this.pickColumn(transactionItemColumns, [
            'created_by',
            'createdBy',
            'createdby',
          ]);
          const unitTypesQtyMeta = unitTypesQtyColumn
            ? await this.getColumnMeta(
                client,
                'tbltransaction_product_items',
                unitTypesQtyColumn,
              )
            : null;

          await client.query(
            `DELETE FROM tbltransaction_product_items
             WHERE COALESCE(
               to_jsonb(tbltransaction_product_items)->>'purchaseId',
               to_jsonb(tbltransaction_product_items)->>'purchase_id',
               to_jsonb(tbltransaction_product_items)->>'po_id'
             ) = $1
             AND LOWER(COALESCE(
               to_jsonb(tbltransaction_product_items)->>'transType',
               to_jsonb(tbltransaction_product_items)->>'trans_type',
               'purchase'
             )) = 'purchase'`,
            [String(id)],
          );

          const serialColumns = await this.getTableColumns(client, 'tblserial_numbers');
          const serialBranchIdColumn = this.pickColumn(serialColumns, ['branchId', 'branch_id']);
          const serialVendorIdColumn = this.pickColumn(serialColumns, ['vendorId', 'vendor_id']);
          const serialPurchaseIdColumn = this.pickColumn(serialColumns, [
            'purchaseId',
            'purchase_id',
          ]);
          const serialSalesIdColumn = this.pickColumn(serialColumns, ['salesId', 'sales_id']);
          const serialProductIdColumn = this.pickColumn(serialColumns, [
            'productId',
            'product_id',
          ]);
          const serialCapacityIdColumn = this.pickColumn(serialColumns, [
            'capacityId',
            'capacity_id',
          ]);
          const serialNumberColumn = this.pickColumn(serialColumns, [
            'serialNumber',
            'serial_number',
          ]);
          const serialUnitTypeColumn = this.pickColumn(serialColumns, ['unitType', 'unit_type']);
          const serialStatusColumn = this.pickColumn(serialColumns, ['status']);
          const serialCreatedByColumn = this.pickColumn(serialColumns, [
            'created_by',
            'createdBy',
            'createdby',
          ]);

          for (const item of productItems) {
            const transType = String(item.transType ?? 'purchase').trim().toLowerCase();
            if (transType !== 'purchase') {
              continue;
            }

            const productId = this.toOptionalNumber(item.productId);
            const capacityId = this.toOptionalNumber(item.capacityId);
            if (productId === null || capacityId === null) {
              throw new Error('productId and capacityId are required for purchase items');
            }

            const productExistsResult = await client.query<{ id: string | number }>(
              `SELECT id FROM tblproducts WHERE id::text = $1 LIMIT 1`,
              [String(productId)],
            );
            if (productExistsResult.rowCount === 0) {
              throw new Error(`Product ID ${productId} does not exist in tblproducts`);
            }

            const capacityExistsResult = await client.query<{ id: string | number }>(
              `SELECT id FROM tblcapacity WHERE id::text = $1 LIMIT 1`,
              [String(capacityId)],
            );
            if (capacityExistsResult.rowCount === 0) {
              throw new Error(`Capacity ID ${capacityId} does not exist in tblcapacity`);
            }

            const unitTypesQty = Array.isArray(item.unitTypesQty) ? item.unitTypesQty : [];
            const qtyFromList = unitTypesQty.reduce((sum, current) => {
              const parsedQty = this.toOptionalNumber(current.qty ?? current.value) ?? 0;
              return sum + (parsedQty > 0 ? parsedQty : 0);
            }, 0);
            const fallbackTotalQty = this.toOptionalNumber(item.totalSetQty) ?? 0;
            const totalQty = qtyFromList > 0 ? qtyFromList : fallbackTotalQty;

            const itemRecord: Record<string, unknown> = {};
            if (transTypeColumn) {
              itemRecord[transTypeColumn] = transType;
            }
            if (productIdColumn) {
              itemRecord[productIdColumn] = productId;
            }
            if (capacityIdColumn) {
              itemRecord[capacityIdColumn] = capacityId;
            }
            if (unitPriceColumn) {
              itemRecord[unitPriceColumn] = this.toOptionalNumber(item.unitPrice) ?? 0;
            }
            if (sellPriceColumn) {
              itemRecord[sellPriceColumn] = this.toOptionalNumber(item.sellPrice) ?? 0;
            }
            if (discountPriceColumn) {
              itemRecord[discountPriceColumn] = this.toOptionalNumber(item.discountPrice) ?? 0;
            }

            if (unitTypesQtyColumn) {
              const normalizedUnitTypesQty = unitTypesQty.map((entry) => ({
                label: String(entry.label ?? entry.unitType ?? 'set').trim() || 'set',
                value: this.toOptionalNumber(entry.value ?? entry.qty) ?? 0,
              }));

              if (
                unitTypesQtyMeta &&
                (unitTypesQtyMeta.data_type === 'ARRAY' ||
                  unitTypesQtyMeta.udt_name.startsWith('_'))
              ) {
                itemRecord[unitTypesQtyColumn] = normalizedUnitTypesQty.map(
                  (entry) => `${entry.label}:${entry.value}`,
                );
              } else {
                itemRecord[unitTypesQtyColumn] = JSON.stringify(normalizedUnitTypesQty);
              }
            }

            if (totalSetQtyColumn) {
              itemRecord[totalSetQtyColumn] = totalQty;
            }
            if (purchaseIdColumn) {
              itemRecord[purchaseIdColumn] = id;
            }
            if (salesIdColumn) {
              itemRecord[salesIdColumn] = this.toOptionalNumber(item.salesId);
            }
            if (itemStatusColumn) {
              itemRecord[itemStatusColumn] = 'pending';
            }
            if (itemCreatedByColumn && userId) {
              itemRecord[itemCreatedByColumn] = userId;
            }

            if (Object.keys(itemRecord).length > 0) {
              await this.runInsert(client, 'tbltransaction_product_items', itemRecord);
            }

            const serialPayload =
              item.serialNumbers && typeof item.serialNumbers === 'object'
                ? (item.serialNumbers as Record<string, unknown>)
                : {};

            const serialStatus = String(serialPayload.status ?? 'scanned')
              .trim()
              .toLowerCase() || 'scanned';

            for (const [unitTypeKey, values] of Object.entries(serialPayload)) {
              if (unitTypeKey.toLowerCase() === 'status') {
                continue;
              }

              const serialList = Array.isArray(values) ? values : [];

              for (const serialRaw of serialList) {
                const normalizedSerial = this.normalizeSerialNumber(serialRaw);
                if (!normalizedSerial || !serialNumberColumn) {
                  continue;
                }

                const existingSerialResult = await client.query<{ id: number; purchase_id: string | null }>(
                  `SELECT
                     sn.id,
                     sn."purchaseId"::text AS purchase_id
                   FROM tblserial_numbers sn
                   WHERE LOWER(
                     regexp_replace(BTRIM(COALESCE(sn."serialNumber", '')), '\\s+', ' ', 'g')
                   ) = LOWER($1)
                   LIMIT 1`,
                  [normalizedSerial],
                );

                const serialRecord: Record<string, unknown> = {};
                if (serialBranchIdColumn && branchId) {
                  serialRecord[serialBranchIdColumn] = branchId;
                }
                if (serialVendorIdColumn) {
                  serialRecord[serialVendorIdColumn] = resolvedVendorId;
                }
                if (serialPurchaseIdColumn) {
                  serialRecord[serialPurchaseIdColumn] = id;
                }
                if (serialSalesIdColumn) {
                  serialRecord[serialSalesIdColumn] = null;
                }
                if (serialProductIdColumn) {
                  serialRecord[serialProductIdColumn] = productId;
                }
                if (serialCapacityIdColumn) {
                  serialRecord[serialCapacityIdColumn] = capacityId;
                }
                serialRecord[serialNumberColumn] = normalizedSerial;
                if (serialUnitTypeColumn) {
                  serialRecord[serialUnitTypeColumn] = unitTypeKey;
                }
                if (serialStatusColumn) {
                  serialRecord[serialStatusColumn] = serialStatus;
                }
                if (serialCreatedByColumn && userId) {
                  serialRecord[serialCreatedByColumn] = userId;
                }

                if (existingSerialResult.rowCount > 0) {
                  const existingSerial = existingSerialResult.rows[0];
                  if (
                    existingSerial.purchase_id &&
                    Number(existingSerial.purchase_id) !== id
                  ) {
                    throw new Error(
                      `Serial number ${normalizedSerial} is already linked to purchase ${existingSerial.purchase_id}`,
                    );
                  }

                  const updateColumns = Object.keys(serialRecord);
                  const updateValues = Object.values(serialRecord);
                  const setClause = updateColumns
                    .map((column, idx) => `"${column}" = $${idx + 1}`)
                    .join(', ');

                  await client.query(
                    `UPDATE tblserial_numbers
                     SET ${setClause}
                     WHERE id = $${updateValues.length + 1}`,
                    [...updateValues, existingSerial.id],
                  );
                } else {
                  await this.runInsert(client, 'tblserial_numbers', serialRecord);
                }
              }
            }
          }
        }

        return {
          purchaseOrderId: id,
          vendorId: resolvedVendorId,
          totalAmount,
        };
      });

      return {
        success: true,
        message: 'Purchase order updated successfully',
        data: result,
      };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to update purchase order',
      };
    }
  }

  remove(id: number) {
    return `This action removes a #${id} purchase`;
  }

  async cancelPurchase(
    id: number,
    context?: { userId?: number; username?: string; roleName?: string; branchId?: number },
  ): Promise<{ success: boolean; message: string }> {
    try {
      const result = await this.databaseService.withTransaction(async (client) => {
        const poResult = await client.query<{ status: string | null }>(
          `SELECT status FROM tblpurchase_orders WHERE id = $1 LIMIT 1`,
          [id],
        );

        if (poResult.rows.length === 0) {
          throw new Error('Purchase order not found');
        }

        const currentStatus = String(poResult.rows[0].status ?? '').trim().toLowerCase();
        const nonCancellable = ['approved', 'completed', 'cancelled'];
        if (nonCancellable.includes(currentStatus)) {
          throw new Error(
            `Cannot cancel a purchase order with status '${currentStatus}'`,
          );
        }

        const serialColumns = await this.getTableColumns(client, 'tblserial_numbers');
        const serialPurchaseIdColumn = this.pickColumn(serialColumns, [
          'purchaseId',
          'purchase_id',
        ]);

        if (serialPurchaseIdColumn) {
          await client.query(
            `DELETE FROM tblserial_numbers WHERE "${serialPurchaseIdColumn}" = $1`,
            [id],
          );
        }

        await client.query(
          `UPDATE tblpurchase_orders SET status = 'cancelled' WHERE id = $1`,
          [id],
        );

        return { id };
      });

      this.auditLogService.log({
        action: 'PURCHASE_CANCEL',
        entityType: 'purchase_order',
        entityId: String(result.id),
        userId: context?.userId,
        username: context?.username,
        roleName: context?.roleName,
        branchId: context?.branchId,
        metadata: { poId: result.id },
      });

      return {
        success: true,
        message: `Purchase order #${result.id} has been cancelled`,
      };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to cancel purchase order',
      };
    }
  }

  async deletePurchaseWithAuth(
    id: number,
    userId: number,
    roleName: string,
    username: string,
    password: string,
    authUsername?: string,
    branchId?: number,
  ): Promise<{ success: boolean; message: string }> {
    if (!Number.isFinite(id) || id <= 0) {
      return { success: false, message: 'Invalid purchase order id' };
    }

    const normalizedPassword = String(password ?? '').trim();
    if (!normalizedPassword) {
      return { success: false, message: 'Password is required to delete a purchase order' };
    }

    const normalizedRole = String(roleName ?? '').trim().toLowerCase();
    const isAdmin =
      normalizedRole.includes('admin') ||
      normalizedRole.includes('super') ||
      normalizedRole.includes('owner');

    const passwordSha1 = createHash('sha1').update(normalizedPassword).digest('hex');

    if (isAdmin) {
      const effectiveUserId = Number(userId);
      if (!Number.isFinite(effectiveUserId) || effectiveUserId <= 0) {
        return { success: false, message: 'Invalid current user' };
      }

      const adminCheck = await this.databaseService.query<{ id: number }>(
        `SELECT u.id
         FROM tblusers u
         WHERE u.id = $1
           AND u.password = $2
         LIMIT 1`,
        [effectiveUserId, passwordSha1],
      );

      if (adminCheck.rowCount === 0) {
        return { success: false, message: 'Incorrect password. Please try again.' };
      }
    } else {
      const normalizedAuthUsername = String(authUsername ?? '').trim();
      if (!normalizedAuthUsername) {
        return { success: false, message: 'Admin username is required to authorize this deletion' };
      }

      const adminCheck = await this.databaseService.query<{ id: number }>(
        `SELECT u.id
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
        [normalizedAuthUsername, passwordSha1],
      );

      if (adminCheck.rowCount === 0) {
        return { success: false, message: 'Invalid admin credentials. Authorization denied.' };
      }
    }

    const result = await this.deletePurchase(id);

    if (result.success) {
      this.auditLogService.log({
        action: 'PURCHASE_DELETE',
        entityType: 'purchase_order',
        entityId: String(id),
        userId,
        username,
        roleName,
        branchId,
        metadata: {
          poId: id,
          authorizedBy: isAdmin ? username : String(authUsername ?? '').trim(),
          authMethod: isAdmin ? 'self' : 'admin_delegate',
        },
      });
    }

    return result;
  }

  async deletePurchase(id: number): Promise<{ success: boolean; message: string }> {
    try {
      const result = await this.databaseService.withTransaction(async (client) => {
        const poResult = await client.query<{ status: string | null; po_number: string | null }>(
          `SELECT status, po_number FROM tblpurchase_orders WHERE id = $1 LIMIT 1`,
          [id],
        );

        if (poResult.rows.length === 0) {
          throw new Error('Purchase order not found');
        }

        const currentStatus = String(poResult.rows[0].status ?? '').trim().toLowerCase();
        const nonDeletable = ['approved', 'completed'];
        if (nonDeletable.includes(currentStatus)) {
          throw new Error(
            `Cannot delete a purchase order with status '${currentStatus}'. Only pending, in-progress, for-approval, or cancelled POs can be deleted.`,
          );
        }

        const poNumber = poResult.rows[0].po_number ?? String(id);

        const serialColumns = await this.getTableColumns(client, 'tblserial_numbers');
        const serialPurchaseIdColumn = this.pickColumn(serialColumns, [
          'purchaseId',
          'purchase_id',
        ]);

        if (serialPurchaseIdColumn) {
          await client.query(
            `DELETE FROM tblserial_numbers WHERE "${serialPurchaseIdColumn}" = $1`,
            [id],
          );
        }

        const transItemColumns = await this.getTableColumns(client, 'tbltransaction_product_items');
        const itemPurchaseIdColumn = this.pickColumn(transItemColumns, [
          'purchaseId',
          'purchase_id',
        ]);

        if (itemPurchaseIdColumn) {
          await client.query(
            `DELETE FROM tbltransaction_product_items WHERE "${itemPurchaseIdColumn}" = $1`,
            [id],
          );
        }

        await client.query(`DELETE FROM tblpo_payments WHERE po_id = $1`, [id]);
        await client.query(`DELETE FROM tblpurchase_orders WHERE id = $1`, [id]);

        return { id, poNumber };
      });

      return {
        success: true,
        message: `Purchase order ${result.poNumber} has been permanently deleted`,
      };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to delete purchase order',
      };
    }
  }

  private async fetchByMode(
    mode: PurchaseMode,
    query: ListPurchaseQueryDto,
  ): Promise<PurchaseListResponseDto> {
    const page = this.normalizePage(query.page);
    const limit = this.normalizeLimit(query.limit);
    const offset = (page - 1) * limit;
    const search = (query.search ?? '').trim().toLowerCase();
    const branchId = Number(query.branchId);

    const params: unknown[] = [];
    const whereParts: string[] = [];

    if (mode === 'deliveries') {
      whereParts.push(`LOWER(COALESCE(base.original_status, '')) NOT IN (
        'for_approval', 'for approval', 'approval', 'approved', 'completed', 'cancelled', 'rejected'
      )`);
    } else if (mode === 'approvals') {
      whereParts.push(`LOWER(COALESCE(base.original_status, '')) IN (
        'for_approval', 'for approval', 'approval', 'pending_approval', 'pending approval'
      )`);
    }

    if (search) {
      params.push(`%${search}%`);
      const searchIndex = params.length;
      whereParts.push(`(
        LOWER(COALESCE(base.po_number, '')) LIKE $${searchIndex}
        OR LOWER(COALESCE(base.vendor_name, '')) LIKE $${searchIndex}
        OR LOWER(COALESCE(base.computed_status, '')) LIKE $${searchIndex}
      )`);
    }

    if (Number.isFinite(branchId) && branchId > 0) {
      params.push(String(branchId));
      const branchIndex = params.length;
      // Include NULL branch_id (legacy records without branch assignment)
      whereParts.push(`(base.branch_id = $${branchIndex} OR base.branch_id IS NULL)`);
    }

    const whereSql = whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : '';

    const computedStatusExpression =
      mode === 'deliveries'
        ? `CASE
             WHEN COALESCE(sc.serial_count, 0) > 0 THEN 'in-progress'
             ELSE 'pending'
           END`
        : `COALESCE(po.status, 'pending')`;

    const baseCte = `
      WITH serial_counts AS (
        SELECT
          COALESCE(
            to_jsonb(tpi)->>'purchaseId',
            to_jsonb(tpi)->>'purchase_id',
            to_jsonb(tpi)->>'po_id'
          ) AS po_id,
          SUM(
            CASE
              WHEN COALESCE(
                to_jsonb(tpi)->>'totalSetQty',
                to_jsonb(tpi)->>'total_set_qty',
                ''
              ) ~ '^-?\\d+$'
                THEN COALESCE(
                  to_jsonb(tpi)->>'totalSetQty',
                  to_jsonb(tpi)->>'total_set_qty',
                  '0'
                )::int
              ELSE 0
            END
          )::int AS serial_count
        FROM tbltransaction_product_items tpi
        WHERE LOWER(COALESCE(to_jsonb(tpi)->>'transType', to_jsonb(tpi)->>'trans_type', 'purchase')) = 'purchase'
        GROUP BY COALESCE(
          to_jsonb(tpi)->>'purchaseId',
          to_jsonb(tpi)->>'purchase_id',
          to_jsonb(tpi)->>'po_id'
        )
      ),
      base AS (
        SELECT
          po.id,
          po.po_number,
          COALESCE(
            to_jsonb(po)->>'branchId',
            to_jsonb(po)->>'branch_id',
            ''
          ) AS branch_id,
          po.vendor_id::text AS vendor_id,
          v.name AS vendor_name,
          po.total_amount,
          COALESCE(po.status, 'pending') AS original_status,
          po.created_at,
          COALESCE(sc.serial_count, 0)::int AS serial_count,
          ${computedStatusExpression} AS computed_status
        FROM tblpurchase_orders po
        LEFT JOIN tblvendors v
          ON v.id::text = po.vendor_id::text
        LEFT JOIN serial_counts sc
          ON sc.po_id = po.id::text
      )
    `;

    const countSql = `
      ${baseCte}
      SELECT COUNT(*)::text AS total
      FROM base
      ${whereSql}
    `;

    const countResult = await this.databaseService.query<PurchaseCountRow>(countSql, params);
    const total = Number(countResult.rows[0]?.total ?? 0);

    params.push(limit);
    params.push(offset);
    const limitIndex = params.length - 1;
    const offsetIndex = params.length;

    const listSql = `
      ${baseCte}
      SELECT
        base.id,
        base.po_number AS "poNumber",
        base.vendor_id AS "vendorId",
        base.vendor_name AS "vendorName",
        COALESCE(to_jsonb(v)->>'address', '') AS "vendorAddress",
        COALESCE(
          to_jsonb(v)->>'contact_person',
          to_jsonb(v)->>'contactPerson',
          ''
        ) AS "vendorContactPerson",
        COALESCE(
          to_jsonb(v)->>'contact_number',
          to_jsonb(v)->>'contactNumber',
          ''
        ) AS "vendorContactNumber",
        base.total_amount::text AS "totalAmount",
        base.computed_status AS status,
        (
          SELECT json_build_object(
            'method', COALESCE(to_jsonb(pp)->>'method', null),
            'amount', COALESCE(NULLIF(to_jsonb(pp)->>'amount', '')::numeric, 0),
            'terms', COALESCE(to_jsonb(pp)->>'terms', null),
            'termsDueDate', COALESCE(
              to_jsonb(pp)->>'terms_due_date',
              to_jsonb(pp)->>'termsDueDate',
              null
            ),
            'status', COALESCE(to_jsonb(pp)->>'status', null),
            'paymentDate', COALESCE(
              to_jsonb(pp)->>'payment_date',
              to_jsonb(pp)->>'paymentDate',
              null
            ),
            'downPayment', COALESCE(
              NULLIF(
                COALESCE(
                  to_jsonb(pp)->>'down_payment',
                  to_jsonb(pp)->>'downPayment',
                  ''
                ),
                ''
              )::numeric,
              0
            )
          )
          FROM tblpo_payments pp
          WHERE COALESCE(
            to_jsonb(pp)->>'po_id',
            to_jsonb(pp)->>'poId'
          ) = base.id::text
          ORDER BY pp.id DESC
          LIMIT 1
        ) AS "paymentDetails",
        (
          SELECT COALESCE(
            json_agg(
              json_build_object(
                'id', tpi.id,
                'transType', COALESCE(
                  to_jsonb(tpi)->>'transType',
                  to_jsonb(tpi)->>'trans_type',
                  'purchase'
                ),
                'productId', COALESCE(
                  to_jsonb(tpi)->>'productId',
                  to_jsonb(tpi)->>'product_id'
                ),
                'capacityId', COALESCE(
                  to_jsonb(tpi)->>'capacityId',
                  to_jsonb(tpi)->>'capacity_id'
                ),
                'unitPrice', COALESCE(
                  NULLIF(
                    COALESCE(to_jsonb(tpi)->>'unitPrice', to_jsonb(tpi)->>'unit_price', ''),
                    ''
                  )::numeric,
                  0
                ),
                'sellPrice', COALESCE(
                  NULLIF(
                    COALESCE(to_jsonb(tpi)->>'sellPrice', to_jsonb(tpi)->>'sell_price', ''),
                    ''
                  )::numeric,
                  0
                ),
                'discountPrice', COALESCE(
                  NULLIF(
                    COALESCE(
                      to_jsonb(tpi)->>'discountPrice',
                      to_jsonb(tpi)->>'discount_price',
                      ''
                    ),
                    ''
                  )::numeric,
                  0
                ),
                'unitTypesQty', COALESCE(
                  to_jsonb(tpi)->'unitTypesQty',
                  to_jsonb(tpi)->'unit_types_qty',
                  '[]'::jsonb
                ),
                'totalSetQty', COALESCE(
                  NULLIF(
                    COALESCE(
                      to_jsonb(tpi)->>'totalSetQty',
                      to_jsonb(tpi)->>'total_set_qty',
                      ''
                    ),
                    ''
                  )::int,
                  0
                ),
                'purchaseId', COALESCE(
                  to_jsonb(tpi)->>'purchaseId',
                  to_jsonb(tpi)->>'purchase_id',
                  to_jsonb(tpi)->>'po_id'
                ),
                'salesId', COALESCE(
                  to_jsonb(tpi)->>'salesId',
                  to_jsonb(tpi)->>'sales_id'
                ),
                'status', COALESCE(to_jsonb(tpi)->>'status', null),
                'product', CASE
                  WHEN p.id IS NULL THEN NULL
                  ELSE json_build_object(
                    'id', p.id,
                    'productName', COALESCE(
                      to_jsonb(p)->>'productName',
                      to_jsonb(p)->>'product_name',
                      to_jsonb(p)->>'productname'
                    ),
                    'unit', COALESCE(to_jsonb(p)->>'unit', null),
                    'productType', COALESCE(
                      to_jsonb(p)->>'productType',
                      to_jsonb(p)->>'product_type',
                      to_jsonb(p)->>'producttype'
                    )
                  )
                END,
                'capacity', CASE
                  WHEN c.id IS NULL THEN NULL
                  ELSE json_build_object(
                    'id', c.id,
                    'capacity', COALESCE(to_jsonb(c)->>'capacity', null),
                    'indoorModel', COALESCE(
                      to_jsonb(c)->>'indoorModel',
                      to_jsonb(c)->>'indoor_model'
                    ),
                    'outdoorModel', COALESCE(
                      to_jsonb(c)->>'outdoorModel',
                      to_jsonb(c)->>'outdoor_model'
                    ),
                    'srp', COALESCE(NULLIF(to_jsonb(c)->>'srp', '')::numeric, 0),
                    'netPrice', COALESCE(
                      NULLIF(
                        COALESCE(to_jsonb(c)->>'netPrice', to_jsonb(c)->>'net_price', ''),
                        ''
                      )::numeric,
                      0
                    )
                  )
                END
              )
              ORDER BY tpi.id DESC
            ),
            '[]'::json
          )
          FROM tbltransaction_product_items tpi
          LEFT JOIN tblproducts p
            ON p.id::text = COALESCE(
              to_jsonb(tpi)->>'productId',
              to_jsonb(tpi)->>'product_id'
            )
          LEFT JOIN tblcapacity c
            ON c.id::text = COALESCE(
              to_jsonb(tpi)->>'capacityId',
              to_jsonb(tpi)->>'capacity_id'
            )
          WHERE COALESCE(
            to_jsonb(tpi)->>'purchaseId',
            to_jsonb(tpi)->>'purchase_id',
            to_jsonb(tpi)->>'po_id'
          ) = base.id::text
        ) AS "productItems",
        base.created_at::text AS "createdAt",
        base.serial_count::int AS "serialCount"
      FROM base
      LEFT JOIN tblvendors v
        ON v.id::text = base.vendor_id::text
      ${whereSql}
      ORDER BY base.created_at DESC, base.id DESC
      LIMIT $${limitIndex} OFFSET $${offsetIndex}
    `;

    const listResult = await this.databaseService.query<PurchaseRow>(listSql, params);

    return {
      success: true,
      items: listResult.rows.map((row) => this.toPurchaseTabItem(row)),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  private normalizePage(value: number | undefined): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 1;
  }

  private normalizeLimit(value: number | undefined): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return 10;
    }

    return Math.min(Math.floor(parsed), 100);
  }

  private toPurchaseTabItem(row: PurchaseRow): PurchaseTabItemDto {
    const totalAmount = Number(row.totalAmount ?? 0);

    return {
      id: row.id,
      poNumber: row.poNumber ?? '-',
      vendorId: row.vendorId,
      vendorName: row.vendorName ?? 'Unknown Vendor',
      vendor: {
        id: row.vendorId,
        name: row.vendorName ?? 'Unknown Vendor',
        address: row.vendorAddress,
        contactPerson: row.vendorContactPerson,
        contactNumber: row.vendorContactNumber,
      },
      totalAmount: Number.isFinite(totalAmount) ? totalAmount : 0,
      status: row.status ?? 'pending',
      paymentDetails:
        (row.paymentDetails as PurchaseTabItemDto['paymentDetails']) ?? null,
      productItems:
        (row.productItems as PurchaseTabItemDto['productItems']) ?? [],
      createdAt: row.createdAt,
      serialCount: row.serialCount ?? 0,
    };
  }

  private normalizeUnitTypesQty(
    value: unknown,
  ): Array<{ label: string; value: number }> {
    let parsedValue: unknown = value;

    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) {
        return [];
      }

      try {
        parsedValue = JSON.parse(trimmed);
      } catch {
        parsedValue = trimmed;
      }
    }

    if (!Array.isArray(parsedValue)) {
      return [];
    }

    const normalized = parsedValue
      .map((entry) => {
        if (typeof entry === 'string') {
          const [labelRaw, qtyRaw] = entry.split(':');
          const label = String(labelRaw ?? '').trim();
          const qty = this.toOptionalNumber(String(qtyRaw ?? '').trim()) ?? 0;

          return {
            label: label || 'set',
            value: qty,
          };
        }

        if (!entry || typeof entry !== 'object') {
          return null;
        }

        const asRecord = entry as Record<string, unknown>;
        const label = String(
          asRecord.label ?? asRecord.unitType ?? asRecord.unit_type ?? 'set',
        )
          .trim()
          .toLowerCase();
        const qty = this.toOptionalNumber(asRecord.value ?? asRecord.qty) ?? 0;

        return {
          label: label || 'set',
          value: qty,
        };
      })
      .filter((entry): entry is { label: string; value: number } => entry !== null);

    return normalized;
  }
}
