import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { PoolClient } from 'pg';
import { CreateSerialNumberDto } from './dto/create-serial-number.dto';
import { UpdateSerialNumberDto } from './dto/update-serial-number.dto';
import { DatabaseService } from 'src/database/database.service';
import { AuditLogService, AuditActorContext } from 'src/audit-log/audit-log.service';
import { SerialEventLogService, LogEventParams } from './serial-event-log.service';
import { ScanFileLoggerService } from './scan-file-logger.service';
import { ScanSalesOrderDto } from './dto/scan-sales-order.dto';
import {
  ScanSalesOrderBatchDto,
} from './dto/scan-sales-order-batch.dto';
import { ScanPurchaseOrderDto } from './dto/scan-purchase-order.dto';
import {
  ScanPurchaseOrderBatchDto,
  ScanPurchaseOrderBatchItemDto,
} from './dto/scan-purchase-order-batch.dto';
import { RemovePurchaseOrderSerialDto } from './dto/remove-purchase-order-serial.dto';
import { RemoveSalesOrderSerialDto } from './dto/remove-sales-order-serial.dto';
import { AdjustPurchaseUnitTypesDto } from './dto/adjust-purchase-unit-types.dto';
import { CheckSerialsDto } from './dto/check-serials.dto';
import { verifyCurrentUserPassword } from 'src/common/utils/verify-user-password';
import {
  GlobalSearchResult,
  GlobalSearchResponse,
  BulkSearchResponse,
  BulkTransferResponse,
  BulkAssignOrderResponse,
} from './interfaces/global-search.interfaces';
import {
  ScanSalesOrderResponse,
  ScanSalesOrderValidationStatus,
} from './interfaces/scan-sales-order-response.interface';

type SerialScanRow = {
  id: number;
  serialNumber: string | null;
  status: string | null;
  salesId: string | null;
  purchaseId?: string | null;
  productId: string | null;
  capacityId: string | null;
  branchId: string | null;
  unitType: string | null;
  productName: string | null;
  unit: string | null;
  capacity: string | null;
  isDefective?: boolean | null;
};

type CapacityStockSerialRow = {
  serialNumber: string | null;
  status: string | null;
};

type ScopedSerialRow = {
  serialNumber: string | null;
  status: string | null;
  branchId: string | null;
  productId: string | null;
  capacityId: string | null;
  unitType: string | null;
};

type ProductUnitMetaRow = {
  unit: string | null;
  unitTypes: string | null;
};

type LandCostingRow = {
  serialNumber: string | null;
  unitType: string | null;
  productId: string | null;
  productName: string | null;
  capacityId: string | null;
  capacityName: string | null;
  purchaseId: string | null;
  poNumber: string | null;
  poDate: string | null;
  vendorName: string | null;
  landedCost: string | null;
  srp: string | null;
  status: string | null;
  isDefective: boolean | null;
  isReturned: boolean | null;
};

type PurchaseTransactionItemUnitTypeRow = {
  id: number;
  purchaseId: string | null;
  productId: string | null;
  capacityId: string | null;
  unitTypesQty: unknown;
};

type PurchaseSerialUnitTypeRow = {
  id: number;
  purchaseId: string | null;
  productId: string | null;
  capacityId: string | null;
  unitType: string | null;
};

@Injectable()
export class SerialNumberService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly auditLogService: AuditLogService,
    private readonly serialEventLogService: SerialEventLogService,
    private readonly scanFileLogger: ScanFileLoggerService,
  ) {}

  private toOptionalNumber(value: unknown): number | null {
    if (value === null || value === undefined || value === '') {
      return null;
    }

    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private async getTableColumns(tableName: string): Promise<string[]> {
    const columnsResult = await this.databaseService.query<{ column_name: string }>(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_name = $1
         AND table_schema = current_schema()`,
      [tableName],
    );

    return columnsResult.rows.map((row) => row.column_name);
  }

  private pickColumn(availableColumns: string[], candidates: string[]): string | undefined {
    const availableColumnsLower = new Set(
      availableColumns.map((column) => column.toLowerCase()),
    );

    return candidates.find((candidate) =>
      availableColumnsLower.has(candidate.toLowerCase()),
    );
  }

  private async runInsert(
    tableName: string,
    record: Record<string, unknown>,
    client?: PoolClient,
  ) {
    const columns = Object.keys(record);
    const values = Object.values(record);
    const quotedColumns = columns.map((column) => `"${column}"`).join(', ');
    const placeholders = values.map((_, index) => `$${index + 1}`).join(', ');
    const sql = `INSERT INTO ${tableName} (${quotedColumns}) VALUES (${placeholders}) RETURNING id`;

    if (client) {
      return client.query<{ id: number }>(sql, values);
    }
    return this.databaseService.query<{ id: number }>(sql, values);
  }

  private async runUpdateById(
    tableName: string,
    id: number,
    record: Record<string, unknown>,
    client?: PoolClient,
  ) {
    const columns = Object.keys(record);
    if (columns.length === 0) {
      return { rowCount: 0, rows: [] as Array<{ id: number }> };
    }

    const values = Object.values(record);
    const setClause = columns
      .map((column, index) => `"${column}" = $${index + 1}`)
      .join(', ');
    const sql = `UPDATE ${tableName}
       SET ${setClause}
       WHERE id = $${values.length + 1}
       RETURNING id`;
    const params = [...values, id];

    if (client) {
      return client.query<{ id: number }>(sql, params);
    }
    return this.databaseService.query<{ id: number }>(sql, params);
  }

  private async persistSerialUpdateWithEvent(
    id: number,
    updateRecord: Record<string, unknown>,
    event: LogEventParams,
  ) {
    return this.databaseService.withTransaction(async (client) => {
      const result = await this.runUpdateById('tblserial_numbers', id, updateRecord, client);
      if ((result.rowCount ?? 0) > 0) {
        await this.serialEventLogService.logEvent(event, client);
      }
      return result;
    });
  }

  private normalizeSerialNumber(value: unknown): string {
    return String(value ?? '')
      .trim()
      .replace(/\s+/g, ' ');
  }

  private normalizeUnitType(value: unknown): string {
    const normalized = String(value ?? '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .replace(/[\s_-]*qty$/i, '')
      .replace(/quantity$/i, '')
      .trim();

    return normalized;
  }

  private async logSerialScanAudit(
    action: 'SERIAL_SCAN_SUCCESS' | 'SERIAL_SCAN_FAILURE' | 'SERIAL_SCAN_ERROR',
    entityType: string,
    entityId: string | number | null,
    serialNumber: string,
    message: string,
    metadata: Record<string, unknown> | null,
    actor?: AuditActorContext,
  ): Promise<void> {
    await this.auditLogService.log({
      action,
      entityType,
      entityId,
      userId: actor?.userId ?? null,
      username: actor?.username ?? null,
      roleName: actor?.roleName ?? null,
      branchId: actor?.branchId ?? null,
      ipAddress: actor?.ipAddress ?? null,
      metadata: {
        serialNumber,
        message,
        ...metadata,
      },
    });
  }

  private parseConfiguredProductUnitTypes(value: unknown): string[] {
    if (Array.isArray(value)) {
      return value
        .map((entry) => this.normalizeUnitType(entry))
        .filter((entry, index, list) => entry.length > 0 && list.indexOf(entry) === index);
    }

    return String(value ?? '')
      .split(',')
      .map((entry) => this.normalizeUnitType(entry))
      .filter((entry, index, list) => entry.length > 0 && list.indexOf(entry) === index);
  }

  private parseUnitTypesQty(value: unknown): Array<{ label: string; value: number }> {
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

    return parsedValue
      .map((entry) => {
        if (typeof entry === 'string') {
          const [labelRaw, qtyRaw] = entry.split(':');
          return {
            label: this.normalizeUnitType(labelRaw),
            value: this.toOptionalNumber(qtyRaw) ?? 0,
          };
        }

        if (!entry || typeof entry !== 'object') {
          return null;
        }

        const asRecord = entry as Record<string, unknown>;
        return {
          label: this.normalizeUnitType(
            asRecord.label ?? asRecord.unitType ?? asRecord.unit_type,
          ),
          value: this.toOptionalNumber(asRecord.value ?? asRecord.qty) ?? 0,
        };
      })
      .filter(
        (entry): entry is { label: string; value: number } =>
          entry !== null && entry.label.length > 0,
      );
  }

  private remapLegacyUnitTypeLabel(label: unknown, configuredLabels: string[]): string {
    const normalized = this.normalizeUnitType(label);
    if (!normalized) {
      return configuredLabels[0] ?? 'set';
    }

    if (configuredLabels.length === 0) {
      return normalized;
    }

    if (normalized === 'indoor') {
      return configuredLabels[0] ?? normalized;
    }

    if (normalized === 'outdoor') {
      if (configuredLabels.length >= 2) {
        return configuredLabels[1];
      }

      return configuredLabels[0] ?? normalized;
    }

    return normalized;
  }

  private resolveLandCostingUnitBucket(
    unitType: unknown,
    configuredLabels: string[],
  ): 'indoor' | 'outdoor' | 'other' {
    const normalized = this.normalizeUnitType(unitType);
    if (!normalized) {
      return 'other';
    }

    if (normalized.includes('indoor')) {
      return 'indoor';
    }

    if (normalized.includes('outdoor')) {
      return 'outdoor';
    }

    const configuredIndoorLabel = this.remapLegacyUnitTypeLabel('indoor', configuredLabels);
    const configuredOutdoorLabel = this.remapLegacyUnitTypeLabel('outdoor', configuredLabels);

    if (configuredIndoorLabel && normalized === configuredIndoorLabel) {
      return 'indoor';
    }

    if (configuredOutdoorLabel && normalized === configuredOutdoorLabel) {
      return 'outdoor';
    }

    return 'other';
  }

  private async getProductDisplayName(productId: number | null): Promise<string | null> {
    if (!Number.isFinite(productId) || (productId as number) <= 0) {
      return null;
    }

    const result = await this.databaseService.query<{ productName: string | null }>(
      `SELECT COALESCE(
         to_jsonb(p)->>'productName',
         to_jsonb(p)->>'product_name',
         to_jsonb(p)->>'productname'
       ) AS "productName"
       FROM tblproducts p
       WHERE p.id = $1
       LIMIT 1`,
      [productId],
    );

    if (result.rowCount === 0) {
      return null;
    }

    return String(result.rows[0]?.productName ?? '').trim() || null;
  }

  private async getCapacityDisplayName(capacityId: number | null): Promise<string | null> {
    if (!Number.isFinite(capacityId) || (capacityId as number) <= 0) {
      return null;
    }

    const result = await this.databaseService.query<{ capacity: string | null }>(
      `SELECT COALESCE(
         to_jsonb(c)->>'capacity',
         to_jsonb(c)->>'capacityName',
         to_jsonb(c)->>'capacity_name'
       ) AS capacity
       FROM tblcapacity c
       WHERE c.id = $1
       LIMIT 1`,
      [capacityId],
    );

    if (result.rowCount === 0) {
      return null;
    }

    return String(result.rows[0]?.capacity ?? '').trim() || null;
  }

  private async getPurchaseOrderReference(
    purchaseId: number | string | null | undefined,
  ): Promise<string | null> {
    const normalizedPurchaseId = String(purchaseId ?? '').trim();
    if (!normalizedPurchaseId) {
      return null;
    }

    for (const tableName of ['tblpurchase_orders', 'tblpo']) {
      try {
        const result = await this.databaseService.query<{ poNumber: string | null }>(
          `SELECT COALESCE(
             to_jsonb(po)->>'po_number',
             to_jsonb(po)->>'poNumber',
             to_jsonb(po)->>'po_no',
             to_jsonb(po)->>'poNo'
           ) AS "poNumber"
           FROM ${tableName} po
           WHERE po.id::text = $1
           LIMIT 1`,
          [normalizedPurchaseId],
        );

        if (result.rowCount === 0) {
          continue;
        }

        const poNumber = String(result.rows[0]?.poNumber ?? '').trim();
        return poNumber ? `PO ${poNumber}` : `purchase order #${normalizedPurchaseId}`;
      } catch (error: unknown) {
        const errorCode =
          typeof error === 'object' && error !== null && 'code' in error
            ? String((error as { code?: unknown }).code ?? '')
            : '';

        if (errorCode === '42P01') {
          continue;
        }

        throw error;
      }
    }

    return `purchase order #${normalizedPurchaseId}`;
  }

  private async getSalesOrderReference(
    salesId: number | string | null | undefined,
  ): Promise<string | null> {
    const normalizedSalesId = String(salesId ?? '').trim();
    if (!normalizedSalesId) {
      return null;
    }

    for (const tableName of ['tblsales_order', 'tblsales_orders']) {
      try {
        const result = await this.databaseService.query<{ soNumber: string | null }>(
          `SELECT COALESCE(
             to_jsonb(so)->>'so_number',
             to_jsonb(so)->>'soNumber',
             to_jsonb(so)->>'so_no',
             to_jsonb(so)->>'soNo'
           ) AS "soNumber"
           FROM ${tableName} so
           WHERE so.id::text = $1
           LIMIT 1`,
          [normalizedSalesId],
        );

        if (result.rowCount === 0) {
          continue;
        }

        const soNumber = String(result.rows[0]?.soNumber ?? '').trim();
        return soNumber ? `SO ${soNumber}` : `sales order #${normalizedSalesId}`;
      } catch (error: unknown) {
        const errorCode =
          typeof error === 'object' && error !== null && 'code' in error
            ? String((error as { code?: unknown }).code ?? '')
            : '';

        if (errorCode === '42P01') {
          continue;
        }

        throw error;
      }
    }

    return `sales order #${normalizedSalesId}`;
  }

  private async getSalesOrderCustomerName(
    salesId: number | string | null | undefined,
  ): Promise<string | null> {
    const normalizedSalesId = String(salesId ?? '').trim();
    if (!normalizedSalesId) {
      return null;
    }

    for (const tableName of ['tblsales_order', 'tblsales_orders']) {
      try {
        const result = await this.databaseService.query<{ customerName: string | null }>(
          `SELECT cust.name AS "customerName"
           FROM ${tableName} so
           LEFT JOIN tblcustomer cust ON cust.id = so.customer_id
           WHERE so.id::text = $1
           LIMIT 1`,
          [normalizedSalesId],
        );

        if (result.rowCount === 0) {
          continue;
        }

        return String(result.rows[0]?.customerName ?? '').trim() || null;
      } catch (error: unknown) {
        const errorCode =
          typeof error === 'object' && error !== null && 'code' in error
            ? String((error as { code?: unknown }).code ?? '')
            : '';

        if (errorCode === '42P01') {
          continue;
        }

        throw error;
      }
    }

    return null;
  }

  private async buildProductMismatchMessage(input: {
    expectedProductId: number | null;
    expectedCapacityId: number | null;
    actualProductName: string | null;
    actualCapacityName: string | null;
    purchaseId?: number | string | null;
  }): Promise<string> {
    const expectedProductName = await this.getProductDisplayName(input.expectedProductId);
    const expectedCapacityName = await this.getCapacityDisplayName(input.expectedCapacityId);
    const purchaseReference = await this.getPurchaseOrderReference(input.purchaseId);

    const expectedProductLabel = expectedProductName
      ? `product '${expectedProductName}'`
      : Number.isFinite(input.expectedProductId) && (input.expectedProductId as number) > 0
        ? `product #${input.expectedProductId}`
        : 'the expected product';

    const expectedLabel = expectedCapacityName
      ? `${expectedProductLabel} (${expectedCapacityName})`
      : expectedProductLabel;

    const actualProductLabel = String(input.actualProductName ?? '').trim()
      ? `product '${String(input.actualProductName).trim()}'`
      : 'a different product';

    const actualCapacityLabel = String(input.actualCapacityName ?? '').trim();
    const actualLabel = actualCapacityLabel
      ? `${actualProductLabel} (${actualCapacityLabel})`
      : actualProductLabel;

    return purchaseReference
      ? `Serial number product mismatch. Expected ${expectedLabel}. This serial belongs to ${actualLabel} from ${purchaseReference}.`
      : `Serial number product mismatch. Expected ${expectedLabel}. This serial belongs to ${actualLabel}.`;
  }

  private async buildCapacityMismatchMessage(input: {
    expectedProductId: number | null;
    expectedCapacityId: number | null;
    actualProductName: string | null;
    actualCapacityName: string | null;
    purchaseId?: number | string | null;
  }): Promise<string> {
    const expectedProductName = await this.getProductDisplayName(input.expectedProductId);
    const expectedCapacityName = await this.getCapacityDisplayName(input.expectedCapacityId);
    const purchaseReference = await this.getPurchaseOrderReference(input.purchaseId);

    const expectedProductLabel = expectedProductName
      ? `product '${expectedProductName}'`
      : Number.isFinite(input.expectedProductId) && (input.expectedProductId as number) > 0
        ? `product #${input.expectedProductId}`
        : 'the expected product';

    const expectedLabel = expectedCapacityName
      ? `${expectedProductLabel} (${expectedCapacityName})`
      : expectedProductLabel;

    const actualProductLabel = String(input.actualProductName ?? '').trim()
      ? `product '${String(input.actualProductName).trim()}'`
      : 'a different product';

    const actualCapacityLabel = String(input.actualCapacityName ?? '').trim();
    const actualLabel = actualCapacityLabel
      ? `${actualProductLabel} (${actualCapacityLabel})`
      : actualProductLabel;

    return purchaseReference
      ? `Serial number capacity mismatch. Expected ${expectedLabel}. This serial belongs to ${actualLabel} from ${purchaseReference}.`
      : `Serial number capacity mismatch. Expected ${expectedLabel}. This serial belongs to ${actualLabel}.`;
  }

  async adjustPurchaseUnitTypes(dto: AdjustPurchaseUnitTypesDto) {
    const incomingPurchaseIds = [
      dto.purchaseId,
      ...(Array.isArray(dto.purchaseIds) ? dto.purchaseIds : []),
    ];

    const normalizedPurchaseIds = Array.from(
      new Set(
        incomingPurchaseIds
          .map((value) => Number(value))
          .filter((value) => Number.isFinite(value) && value > 0)
          .map((value) => Math.floor(value)),
      ),
    );

    if (normalizedPurchaseIds.length === 0) {
      return {
        success: false,
        message: 'purchaseId or purchaseIds is required',
      };
    }

    const purchaseIdTexts = normalizedPurchaseIds.map((value) => String(value));

    const productUnitTypesResult = await this.databaseService.query<{
      id: string | null;
      unitTypes: string | null;
    }>(
      `SELECT
         p.id::text AS id,
         COALESCE(
           to_jsonb(p)->>'unitTypes',
           to_jsonb(p)->>'unit_types',
           to_jsonb(p)->>'unittypes',
           ''
         ) AS "unitTypes"
       FROM tblproducts p`,
    );

    const productUnitTypeMap = new Map<string, string[]>();
    for (const row of productUnitTypesResult.rows) {
      const productId = String(row.id ?? '').trim();
      if (!productId) {
        continue;
      }

      productUnitTypeMap.set(
        productId,
        this.parseConfiguredProductUnitTypes(row.unitTypes),
      );
    }

    const serialColumns = await this.getTableColumns('tblserial_numbers');
    const serialUnitTypeColumn = this.pickColumn(serialColumns, ['unitType', 'unit_type']);
    const transactionColumns = await this.getTableColumns('tbltransaction_product_items');
    const transactionUnitTypesQtyColumn = this.pickColumn(transactionColumns, [
      'unitTypesQty',
      'unit_types_qty',
    ]);
    const transactionUnitTypesQtyMeta = transactionUnitTypesQtyColumn
      ? await this.databaseService.query<{ data_type: string; udt_name: string }>(
          `SELECT
             data_type,
             udt_name
           FROM information_schema.columns
           WHERE table_schema = current_schema()
             AND table_name = 'tbltransaction_product_items'
             AND column_name = $1
           LIMIT 1`,
          [transactionUnitTypesQtyColumn],
        )
      : null;
    const isTransactionUnitTypesQtyArray = Boolean(
      transactionUnitTypesQtyMeta?.rows?.[0] &&
        (
          transactionUnitTypesQtyMeta.rows[0].data_type === 'ARRAY' ||
          String(transactionUnitTypesQtyMeta.rows[0].udt_name ?? '').startsWith('_')
        ),
    );

    const transactionRowsResult = await this.databaseService.query<PurchaseTransactionItemUnitTypeRow>(
      `SELECT
         tpi.id,
         COALESCE(
           to_jsonb(tpi)->>'purchaseId',
           to_jsonb(tpi)->>'purchase_id',
           to_jsonb(tpi)->>'po_id'
         ) AS "purchaseId",
         COALESCE(
           to_jsonb(tpi)->>'productId',
           to_jsonb(tpi)->>'product_id'
         ) AS "productId",
         COALESCE(
           to_jsonb(tpi)->>'capacityId',
           to_jsonb(tpi)->>'capacity_id'
         ) AS "capacityId",
         COALESCE(
           to_jsonb(tpi)->>'unitTypesQty',
           to_jsonb(tpi)->>'unit_types_qty',
           '[]'
         ) AS "unitTypesQty"
       FROM tbltransaction_product_items tpi
       WHERE COALESCE(
         to_jsonb(tpi)->>'purchaseId',
         to_jsonb(tpi)->>'purchase_id',
         to_jsonb(tpi)->>'po_id'
       ) = ANY($1::text[])
       AND LOWER(COALESCE(
         to_jsonb(tpi)->>'transType',
         to_jsonb(tpi)->>'trans_type',
         'purchase'
       )) = 'purchase'`,
      [purchaseIdTexts],
    );

    const serialRowsResult = await this.databaseService.query<PurchaseSerialUnitTypeRow>(
      `SELECT
         sn.id,
         COALESCE(
           to_jsonb(sn)->>'purchaseId',
           to_jsonb(sn)->>'purchase_id',
           to_jsonb(sn)->>'po_id',
           to_jsonb(sn)->>'purchaseOrderId',
           to_jsonb(sn)->>'purchase_order_id'
         ) AS "purchaseId",
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
         to_jsonb(sn)->>'po_id',
         to_jsonb(sn)->>'purchaseOrderId',
         to_jsonb(sn)->>'purchase_order_id'
       ) = ANY($1::text[])
       ORDER BY sn.id`,
      [purchaseIdTexts],
    );

    let updatedTransactionItems = 0;
    let updatedSerialRows = 0;
    let skippedRows = 0;

    if (transactionUnitTypesQtyColumn) {
      for (const row of transactionRowsResult.rows) {
        const productId = String(row.productId ?? '').trim();
        const configuredLabels = productUnitTypeMap.get(productId) ?? [];
        if (configuredLabels.length === 0) {
          skippedRows += 1;
          continue;
        }

        const parsed = this.parseUnitTypesQty(row.unitTypesQty);
        if (parsed.length === 0) {
          skippedRows += 1;
          continue;
        }

        const remapped = parsed.map((entry) => ({
          label: this.remapLegacyUnitTypeLabel(entry.label, configuredLabels),
          value: this.toOptionalNumber(entry.value) ?? 0,
        }));

        const hadLegacy = parsed.some((entry) => {
          const normalized = this.normalizeUnitType(entry.label);
          return normalized === 'indoor' || normalized === 'outdoor';
        });

        if (!hadLegacy) {
          skippedRows += 1;
          continue;
        }

        const mergedByLabel = new Map<string, number>();
        for (const entry of remapped) {
          const current = mergedByLabel.get(entry.label) ?? 0;
          mergedByLabel.set(entry.label, current + (this.toOptionalNumber(entry.value) ?? 0));
        }

        const normalizedForStorage = [...mergedByLabel.entries()].map(([label, value]) => ({
          label,
          value,
        }));

        const storedValue = isTransactionUnitTypesQtyArray
          ? normalizedForStorage.map((entry) => `${entry.label}:${entry.value}`)
          : JSON.stringify(normalizedForStorage);

        const updateResult = await this.runUpdateById('tbltransaction_product_items', row.id, {
          [transactionUnitTypesQtyColumn]: storedValue,
        });

        if (updateResult.rowCount > 0) {
          updatedTransactionItems += 1;
        }
      }
    }

    if (serialUnitTypeColumn) {
      for (const row of serialRowsResult.rows) {
        const productId = String(row.productId ?? '').trim();
        const configuredLabels = productUnitTypeMap.get(productId) ?? [];
        if (configuredLabels.length === 0) {
          skippedRows += 1;
          continue;
        }

        const currentUnitType = this.normalizeUnitType(row.unitType);
        if (currentUnitType !== 'indoor' && currentUnitType !== 'outdoor') {
          skippedRows += 1;
          continue;
        }

        const nextUnitType = this.remapLegacyUnitTypeLabel(currentUnitType, configuredLabels);
        if (!nextUnitType || nextUnitType === currentUnitType) {
          skippedRows += 1;
          continue;
        }

        const updateResult = await this.runUpdateById('tblserial_numbers', row.id, {
          [serialUnitTypeColumn]: nextUnitType,
        });

        if (updateResult.rowCount > 0) {
          updatedSerialRows += 1;
        }
      }
    }

    const totalUpdated = updatedTransactionItems + updatedSerialRows;

    return {
      success: true,
      message:
        totalUpdated > 0
          ? `Adjusted ${totalUpdated} record(s) for ${normalizedPurchaseIds.length} purchase order(s).`
          : 'No legacy indoor/outdoor unit type records found to adjust.',
      item: {
        purchaseIds: normalizedPurchaseIds,
        updatedTransactionItems,
        updatedSerialRows,
        skippedRows,
      },
    };
  }

  async getCapacityStockSummary(
    productIdInput: string,
    capacityIdInput: string,
    branchIdInput?: number,
  ) {
    const productId = Number(productIdInput);
    const capacityId = Number(capacityIdInput);
    const branchId =
      branchIdInput === undefined || branchIdInput === null ? null : Number(branchIdInput);

    if (!Number.isFinite(productId) || productId <= 0) {
      return { success: false, message: 'productId must be a valid number' };
    }

    if (!Number.isFinite(capacityId) || capacityId <= 0) {
      return { success: false, message: 'capacityId must be a valid number' };
    }

    if (branchId !== null && (!Number.isFinite(branchId) || branchId <= 0)) {
      return { success: false, message: 'branchId must be a valid number' };
    }

    const serialRowsResult = await this.databaseService.query<CapacityStockSerialRow>(
      `SELECT
         COALESCE(
           to_jsonb(sn)->>'serialNumber',
           to_jsonb(sn)->>'serial_number',
           ''
         ) AS "serialNumber",
         COALESCE(to_jsonb(sn)->>'status', '') AS status
       FROM tblserial_numbers sn
       WHERE COALESCE(
         to_jsonb(sn)->>'productId',
         to_jsonb(sn)->>'product_id',
         to_jsonb(sn)->>'prodId',
         to_jsonb(sn)->>'prod_id',
         ''
       ) = $1::text
       AND COALESCE(
         to_jsonb(sn)->>'capacityId',
         to_jsonb(sn)->>'capacity_id',
         to_jsonb(sn)->>'capId',
         to_jsonb(sn)->>'cap_id',
         ''
       ) = $2::text
       AND (
         $3::text IS NULL
         OR COALESCE(
           to_jsonb(sn)->>'branchId',
           to_jsonb(sn)->>'branch_id',
           to_jsonb(sn)->>'branchid',
           ''
         ) = $3::text
         OR COALESCE(
           to_jsonb(sn)->>'branchId',
           to_jsonb(sn)->>'branch_id',
           to_jsonb(sn)->>'branchid',
           ''
         ) IN ('', '0')
       )
       ORDER BY sn.id`,
      [String(productId), String(capacityId), branchId !== null ? String(branchId) : null],
    );

    const unitMetaResult = await this.databaseService.query<ProductUnitMetaRow>(
      `SELECT
         COALESCE(to_jsonb(p)->>'unit', '') AS unit,
         COALESCE(
           to_jsonb(p)->>'unitTypes',
           to_jsonb(p)->>'unit_types',
           to_jsonb(p)->>'unittypes',
           ''
         ) AS "unitTypes"
       FROM tblproducts p
       WHERE p.id::text = $1::text
       LIMIT 1`,
      [String(productId)],
    );

    const inStockSerials: string[] = [];
    const reservedSerials: string[] = [];
    const deliveredSerials: string[] = [];

    for (const row of serialRowsResult.rows) {
      const serialNumber = String(row.serialNumber ?? '').trim();
      if (!serialNumber) {
        continue;
      }

      const normalizedStatus = String(row.status ?? '').trim().toLowerCase();
      if (normalizedStatus === 'scanned') {
        continue;
      }

      if (normalizedStatus === 'reserved') {
        reservedSerials.push(serialNumber);
        continue;
      }

      if (
        ['delivered', 'installed', 'for-delivery', 'sold', 'released', 'out', 'outbound'].includes(
          normalizedStatus,
        )
      ) {
        deliveredSerials.push(serialNumber);
        continue;
      }

      inStockSerials.push(serialNumber);
    }

    const unitMeta = unitMetaResult.rows[0] ?? { unit: '', unitTypes: '' };

    const unitTypes = String(unitMeta.unitTypes ?? '')
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);

    return {
      success: true,
      item: {
        branchId,
        productId,
        capacityId,
        unit: String(unitMeta.unit ?? '').trim(),
        unitTypes,
        unitTypeCount: unitTypes.length,
        counts: {
          inStock: inStockSerials.length,
          reserved: reservedSerials.length,
          installed: deliveredSerials.length,
        },
        serials: {
          inStock: inStockSerials,
          reserved: reservedSerials,
          installed: deliveredSerials,
        },
      },
    };
  }

  async getSerialNumbersByScope(
    productIdInput: string,
    capacityIdInput: string,
    branchIdInput?: number,
  ) {
    const productId = Number(productIdInput);
    const capacityId = Number(capacityIdInput);
    const branchId =
      branchIdInput === undefined || branchIdInput === null ? null : Number(branchIdInput);
    console.log('getSerialNumbersByScope called with', {
      productId,
      capacityId,
      branchIdInput,
    });
    if (!Number.isFinite(productId) || productId <= 0) {
      return { success: false, message: 'productId must be a valid number' };
    }

    if (!Number.isFinite(capacityId) || capacityId <= 0) {
      return { success: false, message: 'capacityId must be a valid number' };
    }

    if (branchId !== null && (!Number.isFinite(branchId) || branchId <= 0)) {
      return { success: false, message: 'branchId must be a valid number' };
    }

    const scopedRowsResult = await this.databaseService.query<ScopedSerialRow>(
      `SELECT
         COALESCE(
           to_jsonb(sn)->>'serialNumber',
           to_jsonb(sn)->>'serial_number',
           ''
         ) AS "serialNumber",
         COALESCE(to_jsonb(sn)->>'status', '') AS status,
         COALESCE(
           to_jsonb(sn)->>'branchId',
           to_jsonb(sn)->>'branch_id',
           to_jsonb(sn)->>'branchid',
           ''
         ) AS "branchId",
         COALESCE(
           to_jsonb(sn)->>'productId',
           to_jsonb(sn)->>'product_id',
           to_jsonb(sn)->>'prodId',
           to_jsonb(sn)->>'prod_id',
           ''
         ) AS "productId",
         COALESCE(
           to_jsonb(sn)->>'capacityId',
           to_jsonb(sn)->>'capacity_id',
           to_jsonb(sn)->>'capId',
           to_jsonb(sn)->>'cap_id',
           ''
         ) AS "capacityId",
         COALESCE(
           to_jsonb(sn)->>'unitType',
           to_jsonb(sn)->>'unit_type',
           ''
         ) AS "unitType"
       FROM tblserial_numbers sn
       WHERE COALESCE(
         to_jsonb(sn)->>'productId',
         to_jsonb(sn)->>'product_id',
         to_jsonb(sn)->>'prodId',
         to_jsonb(sn)->>'prod_id',
         ''
       ) = $1::text
       AND COALESCE(
         to_jsonb(sn)->>'capacityId',
         to_jsonb(sn)->>'capacity_id',
         to_jsonb(sn)->>'capId',
         to_jsonb(sn)->>'cap_id',
         ''
       ) = $2::text
       AND (
         $3::text IS NULL
         OR COALESCE(
           to_jsonb(sn)->>'branchId',
           to_jsonb(sn)->>'branch_id',
           to_jsonb(sn)->>'branchid',
           ''
         ) = $3::text
         OR COALESCE(
           to_jsonb(sn)->>'branchId',
           to_jsonb(sn)->>'branch_id',
           to_jsonb(sn)->>'branchid',
           ''
         ) IN ('', '0')
       )
       ORDER BY sn.id`,
      [String(productId), String(capacityId), branchId !== null ? String(branchId) : null],
    );

    const unitMetaResult = await this.databaseService.query<ProductUnitMetaRow>(
      `SELECT
         COALESCE(to_jsonb(p)->>'unit', '') AS unit,
         COALESCE(
           to_jsonb(p)->>'unitTypes',
           to_jsonb(p)->>'unit_types',
           to_jsonb(p)->>'unittypes',
           ''
         ) AS "unitTypes"
       FROM tblproducts p
       WHERE p.id::text = $1::text
       LIMIT 1`,
      [String(productId)],
    );

    const inStock: Array<{ serialNumber: string; unitType: string }> = [];
    const reserved: Array<{ serialNumber: string; unitType: string }> = [];
    const delivered: Array<{ serialNumber: string; unitType: string }> = [];

    for (const row of scopedRowsResult.rows) {
      const serialNumber = String(row.serialNumber ?? '').trim();
      if (!serialNumber) {
        continue;
      }

      const unitType = this.normalizeUnitType(row.unitType);
      const entry = { serialNumber, unitType };
      const normalizedStatus = String(row.status ?? '').trim().toLowerCase();

      if (normalizedStatus === 'scanned') {
        continue;
      }

      if (normalizedStatus === 'reserved') {
        reserved.push(entry);
        continue;
      }

      if (
        ['delivered', 'installed', 'for-delivery', 'sold', 'released', 'out', 'outbound'].includes(
          normalizedStatus,
        )
      ) {
        delivered.push(entry);
        continue;
      }

      inStock.push(entry);
    }

    const unitMeta = unitMetaResult.rows[0] ?? { unit: '', unitTypes: '' };
    const unitTypes = String(unitMeta.unitTypes ?? '')
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);

    return {
      success: true,
      item: {
        branchId,
        productId,
        capacityId,
        unit: String(unitMeta.unit ?? '').trim(),
        unitTypes,
        unitTypeCount: unitTypes.length,
        total: scopedRowsResult.rows.length,
        counts: {
          inStock: inStock.length,
          reserved: reserved.length,
          installed: delivered.length,
        },
        serials: {
          inStock,
          reserved,
          installed: delivered,
        },
      },
    };
  }

  async getLandCostingReport(input: {
    monthsInput?: string;
    dateFromInput?: string;
    dateToInput?: string;
    productIdInput?: string;
    capacityIdInput?: string;
    branchId?: number;
  }) {
    const parsedDateTo = input.dateToInput ? new Date(input.dateToInput) : new Date();
    let safeDateTo = Number.isNaN(parsedDateTo.getTime()) ? new Date() : parsedDateTo;

    let safeDateFrom: Date;
    if (input.dateFromInput) {
      const parsedDateFrom = new Date(input.dateFromInput);
      safeDateFrom = Number.isNaN(parsedDateFrom.getTime())
        ? new Date(safeDateTo.getFullYear(), safeDateTo.getMonth() - 6, safeDateTo.getDate())
        : parsedDateFrom;
    } else {
      const monthsParsed = Number(input.monthsInput ?? 6);
      const months = Number.isFinite(monthsParsed)
        ? Math.max(1, Math.min(24, Math.floor(monthsParsed)))
        : 6;
      safeDateFrom = new Date(safeDateTo.getFullYear(), safeDateTo.getMonth() - months, safeDateTo.getDate());
    }

    if (safeDateFrom > safeDateTo) {
      const swap = safeDateFrom;
      safeDateFrom = safeDateTo;
      safeDateTo = swap;
    }

    const dateFrom = `${safeDateFrom.getFullYear()}-${String(safeDateFrom.getMonth() + 1).padStart(2, '0')}-${String(safeDateFrom.getDate()).padStart(2, '0')}`;
    const dateTo = `${safeDateTo.getFullYear()}-${String(safeDateTo.getMonth() + 1).padStart(2, '0')}-${String(safeDateTo.getDate()).padStart(2, '0')}`;

    const productId = this.toOptionalNumber(input.productIdInput);
    const capacityId = this.toOptionalNumber(input.capacityIdInput);
    const branchId =
      input.branchId === undefined || input.branchId === null
        ? null
        : Number(input.branchId);

    if (productId !== null && (!Number.isFinite(productId) || productId <= 0)) {
      return { success: false, message: 'productId must be a valid number' };
    }

    if (capacityId !== null && (!Number.isFinite(capacityId) || capacityId <= 0)) {
      return { success: false, message: 'capacityId must be a valid number' };
    }

    if (branchId !== null && (!Number.isFinite(branchId) || branchId <= 0)) {
      return { success: false, message: 'branchId must be a valid number' };
    }

    const productUnitTypesResult = await this.databaseService.query<{
      id: string | null;
      unitTypes: string | null;
    }>(
      `SELECT
         p.id::text AS id,
         COALESCE(
           to_jsonb(p)->>'unitTypes',
           to_jsonb(p)->>'unit_types',
           to_jsonb(p)->>'unittypes',
           ''
         ) AS "unitTypes"
       FROM tblproducts p`,
    );

    const productUnitTypeMap = new Map<string, string[]>();
    for (const row of productUnitTypesResult.rows) {
      const currentProductId = String(row.id ?? '').trim();
      if (!currentProductId) {
        continue;
      }

      productUnitTypeMap.set(
        currentProductId,
        this.parseConfiguredProductUnitTypes(row.unitTypes),
      );
    }

    const rowsResult = await this.databaseService.query<LandCostingRow>(
      `WITH serial_scope AS (
         SELECT
           sn.id,
           COALESCE(
             to_jsonb(sn)->>'serialNumber',
             to_jsonb(sn)->>'serial_number',
             ''
           ) AS serial_number,
           LOWER(TRIM(COALESCE(to_jsonb(sn)->>'status', ''))) AS status,
           COALESCE(
             to_jsonb(sn)->>'unitType',
             to_jsonb(sn)->>'unit_type',
             ''
           ) AS unit_type,
           COALESCE(
             to_jsonb(sn)->>'productId',
             to_jsonb(sn)->>'product_id',
             to_jsonb(sn)->>'prodId',
             to_jsonb(sn)->>'prod_id',
             ''
           ) AS product_id,
           COALESCE(
             to_jsonb(sn)->>'capacityId',
             to_jsonb(sn)->>'capacity_id',
             to_jsonb(sn)->>'capId',
             to_jsonb(sn)->>'cap_id',
             ''
           ) AS capacity_id,
           COALESCE(
             to_jsonb(sn)->>'purchaseId',
             to_jsonb(sn)->>'purchase_id',
             to_jsonb(sn)->>'po_id',
             ''
           ) AS purchase_id,
           COALESCE(
             to_jsonb(sn)->>'branchId',
             to_jsonb(sn)->>'branch_id',
             to_jsonb(sn)->>'branchid',
             ''
           ) AS branch_id
         FROM tblserial_numbers sn
       ),
       purchase_items AS (
         SELECT
           COALESCE(
             to_jsonb(tpi)->>'purchaseId',
             to_jsonb(tpi)->>'purchase_id',
             to_jsonb(tpi)->>'po_id',
             ''
           ) AS purchase_id,
           COALESCE(
             to_jsonb(tpi)->>'productId',
             to_jsonb(tpi)->>'product_id',
             ''
           ) AS product_id,
           COALESCE(
             to_jsonb(tpi)->>'capacityId',
             to_jsonb(tpi)->>'capacity_id',
             ''
           ) AS capacity_id,
           COALESCE(
             to_jsonb(tpi)->>'unitPrice',
             to_jsonb(tpi)->>'unit_price',
             ''
           ) AS unit_price
         FROM tbltransaction_product_items tpi
         WHERE LOWER(COALESCE(
           to_jsonb(tpi)->>'transType',
           to_jsonb(tpi)->>'trans_type',
           'purchase'
         )) = 'purchase'
       ),
       purchase_product_item_counts AS (
         SELECT
           pi.purchase_id,
           pi.product_id,
           COUNT(*)::int AS item_count
         FROM purchase_items pi
         WHERE pi.purchase_id <> ''
           AND pi.product_id <> ''
         GROUP BY pi.purchase_id, pi.product_id
       ),
       resolved_serial_scope AS (
         SELECT
           ss.serial_number,
           ss.status,
           ss.unit_type,
           ss.product_id,
           COALESCE(exact_item.capacity_id, fallback_item.capacity_id, ss.capacity_id) AS capacity_id,
           ss.purchase_id,
           ss.branch_id,
           COALESCE(exact_item.unit_price, fallback_item.unit_price, '') AS unit_price
         FROM serial_scope ss
         LEFT JOIN LATERAL (
           SELECT
             pi.capacity_id,
             pi.unit_price
           FROM purchase_items pi
           WHERE pi.purchase_id = ss.purchase_id
             AND pi.product_id = ss.product_id
             AND pi.capacity_id = ss.capacity_id
           LIMIT 1
         ) exact_item ON true
         LEFT JOIN purchase_product_item_counts ppic
           ON ppic.purchase_id = ss.purchase_id
          AND ppic.product_id = ss.product_id
         LEFT JOIN LATERAL (
           SELECT
             pi.capacity_id,
             pi.unit_price
           FROM purchase_items pi
           WHERE pi.purchase_id = ss.purchase_id
             AND pi.product_id = ss.product_id
           LIMIT 1
         ) fallback_item
           ON exact_item.capacity_id IS NULL
          AND COALESCE(ppic.item_count, 0) = 1
       )
       SELECT
         rss.serial_number AS "serialNumber",
         rss.unit_type AS "unitType",
         rss.product_id AS "productId",
         COALESCE(
           to_jsonb(p)->>'productName',
           to_jsonb(p)->>'product_name',
           to_jsonb(p)->>'productname',
           ''
         ) AS "productName",
         rss.capacity_id AS "capacityId",
         COALESCE(
           to_jsonb(c)->>'capacity',
           to_jsonb(c)->>'capacityValue',
           to_jsonb(c)->>'capacity_value',
           to_jsonb(c)->>'name',
           ''
         ) AS "capacityName",
         rss.purchase_id AS "purchaseId",
         COALESCE(
           to_jsonb(po)->>'po_number',
           to_jsonb(po)->>'poNumber',
           to_jsonb(po)->>'po_no',
           ''
         ) AS "poNumber",
         po.created_at::text AS "poDate",
         COALESCE(
           to_jsonb(v)->>'name',
           ''
         ) AS "vendorName",
         COALESCE(
           NULLIF(
             rss.unit_price,
             ''
           )::numeric,
           0
         )::text AS "landedCost",
         COALESCE(
           NULLIF(
             COALESCE(
               to_jsonb(c)->>'srp',
               to_jsonb(c)->>'SRP',
               ''
             ),
             ''
           )::numeric,
           0
         )::text AS srp,
         rss.status AS "status",
         CASE
           WHEN sn."isDefective" IS NOT NULL THEN sn."isDefective"
           ELSE false
         END AS "isDefective",
         CASE
           WHEN sn."isReturned" IS NOT NULL THEN sn."isReturned"
           ELSE false
         END AS "isReturned"
       FROM resolved_serial_scope rss
       LEFT JOIN tblserial_numbers sn
         ON sn."serialNumber" = rss.serial_number
       LEFT JOIN tblproducts p
         ON p.id::text = rss.product_id
       LEFT JOIN tblcapacity c
         ON c.id::text = rss.capacity_id
       LEFT JOIN tblpurchase_orders po
         ON po.id::text = rss.purchase_id
       LEFT JOIN tblvendors v
         ON v.id::text = COALESCE(
           to_jsonb(po)->>'vendor_id',
           to_jsonb(po)->>'vendorId',
           ''
         )
       WHERE rss.serial_number <> ''
         AND rss.purchase_id <> ''
         AND (
           $1::text IS NULL
           OR rss.branch_id = $1::text
         )
         AND (
           $2::text IS NULL
           OR rss.product_id = $2::text
         )
         AND (
           $3::text IS NULL
           OR rss.capacity_id = $3::text
         )
         AND (
             po.created_at::date >= $4::date
             AND po.created_at::date <= $5::date
         )
         ORDER BY
           COALESCE(to_jsonb(p)->>'productName', to_jsonb(p)->>'product_name', to_jsonb(p)->>'productname', '') ASC,
           COALESCE(to_jsonb(c)->>'capacity', to_jsonb(c)->>'capacityValue', to_jsonb(c)->>'capacity_value', to_jsonb(c)->>'name', '') ASC,
           COALESCE(to_jsonb(v)->>'name', '') ASC,
           po.created_at ASC NULLS LAST,
           rss.serial_number ASC`,
      [
        branchId !== null ? String(branchId) : null,
        productId !== null ? String(productId) : null,
        capacityId !== null ? String(capacityId) : null,
          dateFrom,
          dateTo,
      ],
    );

      const normalizedRows = rowsResult.rows.map((row) => {
        const landedCost = this.toOptionalNumber(row.landedCost) ?? 0;
        const srp = this.toOptionalNumber(row.srp) ?? 0;
        const marginAmount = srp - landedCost;
        const normalizedProductId = String(row.productId ?? '').trim();

        return {
          serialNumber: String(row.serialNumber ?? '').trim(),
          unitType: this.normalizeUnitType(row.unitType),
          productId: normalizedProductId,
          productName: String(row.productName ?? '').trim(),
          capacityName: String(row.capacityName ?? '').trim(),
          purchaseId: this.toOptionalNumber(row.purchaseId),
          poNumber: String(row.poNumber ?? '').trim(),
          poDate: row.poDate,
          vendorName: String(row.vendorName ?? '').trim(),
          landedCost,
          srp,
          marginAmount,
          status: String(row.status ?? '').trim(),
          isDefective: Boolean(row.isDefective ?? false),
          isReturned: Boolean(row.isReturned ?? false),
        };
      });

      const groupMap = new Map<string, {
        productName: string;
        capacityName: string;
        vendorName: string;
        poNumber: string;
        poDate: string | null;
        landedCost: number;
        srp: number;
        indoorSerials: Array<{ serial: string; status: string; isDefective: boolean; isReturned: boolean }>;
        outdoorSerials: Array<{ serial: string; status: string; isDefective: boolean; isReturned: boolean }>;
        others: Array<{ serialNumber: string; unitType: string; status: string; isDefective: boolean; isReturned: boolean }>;
      }>();

      for (const row of normalizedRows) {
        const groupKey = [
          row.productName,
          row.capacityName,
          row.vendorName,
          String(row.purchaseId ?? ''),
          row.poNumber,
          row.poDate ?? '',
          row.landedCost,
          row.srp,
        ].join('::');

        if (!groupMap.has(groupKey)) {
          groupMap.set(groupKey, {
            productName: row.productName,
            capacityName: row.capacityName,
            vendorName: row.vendorName,
            poNumber: row.poNumber,
            poDate: row.poDate,
            landedCost: row.landedCost,
            srp: row.srp,
            indoorSerials: [],
            outdoorSerials: [],
            others: [],
          });
        }

        const group = groupMap.get(groupKey)!;
        const configuredLabels = productUnitTypeMap.get(row.productId) ?? [];
        const unitBucket = this.resolveLandCostingUnitBucket(row.unitType, configuredLabels);

        if (unitBucket === 'indoor') {
          group.indoorSerials.push({
            serial: row.serialNumber,
            status: row.status,
            isDefective: row.isDefective,
            isReturned: row.isReturned,
          });
          continue;
        }

        if (unitBucket === 'outdoor') {
          group.outdoorSerials.push({
            serial: row.serialNumber,
            status: row.status,
            isDefective: row.isDefective,
            isReturned: row.isReturned,
          });
          continue;
        }

        group.others.push({
          serialNumber: row.serialNumber,
          unitType: row.unitType || 'other',
          status: row.status,
          isDefective: row.isDefective,
          isReturned: row.isReturned,
        });
      }

      const groups = Array.from(groupMap.values()).map((group) => {
        const rows: Array<{
          indoorSerial: string;
          outdoorSerial: string;
          landedCost: number;
          srp: number;
          marginAmount: number;
          serialStatus: string;
          isDefective: boolean;
          isReturned: boolean;
        }> = [];

        const maxPairCount = Math.max(group.indoorSerials.length, group.outdoorSerials.length);
        for (let index = 0; index < maxPairCount; index += 1) {
          const indoor = group.indoorSerials[index];
          const outdoor = group.outdoorSerials[index];

          const serialStatus =
            [indoor, outdoor].some((s) => s?.isDefective) ? 'Defective' :
            [indoor, outdoor].some((s) => s?.isReturned) ? 'Returned' :
            [indoor, outdoor].some((s) => (s?.status ?? '').toLowerCase() === 'installed') ? 'Installed' :
            'In-Stock';

          rows.push({
            indoorSerial: indoor?.serial ?? '',
            outdoorSerial: outdoor?.serial ?? '',
            landedCost: group.landedCost,
            srp: group.srp,
            marginAmount: group.srp - group.landedCost,
            serialStatus,
            isDefective: Boolean(indoor?.isDefective || outdoor?.isDefective),
            isReturned: Boolean(indoor?.isReturned || outdoor?.isReturned),
          });
        }

        // Add any "other" serials as their own rows (placed in Indoor column)
        for (const other of group.others) {
          const serialStatus = other.isDefective ? 'Defective' : other.isReturned ? 'Returned' : (other.status || 'In-Stock');
          rows.push({
            indoorSerial: other.serialNumber,
            outdoorSerial: '',
            landedCost: group.landedCost,
            srp: group.srp,
            marginAmount: group.srp - group.landedCost,
            serialStatus,
            isDefective: other.isDefective,
            isReturned: other.isReturned,
          });
        }

        const groupMarginTotal = rows.reduce((total, row) => total + row.marginAmount, 0);
        const serialCount =
          group.indoorSerials.length + group.outdoorSerials.length + group.others.length;

        return {
          productName: group.productName,
          capacityName: group.capacityName,
          vendorName: group.vendorName,
          poNumber: group.poNumber,
          poDate: group.poDate,
          rows,
          totals: {
            serialCount,
            landedCost: rows.reduce((total, row) => total + row.landedCost, 0),
            srp: rows.reduce((total, row) => total + row.srp, 0),
            marginAmount: groupMarginTotal,
          },
        };
      });

      const totals = groups.reduce(
        (accumulator, group) => {
          accumulator.serialCount += group.totals.serialCount;
          accumulator.landedCost += group.totals.landedCost;
          accumulator.srp += group.totals.srp;
          accumulator.marginAmount += group.totals.marginAmount;
          return accumulator;
        },
        {
          serialCount: 0,
          landedCost: 0,
          srp: 0,
          marginAmount: 0,
        },
      );

    return {
      success: true,
      item: {
        dateFrom,
        dateTo,
        filters: {
          branchId,
          productId,
          capacityId,
        },
        totals: {
          ...totals,
          marginPercent:
            totals.landedCost > 0
              ? (totals.marginAmount / totals.landedCost) * 100
              : 0,
        },
        groups,
      },
    };
  }

  async insertBulk(
    serials: Array<{ serialNumber: string; unitType?: string; status?: string; productId?: number; capacityId?: number }>,
    auditActor?: AuditActorContext,
  ) {
    if (!serials || serials.length === 0) {
      return { success: false, message: 'No serials provided' };
    }

    const serialColumns = await this.getTableColumns('tblserial_numbers');
    const serialNumberColumn = this.pickColumn(serialColumns, ['serialNumber', 'serial_number']);
    const serialStatusColumn = this.pickColumn(serialColumns, ['status']);
    const serialUnitTypeColumn = this.pickColumn(serialColumns, ['unitType', 'unit_type']);
    const serialProductIdColumn = this.pickColumn(serialColumns, ['productId', 'product_id']);
    const serialCapacityIdColumn = this.pickColumn(serialColumns, ['capacityId', 'capacity_id']);

    if (!serialNumberColumn) {
      return { success: false, message: 'Serial number column not found' };
    }

    const requestedProductIds = [...new Set(
      (serials ?? [])
        .map((serial) => Number(serial.productId))
        .filter((value) => Number.isFinite(value) && value > 0),
    )];

    const requestedCapacityIds = [...new Set(
      (serials ?? [])
        .map((serial) => Number(serial.capacityId))
        .filter((value) => Number.isFinite(value) && value > 0),
    )];

    if (requestedProductIds.length > 0) {
      const existingProducts = await this.databaseService.query<{ id: string }>(
        `SELECT id::text AS id FROM tblproducts WHERE id = ANY($1::int[])`,
        [requestedProductIds],
      );
      const existingProductIds = new Set(existingProducts.rows.map((row) => Number(row.id)));
      const missingProductId = requestedProductIds.find((value) => !existingProductIds.has(value));
      if (missingProductId !== undefined) {
        return { success: false, message: `Product ID ${missingProductId} does not exist` };
      }
    }

    if (requestedCapacityIds.length > 0) {
      const existingCapacities = await this.databaseService.query<{ id: string }>(
        `SELECT id::text AS id FROM tblcapacity WHERE id = ANY($1::int[])`,
        [requestedCapacityIds],
      );
      const existingCapacityIds = new Set(existingCapacities.rows.map((row) => Number(row.id)));
      const missingCapacityId = requestedCapacityIds.find((value) => !existingCapacityIds.has(value));
      if (missingCapacityId !== undefined) {
        return { success: false, message: `Capacity ID ${missingCapacityId} does not exist` };
      }
    }

    const requestedProductCapacityPairs = [...new Set(
      (serials ?? [])
        .map((serial) => ({
          productId: Number(serial.productId),
          capacityId: Number(serial.capacityId),
        }))
        .filter((entry) => Number.isFinite(entry.productId) && entry.productId > 0 && Number.isFinite(entry.capacityId) && entry.capacityId > 0)
        .map((entry) => `${entry.productId}::${entry.capacityId}`),
    )];

    if (requestedProductCapacityPairs.length > 0) {
      const capacityProductRows = await this.databaseService.query<{ id: string; productId: string | null }>(
        `SELECT
           c.id::text AS id,
           COALESCE(
             to_jsonb(c)->>'productId',
             to_jsonb(c)->>'product_id',
             to_jsonb(c)->>'prodId',
             to_jsonb(c)->>'prod_id',
             null
           ) AS "productId"
         FROM tblcapacity c
         WHERE c.id = ANY($1::int[])`,
        [requestedCapacityIds],
      );

      const capacityToProductMap = new Map<number, number>();
      for (const row of capacityProductRows.rows) {
        const capacityId = Number(row.id);
        const productId = Number(row.productId);
        if (Number.isFinite(capacityId) && capacityId > 0 && Number.isFinite(productId) && productId > 0) {
          capacityToProductMap.set(capacityId, productId);
        }
      }

      for (const pair of requestedProductCapacityPairs) {
        const [productIdText, capacityIdText] = pair.split('::');
        const productId = Number(productIdText);
        const capacityId = Number(capacityIdText);
        const linkedProductId = capacityToProductMap.get(capacityId);

        if (!linkedProductId) {
          return { success: false, message: `Capacity ID ${capacityId} is missing its linked product` };
        }

        if (linkedProductId !== productId) {
          return { success: false, message: `Capacity ID ${capacityId} does not belong to Product ID ${productId}` };
        }
      }
    }

    let inserted = 0;
    let skipped = 0;

    for (const s of serials) {
      const sn = this.normalizeSerialNumber(s.serialNumber);
      if (!sn) { skipped++; continue; }

      const productId = Number(s.productId);
      const capacityId = Number(s.capacityId);
      const hasProductId = Number.isFinite(productId) && productId > 0;
      const hasCapacityId = Number.isFinite(capacityId) && capacityId > 0;

      if (hasProductId !== hasCapacityId) {
        skipped++;
        continue;
      }

      // Check if already exists
      const existing = await this.databaseService.query<{ id: number }>(
        `SELECT id FROM tblserial_numbers
         WHERE LOWER(regexp_replace(BTRIM(COALESCE("serialNumber", '')), '\\s+', ' ', 'g')) = LOWER($1)
         LIMIT 1`,
        [sn],
      );
      if (existing.rowCount > 0) { skipped++; continue; }

      const record: Record<string, unknown> = { [serialNumberColumn]: sn };
      if (serialStatusColumn) record[serialStatusColumn] = 'in-stock';
      if (serialUnitTypeColumn) record[serialUnitTypeColumn] = this.normalizeUnitType(s.unitType ?? '');
      if (serialProductIdColumn && hasProductId) record[serialProductIdColumn] = productId;
      if (serialCapacityIdColumn && hasCapacityId) record[serialCapacityIdColumn] = capacityId;

      await this.runInsert('tblserial_numbers', record);
      inserted++;
    }

    await this.auditLogService.logMutation({
      action: 'SERIAL_BULK_INSERT',
      entityType: 'serial-number',
      entityId: null,
      actor: auditActor,
      description: `Bulk inserted ${inserted} serial(s)`,
      requestBody: { count: serials.length },
      after: { inserted, skipped },
    });

    return {
      success: true,
      message: `Inserted ${inserted} serial(s). Skipped ${skipped} (already exist or invalid).`,
      inserted,
      skipped,
    };
  }

  async csvPreview(rows: Array<{ serialNumber: string; unitType?: string; status: string }>, productId?: number, capacityId?: number) {
    const targetProductId = productId ? Number(productId) : null;
    const targetCapacityId = capacityId ? Number(capacityId) : null;

    const normalized = (rows ?? [])
      .map((r) => ({
        serialNumber: this.normalizeSerialNumber(r.serialNumber),
        csvUnitType: this.normalizeUnitType(r.unitType ?? ''),
        csvStatus: String(r.status ?? '').trim().toLowerCase(),
      }))
      .filter((r) => r.serialNumber.length > 0);

    if (normalized.length === 0) {
      return { success: false, message: 'No serial numbers provided' };
    }

    const seen = new Set<string>();
    const unique = normalized.filter((r) => {
      const key = r.serialNumber.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const serialList = unique.map((r) => r.serialNumber);

    const result = await this.databaseService.query<{
      serialNumber: string;
      status: string | null;
      unitType: string | null;
      productName: string | null;
      capacityName: string | null;
      productId: string | null;
      capacityId: string | null;
    }>(
      `SELECT
         COALESCE(to_jsonb(sn)->>'serialNumber', to_jsonb(sn)->>'serial_number', '') AS "serialNumber",
         COALESCE(to_jsonb(sn)->>'status', '') AS status,
         COALESCE(to_jsonb(sn)->>'unitType', to_jsonb(sn)->>'unit_type', '') AS "unitType",
         COALESCE(to_jsonb(p)->>'productName', to_jsonb(p)->>'product_name', '') AS "productName",
         COALESCE(to_jsonb(c)->>'capacity', '') AS "capacityName",
         COALESCE(to_jsonb(sn)->>'productId', to_jsonb(sn)->>'product_id', '') AS "productId",
         COALESCE(to_jsonb(sn)->>'capacityId', to_jsonb(sn)->>'capacity_id', '') AS "capacityId"
       FROM tblserial_numbers sn
       LEFT JOIN tblproducts p ON p.id::text = COALESCE(to_jsonb(sn)->>'productId', to_jsonb(sn)->>'product_id')
       LEFT JOIN tblcapacity c ON c.id::text = COALESCE(to_jsonb(sn)->>'capacityId', to_jsonb(sn)->>'capacity_id')
       WHERE LOWER(regexp_replace(BTRIM(COALESCE(to_jsonb(sn)->>'serialNumber', to_jsonb(sn)->>'serial_number', '')), '\\s+', ' ', 'g'))
         = ANY(SELECT LOWER(regexp_replace(BTRIM(s), '\\s+', ' ', 'g')) FROM unnest($1::text[]) s)`,
      [serialList],
    );

    const foundMap = new Map<string, { serialNumber: string; dbStatus: string; unitType: string; productName: string; capacityName: string; productId: number | null; capacityId: number | null }>();
    for (const row of result.rows) {
      foundMap.set(row.serialNumber.toLowerCase().trim(), {
        serialNumber: row.serialNumber,
        dbStatus: String(row.status ?? '').toLowerCase().trim(),
        unitType: String(row.unitType ?? '').trim().toUpperCase(),
        productName: String(row.productName ?? '').trim(),
        capacityName: String(row.capacityName ?? '').trim(),
        productId: row.productId ? Number(row.productId) : null,
        capacityId: row.capacityId ? Number(row.capacityId) : null,
      });
    }

    const toInstall: Array<{ serialNumber: string; csvStatus: string; csvUnitType: string; unitType: string; productName: string; capacityName: string }> = [];
    const alreadyInstalled: Array<{ serialNumber: string; unitType: string; productName: string; capacityName: string }> = [];
    const installedInDb: Array<{ serialNumber: string; csvStatus: string; csvUnitType: string; unitType: string; productName: string; capacityName: string }> = [];
    const notFound: Array<{ serialNumber: string; csvStatus: string; csvUnitType: string }> = [];
    const otherStatus: Array<{ serialNumber: string; csvStatus: string; dbStatus: string; unitType: string; productName: string; capacityName: string }> = [];
    const wrongCapacity: Array<{ serialNumber: string; csvStatus: string; dbStatus: string; unitType: string; productName: string; capacityName: string; dbProductId: number | null; dbCapacityId: number | null }> = [];

    // Unit type counts across all found serials
    const unitTypeCounts: Record<string, number> = {};

    for (const row of unique) {
      const found = foundMap.get(row.serialNumber.toLowerCase());

      if (!found) {
        notFound.push({ serialNumber: row.serialNumber, csvStatus: row.csvStatus, csvUnitType: row.csvUnitType });
        continue;
      }

      const ut = found.unitType || row.csvUnitType.toUpperCase() || 'UNKNOWN';
      unitTypeCounts[ut] = (unitTypeCounts[ut] ?? 0) + 1;

      if (found.dbStatus === 'installed' && row.csvStatus === 'installed') {
        // Both CSV and DB say installed — confirmed installed
        alreadyInstalled.push({ serialNumber: found.serialNumber, unitType: found.unitType, productName: found.productName, capacityName: found.capacityName });
        continue;
      }

      if (found.dbStatus === 'installed' && row.csvStatus !== 'installed') {
        // CSV says in-stock but DB says installed — conflict: DB has it as installed already
        installedInDb.push({ serialNumber: found.serialNumber, csvStatus: row.csvStatus, csvUnitType: row.csvUnitType, unitType: found.unitType, productName: found.productName, capacityName: found.capacityName });
        continue;
      }

      if (row.csvStatus === 'installed') {
        // CSV says installed but DB is not installed — should be marked as installed
        toInstall.push({ serialNumber: found.serialNumber, csvStatus: row.csvStatus, csvUnitType: row.csvUnitType, unitType: found.unitType, productName: found.productName, capacityName: found.capacityName });
        continue;
      }

      // Both CSV and DB are non-installed (e.g., both in-stock) — check if capacity matches
      const dbProductId = found.productId ? Number(found.productId) : null;
      const dbCapacityId = found.capacityId ? Number(found.capacityId) : null;

      const dbCapacityMatches = !targetProductId || !targetCapacityId || !dbProductId || !dbCapacityId ||
        (dbProductId === targetProductId && dbCapacityId === targetCapacityId);

      if (!dbCapacityMatches) {
        wrongCapacity.push({ serialNumber: found.serialNumber, csvStatus: row.csvStatus, dbStatus: found.dbStatus, unitType: found.unitType, productName: found.productName, capacityName: found.capacityName, dbProductId: found.productId, dbCapacityId: found.capacityId });
      } else {
        otherStatus.push({ serialNumber: found.serialNumber, csvStatus: row.csvStatus, dbStatus: found.dbStatus, unitType: found.unitType, productName: found.productName, capacityName: found.capacityName });
      }
    }

    // Total sets = total found serials / unit types per set (approximate: count distinct unitType labels)
    const unitTypeLabels = Object.keys(unitTypeCounts);
    const unitTypeCount = unitTypeLabels.length || 1;
    const totalFoundSerials = toInstall.length + alreadyInstalled.length + installedInDb.length + otherStatus.length + wrongCapacity.length;
    const totalSets = unitTypeCount > 1 ? Math.floor(totalFoundSerials / unitTypeCount) : totalFoundSerials;

    // Remaining stocks = serials that are NOT installed (in-stock, reserved, etc.)
    const remainingStocks = otherStatus.length + toInstall.length;

    // Find serials in DB for this product/capacity that are NOT in the uploaded CSV
    let notInCsv: Array<{ serialNumber: string; dbStatus: string; unitType: string; productName: string; capacityName: string }> = [];

    if (targetProductId && targetCapacityId) {
      const serialColumns = await this.getTableColumns('tblserial_numbers');
      const snCol = this.pickColumn(serialColumns, ['serialNumber', 'serial_number']);
      const statusCol = this.pickColumn(serialColumns, ['status']);
      const unitTypeCol = this.pickColumn(serialColumns, ['unitType', 'unit_type']);
      const productIdCol = this.pickColumn(serialColumns, ['productId', 'product_id']);
      const capacityIdCol = this.pickColumn(serialColumns, ['capacityId', 'capacity_id']);

      if (snCol && statusCol && productIdCol && capacityIdCol) {
        // Get all in_stock serials for this product/capacity (installed ones are already handled)
        const dbSerialsResult = await this.databaseService.query<{
          serialNumber: string;
          status: string | null;
          unitType: string | null;
          productName: string | null;
          capacityName: string | null;
        }>(
          `SELECT
             sn."${snCol}" AS "serialNumber",
             sn."${statusCol}" AS status,
             ${unitTypeCol ? `sn."${unitTypeCol}"` : `''`} AS "unitType",
             COALESCE(to_jsonb(p)->>'productName', to_jsonb(p)->>'product_name', '') AS "productName",
             COALESCE(to_jsonb(c)->>'capacity', '') AS "capacityName"
           FROM tblserial_numbers sn
           LEFT JOIN tblproducts p ON p.id = sn."${productIdCol}"
           LEFT JOIN tblcapacity c ON c.id = sn."${capacityIdCol}"
           WHERE sn."${productIdCol}" = $1
             AND sn."${capacityIdCol}" = $2
             AND LOWER(COALESCE(sn."${statusCol}", '')) NOT IN ('installed')`,
          [targetProductId, targetCapacityId],
        );

        // Filter out serials that ARE in the CSV
        const csvSerialSet = new Set(unique.map((r) => r.serialNumber.toLowerCase()));

        for (const row of dbSerialsResult.rows) {
          const normalizedDbSerial = String(row.serialNumber ?? '').trim().toLowerCase();
          if (normalizedDbSerial && !csvSerialSet.has(normalizedDbSerial)) {
            notInCsv.push({
              serialNumber: String(row.serialNumber ?? '').trim(),
              dbStatus: String(row.status ?? '').trim().toLowerCase(),
              unitType: String(row.unitType ?? '').trim().toUpperCase(),
              productName: String(row.productName ?? '').trim(),
              capacityName: String(row.capacityName ?? '').trim(),
            });
          }
        }
      }
    }

    return {
      success: true,
      summary: {
        total: unique.length,
        toInstall: toInstall.length,
        alreadyInstalled: alreadyInstalled.length,
        installedInDb: installedInDb.length,
        notFound: notFound.length,
        otherStatus: otherStatus.length,
        wrongCapacity: wrongCapacity.length,
        notInCsv: notInCsv.length,
        totalSets,
        unitTypeCounts,
        remainingStocks,
      },
      toInstall,
      alreadyInstalled,
      installedInDb,
      notFound,
      otherStatus,
      wrongCapacity,
      notInCsv,
    };
  }
  async bulkUpdateStatus(
    serialNumbers: string[],
    status: string,
    userId?: number,
    auditActor?: AuditActorContext,
    password?: string,
    remarks?: string,
    isRevertToStock = false,
  ) {
    const allowedStatuses = ['installed', 'in-stock', 'reserved', 'for-delivery'];
    const normalizedStatus = String(status ?? '').trim().toLowerCase();
    if (!allowedStatuses.includes(normalizedStatus)) {
      return { success: false, message: `Invalid status. Allowed: ${allowedStatuses.join(', ')}` };
    }

    const revertingToStock = isRevertToStock && normalizedStatus === 'in-stock';
    const requiresPassword = normalizedStatus === 'installed' || revertingToStock;
    if (requiresPassword) {
      const auth = await verifyCurrentUserPassword(this.databaseService, userId, password);
      if (!auth.ok) {
        return { success: false, message: auth.message };
      }
    }

    const normalizedRemarks = String(remarks ?? '').trim();
    if (revertingToStock && !normalizedRemarks) {
      return { success: false, message: 'Remarks are required to revert serials to stock.' };
    }

    const normalized = (serialNumbers ?? [])
      .map((s) => this.normalizeSerialNumber(s))
      .filter((s) => s.length > 0);

    if (normalized.length === 0) {
      return { success: false, message: 'No serial numbers provided' };
    }

    const serialColumns = await this.getTableColumns('tblserial_numbers');
    const serialStatusColumn = this.pickColumn(serialColumns, ['status']);
    const serialCreatedByColumn = this.pickColumn(serialColumns, ['created_by', 'createdBy', 'createdby']);

    if (!serialStatusColumn) {
      return { success: false, message: 'Status column not found in tblserial_numbers' };
    }

    // Query serials before update to capture previous status for event logging
    const beforeResult = await this.databaseService.query<{ id: number; serialNumber: string; status: string | null }>(
      `SELECT sn.id,
              COALESCE(to_jsonb(sn)->>'serialNumber', to_jsonb(sn)->>'serial_number', '') AS "serialNumber",
              COALESCE(to_jsonb(sn)->>'status', null) AS status
       FROM tblserial_numbers sn
       WHERE LOWER(regexp_replace(BTRIM(COALESCE(to_jsonb(sn)->>'serialNumber', to_jsonb(sn)->>'serial_number', '')), '\\s+', ' ', 'g')) = ANY(
         SELECT LOWER(regexp_replace(BTRIM(s), '\\s+', ' ', 'g')) FROM unnest($1::text[]) s
       )`,
      [normalized],
    );

    const affectedRows = revertingToStock
      ? beforeResult.rows.filter((row) => String(row.status ?? '').trim().toLowerCase() === 'installed')
      : beforeResult.rows;

    if (revertingToStock && affectedRows.length === 0) {
      return { success: false, message: 'No installed serial numbers to revert to stock.' };
    }

    const serialsToUpdate = revertingToStock
      ? affectedRows.map((row) => this.normalizeSerialNumber(row.serialNumber)).filter((s) => s.length > 0)
      : normalized;

    const setClauses = [`"${serialStatusColumn}" = $1`];
    const params: unknown[] = [normalizedStatus];

    if (serialCreatedByColumn && userId !== undefined) {
      params.push(userId);
      setClauses.push(`"${serialCreatedByColumn}" = $${params.length}`);
    }

    params.push(serialsToUpdate);
    const revertOnlyInstalled = revertingToStock
      ? ` AND LOWER(COALESCE("${serialStatusColumn}", '')) = 'installed'`
      : '';
    const result = await this.databaseService.withTransaction(async (client) => {
      const updateResult = await client.query(
        `UPDATE tblserial_numbers
         SET ${setClauses.join(', ')}
         WHERE LOWER(regexp_replace(BTRIM(COALESCE("serialNumber", '')), '\\s+', ' ', 'g')) = ANY(
           SELECT LOWER(regexp_replace(BTRIM(s), '\\s+', ' ', 'g')) FROM unnest($${params.length}::text[]) s
         )${revertOnlyInstalled}`,
        params,
      );

      if (affectedRows.length > 0) {
        const eventReason = revertingToStock ? normalizedRemarks : normalizedRemarks || null;

        for (const row of affectedRows) {
          let eventType: 'STATUS_CHANGED' | 'MARKED_DEFECTIVE' | 'RETURNED' = 'STATUS_CHANGED';
          if (normalizedStatus === 'defective') {
            eventType = 'MARKED_DEFECTIVE';
          } else if (normalizedStatus === 'returned') {
            eventType = 'RETURNED';
          }

          await this.serialEventLogService.logEvent(
            {
              serialId: row.id,
              serialNumber: row.serialNumber,
              eventType,
              previousStatus: row.status,
              newStatus: normalizedStatus,
              performedBy: userId ?? null,
              performedByUsername: auditActor?.username ?? null,
              ipAddress: auditActor?.ipAddress ?? null,
              reason: eventReason,
            },
            client,
          );
        }
      }

      return updateResult;
    });

    await this.auditLogService.logMutation({
      action: revertingToStock ? 'SERIAL_REVERT_TO_STOCK' : 'SERIAL_BULK_UPDATE_STATUS',
      entityType: 'serial-number',
      entityId: null,
      actor: auditActor ?? { userId },
      description: revertingToStock
        ? `Reverted ${result.rowCount ?? 0} serial(s) to in-stock. Remarks: ${normalizedRemarks}`
        : `Bulk updated ${result.rowCount ?? 0} serial(s) to '${normalizedStatus}'`,
      requestBody: {
        status: normalizedStatus,
        count: serialsToUpdate.length,
        remarks: revertingToStock ? normalizedRemarks : undefined,
      },
      after: { updated: result.rowCount ?? 0, status: normalizedStatus },
    });

    return {
      success: true,
      message: revertingToStock
        ? `Reverted ${result.rowCount ?? 0} serial number(s) to stock`
        : `Updated ${result.rowCount ?? 0} serial number(s) to '${normalizedStatus}'`,
      updated: result.rowCount ?? 0,
    };
  }

  async bulkReassignCapacity(
    serialNumbers: string[],
    productId: number,
    capacityId: number,
    auditActor?: AuditActorContext,
  ) {
    if (!productId || !capacityId) {
      return { success: false, message: 'productId and capacityId are required' };
    }

    const normalized = (serialNumbers ?? [])
      .map((s) => this.normalizeSerialNumber(s))
      .filter((s) => s.length > 0);

    if (normalized.length === 0) {
      return { success: false, message: 'No serial numbers provided' };
    }

    const serialColumns = await this.getTableColumns('tblserial_numbers');
    const serialNumberColumn = this.pickColumn(serialColumns, ['serialNumber', 'serial_number']);
    const productIdColumn = this.pickColumn(serialColumns, ['productId', 'product_id']);
    const capacityIdColumn = this.pickColumn(serialColumns, ['capacityId', 'capacity_id']);

    if (!serialNumberColumn || !productIdColumn || !capacityIdColumn) {
      return { success: false, message: 'Required columns not found in tblserial_numbers' };
    }

    const result = await this.databaseService.query<{ count: string }>(
      `UPDATE tblserial_numbers
       SET "${productIdColumn}" = $1, "${capacityIdColumn}" = $2
       WHERE LOWER(regexp_replace(BTRIM(COALESCE("${serialNumberColumn}", '')), '\\s+', ' ', 'g')) = ANY(
         SELECT LOWER(regexp_replace(BTRIM(s), '\\s+', ' ', 'g')) FROM unnest($3::text[]) s
       )
       RETURNING id`,
      [productId, capacityId, normalized],
    );

    const updated = result.rowCount ?? 0;
    await this.auditLogService.logMutation({
      action: 'SERIAL_BULK_REASSIGN',
      entityType: 'serial-number',
      entityId: null,
      actor: auditActor,
      description: `Bulk reassigned ${updated} serial(s) to product #${productId} / capacity #${capacityId}`,
      requestBody: { productId, capacityId, count: normalized.length },
      after: { updated, productId, capacityId },
    });

    return { success: true, message: `Reassigned ${updated} serial(s) to the selected capacity`, updated };
  }

  async reassignCapacityForPurchaseImport(input: {
    purchaseId: number;
    serialNumbers: string[];
    productId: number;
    capacityId: number;
    unitType?: string;
  }) {
    const purchaseId = Number(input.purchaseId);
    const productId = Number(input.productId);
    const capacityId = Number(input.capacityId);

    if (!Number.isFinite(purchaseId) || purchaseId <= 0) {
      return { success: false, message: 'purchaseId is required' };
    }
    if (!productId || !capacityId) {
      return { success: false, message: 'productId and capacityId are required' };
    }

    const normalized = (input.serialNumbers ?? [])
      .map((serial) => this.normalizeSerialNumber(serial))
      .filter((serial) => serial.length > 0);

    if (normalized.length === 0) {
      return { success: false, message: 'No serial numbers provided' };
    }

    const serialColumns = await this.getTableColumns('tblserial_numbers');
    const serialNumberColumn = this.pickColumn(serialColumns, ['serialNumber', 'serial_number']);
    const productIdColumn = this.pickColumn(serialColumns, ['productId', 'product_id']);
    const capacityIdColumn = this.pickColumn(serialColumns, ['capacityId', 'capacity_id']);
    const unitTypeColumn = this.pickColumn(serialColumns, ['unitType', 'unit_type']);
    const purchaseIdColumn = this.pickColumn(serialColumns, [
      'purchaseId',
      'purchase_id',
      'po_id',
      'purchaseOrderId',
      'purchase_order_id',
    ]);

    if (!serialNumberColumn || !productIdColumn || !capacityIdColumn || !purchaseIdColumn) {
      return { success: false, message: 'Required columns not found in tblserial_numbers' };
    }

    const normalizedUnitType = input.unitType
      ? this.normalizeUnitType(input.unitType)
      : null;

    const setParts = [
      `"${productIdColumn}" = $1`,
      `"${capacityIdColumn}" = $2`,
    ];
    const params: unknown[] = [productId, capacityId];

    if (normalizedUnitType && unitTypeColumn) {
      params.push(normalizedUnitType);
      setParts.push(`"${unitTypeColumn}" = $${params.length}`);
    }

    params.push(purchaseId);
    const purchaseParamIndex = params.length;
    params.push(normalized);

    const result = await this.databaseService.query<{ id: number }>(
      `UPDATE tblserial_numbers
       SET ${setParts.join(', ')}
       WHERE "${purchaseIdColumn}" = $${purchaseParamIndex}
         AND LOWER(
           regexp_replace(
             BTRIM(COALESCE("${serialNumberColumn}", '')),
             '\\s+',
             ' ',
             'g'
           )
         ) = ANY(
           SELECT LOWER(regexp_replace(BTRIM(s), '\\s+', ' ', 'g')) FROM unnest($${params.length}::text[]) s
         )
       RETURNING id`,
      params,
    );

    const updated = result.rowCount ?? 0;
    if (updated === 0) {
      return {
        success: false,
        message: 'No matching serial numbers found on this purchase order to update',
        updated: 0,
      };
    }

    return {
      success: true,
      message: `Updated capacity for ${updated} serial number(s)`,
      updated,
    };
  }

  async validateAndBulkInstall(
    serialNumbers: string[],
    userId?: number,
    auditActor?: AuditActorContext,
    password?: string,
  ) {
    const auth = await verifyCurrentUserPassword(this.databaseService, userId, password);
    if (!auth.ok) {
      return {
        success: false,
        message: auth.message,
        existing: [],
        nonExisting: [],
        updated: 0,
      };
    }

    const normalizedInputs = (serialNumbers ?? [])
      .map((s) => this.normalizeSerialNumber(s))
      .filter((s) => s.length > 0);

    if (normalizedInputs.length === 0) {
      return {
        success: false,
        message: 'No serial numbers provided',
        existing: [],
        nonExisting: [],
        updated: 0,
      };
    }

    const serialColumns = await this.getTableColumns('tblserial_numbers');
    const serialStatusColumn = this.pickColumn(serialColumns, ['status']);
    const serialCreatedByColumn = this.pickColumn(serialColumns, ['created_by', 'createdBy', 'createdby']);

    if (!serialStatusColumn) {
      return {
        success: false,
        message: 'Status column not found in tblserial_numbers',
        existing: [],
        nonExisting: [],
        updated: 0,
      };
    }

    // Query to find which serials exist in the database
    const existingResult = await this.databaseService.query<{ id: number; serialNumber: string; status: string | null }>(
      `SELECT sn.id,
              COALESCE(to_jsonb(sn)->>'serialNumber', to_jsonb(sn)->>'serial_number', '') AS "serialNumber",
              COALESCE(to_jsonb(sn)->>'status', null) AS status
       FROM tblserial_numbers sn
       WHERE LOWER(regexp_replace(BTRIM(COALESCE(to_jsonb(sn)->>'serialNumber', to_jsonb(sn)->>'serial_number', '')), '\\s+', ' ', 'g')) = ANY(
         SELECT LOWER(regexp_replace(BTRIM(s), '\\s+', ' ', 'g')) FROM unnest($1::text[]) s
       )`,
      [normalizedInputs],
    );

    // Separate existing and non-existing serial numbers
    const existingSerials = new Set(
      existingResult.rows.map((row) => 
        String(row.serialNumber ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
      ),
    );

    const normalizedWithOriginal = normalizedInputs.map((n) => ({
      normalized: n.toLowerCase().replace(/\s+/g, ' '),
      original: n,
    }));

    const existing: string[] = [];
    const nonExisting: string[] = [];

    normalizedWithOriginal.forEach(({ normalized, original }) => {
      if (existingSerials.has(normalized)) {
        existing.push(original);
      } else {
        nonExisting.push(original);
      }
    });

    // Update only existing serials to 'installed' status
    let updateResult = { rowCount: 0 };
    if (existing.length > 0) {
      const setClauses = [`"${serialStatusColumn}" = $1`];
      const params: unknown[] = ['installed'];

      if (serialCreatedByColumn && userId !== undefined) {
        params.push(userId);
        setClauses.push(`"${serialCreatedByColumn}" = $${params.length}`);
      }

      params.push(existing);
      updateResult = await this.databaseService.query(
        `UPDATE tblserial_numbers sn
         SET ${setClauses.join(', ')}
         WHERE LOWER(regexp_replace(BTRIM(COALESCE(to_jsonb(sn)->>'serialNumber', to_jsonb(sn)->>'serial_number', '')), '\\s+', ' ', 'g')) = ANY(
           SELECT LOWER(regexp_replace(BTRIM(s), '\\s+', ' ', 'g')) FROM unnest($${params.length}::text[]) s
         )`,
        params,
      );

      // Log events for each affected serial
      if (existingResult.rows.length > 0) {
        for (const row of existingResult.rows) {
          await this.serialEventLogService.logEvent({
            serialId: row.id,
            serialNumber: row.serialNumber,
            eventType: 'STATUS_CHANGED',
            previousStatus: row.status,
            newStatus: 'installed',
            performedBy: userId ?? null,
            performedByUsername: null,
            ipAddress: null,
          });
        }
      }
    }

    await this.auditLogService.logMutation({
      action: 'SERIAL_INSTALL',
      entityType: 'serial-number',
      entityId: null,
      actor: auditActor ?? { userId },
      description: `Bulk installed ${updateResult.rowCount ?? 0} serial(s)`,
      requestBody: { count: normalizedInputs.length },
      after: {
        updated: updateResult.rowCount ?? 0,
        existingCount: existing.length,
        nonExistingCount: nonExisting.length,
      },
    });

    return {
      success: true,
      message: `Validated ${normalizedInputs.length} serial(s). Found ${existing.length} existing, ${nonExisting.length} not found. Updated ${updateResult.rowCount ?? 0} to installed.`,
      existing,
      nonExisting,
      updated: updateResult.rowCount ?? 0,
    };
  }

  async scanSalesOrder(dto: ScanSalesOrderDto, actor?: AuditActorContext) {
    const serialNumber = this.normalizeSerialNumber(dto.serialNumber);
    const salesId = Number(dto.salesId);
    const branchId =
      dto.branchId === null || dto.branchId === undefined || dto.branchId === ('' as unknown)
        ? null
        : Number(dto.branchId);
    const expectedProductId =
      dto.expectedProductId === null ||
      dto.expectedProductId === undefined ||
      dto.expectedProductId === ('' as unknown)
        ? null
        : Number(dto.expectedProductId);
    const expectedCapacityId =
      dto.expectedCapacityId === null ||
      dto.expectedCapacityId === undefined ||
      dto.expectedCapacityId === ('' as unknown)
        ? null
        : Number(dto.expectedCapacityId);
    const expectedUnitType = this.normalizeUnitType(dto.expectedUnitType);
    const userId = actor?.userId ?? undefined;
    let unitTypeCorrectedFrom: string | null = null;

    const auditMetadata = {
      branchId,
      expectedProductId,
      expectedCapacityId,
      expectedUnitType,
      event: 'scanSalesOrder',
    };

    const auditFailure = async (message: string) => {
      await this.logSerialScanAudit(
        'SERIAL_SCAN_FAILURE',
        'SalesOrder',
        salesId,
        serialNumber,
        message,
        auditMetadata,
        actor,
      );
      return { success: false, message, item: undefined };
    };

    const auditSuccess = async (result: { success: true; message: string; item?: { serialNumber?: string | null } }) => {
      await this.logSerialScanAudit(
        'SERIAL_SCAN_SUCCESS',
        'SalesOrder',
        salesId,
        serialNumber,
        result.message,
        auditMetadata,
        actor,
      );
      return result;
    };

    // Pick previousSalesId and previousPurchaseId columns if available
    const serialColumns = await this.getTableColumns('tblserial_numbers');
    const serialPreviousSalesIdColumn = this.pickColumn(serialColumns, ['previousSalesId', 'previous_sales_id']);
    const serialPreviousPurchaseIdColumn = this.pickColumn(serialColumns, ['previousPurchaseId', 'previous_purchase_id']);

    if (!serialNumber) {
      return auditFailure('serialNumber is required');
    }
    if (!Number.isFinite(salesId) || salesId <= 0) {
      return auditFailure('salesId must be a valid number');
    }
    if (branchId !== null && (!Number.isFinite(branchId) || branchId <= 0)) {
      return auditFailure('branchId must be a valid number');
    }

    const serialNumberColumn = this.pickColumn(serialColumns, [
      'serialNumber',
      'serial_number',
    ]);
    const serialSalesIdColumn = this.pickColumn(serialColumns, ['salesId', 'sales_id']);
    const serialBranchIdColumn = this.pickColumn(serialColumns, ['branchId', 'branch_id']);
    const serialStatusColumn = this.pickColumn(serialColumns, ['status']);
    const serialCreatedByColumn = this.pickColumn(serialColumns, [
      'created_by',
      'createdBy',
      'createdby',
    ]);

    if (!serialNumberColumn) {
      return auditFailure('Serial number column is not configured in tblserial_numbers');
    }

    if (!serialSalesIdColumn) {
      return auditFailure('Sales reference column is not configured in tblserial_numbers');
    }

    const serialResult = await this.databaseService.query<SerialScanRow>(
      `SELECT
        sn.id,
        COALESCE(to_jsonb(sn)->>'serialNumber', to_jsonb(sn)->>'serial_number', null) AS "serialNumber",
        COALESCE(to_jsonb(sn)->>'status', null) AS status,
        COALESCE(to_jsonb(sn)->>'salesId', to_jsonb(sn)->>'sales_id', null) AS "salesId",
        COALESCE(
          to_jsonb(sn)->>'purchaseId',
          to_jsonb(sn)->>'purchase_id',
          to_jsonb(sn)->>'po_id',
          to_jsonb(sn)->>'purchaseOrderId',
          to_jsonb(sn)->>'purchase_order_id',
          null
        ) AS "purchaseId",
        COALESCE(to_jsonb(sn)->>'productId', to_jsonb(sn)->>'product_id', null) AS "productId",
        COALESCE(to_jsonb(sn)->>'capacityId', to_jsonb(sn)->>'capacity_id', null) AS "capacityId",
        COALESCE(to_jsonb(sn)->>'branchId', to_jsonb(sn)->>'branch_id', null) AS "branchId",
        COALESCE(to_jsonb(sn)->>'unitType', to_jsonb(sn)->>'unit_type', null) AS "unitType",
        COALESCE(
          to_jsonb(p)->>'productName',
          to_jsonb(p)->>'product_name',
          to_jsonb(p)->>'productname'
        ) AS "productName",
        COALESCE(to_jsonb(p)->>'unit', null) AS unit,
        COALESCE(to_jsonb(c)->>'capacity', null) AS capacity,
        COALESCE((to_jsonb(sn)->>'isDefective')::boolean, false) AS "isDefective"
      FROM tblserial_numbers sn
      LEFT JOIN tblproducts p
        ON p.id::text = COALESCE(
          to_jsonb(sn)->>'productId',
          to_jsonb(sn)->>'product_id'
        )
      LEFT JOIN tblcapacity c
        ON c.id::text = COALESCE(
          to_jsonb(sn)->>'capacityId',
          to_jsonb(sn)->>'capacity_id'
        )
      WHERE LOWER(
        regexp_replace(
          BTRIM(
            COALESCE(
              to_jsonb(sn)->>'serialNumber',
              to_jsonb(sn)->>'serial_number',
              ''
            )
          ),
          '\\s+',
          ' ',
          'g'
        )
      ) = LOWER($1)
      LIMIT 1`,
      [serialNumber],
    );

    if (serialResult.rowCount === 0) {
      // --- Non-existing serial handling ---
      if (!dto.forceInsert) {
        // Return structured not_found response (soft warning)
        await this.logSerialScanAudit(
          'SERIAL_SCAN_FAILURE',
          'SalesOrder',
          salesId,
          serialNumber,
          'Serial number not found',
          auditMetadata,
          actor,
        );
        return {
          success: false,
          message: 'Serial number not found',
          validationStatus: 'not_found' as ScanSalesOrderValidationStatus,
          item: undefined,
        } as ScanSalesOrderResponse;
      }

      // forceInsert = true: create a new serial record and assign to salesId
      const insertRecord: Record<string, unknown> = {
        [serialNumberColumn]: serialNumber,
        [serialSalesIdColumn]: salesId,
      };

      if (serialStatusColumn) {
        insertRecord[serialStatusColumn] = 'reserved';
      }

      const serialProductIdColumn = this.pickColumn(serialColumns, ['productId', 'product_id']);
      const serialCapacityIdColumn = this.pickColumn(serialColumns, ['capacityId', 'capacity_id']);
      const serialUnitTypeColumn = this.pickColumn(serialColumns, ['unitType', 'unit_type']);

      if (serialProductIdColumn && expectedProductId !== null) {
        insertRecord[serialProductIdColumn] = expectedProductId;
      }
      if (serialCapacityIdColumn && expectedCapacityId !== null) {
        insertRecord[serialCapacityIdColumn] = expectedCapacityId;
      }
      if (serialUnitTypeColumn && expectedUnitType) {
        insertRecord[serialUnitTypeColumn] = expectedUnitType;
      }
      if (serialBranchIdColumn && branchId !== null) {
        insertRecord[serialBranchIdColumn] = branchId;
      }
      if (serialCreatedByColumn && userId !== undefined) {
        insertRecord[serialCreatedByColumn] = userId;
      }

      const insertResult = await this.databaseService.withTransaction(async (client) => {
        const result = await this.runInsert('tblserial_numbers', insertRecord, client);
        if ((result.rowCount ?? 0) > 0) {
          const newSerialId = result.rows[0]?.id;
          await this.serialEventLogService.logEvent(
            {
              serialId: newSerialId,
              serialNumber,
              eventType: 'FORCE_INSERT_SO',
              previousStatus: null,
              newStatus: 'reserved',
              previousSalesId: null,
              newSalesId: salesId,
              previousBranchId: null,
              newBranchId: branchId,
              performedBy: actor?.userId ?? null,
              performedByUsername: actor?.username ?? null,
              ipAddress: actor?.ipAddress ?? null,
            },
            client,
          );
        }
        return result;
      });

      if (insertResult.rowCount === 0) {
        return auditFailure('Unable to create serial number record');
      }

      return auditSuccess({
        success: true,
        message: 'Serial number created and assigned to sales order',
        item: {
          serialNumber,
        },
      });
    }

    const serial = serialResult.rows[0];
    const currentSalesId = Number(serial.salesId);
    const normalizedStatus = String(serial.status ?? '').trim().toLowerCase();
    const reservedStatuses = new Set(['reserved', 'for-delivery', 'sold', 'released', 'out', 'outbound']);

    // Defective check: after serial lookup, before product/capacity mismatch
    if (serial.isDefective && !dto.forceAssign) {
      await this.logSerialScanAudit(
        'SERIAL_SCAN_FAILURE',
        'SalesOrder',
        salesId,
        serialNumber,
        'Serial number is marked as defective',
        auditMetadata,
        actor,
      );
      return {
        success: false,
        validationStatus: 'warning_defective' as ScanSalesOrderValidationStatus,
        message: 'Serial number is marked as defective',
        item: undefined,
      } as ScanSalesOrderResponse;
    }

    // Product/Capacity mismatch check — skip when forceAssign is true
    if (!dto.forceAssign) {
      const productMismatch =
        expectedProductId !== null &&
        Number(serial.productId) !== Number(expectedProductId);
      const capacityMismatch =
        expectedCapacityId !== null &&
        Number(serial.capacityId) !== Number(expectedCapacityId);

      if (productMismatch || capacityMismatch) {
        const expectedProductName = await this.getProductDisplayName(expectedProductId);
        const expectedCapacityName = await this.getCapacityDisplayName(expectedCapacityId);
        const actualProductName = String(serial.productName ?? '').trim() || null;
        const actualCapacityName = String(serial.capacity ?? '').trim() || null;

        const message = productMismatch
          ? await this.buildProductMismatchMessage({
              expectedProductId,
              expectedCapacityId,
              actualProductName,
              actualCapacityName,
              purchaseId: serial.purchaseId,
            })
          : await this.buildCapacityMismatchMessage({
              expectedProductId,
              expectedCapacityId,
              actualProductName,
              actualCapacityName,
              purchaseId: serial.purchaseId,
            });

        await this.logSerialScanAudit(
          'SERIAL_SCAN_FAILURE',
          'SalesOrder',
          salesId,
          serialNumber,
          message,
          auditMetadata,
          actor,
        );

        return {
          success: false,
          message,
          validationStatus: 'warning_mismatch' as const,
          details: {
            expectedProductName: expectedProductName ?? undefined,
            expectedCapacityName: expectedCapacityName ?? undefined,
            actualProductName: actualProductName ?? undefined,
            actualCapacityName: actualCapacityName ?? undefined,
          },
          item: undefined,
        };
      }
    }

    if (expectedUnitType) {
      const scannedUnitType = this.normalizeUnitType(serial.unitType);
      if (scannedUnitType && scannedUnitType !== expectedUnitType) {
        if (!dto.forceCorrectUnitType) {
          const message = `This serial is registered as ${scannedUnitType}, but you are scanning on ${expectedUnitType}.`;

          await this.logSerialScanAudit(
            'SERIAL_SCAN_FAILURE',
            'SalesOrder',
            salesId,
            serialNumber,
            message,
            {
              ...auditMetadata,
              actualUnitType: scannedUnitType,
            },
            actor,
          );

          return {
            success: false,
            message,
            validationStatus: 'error_unit_type_mismatch' as ScanSalesOrderValidationStatus,
            details: {
              expectedUnitType,
              actualUnitType: scannedUnitType,
              serialNumber,
            },
            item: undefined,
          };
        }

        const serialUnitTypeColumn = this.pickColumn(serialColumns, ['unitType', 'unit_type']);
        if (!serialUnitTypeColumn) {
          return auditFailure('Unit type column is not configured in tblserial_numbers');
        }

        const unitTypeUpdateResult = await this.persistSerialUpdateWithEvent(
          serial.id,
          { [serialUnitTypeColumn]: expectedUnitType },
          {
            serialId: serial.id,
            serialNumber: serial.serialNumber ?? serialNumber,
            eventType: 'UNIT_TYPE_CORRECTED',
            previousStatus: serial.status,
            newStatus: serial.status,
            previousSalesId: Number.isFinite(currentSalesId) && currentSalesId > 0 ? currentSalesId : null,
            newSalesId: salesId,
            previousBranchId: serial.branchId ? Number(serial.branchId) : null,
            newBranchId: branchId,
            performedBy: actor?.userId ?? null,
            performedByUsername: actor?.username ?? null,
            ipAddress: actor?.ipAddress ?? null,
          },
        );

        if (unitTypeUpdateResult.rowCount === 0) {
          return auditFailure('Unable to update serial unit type');
        }

        unitTypeCorrectedFrom = scannedUnitType;
        serial.unitType = expectedUnitType;
      }
    }

    // If serial is already assigned to a different SO
    if (Number.isFinite(currentSalesId) && currentSalesId > 0 && currentSalesId !== salesId) {
      if (!dto.forceReassign) {
        // Return structured warning_reassignment response
        const currentSoNumber = await this.getSalesOrderReference(currentSalesId);
        const currentCustomerName = await this.getSalesOrderCustomerName(currentSalesId);

        const message = currentSoNumber
          ? `Serial number is already assigned to ${currentSoNumber}`
          : `Serial number is already assigned to another sales order`;

        await this.logSerialScanAudit(
          'SERIAL_SCAN_FAILURE',
          'SalesOrder',
          salesId,
          serialNumber,
          message,
          auditMetadata,
          actor,
        );

        return {
          success: false,
          message,
          validationStatus: 'warning_reassignment' as ScanSalesOrderValidationStatus,
          details: {
            currentCustomerName: currentCustomerName ?? undefined,
            currentSoNumber: currentSoNumber ?? undefined,
            currentSalesId,
          },
          item: undefined,
        } as ScanSalesOrderResponse;
      }

      // forceReassign = true: proceed with reassignment
      const reassignUpdateRecord: Record<string, unknown> = {
        [serialSalesIdColumn]: salesId,
      };
      if (serialPreviousSalesIdColumn) {
        reassignUpdateRecord[serialPreviousSalesIdColumn] = currentSalesId;
      }
      if (serialStatusColumn) {
        reassignUpdateRecord[serialStatusColumn] = 'reserved';
      }
      if (serialBranchIdColumn && branchId !== null) {
        reassignUpdateRecord[serialBranchIdColumn] = branchId;
      }
      if (serialCreatedByColumn && userId !== undefined) {
        reassignUpdateRecord[serialCreatedByColumn] = userId;
      }

      const reassignResult = await this.persistSerialUpdateWithEvent(
        serial.id,
        reassignUpdateRecord,
        {
          serialId: serial.id,
          serialNumber: serial.serialNumber ?? serialNumber,
          eventType: 'ASSIGNED_TO_SO',
          previousStatus: serial.status,
          newStatus: 'reserved',
          previousSalesId: currentSalesId,
          newSalesId: salesId,
          previousBranchId: serial.branchId ? Number(serial.branchId) : null,
          newBranchId: branchId,
          performedBy: actor?.userId ?? null,
          performedByUsername: actor?.username ?? null,
          ipAddress: actor?.ipAddress ?? null,
        },
      );

      if (reassignResult.rowCount === 0) {
        return auditFailure('Unable to update serial number for sales order');
      }

      return auditSuccess({
        success: true,
        message: 'Serial number reassigned to sales order',
        item: {
          ...serial,
          salesId: String(salesId),
          status: 'reserved',
          branchId: branchId !== null ? String(branchId) : serial.branchId,
        },
      });
    }

    if (reservedStatuses.has(normalizedStatus) && currentSalesId === salesId) {
      return auditSuccess({
        success: true,
        message: 'Serial number already scanned for this sales order',
        item: serial,
      });
    }

    // --- Scanned-status serial acceptance (step 6 in pipeline) ---
    // If the serial has status "scanned" and a non-null purchaseId, it was scanned for a PO
    // that hasn't been approved yet. Reassign it to this SO with an informational response.
    const serialPurchaseId = this.toOptionalNumber(serial.purchaseId);
    if (normalizedStatus === 'scanned' && serialPurchaseId !== null && serialPurchaseId > 0) {
      const serialPurchaseIdColumn = this.pickColumn(serialColumns, [
        'purchaseId',
        'purchase_id',
        'po_id',
        'purchaseOrderId',
        'purchase_order_id',
      ]);

      const scannedUpdateRecord: Record<string, unknown> = {
        [serialSalesIdColumn]: salesId,
      };
      if (serialStatusColumn) {
        scannedUpdateRecord[serialStatusColumn] = 'reserved';
      }
      if (serialPreviousPurchaseIdColumn) {
        scannedUpdateRecord[serialPreviousPurchaseIdColumn] = serialPurchaseId;
      }
      // Clear the purchaseId since the serial is now assigned to an SO
      if (serialPurchaseIdColumn) {
        scannedUpdateRecord[serialPurchaseIdColumn] = null;
      }
      if (serialBranchIdColumn && branchId !== null) {
        scannedUpdateRecord[serialBranchIdColumn] = branchId;
      }
      if (serialCreatedByColumn && userId !== undefined) {
        scannedUpdateRecord[serialCreatedByColumn] = userId;
      }

      const scannedUpdateResult = await this.persistSerialUpdateWithEvent(
        serial.id,
        scannedUpdateRecord,
        {
          serialId: serial.id,
          serialNumber: serial.serialNumber ?? serialNumber,
          eventType: 'ASSIGNED_TO_SO',
          previousStatus: serial.status,
          newStatus: 'reserved',
          previousSalesId: Number.isFinite(currentSalesId) && currentSalesId > 0 ? currentSalesId : null,
          newSalesId: salesId,
          previousBranchId: serial.branchId ? Number(serial.branchId) : null,
          newBranchId: branchId,
          performedBy: actor?.userId ?? null,
          performedByUsername: actor?.username ?? null,
          ipAddress: actor?.ipAddress ?? null,
        },
      );

      if (scannedUpdateResult.rowCount === 0) {
        return auditFailure('Unable to update serial number for sales order');
      }

      // Fetch PO number for the response details
      const previousPoNumber = await this.getPurchaseOrderReference(serialPurchaseId);

      await this.logSerialScanAudit(
        'SERIAL_SCAN_SUCCESS',
        'SalesOrder',
        salesId,
        serialNumber,
        'Serial reassigned from pending PO',
        { ...auditMetadata, previousPurchaseId: serialPurchaseId, previousPoNumber },
        actor,
      );

      return {
        success: true,
        message: 'Serial reassigned from pending PO',
        validationStatus: 'info_scanned_status' as const,
        details: {
          previousPoNumber: previousPoNumber ?? undefined,
          previousPurchaseId: serialPurchaseId,
        },
        item: {
          ...serial,
          salesId: String(salesId),
          status: 'reserved',
          branchId: branchId !== null ? String(branchId) : serial.branchId,
        },
      } as ScanSalesOrderResponse;
    }

    // If serial is being reassigned to a new SO (after transfer), set previousSalesId
    const updateRecord: Record<string, unknown> = {
      [serialSalesIdColumn]: salesId,
    };
    if (serialPreviousSalesIdColumn && Number.isFinite(currentSalesId) && currentSalesId > 0 && currentSalesId !== salesId) {
      updateRecord[serialPreviousSalesIdColumn] = currentSalesId;
    }
    if (serialBranchIdColumn && branchId !== null) {
      updateRecord[serialBranchIdColumn] = branchId;
    }
    if (serialStatusColumn) {
      updateRecord[serialStatusColumn] = 'reserved';
    }
    if (serialCreatedByColumn && userId !== undefined) {
      updateRecord[serialCreatedByColumn] = userId;
    }

    const updateResult = await this.persistSerialUpdateWithEvent(
      serial.id,
      updateRecord,
      {
        serialId: serial.id,
        serialNumber: serial.serialNumber ?? serialNumber,
        eventType: 'ASSIGNED_TO_SO',
        previousStatus: serial.status,
        newStatus: 'reserved',
        previousSalesId: Number.isFinite(currentSalesId) && currentSalesId > 0 ? currentSalesId : null,
        newSalesId: salesId,
        previousBranchId: serial.branchId ? Number(serial.branchId) : null,
        newBranchId: branchId,
        performedBy: actor?.userId ?? null,
        performedByUsername: actor?.username ?? null,
        ipAddress: actor?.ipAddress ?? null,
      },
    );

    if (updateResult.rowCount === 0) {
      return auditFailure('Unable to update serial number for sales order');
    }

    return auditSuccess({
      success: true,
      message: unitTypeCorrectedFrom
        ? `Serial unit type corrected from ${unitTypeCorrectedFrom} to ${expectedUnitType} and assigned to this sales order`
        : 'Serial number scanned successfully',
      item: {
        ...serial,
        salesId: String(salesId),
        status: 'reserved',
        unitType: expectedUnitType || serial.unitType,
        branchId: branchId !== null ? String(branchId) : serial.branchId,
      },
    });
  }

  async scanSalesOrderBatch(dto: ScanSalesOrderBatchDto, actor?: AuditActorContext) {
    const items = Array.isArray(dto.items) ? dto.items : [];
    const auditMetadata = { event: 'scanSalesOrderBatch' };
    if (items.length === 0) {
      return {
        success: false,
        message: 'At least one serial scan item is required',
        items: [],
      };
    }

    const results: Array<{
      serialNumber: string;
      success: boolean;
      message?: string;
      validationStatus?: string;
      details?: Record<string, unknown>;
      item?: {
        serialNumber?: string | null;
      };
    }> = [];

    for (const entry of items) {
      const payload = {
        serialNumber: entry.serialNumber,
        salesId: entry.salesId,
        ...(entry.branchId === null || entry.branchId === undefined
          ? {}
          : { branchId: entry.branchId }),
        ...(entry.expectedProductId === null || entry.expectedProductId === undefined
          ? {}
          : { expectedProductId: entry.expectedProductId }),
        ...(entry.expectedCapacityId === null || entry.expectedCapacityId === undefined
          ? {}
          : { expectedCapacityId: entry.expectedCapacityId }),
        ...(entry.expectedUnitType === null || entry.expectedUnitType === undefined
          ? {}
          : { expectedUnitType: entry.expectedUnitType }),
        ...(entry.forceAssign ? { forceAssign: true } : {}),
        ...(entry.forceInsert ? { forceInsert: true } : {}),
        ...(entry.forceReassign ? { forceReassign: true } : {}),
        ...(entry.forceCorrectUnitType ? { forceCorrectUnitType: true } : {}),
      };

      try {
        const result = await this.scanSalesOrder(payload, actor) as {
          success: boolean;
          message: string;
          validationStatus?: string;
          details?: Record<string, unknown>;
          item?: { serialNumber?: string | null };
        };
        results.push({
          serialNumber: this.normalizeSerialNumber(entry.serialNumber),
          success: Boolean(result.success),
          message: result.message,
          validationStatus: result.validationStatus,
          details: result.details,
          item: {
            serialNumber: result.item?.serialNumber ?? null,
          },
        });

        // File-based scan log for backup
        this.scanFileLogger.logSalesScan({
          serialNumber: this.normalizeSerialNumber(entry.serialNumber),
          productId: entry.expectedProductId ? Number(entry.expectedProductId) : null,
          capacityId: entry.expectedCapacityId ? Number(entry.expectedCapacityId) : null,
          unitType: entry.expectedUnitType ?? null,
          salesId: Number(entry.salesId) || null,
          soNumber: null,
          success: Boolean(result.success),
          message: result.message,
          userId: actor?.userId ?? null,
        });
      } catch (error: unknown) {
        const message =
          error instanceof Error
            ? error.message
            : 'Internal Server Error while scanning serial number';
        await this.logSerialScanAudit(
          'SERIAL_SCAN_ERROR',
          'SalesOrder',
          entry.salesId,
          this.normalizeSerialNumber(entry.serialNumber),
          message,
          {
            ...auditMetadata,
            event: 'scanSalesOrderBatch',
          },
          actor,
        );
        results.push({
          serialNumber: this.normalizeSerialNumber(entry.serialNumber),
          success: false,
          message,
          item: {
            serialNumber: null,
          },
        });
      }
    }

    const successCount = results.filter((entry) => entry.success).length;
    const warningCount = results.filter(
      (entry) =>
        !entry.success &&
        entry.validationStatus &&
        (entry.validationStatus.startsWith('warning_') ||
          entry.validationStatus === 'not_found' ||
          entry.validationStatus === 'error_unit_type_mismatch'),
    ).length;
    // failureCount excludes validation warnings (those are handled by frontend modals)
    const failureCount = results.length - successCount - warningCount;

    return {
      success: failureCount === 0,
      message:
        failureCount === 0
          ? `Successfully scanned ${successCount} serial number${successCount === 1 ? '' : 's'}`
          : `Scanned ${successCount} serial number${successCount === 1 ? '' : 's'} with ${failureCount} failure${failureCount === 1 ? '' : 's'}`,
      summary: {
        total: results.length,
        successCount,
        failureCount,
        warningCount,
      },
      items: results,
    };
  }

  async scanPurchaseOrder(dto: ScanPurchaseOrderDto, actor?: AuditActorContext, branchIdInput?: number, trackPreviousPurchase?: boolean) {
    const serialNumber = this.normalizeSerialNumber(dto.serialNumber);
    const purchaseId = Number(dto.purchaseId);
    const requestBranchId =
      branchIdInput === undefined || branchIdInput === null
        ? dto.branchId === undefined || dto.branchId === null || dto.branchId === ('' as unknown)
          ? null
          : Number(dto.branchId)
        : Number(branchIdInput);
    const expectedProductId =
      dto.expectedProductId === null ||
      dto.expectedProductId === undefined ||
      dto.expectedProductId === ('' as unknown)
        ? null
        : Number(dto.expectedProductId);
    const expectedCapacityId =
      dto.expectedCapacityId === null ||
      dto.expectedCapacityId === undefined ||
      dto.expectedCapacityId === ('' as unknown)
        ? null
        : Number(dto.expectedCapacityId);
    const unitType = this.normalizeUnitType(dto.unitType ?? 'set') || 'set';
    const userId = actor?.userId ?? undefined;

    const auditMetadata = {
      requestBranchId,
      expectedProductId,
      expectedCapacityId,
      unitType,
      event: 'scanPurchaseOrder',
    };

    const auditFailure = async (message: string) => {
      await this.logSerialScanAudit(
        'SERIAL_SCAN_FAILURE',
        'PurchaseOrder',
        purchaseId,
        serialNumber,
        message,
        auditMetadata,
        actor,
      );
      return { success: false, message, item: undefined };
    };

    const auditSuccess = async (result: { success: true; message: string; item?: { serialNumber?: string | null; unitType?: string | null } }) => {
      await this.logSerialScanAudit(
        'SERIAL_SCAN_SUCCESS',
        'PurchaseOrder',
        purchaseId,
        serialNumber,
        result.message,
        auditMetadata,
        actor,
      );
      return result;
    };

    if (!serialNumber) {
      return auditFailure('serialNumber is required');
    }
    if (!Number.isFinite(purchaseId) || purchaseId <= 0) {
      return auditFailure('purchaseId must be a valid number');
    }
    if (requestBranchId !== null && (!Number.isFinite(requestBranchId) || requestBranchId <= 0)) {
      return auditFailure('branchId must be a valid number');
    }

    let purchaseBranchIdRaw: string | null = null;
    const purchaseBranchSourceTables = ['tblpurchase_orders', 'tblpo'];

    for (const tableName of purchaseBranchSourceTables) {
      try {
        const purchaseBranchResult = await this.databaseService.query<{ branchId: string | null }>(
          `SELECT
             COALESCE(to_jsonb(po)->>'branchId', to_jsonb(po)->>'branch_id', null) AS "branchId"
           FROM ${tableName} po
           WHERE po.id::text = $1
           LIMIT 1`,
          [String(purchaseId)],
        );

        if (purchaseBranchResult.rowCount > 0) {
          purchaseBranchIdRaw = purchaseBranchResult.rows[0]?.branchId ?? null;
          break;
        }
      } catch (error: unknown) {
        const errorCode =
          typeof error === 'object' && error !== null && 'code' in error
            ? String((error as { code?: unknown }).code ?? '')
            : '';

        if (errorCode === '42P01') {
          continue;
        }

        throw error;
      }
    }

    const purchaseBranchId =
      purchaseBranchIdRaw === null || purchaseBranchIdRaw === undefined || purchaseBranchIdRaw === ''
        ? null
        : Number(purchaseBranchIdRaw);
    const branchId = requestBranchId ??
      (Number.isFinite(purchaseBranchId) && (purchaseBranchId as number) > 0
        ? (purchaseBranchId as number)
        : null);

    const serialColumns = await this.getTableColumns('tblserial_numbers');
    const serialNumberColumn = this.pickColumn(serialColumns, [
      'serialNumber',
      'serial_number',
    ]);
    const serialPurchaseIdColumn = this.pickColumn(serialColumns, [
      'purchaseId',
      'purchase_id',
      'po_id',
      'purchaseOrderId',
      'purchase_order_id',
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
    const serialUnitTypeColumn = this.pickColumn(serialColumns, ['unitType', 'unit_type']);
    const serialBranchIdColumn = this.pickColumn(serialColumns, ['branchId', 'branch_id']);
    const serialStatusColumn = this.pickColumn(serialColumns, ['status']);
    const serialCreatedByColumn = this.pickColumn(serialColumns, [
      'created_by',
      'createdBy',
      'createdby',
    ]);
    const serialPreviousPurchaseIdColumn = this.pickColumn(serialColumns, [
      'previousPurchaseId',
      'previous_purchase_id',
    ]);

    if (!serialNumberColumn) {
      return {
        success: false,
        message: 'Serial number column is not configured in tblserial_numbers',
      };
    }

    const serialResult = await this.databaseService.query<SerialScanRow & { purchaseId: string | null; unitType: string | null }>(
      `SELECT
        sn.id,
        COALESCE(to_jsonb(sn)->>'serialNumber', to_jsonb(sn)->>'serial_number') AS "serialNumber",
        COALESCE(to_jsonb(sn)->>'status', null) AS status,
        COALESCE(to_jsonb(sn)->>'salesId', to_jsonb(sn)->>'sales_id', null) AS "salesId",
        COALESCE(
          to_jsonb(sn)->>'purchaseId',
          to_jsonb(sn)->>'purchase_id',
          to_jsonb(sn)->>'po_id',
          to_jsonb(sn)->>'purchaseOrderId',
          to_jsonb(sn)->>'purchase_order_id',
          null
        ) AS "purchaseId",
        COALESCE(to_jsonb(sn)->>'productId', to_jsonb(sn)->>'product_id', null) AS "productId",
        COALESCE(to_jsonb(sn)->>'capacityId', to_jsonb(sn)->>'capacity_id', null) AS "capacityId",
        COALESCE(to_jsonb(sn)->>'branchId', to_jsonb(sn)->>'branch_id', null) AS "branchId",
        COALESCE(to_jsonb(sn)->>'unitType', to_jsonb(sn)->>'unit_type', null) AS "unitType",
        COALESCE(
          to_jsonb(p)->>'productName',
          to_jsonb(p)->>'product_name',
          to_jsonb(p)->>'productname'
        ) AS "productName",
        COALESCE(to_jsonb(p)->>'unit', null) AS unit,
        COALESCE(to_jsonb(c)->>'capacity', null) AS capacity
      FROM tblserial_numbers sn
      LEFT JOIN tblproducts p
        ON p.id::text = COALESCE(
          to_jsonb(sn)->>'productId',
          to_jsonb(sn)->>'product_id'
        )
      LEFT JOIN tblcapacity c
        ON c.id::text = COALESCE(
          to_jsonb(sn)->>'capacityId',
          to_jsonb(sn)->>'capacity_id'
        )
      WHERE LOWER(
        regexp_replace(
          BTRIM(
            COALESCE(
              to_jsonb(sn)->>'serialNumber',
              to_jsonb(sn)->>'serial_number',
              ''
            )
          ),
          '\\s+',
          ' ',
          'g'
        )
      ) = LOWER($1)
      LIMIT 1`,
      [serialNumber],
    );

    if (serialResult.rowCount === 0) {
      if (expectedProductId === null || !Number.isFinite(expectedProductId) || expectedProductId <= 0) {
        return auditFailure(
          'Serial number not found. expectedProductId is required to create a new serial for purchase order.',
        );
      }

      if (expectedCapacityId === null || !Number.isFinite(expectedCapacityId) || expectedCapacityId <= 0) {
        return auditFailure(
          'Serial number not found. expectedCapacityId is required to create a new serial for purchase order.',
        );
      }

      const productExistsResult = await this.databaseService.query<{ id: number }>(
        `SELECT id
         FROM tblproducts
         WHERE id::text = $1
         LIMIT 1`,
        [String(expectedProductId)],
      );

      if (productExistsResult.rowCount === 0) {
        return auditFailure(`Product ID ${expectedProductId} does not exist`);
      }

      const capacityExistsResult = await this.databaseService.query<{ id: number }>(
        `SELECT id
         FROM tblcapacity
         WHERE id::text = $1
         LIMIT 1`,
        [String(expectedCapacityId)],
      );

      if (capacityExistsResult.rowCount === 0) {
        return auditFailure(`Capacity ID ${expectedCapacityId} does not exist`);
      }

      const existingBySerialResult = await this.databaseService.query<{ id: number }>(
        `SELECT sn.id
         FROM tblserial_numbers sn
         WHERE LOWER(
           regexp_replace(
             BTRIM(
               COALESCE(
                 to_jsonb(sn)->>'serialNumber',
                 to_jsonb(sn)->>'serial_number',
                 ''
               )
             ),
             '\\s+',
             ' ',
             'g'
           )
         ) = LOWER($1)
         LIMIT 1`,
        [serialNumber],
      );

      let createdId: number | null = null;
      if (existingBySerialResult.rowCount === 0) {
        const serialRecord: Record<string, unknown> = {
          [serialNumberColumn]: serialNumber,
        };
        if (serialPurchaseIdColumn) {
          serialRecord[serialPurchaseIdColumn] = purchaseId;
        }
        if (serialSalesIdColumn) {
          serialRecord[serialSalesIdColumn] = null;
        }
        if (serialProductIdColumn) {
          serialRecord[serialProductIdColumn] = expectedProductId;
        }
        if (serialCapacityIdColumn) {
          serialRecord[serialCapacityIdColumn] = expectedCapacityId;
        }
        if (serialUnitTypeColumn) {
          serialRecord[serialUnitTypeColumn] = unitType;
        }
        if (serialBranchIdColumn && branchId !== null) {
          serialRecord[serialBranchIdColumn] = branchId;
        }
        if (serialStatusColumn) {
          serialRecord[serialStatusColumn] = 'scanned';
        }
        if (serialCreatedByColumn) {
          serialRecord[serialCreatedByColumn] = userId ?? null;
        }

        const insertResult = await this.runInsert('tblserial_numbers', serialRecord);
        createdId = insertResult.rows[0]?.id ?? null;
      }

      if (!createdId) {
        return this.scanPurchaseOrder(dto, actor, branchId ?? undefined, trackPreviousPurchase);
      }

      const createdResult = await this.databaseService.query<
        SerialScanRow & { purchaseId: string | null; unitType: string | null }
      >(
        `SELECT
           sn.id,
           COALESCE(to_jsonb(sn)->>'serialNumber', to_jsonb(sn)->>'serial_number') AS "serialNumber",
           COALESCE(to_jsonb(sn)->>'status', null) AS status,
           COALESCE(to_jsonb(sn)->>'salesId', to_jsonb(sn)->>'sales_id', null) AS "salesId",
           COALESCE(
             to_jsonb(sn)->>'purchaseId',
             to_jsonb(sn)->>'purchase_id',
             to_jsonb(sn)->>'po_id',
             to_jsonb(sn)->>'purchaseOrderId',
             to_jsonb(sn)->>'purchase_order_id',
             null
           ) AS "purchaseId",
           COALESCE(to_jsonb(sn)->>'productId', to_jsonb(sn)->>'product_id', null) AS "productId",
           COALESCE(to_jsonb(sn)->>'capacityId', to_jsonb(sn)->>'capacity_id', null) AS "capacityId",
           COALESCE(to_jsonb(sn)->>'branchId', to_jsonb(sn)->>'branch_id', null) AS "branchId",
           COALESCE(to_jsonb(sn)->>'unitType', to_jsonb(sn)->>'unit_type', null) AS "unitType",
           null::text AS "productName",
           null::text AS unit,
           null::text AS capacity
         FROM tblserial_numbers sn
         WHERE sn.id = $1
         LIMIT 1`,
        [createdId],
      );

      if (createdResult.rowCount === 0) {
        return auditFailure('Serial number was created but cannot be retrieved');
      }

      const created = createdResult.rows[0];

      await this.serialEventLogService.logEvent({
        serialId: createdId,
        serialNumber: serialNumber,
        eventType: 'SCANNED_IN_PO',
        previousStatus: null,
        newStatus: 'scanned',
        previousPurchaseId: null,
        newPurchaseId: purchaseId,
        previousBranchId: null,
        newBranchId: branchId,
        performedBy: actor?.userId ?? null,
        performedByUsername: actor?.username ?? null,
        ipAddress: actor?.ipAddress ?? null,
      });

      return auditSuccess({
        success: true,
        message: 'Serial number created and scanned successfully',
        item: {
          ...created,
          purchaseId: String(purchaseId),
          salesId: null,
          status: 'scanned',
          branchId: branchId !== null ? String(branchId) : created.branchId,
          unitType,
        },
      });
    }

    const serial = serialResult.rows[0];
    const currentPurchaseId = Number(serial.purchaseId);
    const currentSalesId = Number(serial.salesId);
    const normalizedStatus = String(serial.status ?? '').trim().toLowerCase();

    if (
      expectedProductId !== null &&
      Number(serial.productId) !== Number(expectedProductId)
    ) {
      return {
        success: false,
        message: await this.buildProductMismatchMessage({
          expectedProductId,
          expectedCapacityId,
          actualProductName: serial.productName,
          actualCapacityName: serial.capacity,
          purchaseId: serial.purchaseId,
        }),
      };
    }

    if (
      expectedCapacityId !== null &&
      Number(serial.capacityId) !== Number(expectedCapacityId)
    ) {
      return {
        success: false,
        message: await this.buildCapacityMismatchMessage({
          expectedProductId,
          expectedCapacityId,
          actualProductName: serial.productName,
          actualCapacityName: serial.capacity,
          purchaseId: serial.purchaseId,
        }),
      };
    }

    if (Number.isFinite(currentSalesId) && currentSalesId > 0) {
      const salesReference = await this.getSalesOrderReference(currentSalesId);
      return auditFailure(
        salesReference
          ? `Serial number is already assigned to ${salesReference}`
          : `Serial number is already assigned to sales order #${currentSalesId}`,
      );
    }

    if (
      Number.isFinite(currentPurchaseId) &&
      currentPurchaseId > 0 &&
      currentPurchaseId !== purchaseId
    ) {
      if (!trackPreviousPurchase) {
        const purchaseReference = await this.getPurchaseOrderReference(currentPurchaseId);
        return auditFailure(
          purchaseReference
            ? `Serial number is already linked to ${purchaseReference}`
            : `Serial number is already linked to purchase order #${currentPurchaseId}`,
        );
      }
    }

    if (['sold', 'released', 'out', 'outbound'].includes(normalizedStatus)) {
      return auditFailure(`Serial number cannot be used with status '${normalizedStatus || 'unknown'}'`);
    }

    if (currentPurchaseId === purchaseId) {
      const currentUnitType = this.normalizeUnitType(serial.unitType);
      if (currentUnitType === unitType.toLowerCase()) {
        return auditSuccess({
          success: true,
          message: 'Serial number already scanned for this purchase order',
          item: {
            ...serial,
            unitType: currentUnitType,
          },
        });
      }

      return auditFailure(`Serial number already scanned under unit type '${currentUnitType || 'unknown'}'`);
    }

    const updateRecord: Record<string, unknown> = {};
    if (serialPurchaseIdColumn) {
      updateRecord[serialPurchaseIdColumn] = purchaseId;
    }
    if (serialSalesIdColumn) {
      updateRecord[serialSalesIdColumn] = null;
    }
    if (serialProductIdColumn && expectedProductId !== null) {
      updateRecord[serialProductIdColumn] = expectedProductId;
    }
    if (serialCapacityIdColumn && expectedCapacityId !== null) {
      updateRecord[serialCapacityIdColumn] = expectedCapacityId;
    }
    if (serialUnitTypeColumn) {
      updateRecord[serialUnitTypeColumn] = unitType;
    }
    if (serialBranchIdColumn && branchId !== null) {
      updateRecord[serialBranchIdColumn] = branchId;
    }
    if (serialStatusColumn) {
      updateRecord[serialStatusColumn] = 'scanned';
    }
    if (serialCreatedByColumn) {
      updateRecord[serialCreatedByColumn] = userId ?? null;
    }

    if (
      trackPreviousPurchase &&
      serialPreviousPurchaseIdColumn &&
      Number.isFinite(currentPurchaseId) &&
      currentPurchaseId > 0 &&
      currentPurchaseId !== purchaseId
    ) {
      updateRecord[serialPreviousPurchaseIdColumn] = currentPurchaseId;
    }

    const updateResult = await this.runUpdateById(
      'tblserial_numbers',
      serial.id,
      updateRecord,
    );

    if (updateResult.rowCount === 0) {
      return auditFailure('Unable to update serial number for purchase order');
    }

    await this.serialEventLogService.logEvent({
      serialId: serial.id,
      serialNumber: serialNumber,
      eventType: 'SCANNED_IN_PO',
      previousStatus: serial.status,
      newStatus: 'scanned',
      previousPurchaseId: Number.isFinite(currentPurchaseId) && currentPurchaseId > 0 ? currentPurchaseId : null,
      newPurchaseId: purchaseId,
      previousBranchId: serial.branchId ? Number(serial.branchId) : null,
      newBranchId: branchId,
      performedBy: actor?.userId ?? null,
      performedByUsername: actor?.username ?? null,
      ipAddress: actor?.ipAddress ?? null,
    });

    return auditSuccess({
      success: true,
      message: 'Serial number scanned successfully',
      item: {
        ...serial,
        purchaseId: String(purchaseId),
        salesId: null,
        status: 'scanned',
        branchId: branchId !== null ? String(branchId) : serial.branchId,
        unitType,
      },
    });
  }

  async scanPurchaseOrderBatch(dto: ScanPurchaseOrderBatchDto, actor?: AuditActorContext, branchIdInput?: number) {
    const items = Array.isArray(dto.items) ? dto.items : [];
    if (items.length === 0) {
      return {
        success: false,
        message: 'At least one serial scan item is required',
        items: [],
      };
    }

    const results: Array<{
      serialNumber: string;
      success: boolean;
      message?: string;
      item?: {
        serialNumber?: string | null;
        unitType?: string | null;
      };
    }> = [];

    for (const entry of items) {
      const payload: ScanPurchaseOrderBatchItemDto = {
        serialNumber: entry.serialNumber,
        purchaseId: entry.purchaseId,
        branchId: entry.branchId,
        expectedProductId: entry.expectedProductId,
        expectedCapacityId: entry.expectedCapacityId,
        unitType: entry.unitType,
      };

      try {
        const result = await this.scanPurchaseOrder(payload, actor, branchIdInput, dto.trackPreviousPurchase);
        results.push({
          serialNumber: this.normalizeSerialNumber(entry.serialNumber),
          success: Boolean(result.success),
          message: result.message,
          item: {
            serialNumber: result.item?.serialNumber ?? null,
            unitType: result.item?.unitType ?? entry.unitType ?? null,
          },
        });

        // File-based scan log for backup
        this.scanFileLogger.logPurchaseScan({
          serialNumber: this.normalizeSerialNumber(entry.serialNumber),
          productId: entry.expectedProductId ? Number(entry.expectedProductId) : null,
          capacityId: entry.expectedCapacityId ? Number(entry.expectedCapacityId) : null,
          unitType: entry.unitType ?? null,
          purchaseId: Number(entry.purchaseId) || null,
          poNumber: null,
          success: Boolean(result.success),
          message: result.message,
          userId: actor?.userId ?? null,
        });
      } catch (error: unknown) {
        await this.logSerialScanAudit(
          'SERIAL_SCAN_ERROR',
          'PurchaseOrder',
          Number(entry.purchaseId) || 0,
          this.normalizeSerialNumber(entry.serialNumber),
          `Unexpected error during purchase order batch scan: ${error instanceof Error ? error.message : String(error)}`,
          {
            requestBranchId: entry.branchId,
            expectedProductId: entry.expectedProductId,
            expectedCapacityId: entry.expectedCapacityId,
            unitType: entry.unitType,
            event: 'scanPurchaseOrderBatch',
          },
          actor,
        );

        results.push({
          serialNumber: this.normalizeSerialNumber(entry.serialNumber),
          success: false,
          message:
            error instanceof Error
              ? error.message
              : 'Internal Server Error while scanning serial number',
          item: {
            serialNumber: null,
            unitType: entry.unitType ?? null,
          },
        });
      }
    }

    const successCount = results.filter((entry) => entry.success).length;
    const failureCount = results.length - successCount;

    return {
      success: failureCount === 0,
      message:
        failureCount === 0
          ? `Successfully scanned ${successCount} serial number${successCount === 1 ? '' : 's'}`
          : `Scanned ${successCount} serial number${successCount === 1 ? '' : 's'} with ${failureCount} failure${failureCount === 1 ? '' : 's'}`,
      summary: {
        total: results.length,
        successCount,
        failureCount,
      },
      items: results,
    };
  }

  async removePurchaseOrderSerial(
    dto: RemovePurchaseOrderSerialDto,
    auditActor?: AuditActorContext,
  ) {
    const serialNumber = this.normalizeSerialNumber(dto.serialNumber);
    const purchaseId = Number(dto.purchaseId);
    const unitType = this.normalizeUnitType(dto.unitType);

    if (!serialNumber) {
      return { success: false, message: 'serialNumber is required' };
    }

    if (!Number.isFinite(purchaseId) || purchaseId <= 0) {
      return { success: false, message: 'purchaseId must be a valid number' };
    }

    const serialColumns = await this.getTableColumns('tblserial_numbers');
    const serialPurchaseIdColumn = this.pickColumn(serialColumns, [
      'purchaseId',
      'purchase_id',
      'po_id',
      'purchaseOrderId',
      'purchase_order_id',
    ]);
    if (!serialPurchaseIdColumn) {
      return {
        success: false,
        message: 'Purchase reference column is not configured in tblserial_numbers',
      };
    }

    const existingResult = await this.databaseService.query<{
      id: number;
      salesId: string | null;
      purchaseId: string | null;
      unitType: string | null;
    }>(
      `SELECT
         sn.id,
         COALESCE(to_jsonb(sn)->>'salesId', to_jsonb(sn)->>'sales_id', null) AS "salesId",
        COALESCE(
          to_jsonb(sn)->>'purchaseId',
          to_jsonb(sn)->>'purchase_id',
          to_jsonb(sn)->>'po_id',
          to_jsonb(sn)->>'purchaseOrderId',
          to_jsonb(sn)->>'purchase_order_id',
          null
        ) AS "purchaseId",
         COALESCE(to_jsonb(sn)->>'unitType', to_jsonb(sn)->>'unit_type', null) AS "unitType"
       FROM tblserial_numbers sn
       WHERE LOWER(
         regexp_replace(
           BTRIM(
             COALESCE(
               to_jsonb(sn)->>'serialNumber',
               to_jsonb(sn)->>'serial_number',
               ''
             )
           ),
           '\\s+',
           ' ',
           'g'
         )
       ) = LOWER($1)
       LIMIT 1`,
      [serialNumber],
    );

    if (existingResult.rowCount === 0) {
      return { success: false, message: 'Serial number not found' };
    }

    const existing = existingResult.rows[0];
    const existingPurchaseId = Number(existing.purchaseId);
    const existingSalesId = Number(existing.salesId);
    const existingUnitType = this.normalizeUnitType(existing.unitType);

    if (!Number.isFinite(existingPurchaseId) || existingPurchaseId !== purchaseId) {
      return {
        success: false,
        message: 'Serial number is not linked to this purchase order',
      };
    }

    if (Number.isFinite(existingSalesId) && existingSalesId > 0) {
      return {
        success: false,
        message: `Serial number is linked to salesId ${existingSalesId} and cannot be deleted`,
      };
    }

    if (unitType && existingUnitType && unitType !== existingUnitType) {
      return {
        success: false,
        message: `Serial number belongs to unit type '${existingUnitType}'`,
      };
    }

    const deleteResult = await this.databaseService.query<{ id: number }>(
      `DELETE FROM tblserial_numbers
       WHERE id = $1
       RETURNING id`,
      [existing.id],
    );

    if (deleteResult.rowCount === 0) {
      return {
        success: false,
        message: 'Unable to delete serial number',
      };
    }

    await this.serialEventLogService.logEvent({
      serialId: existing.id,
      serialNumber: serialNumber,
      eventType: 'REMOVED_FROM_PO',
      previousStatus: null,
      newStatus: null,
      previousPurchaseId: purchaseId,
      newPurchaseId: null,
      performedBy: auditActor?.userId ?? null,
      performedByUsername: auditActor?.username ?? null,
      ipAddress: auditActor?.ipAddress ?? null,
    });

    await this.auditLogService.logMutation({
      action: 'SERIAL_REMOVE_PO',
      entityType: 'serial-number',
      entityId: existing.id,
      actor: auditActor,
      description: `Removed serial '${serialNumber}' from purchase order #${purchaseId}`,
      requestBody: dto as unknown as Record<string, unknown>,
      before: {
        id: existing.id,
        serialNumber,
        purchaseId,
        unitType: existingUnitType,
      },
    });

    return {
      success: true,
      message: 'Serial number deleted successfully',
    };
  }

  async removeSalesOrderSerial(
    dto: RemoveSalesOrderSerialDto,
    actor?: AuditActorContext,
  ) {
    const serialNumber = this.normalizeSerialNumber(dto.serialNumber);
    const salesId = Number(dto.salesId);
    const unitType = this.normalizeUnitType(dto.unitType);

    if (!serialNumber) {
      return { success: false, message: 'serialNumber is required' };
    }

    if (!Number.isFinite(salesId) || salesId <= 0) {
      return { success: false, message: 'salesId must be a valid number' };
    }

    const existingResult = await this.databaseService.query<{
      id: number;
      salesId: string | null;
      unitType: string | null;
      status: string | null;
      productId: string | null;
      capacityId: string | null;
    }>(
      `SELECT
         sn.id,
         COALESCE(to_jsonb(sn)->>'salesId', to_jsonb(sn)->>'sales_id', null) AS "salesId",
         COALESCE(to_jsonb(sn)->>'unitType', to_jsonb(sn)->>'unit_type', null) AS "unitType",
         COALESCE(to_jsonb(sn)->>'status', null) AS status,
         COALESCE(to_jsonb(sn)->>'productId', to_jsonb(sn)->>'product_id', null) AS "productId",
         COALESCE(to_jsonb(sn)->>'capacityId', to_jsonb(sn)->>'capacity_id', null) AS "capacityId"
       FROM tblserial_numbers sn
       WHERE LOWER(
         regexp_replace(
           BTRIM(
             COALESCE(
               to_jsonb(sn)->>'serialNumber',
               to_jsonb(sn)->>'serial_number',
               ''
             )
           ),
           '\\s+',
           ' ',
           'g'
         )
       ) = LOWER($1)
       LIMIT 1`,
      [serialNumber],
    );

    if (existingResult.rowCount === 0) {
      return { success: false, message: 'Serial number not found' };
    }

    const existing = existingResult.rows[0];
    const existingSalesId = Number(existing.salesId);
    const existingUnitType = this.normalizeUnitType(existing.unitType);

    if (!Number.isFinite(existingSalesId) || existingSalesId !== salesId) {
      return {
        success: false,
        message: 'Serial number is not linked to this sales order',
      };
    }

    if (unitType && existingUnitType && unitType !== existingUnitType) {
      return {
        success: false,
        message: `Serial number belongs to unit type '${existingUnitType}'`,
      };
    }

    // Capture before state for audit logging
    const beforeState = {
      id: existing.id,
      serialNumber: serialNumber,
      salesId: existing.salesId,
      unitType: existing.unitType,
      status: existing.status,
      productId: existing.productId,
      capacityId: existing.capacityId,
    };

    const serialColumns = await this.getTableColumns('tblserial_numbers');
    const serialSalesIdColumn = this.pickColumn(serialColumns, ['salesId', 'sales_id']);
    const serialStatusColumn = this.pickColumn(serialColumns, ['status']);

    if (!serialSalesIdColumn) {
      return {
        success: false,
        message: 'Sales reference column is not configured in tblserial_numbers',
      };
    }

    const updateRecord: Record<string, unknown> = {
      [serialSalesIdColumn]: null,
    };

    if (serialStatusColumn) {
      updateRecord[serialStatusColumn] = 'in-stock';
    }

    const updateResult = await this.persistSerialUpdateWithEvent(
      existing.id,
      updateRecord,
      {
        serialId: existing.id,
        serialNumber: serialNumber,
        eventType: 'REMOVED_FROM_SO',
        previousStatus: existing.status,
        newStatus: 'in-stock',
        previousSalesId: salesId,
        newSalesId: null,
        performedBy: actor?.userId ?? null,
        performedByUsername: actor?.username ?? null,
        ipAddress: actor?.ipAddress ?? null,
      },
    );

    if (updateResult.rowCount === 0) {
      return {
        success: false,
        message: 'Unable to remove serial number from sales order',
      };
    }

    // Capture after state for audit logging
    const afterState = {
      ...beforeState,
      salesId: null,
      status: 'in-stock',
    };

    // Log audit entry for serial number removal from sales order
    if (actor) {
      await this.auditLogService.logMutation({
        action: 'DELETE',
        entityType: 'serial-number',
        entityId: existing.id,
        actor,
        description: `Removed serial number '${serialNumber}' from sales order #${salesId}`,
        before: beforeState,
        after: afterState,
        metadata: {
          salesOrderId: salesId,
          unitType: unitType ?? existingUnitType,
        },
      });
    }

    return {
      success: true,
      message: 'Serial number removed from sales order successfully',
    };
  }

  async normalizeStoredUnitTypes() {
    const serialColumns = await this.getTableColumns('tblserial_numbers');
    const serialUnitTypeColumn = this.pickColumn(serialColumns, ['unitType', 'unit_type']);

    if (!serialUnitTypeColumn) {
      return {
        success: false,
        message: 'Unit type column is not configured in tblserial_numbers',
      };
    }

    const rowsResult = await this.databaseService.query<{ id: number; unitType: string | null }>(
      `SELECT
         sn.id,
         COALESCE(
           to_jsonb(sn)->>'unitType',
           to_jsonb(sn)->>'unit_type',
           null
         ) AS "unitType"
       FROM tblserial_numbers sn
       ORDER BY sn.id`,
    );

    let updatedCount = 0;
    let skippedCount = 0;

    for (const row of rowsResult.rows) {
      const currentRaw = String(row.unitType ?? '').trim();
      if (!currentRaw) {
        skippedCount += 1;
        continue;
      }

      const currentNormalized = currentRaw.toLowerCase().replace(/\s+/g, ' ');
      const normalizedUnitType = this.normalizeUnitType(currentRaw);

      if (!normalizedUnitType || normalizedUnitType === currentNormalized) {
        skippedCount += 1;
        continue;
      }

      const updateResult = await this.runUpdateById('tblserial_numbers', row.id, {
        [serialUnitTypeColumn]: normalizedUnitType,
      });

      if (updateResult.rowCount > 0) {
        updatedCount += 1;
      }
    }

    return {
      success: true,
      message: `Unit types normalized. Updated ${updatedCount} serial number record(s).`,
      item: {
        scannedCount: rowsResult.rows.length,
        updatedCount,
        skippedCount,
        unitTypeColumn: serialUnitTypeColumn,
      },
    };
  }

  async deleteInStockByScope(
    productIdInput: string,
    capacityIdInput: string,
    auditActor?: AuditActorContext,
  ) {
    const productId = Number(productIdInput);
    const capacityId = Number(capacityIdInput);

    if (!Number.isFinite(productId) || productId <= 0) {
      return { success: false, message: 'productId must be a valid number' };
    }

    if (!Number.isFinite(capacityId) || capacityId <= 0) {
      return { success: false, message: 'capacityId must be a valid number' };
    }

    const inStockStatuses = ['in-stock', 'in_stock', 'instock', ''];
    const excludedStatuses = [
      'scanned', 'reserved', 'delivered', 'installed', 'sold',
      'released', 'out', 'outbound', 'for-delivery',
    ];

    const result = await this.databaseService.query<{ id: number }>(
      `DELETE FROM tblserial_numbers
       WHERE COALESCE(
         to_jsonb(tblserial_numbers)->>'productId',
         to_jsonb(tblserial_numbers)->>'product_id', ''
       ) = $1::text
       AND COALESCE(
         to_jsonb(tblserial_numbers)->>'capacityId',
         to_jsonb(tblserial_numbers)->>'capacity_id', ''
       ) = $2::text
       AND LOWER(TRIM(COALESCE(to_jsonb(tblserial_numbers)->>'status', ''))) NOT IN (${excludedStatuses.map((_, i) => `$${i + 3}`).join(', ')})
       RETURNING id`,
      [String(productId), String(capacityId), ...excludedStatuses],
    );

    const deleted = result.rowCount ?? 0;
    await this.auditLogService.logMutation({
      action: 'SERIAL_DELETE_IN_STOCK',
      entityType: 'serial-number',
      entityId: null,
      actor: auditActor,
      description: `Deleted ${deleted} in-stock serial(s) for product #${productId} / capacity #${capacityId}`,
      requestBody: { productId, capacityId },
      after: { deleted, productId, capacityId },
      metadata: { unusedInStockStatuses: inStockStatuses },
    });

    return {
      success: true,
      message: `Deleted ${deleted} in-stock serial number(s)`,
      deleted,
    };
  }

  async globalSearch(params: {
    search: string;
    page: number;
    pageSize: number;
  }): Promise<GlobalSearchResponse> {
    const { search, page, pageSize } = params;
    const offset = (page - 1) * pageSize;
    const searchPattern = `%${search}%`;

    const countResult = await this.databaseService.query<{ total: string }>(
      `SELECT COUNT(*) AS total
       FROM tblserial_numbers sn
       WHERE sn."serialNumber" ILIKE $1`,
      [searchPattern],
    );

    const total = parseInt(countResult.rows[0]?.total ?? '0', 10);

    const itemsResult = await this.databaseService.query<GlobalSearchResult>(
      `SELECT
         sn.id,
         sn."serialNumber",
         sn.status,
         sn."unitType",
         b."brandName",
         p."productName",
         c.capacity,
         br."branchName",
         po.po_number AS "poNumber",
         so.so_number AS "soNumber",
         cust.name AS "customerName",
         COALESCE(sn."isDefective", false) AS "isDefective",
         COALESCE(sn."isReturned", false) AS "isReturned",
         sn.created_at AS "createdAt"
       FROM tblserial_numbers sn
       LEFT JOIN tblproducts p ON p.id = sn."productId"
       LEFT JOIN tblbrands b ON b.id = p."brandId"
       LEFT JOIN tblcapacity c ON c.id = sn."capacityId"
       LEFT JOIN tblbranches br ON br.id = sn."branchId"
       LEFT JOIN tblpurchase_orders po ON po.id = sn."purchaseId"
       LEFT JOIN tblsales_order so ON so.id = sn."salesId"
       LEFT JOIN tblcustomer cust ON cust.id = sn."customerId"
       WHERE sn."serialNumber" ILIKE $1
       ORDER BY sn.created_at DESC
       LIMIT $2 OFFSET $3`,
      [searchPattern, pageSize, offset],
    );

    return {
      success: true,
      items: itemsResult.rows,
      total,
      page,
      pageSize,
    };
  }

  async bulkSearch(params: {
    serialNumbers: string[];
  }): Promise<BulkSearchResponse> {
    const uniqueSerials: string[] = [];
    const seen = new Set<string>();

    for (const raw of params.serialNumbers ?? []) {
      const serial = this.normalizeSerialNumber(raw);
      if (!serial) {
        continue;
      }
      const key = serial.toLowerCase();
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      uniqueSerials.push(serial);
    }

    if (uniqueSerials.length === 0) {
      throw new HttpException(
        { success: false, message: 'At least one serial number is required' },
        HttpStatus.BAD_REQUEST,
      );
    }

    if (uniqueSerials.length > 5000) {
      throw new HttpException(
        { success: false, message: 'Maximum 5000 serial numbers per bulk search' },
        HttpStatus.BAD_REQUEST,
      );
    }

    const lookupKeys = uniqueSerials.map((serial) => serial.toLowerCase());

    const itemsResult = await this.databaseService.query<GlobalSearchResult>(
      `SELECT
         sn.id,
         sn."serialNumber",
         sn.status,
         sn."unitType",
         b."brandName",
         p."productName",
         c.capacity,
         br."branchName",
         po.po_number AS "poNumber",
         so.so_number AS "soNumber",
         cust.name AS "customerName",
         COALESCE(sn."isDefective", false) AS "isDefective",
         COALESCE(sn."isReturned", false) AS "isReturned",
         sn.created_at AS "createdAt"
       FROM tblserial_numbers sn
       LEFT JOIN tblproducts p ON p.id = sn."productId"
       LEFT JOIN tblbrands b ON b.id = p."brandId"
       LEFT JOIN tblcapacity c ON c.id = sn."capacityId"
       LEFT JOIN tblbranches br ON br.id = sn."branchId"
       LEFT JOIN tblpurchase_orders po ON po.id = sn."purchaseId"
       LEFT JOIN tblsales_order so ON so.id = sn."salesId"
       LEFT JOIN tblcustomer cust ON cust.id = sn."customerId"
       WHERE LOWER(TRIM(sn."serialNumber")) = ANY($1::text[])
       ORDER BY sn.created_at DESC`,
      [lookupKeys],
    );

    const foundKeys = new Set(
      itemsResult.rows.map((row) => String(row.serialNumber ?? '').trim().toLowerCase()),
    );
    const notFound = uniqueSerials.filter((serial) => !foundKeys.has(serial.toLowerCase()));

    return {
      success: true,
      items: itemsResult.rows,
      total: itemsResult.rows.length,
      queriedCount: uniqueSerials.length,
      notFound,
    };
  }

  async bulkTransfer(params: {
    serialIds: number[];
    targetProductId: number;
    targetCapacityId: number;
    reason?: string;
    performedBy: number | null;
    performedByUsername: string | null;
    ipAddress: string | null;
    auditActor?: AuditActorContext;
  }): Promise<BulkTransferResponse> {
    const {
      serialIds,
      targetProductId,
      targetCapacityId,
      reason,
      performedBy,
      performedByUsername,
      ipAddress,
      auditActor,
    } = params;

    // Validate serialIds is non-empty
    if (!serialIds || serialIds.length === 0) {
      throw new HttpException(
        { success: false, message: 'serialIds must not be empty' },
        HttpStatus.BAD_REQUEST,
      );
    }

    // Validate target product exists
    const productResult = await this.databaseService.query<{ id: number }>(
      `SELECT id FROM tblproducts WHERE id = $1`,
      [targetProductId],
    );

    if (productResult.rowCount === 0) {
      throw new HttpException(
        { success: false, message: 'Target product does not exist' },
        HttpStatus.BAD_REQUEST,
      );
    }

    // Validate target capacity exists and belongs to the target product
    const capacityResult = await this.databaseService.query<{ id: number }>(
      `SELECT id FROM tblcapacity WHERE id = $1 AND "prodId" = $2`,
      [targetCapacityId, targetProductId],
    );

    if (capacityResult.rowCount === 0) {
      throw new HttpException(
        { success: false, message: 'Target capacity does not exist or does not belong to the selected product' },
        HttpStatus.BAD_REQUEST,
      );
    }

    const transferReason = reason || 'Bulk transfer - serial misplacement correction';

    // Execute transfer within a transaction for atomicity
    return await this.databaseService.withTransaction(async (client) => {
      // Get current state of all serials before update
      const currentStateResult = await client.query<{
        id: number;
        serialNumber: string;
        productId: number | null;
        capacityId: number | null;
      }>(
        `SELECT id, "serialNumber", "productId", "capacityId"
         FROM tblserial_numbers
         WHERE id = ANY($1::bigint[])`,
        [serialIds],
      );

      const currentSerials = currentStateResult.rows;

      // Update all serials' productId and capacityId
      await client.query(
        `UPDATE tblserial_numbers
         SET "productId" = $1, "capacityId" = $2
         WHERE id = ANY($3::bigint[])`,
        [targetProductId, targetCapacityId, serialIds],
      );

      // Log TRANSFERRED event for each serial
      for (const serial of currentSerials) {
        await this.serialEventLogService.logEvent(
          {
            serialId: serial.id,
            serialNumber: serial.serialNumber,
            eventType: 'TRANSFERRED',
            performedBy,
            performedByUsername,
            ipAddress,
            reason: transferReason,
            metadata: {
              previousProductId: serial.productId,
              previousCapacityId: serial.capacityId,
              newProductId: targetProductId,
              newCapacityId: targetCapacityId,
            },
          },
          client,
        );
      }

      await this.auditLogService.logMutation({
        action: 'SERIAL_BULK_TRANSFER',
        entityType: 'serial-number',
        entityId: null,
        actor: auditActor ?? {
          userId: performedBy,
          username: performedByUsername,
          ipAddress,
        },
        description: `Bulk transferred ${currentSerials.length} serial(s) to product #${targetProductId} / capacity #${targetCapacityId}`,
        requestBody: {
          serialIds,
          targetProductId,
          targetCapacityId,
          reason: transferReason,
        },
        after: {
          transferredCount: currentSerials.length,
          targetProductId,
          targetCapacityId,
        },
      });

      return {
        success: true,
        message: `Successfully transferred ${currentSerials.length} serial number(s) to the target product and capacity.`,
        transferredCount: currentSerials.length,
      };
    });
  }

  async bulkAssignOrder(params: {
    serialIds: number[];
    purchaseId?: number | null;
    salesId?: number | null;
    reason?: string;
    performedBy: number | null;
    performedByUsername: string | null;
    ipAddress: string | null;
    auditActor?: AuditActorContext;
  }): Promise<BulkAssignOrderResponse> {
    const {
      serialIds,
      purchaseId,
      salesId,
      reason,
      performedBy,
      performedByUsername,
      ipAddress,
      auditActor,
    } = params;

    // Validate serialIds is non-empty
    if (!serialIds || serialIds.length === 0) {
      throw new HttpException(
        { success: false, message: 'serialIds must not be empty' },
        HttpStatus.BAD_REQUEST,
      );
    }

    // At least one of purchaseId or salesId must be provided
    if (!purchaseId && !salesId) {
      throw new HttpException(
        { success: false, message: 'At least one of purchaseId or salesId must be provided' },
        HttpStatus.BAD_REQUEST,
      );
    }

    // Validate purchase order exists if provided
    if (purchaseId) {
      const poResult = await this.databaseService.query<{ id: number }>(
        `SELECT id FROM tblpurchase_orders WHERE id = $1`,
        [purchaseId],
      );
      if (poResult.rowCount === 0) {
        throw new HttpException(
          { success: false, message: 'Target purchase order does not exist' },
          HttpStatus.BAD_REQUEST,
        );
      }
    }

    // Validate sales order exists if provided
    if (salesId) {
      const soResult = await this.databaseService.query<{ id: number }>(
        `SELECT id FROM tblsales_order WHERE id = $1`,
        [salesId],
      );
      if (soResult.rowCount === 0) {
        throw new HttpException(
          { success: false, message: 'Target sales order does not exist' },
          HttpStatus.BAD_REQUEST,
        );
      }
    }

    const assignReason = reason || 'Bulk assign to PO/SO - serial reassignment';

    return await this.databaseService.withTransaction(async (client) => {
      // Get current state of all serials before update
      const currentStateResult = await client.query<{
        id: number;
        serialNumber: string;
        purchaseId: number | null;
        salesId: number | null;
      }>(
        `SELECT id, "serialNumber", "purchaseId", "salesId"
         FROM tblserial_numbers
         WHERE id = ANY($1::bigint[])`,
        [serialIds],
      );

      const currentSerials = currentStateResult.rows;

      // Build dynamic SET clause
      const setClauses: string[] = [];
      const updateParams: (number | null)[] = [];
      let paramIndex = 1;

      if (purchaseId !== undefined && purchaseId !== null) {
        setClauses.push(`"purchaseId" = $${paramIndex}`);
        updateParams.push(purchaseId);
        paramIndex++;
      }

      if (salesId !== undefined && salesId !== null) {
        setClauses.push(`"salesId" = $${paramIndex}`);
        updateParams.push(salesId);
        paramIndex++;
      }

      // Update all serials
      await client.query(
        `UPDATE tblserial_numbers
         SET ${setClauses.join(', ')}
         WHERE id = ANY($${paramIndex}::bigint[])`,
        [...updateParams, serialIds],
      );

      // Log ASSIGNED_ORDER event for each serial
      for (const serial of currentSerials) {
        await this.serialEventLogService.logEvent(
          {
            serialId: serial.id,
            serialNumber: serial.serialNumber,
            eventType: 'ASSIGNED_ORDER',
            performedBy,
            performedByUsername,
            ipAddress,
            reason: assignReason,
            metadata: {
              previousPurchaseId: serial.purchaseId,
              previousSalesId: serial.salesId,
              newPurchaseId: purchaseId ?? null,
              newSalesId: salesId ?? null,
            },
          },
          client,
        );
      }

      await this.auditLogService.logMutation({
        action: 'SERIAL_BULK_ASSIGN_ORDER',
        entityType: 'serial-number',
        entityId: null,
        actor: auditActor ?? {
          userId: performedBy,
          username: performedByUsername,
          ipAddress,
        },
        description: `Bulk assigned ${currentSerials.length} serial(s) to order(s)`,
        requestBody: {
          serialIds,
          purchaseId: purchaseId ?? null,
          salesId: salesId ?? null,
          reason: assignReason,
        },
        after: {
          assignedCount: currentSerials.length,
          purchaseId: purchaseId ?? null,
          salesId: salesId ?? null,
        },
      });

      return {
        success: true,
        message: `Successfully assigned ${currentSerials.length} serial number(s) to the specified order(s).`,
        assignedCount: currentSerials.length,
      };
    });
  }

  create(createSerialNumberDto: CreateSerialNumberDto) {
    void createSerialNumberDto;
    return 'This action adds a new serialNumber';
  }

  async checkSerials(dto: CheckSerialsDto) {
    const { serialNumbers, purchaseId } = dto;

    if (!Array.isArray(serialNumbers) || serialNumbers.length === 0) {
      throw new HttpException(
        'At least one serial number is required',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (serialNumbers.length > 5000) {
      throw new HttpException(
        'Maximum 5000 serial numbers per check',
        HttpStatus.BAD_REQUEST,
      );
    }

    // Normalize input serial numbers for matching
    const normalizedSerials = serialNumbers.map((sn) =>
      this.normalizeSerialNumber(sn).toLowerCase(),
    );

    // Resolve column names dynamically
    const serialColumns = await this.getTableColumns('tblserial_numbers');
    const serialNumberColumn = this.pickColumn(serialColumns, ['serialNumber', 'serial_number']);
    const serialPurchaseIdColumn = this.pickColumn(serialColumns, [
      'purchaseId',
      'purchase_id',
      'po_id',
      'purchaseOrderId',
      'purchase_order_id',
    ]);
    const serialProductIdColumn = this.pickColumn(serialColumns, ['productId', 'product_id']);
    const serialCapacityIdColumn = this.pickColumn(serialColumns, ['capacityId', 'capacity_id']);
    const serialUnitTypeColumn = this.pickColumn(serialColumns, ['unitType', 'unit_type']);

    if (!serialNumberColumn || !serialPurchaseIdColumn) {
      throw new HttpException(
        'Unable to resolve serial number table columns',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    // Resolve purchase orders table columns
    const poColumns = await this.getTableColumns('tblpurchase_orders');
    const poNumberColumn = this.pickColumn(poColumns, ['poNumber', 'po_number', 'po_no', 'poNo']);

    // Query existing serials with their current purchase ownership state
    const result = await this.databaseService.query<{
      serialNumber: string;
      purchaseId: string | null;
      currentPoNumber: string | null;
      productId: string | null;
      capacityId: string | null;
      unitType: string | null;
    }>(
      `SELECT
         COALESCE(to_jsonb(sn)->>'serialNumber', to_jsonb(sn)->>'serial_number', '') AS "serialNumber",
         COALESCE(
           to_jsonb(sn)->>'purchaseId',
           to_jsonb(sn)->>'purchase_id',
           to_jsonb(sn)->>'po_id',
           to_jsonb(sn)->>'purchaseOrderId',
           to_jsonb(sn)->>'purchase_order_id'
         ) AS "purchaseId",
         ${poNumberColumn ? `po."${poNumberColumn}"` : 'NULL'} AS "currentPoNumber",
         COALESCE(to_jsonb(sn)->>'productId', to_jsonb(sn)->>'product_id') AS "productId",
         COALESCE(to_jsonb(sn)->>'capacityId', to_jsonb(sn)->>'capacity_id') AS "capacityId",
         COALESCE(to_jsonb(sn)->>'unitType', to_jsonb(sn)->>'unit_type') AS "unitType"
       FROM tblserial_numbers sn
       LEFT JOIN tblpurchase_orders po
         ON po.id::text = COALESCE(
           to_jsonb(sn)->>'purchaseId',
           to_jsonb(sn)->>'purchase_id',
           to_jsonb(sn)->>'po_id',
           to_jsonb(sn)->>'purchaseOrderId',
           to_jsonb(sn)->>'purchase_order_id'
         )
       WHERE LOWER(
         regexp_replace(
           BTRIM(COALESCE(to_jsonb(sn)->>'serialNumber', to_jsonb(sn)->>'serial_number', '')),
           '\\s+',
           ' ',
           'g'
         )
       ) = ANY(
         SELECT LOWER(regexp_replace(BTRIM(s), '\\s+', ' ', 'g'))
         FROM unnest($1::text[]) s
       )`,
      [normalizedSerials],
    );

    // Build a lookup map from normalized serial -> DB row
    const existingMap = new Map<
      string,
      {
        serialNumber: string;
        purchaseId: number | null;
        currentPoNumber: string | null;
        productId: number | null;
        capacityId: number | null;
        unitType: string | null;
      }
    >();

    for (const row of result.rows) {
      const normalizedKey = this.normalizeSerialNumber(row.serialNumber).toLowerCase();
      existingMap.set(normalizedKey, {
        serialNumber: row.serialNumber,
        purchaseId: row.purchaseId !== null && row.purchaseId !== undefined
          ? Number(row.purchaseId)
          : null,
        currentPoNumber: row.currentPoNumber ?? null,
        productId: row.productId !== null && row.productId !== undefined && String(row.productId).trim() !== ''
          ? Number(row.productId)
          : null,
        capacityId: row.capacityId !== null && row.capacityId !== undefined && String(row.capacityId).trim() !== ''
          ? Number(row.capacityId)
          : null,
        unitType: row.unitType ?? null,
      });
    }

    // Map each input serial to a result
    const results = serialNumbers.map((inputSerial) => {
      const normalized = this.normalizeSerialNumber(inputSerial).toLowerCase();
      const existing = existingMap.get(normalized);

      if (!existing) {
        return {
          serialNumber: inputSerial,
          exists: false,
          currentPurchaseId: null,
          currentPoNumber: null,
          isSamePoAssignment: false,
          productId: null,
          capacityId: null,
          unitType: null,
        };
      }

      const currentPurchaseId = existing.purchaseId;
      const isSamePoAssignment =
        currentPurchaseId !== null && currentPurchaseId === purchaseId;

      return {
        serialNumber: inputSerial,
        exists: true,
        currentPurchaseId,
        currentPoNumber: existing.currentPoNumber,
        isSamePoAssignment,
        productId: existing.productId,
        capacityId: existing.capacityId,
        unitType: existing.unitType,
      };
    });

    return { results };
  }

  findAll() {
    return `This action returns all serialNumber`;
  }

  findOne(id: number) {
    return `This action returns a #${id} serialNumber`;
  }

  update(id: number, updateSerialNumberDto: UpdateSerialNumberDto) {
    return `This action updates a #${id} serialNumber`;
  }

  remove(id: number) {
    return `This action removes a #${id} serialNumber`;
  }
}
