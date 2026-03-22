import { Injectable } from '@nestjs/common';
import { CreateSerialNumberDto } from './dto/create-serial-number.dto';
import { UpdateSerialNumberDto } from './dto/update-serial-number.dto';
import { DatabaseService } from 'src/database/database.service';
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

type SerialScanRow = {
  id: number;
  serialNumber: string | null;
  status: string | null;
  salesId: string | null;
  productId: string | null;
  capacityId: string | null;
  branchId: string | null;
  unitType: string | null;
  productName: string | null;
  unit: string | null;
  capacity: string | null;
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

@Injectable()
export class SerialNumberService {
  constructor(private readonly databaseService: DatabaseService) {}

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

  private async runInsert(tableName: string, record: Record<string, unknown>) {
    const columns = Object.keys(record);
    const values = Object.values(record);
    const quotedColumns = columns.map((column) => `"${column}"`).join(', ');
    const placeholders = values.map((_, index) => `$${index + 1}`).join(', ');

    return this.databaseService.query<{ id: number }>(
      `INSERT INTO ${tableName} (${quotedColumns}) VALUES (${placeholders}) RETURNING id`,
      values,
    );
  }

  private async runUpdateById(
    tableName: string,
    id: number,
    record: Record<string, unknown>,
  ) {
    const columns = Object.keys(record);
    if (columns.length === 0) {
      return { rowCount: 0 };
    }

    const values = Object.values(record);
    const setClause = columns
      .map((column, index) => `"${column}" = $${index + 1}`)
      .join(', ');

    return this.databaseService.query<{ id: number }>(
      `UPDATE ${tableName}
       SET ${setClause}
       WHERE id = $${values.length + 1}
       RETURNING id`,
      [...values, id],
    );
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
      `WITH selected_product AS (
         SELECT
           p.id::text AS product_id,
           LOWER(TRIM(COALESCE(
             to_jsonb(p)->>'productName',
             to_jsonb(p)->>'product_name',
             to_jsonb(p)->>'productname',
             ''
           ))) AS product_name
         FROM tblproducts p
         WHERE p.id::text = $1::text
         LIMIT 1
       ),
       selected_capacity AS (
         SELECT
           c.id::text AS capacity_id,
           LOWER(TRIM(COALESCE(
             to_jsonb(c)->>'capacity',
             to_jsonb(c)->>'capacityValue',
             to_jsonb(c)->>'capacity_value',
             to_jsonb(c)->>'name',
             ''
           ))) AS capacity_name
         FROM tblcapacity c
         WHERE c.id::text = $2::text
         LIMIT 1
       )
       SELECT
         COALESCE(
           to_jsonb(sn)->>'serialNumber',
           to_jsonb(sn)->>'serial_number',
           ''
         ) AS "serialNumber",
         COALESCE(to_jsonb(sn)->>'status', '') AS status
       FROM tblserial_numbers sn
       CROSS JOIN selected_product sp
       CROSS JOIN selected_capacity sc
       WHERE (
         COALESCE(
           to_jsonb(sn)->>'productId',
           to_jsonb(sn)->>'product_id',
           to_jsonb(sn)->>'prodId',
           to_jsonb(sn)->>'prod_id'
         ) = sp.product_id
         OR LOWER(TRIM(COALESCE(
           to_jsonb(sn)->>'productName',
           to_jsonb(sn)->>'product_name',
           ''
         ))) = sp.product_name
       )
       AND (
         COALESCE(
           to_jsonb(sn)->>'capacityId',
           to_jsonb(sn)->>'capacity_id',
           to_jsonb(sn)->>'capId',
           to_jsonb(sn)->>'cap_id'
         ) = sc.capacity_id
         OR LOWER(TRIM(COALESCE(
           to_jsonb(sn)->>'capacity',
           to_jsonb(sn)->>'capacityValue',
           to_jsonb(sn)->>'capacity_value',
           to_jsonb(sn)->>'capacityName',
           to_jsonb(sn)->>'capacity_name',
           ''
         ))) = sc.capacity_name
       )
       AND (
         $3::text IS NULL
         OR COALESCE(
           to_jsonb(sn)->>'branchId',
           to_jsonb(sn)->>'branch_id',
           to_jsonb(sn)->>'branchid',
           ''
         ) = $3::text
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
        ['delivered', 'installed', 'sold', 'released', 'out', 'outbound'].includes(
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
       )
       SELECT
         ss.serial_number AS "serialNumber",
         ss.unit_type AS "unitType",
         ss.product_id AS "productId",
         COALESCE(
           to_jsonb(p)->>'productName',
           to_jsonb(p)->>'product_name',
           to_jsonb(p)->>'productname',
           ''
         ) AS "productName",
         ss.capacity_id AS "capacityId",
         COALESCE(
           to_jsonb(c)->>'capacity',
           to_jsonb(c)->>'capacityValue',
           to_jsonb(c)->>'capacity_value',
           to_jsonb(c)->>'name',
           ''
         ) AS "capacityName",
         ss.purchase_id AS "purchaseId",
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
             COALESCE(
               to_jsonb(tpi)->>'unitPrice',
               to_jsonb(tpi)->>'unit_price',
               ''
             ),
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
         ss.status AS "status",
         CASE
           WHEN sn."isDefective" IS NOT NULL THEN sn."isDefective"
           ELSE false
         END AS "isDefective",
         CASE
           WHEN sn."isReturned" IS NOT NULL THEN sn."isReturned"
           ELSE false
         END AS "isReturned"
       FROM serial_scope ss
       LEFT JOIN tblserial_numbers sn
         ON sn."serialNumber" = ss.serial_number
       LEFT JOIN tblproducts p
         ON p.id::text = ss.product_id
       LEFT JOIN tblcapacity c
         ON c.id::text = ss.capacity_id
       LEFT JOIN tblpurchase_orders po
         ON po.id::text = ss.purchase_id
       LEFT JOIN tblvendors v
         ON v.id::text = COALESCE(
           to_jsonb(po)->>'vendor_id',
           to_jsonb(po)->>'vendorId',
           ''
         )
       LEFT JOIN tbltransaction_product_items tpi
         ON COALESCE(
           to_jsonb(tpi)->>'purchaseId',
           to_jsonb(tpi)->>'purchase_id',
           to_jsonb(tpi)->>'po_id',
           ''
         ) = ss.purchase_id
         AND COALESCE(
           to_jsonb(tpi)->>'productId',
           to_jsonb(tpi)->>'product_id',
           ''
         ) = ss.product_id
         AND COALESCE(
           to_jsonb(tpi)->>'capacityId',
           to_jsonb(tpi)->>'capacity_id',
           ''
         ) = ss.capacity_id
         AND LOWER(COALESCE(
           to_jsonb(tpi)->>'transType',
           to_jsonb(tpi)->>'trans_type',
           'purchase'
         )) = 'purchase'
       WHERE ss.serial_number <> ''
         AND ss.purchase_id <> ''
         AND (
           $1::text IS NULL
           OR ss.branch_id = $1::text
         )
         AND (
           $2::text IS NULL
           OR ss.product_id = $2::text
         )
         AND (
           $3::text IS NULL
           OR ss.capacity_id = $3::text
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
           ss.serial_number ASC`,
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

        return {
          serialNumber: String(row.serialNumber ?? '').trim(),
          unitType: this.normalizeUnitType(row.unitType),
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
        if (row.unitType.includes('indoor')) {
          group.indoorSerials.push({
            serial: row.serialNumber,
            status: row.status,
            isDefective: row.isDefective,
            isReturned: row.isReturned,
          });
          continue;
        }

        if (row.unitType.includes('outdoor')) {
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

        return {
          productName: group.productName,
          capacityName: group.capacityName,
          vendorName: group.vendorName,
          poNumber: group.poNumber,
          poDate: group.poDate,
          rows,
          totals: {
            serialCount: rows.length,
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

  async scanSalesOrder(dto: ScanSalesOrderDto, userId?: number) {
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

    if (!serialNumber) {
      return { success: false, message: 'serialNumber is required' };
    }
    if (!Number.isFinite(salesId) || salesId <= 0) {
      return { success: false, message: 'salesId must be a valid number' };
    }
    if (branchId !== null && (!Number.isFinite(branchId) || branchId <= 0)) {
      return { success: false, message: 'branchId must be a valid number' };
    }

    const serialResult = await this.databaseService.query<SerialScanRow>(
      `SELECT
        sn.id,
        sn."serialNumber"::text AS "serialNumber",
        sn.status::text AS status,
        sn."salesId"::text AS "salesId",
        sn."productId"::text AS "productId",
        sn."capacityId"::text AS "capacityId",
        sn."branchId"::text AS "branchId",
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
        ON p.id::text = sn."productId"::text
      LEFT JOIN tblcapacity c
        ON c.id::text = sn."capacityId"::text
      WHERE LOWER(
        regexp_replace(BTRIM(COALESCE(sn."serialNumber", '')), '\\s+', ' ', 'g')
      ) = LOWER($1)
      LIMIT 1`,
      [serialNumber],
    );

    if (serialResult.rowCount === 0) {
      return { success: false, message: 'Serial number not found' };
    }

    const serial = serialResult.rows[0];
    const currentSalesId = Number(serial.salesId);
    const normalizedStatus = String(serial.status ?? '').trim().toLowerCase();
    const reservedStatuses = new Set(['reserved', 'sold', 'released', 'out', 'outbound']);

    if (
      expectedProductId !== null &&
      Number(serial.productId) !== Number(expectedProductId)
    ) {
      return {
        success: false,
        message: `Serial number product mismatch. Expected productId ${expectedProductId}`,
      };
    }

    if (
      expectedCapacityId !== null &&
      Number(serial.capacityId) !== Number(expectedCapacityId)
    ) {
      return {
        success: false,
        message: `Serial number capacity mismatch. Expected capacityId ${expectedCapacityId}`,
      };
    }

    if (expectedUnitType) {
      const scannedUnitType = this.normalizeUnitType(serial.unitType);
      if (scannedUnitType && scannedUnitType !== expectedUnitType) {
        return {
          success: false,
          message: `Serial number unit type mismatch. Expected ${expectedUnitType}`,
        };
      }
    }

    if (Number.isFinite(currentSalesId) && currentSalesId > 0 && currentSalesId !== salesId) {
      return {
        success: false,
        message: `Serial number already assigned to salesId ${currentSalesId}`,
      };
    }

    if (reservedStatuses.has(normalizedStatus) && currentSalesId === salesId) {
      return {
        success: true,
        message: 'Serial number already scanned for this sales order',
        item: serial,
      };
    }

    const updateResult = await this.databaseService.query<SerialScanRow>(
      `UPDATE tblserial_numbers
       SET
         "salesId" = $1,
         "branchId" = COALESCE($2, "branchId"),
         status = 'reserved',
         created_by = COALESCE($3, created_by)
       WHERE id = $4
       RETURNING
         id,
         "serialNumber"::text AS "serialNumber",
         status::text AS status,
         "salesId"::text AS "salesId",
         "productId"::text AS "productId",
         "capacityId"::text AS "capacityId",
         "branchId"::text AS "branchId",
         COALESCE(to_jsonb(tblserial_numbers)->>'unitType', to_jsonb(tblserial_numbers)->>'unit_type', null) AS "unitType",
         null::text AS "productName",
         null::text AS unit,
         null::text AS capacity`,
      [salesId, branchId, userId ?? null, serial.id],
    );

    if (updateResult.rowCount === 0) {
      return {
        success: false,
        message: 'Unable to update serial number for sales order',
      };
    }

    return {
      success: true,
      message: 'Serial number scanned successfully',
      item: {
        ...serial,
        salesId: String(salesId),
        status: 'reserved',
        branchId: branchId !== null ? String(branchId) : serial.branchId,
      },
    };
  }

  async scanSalesOrderBatch(dto: ScanSalesOrderBatchDto, userId?: number) {
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
      };

      const result = await this.scanSalesOrder(payload, userId);
      results.push({
        serialNumber: this.normalizeSerialNumber(entry.serialNumber),
        success: Boolean(result.success),
        message: result.message,
        item: {
          serialNumber: result.item?.serialNumber ?? null,
        },
      });
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

  async scanPurchaseOrder(dto: ScanPurchaseOrderDto, userId?: number, branchIdInput?: number) {
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

    if (!serialNumber) {
      return { success: false, message: 'serialNumber is required' };
    }
    if (!Number.isFinite(purchaseId) || purchaseId <= 0) {
      return { success: false, message: 'purchaseId must be a valid number' };
    }
    if (requestBranchId !== null && (!Number.isFinite(requestBranchId) || requestBranchId <= 0)) {
      return { success: false, message: 'branchId must be a valid number' };
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
        return {
          success: false,
          message:
            'Serial number not found. expectedProductId is required to create a new serial for purchase order.',
        };
      }

      if (expectedCapacityId === null || !Number.isFinite(expectedCapacityId) || expectedCapacityId <= 0) {
        return {
          success: false,
          message:
            'Serial number not found. expectedCapacityId is required to create a new serial for purchase order.',
        };
      }

      const productExistsResult = await this.databaseService.query<{ id: number }>(
        `SELECT id
         FROM tblproducts
         WHERE id::text = $1
         LIMIT 1`,
        [String(expectedProductId)],
      );

      if (productExistsResult.rowCount === 0) {
        return {
          success: false,
          message: `Product ID ${expectedProductId} does not exist`,
        };
      }

      const capacityExistsResult = await this.databaseService.query<{ id: number }>(
        `SELECT id
         FROM tblcapacity
         WHERE id::text = $1
         LIMIT 1`,
        [String(expectedCapacityId)],
      );

      if (capacityExistsResult.rowCount === 0) {
        return {
          success: false,
          message: `Capacity ID ${expectedCapacityId} does not exist`,
        };
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
        return this.scanPurchaseOrder(dto, userId, branchId ?? undefined);
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
        return {
          success: false,
          message: 'Serial number was created but cannot be retrieved',
        };
      }

      const created = createdResult.rows[0];

      return {
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
      };
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
        message: `Serial number product mismatch. Expected productId ${expectedProductId}`,
      };
    }

    if (
      expectedCapacityId !== null &&
      Number(serial.capacityId) !== Number(expectedCapacityId)
    ) {
      return {
        success: false,
        message: `Serial number capacity mismatch. Expected capacityId ${expectedCapacityId}`,
      };
    }

    if (Number.isFinite(currentSalesId) && currentSalesId > 0) {
      return {
        success: false,
        message: `Serial number already assigned to salesId ${currentSalesId}`,
      };
    }

    if (
      Number.isFinite(currentPurchaseId) &&
      currentPurchaseId > 0 &&
      currentPurchaseId !== purchaseId
    ) {
      return {
        success: false,
        message: `Serial number already linked to purchaseId ${currentPurchaseId}`,
      };
    }

    if (['sold', 'released', 'out', 'outbound'].includes(normalizedStatus)) {
      return {
        success: false,
        message: `Serial number cannot be used with status '${normalizedStatus || 'unknown'}'`,
      };
    }

    if (currentPurchaseId === purchaseId) {
      const currentUnitType = this.normalizeUnitType(serial.unitType);
      if (currentUnitType === unitType.toLowerCase()) {
        return {
          success: true,
          message: 'Serial number already scanned for this purchase order',
          item: {
            ...serial,
            unitType: currentUnitType,
          },
        };
      }

      return {
        success: false,
        message: `Serial number already scanned under unit type '${currentUnitType || 'unknown'}'`,
      };
    }

    const updateRecord: Record<string, unknown> = {};
    if (serialPurchaseIdColumn) {
      updateRecord[serialPurchaseIdColumn] = purchaseId;
    }
    if (serialSalesIdColumn) {
      updateRecord[serialSalesIdColumn] = null;
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

    const updateResult = await this.runUpdateById(
      'tblserial_numbers',
      serial.id,
      updateRecord,
    );

    if (updateResult.rowCount === 0) {
      return {
        success: false,
        message: 'Unable to update serial number for purchase order',
      };
    }

    return {
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
    };
  }

  async scanPurchaseOrderBatch(dto: ScanPurchaseOrderBatchDto, userId?: number, branchIdInput?: number) {
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
        const result = await this.scanPurchaseOrder(payload, userId, branchIdInput);
        results.push({
          serialNumber: this.normalizeSerialNumber(entry.serialNumber),
          success: Boolean(result.success),
          message: result.message,
          item: {
            serialNumber: result.item?.serialNumber ?? null,
            unitType: result.item?.unitType ?? entry.unitType ?? null,
          },
        });
      } catch (error: unknown) {
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

  async removePurchaseOrderSerial(dto: RemovePurchaseOrderSerialDto) {
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

    return {
      success: true,
      message: 'Serial number deleted successfully',
    };
  }

  async removeSalesOrderSerial(dto: RemoveSalesOrderSerialDto) {
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
    }>(
      `SELECT
         sn.id,
         COALESCE(to_jsonb(sn)->>'salesId', to_jsonb(sn)->>'sales_id', null) AS "salesId",
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

    const updateResult = await this.runUpdateById(
      'tblserial_numbers',
      existing.id,
      updateRecord,
    );

    if (updateResult.rowCount === 0) {
      return {
        success: false,
        message: 'Unable to remove serial number from sales order',
      };
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

  create(createSerialNumberDto: CreateSerialNumberDto) {
    void createSerialNumberDto;
    return 'This action adds a new serialNumber';
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
