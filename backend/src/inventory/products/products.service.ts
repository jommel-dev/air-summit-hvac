import { Injectable } from '@nestjs/common';
import {
  CreateProductCapacityDto,
  CreateProductDto,
} from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { DatabaseService } from 'src/database/database.service';
import { PoolClient } from 'pg';
import { AuditActorContext, AuditLogService } from 'src/audit-log/audit-log.service';
import {
  catalogActiveSql,
  findPendingCatalogAlerts,
} from 'src/common/utils/catalog-soft-delete';

@Injectable()
export class ProductsService {
  constructor(
    private readonly databaseService: DatabaseService,
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

  private async insertCapacityAndPriceHistory(
    executor: { query: PoolClient['query'] },
    productId: number,
    userId: number,
    capacityItem: CreateProductCapacityDto,
  ) {
    const toOptionalNumber = (value: unknown): number | null => {
      if (value === null || value === undefined || value === '') {
        return null;
      }

      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    };

    const toRequiredNumber = (value: unknown, fieldName: string): number => {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) {
        throw new Error(`${fieldName} must be a valid number`);
      }
      return parsed;
    };

    const supplierId = toOptionalNumber(capacityItem.supplierId);
    const purchaseOrderId = toOptionalNumber(capacityItem.purchaseOrderId);
    const purchaseOrderNo =
      typeof capacityItem.purchaseOrderNo === 'string'
        ? capacityItem.purchaseOrderNo.trim()
        : '';
    const srp = toRequiredNumber(capacityItem.srp, 'srp');
    const netPrice = toRequiredNumber(capacityItem.netPrice, 'netPrice');

    const capacityColumns = await this.getTableColumns(executor, 'tblcapacity');
    if (capacityColumns.length === 0) {
      throw new Error('tblcapacity table was not found in current schema');
    }

    const capacityProductIdColumn = this.pickColumn(capacityColumns, [
      'prodId',
      'productId',
      'prod_id',
      'product_id',
    ]);
    const capacityValueColumn = this.pickColumn(capacityColumns, [
      'capacity',
      'capacityValue',
    ]);
    const indoorModelColumn = this.pickColumn(capacityColumns, [
      'indoorModel',
      'indoor_model',
    ]);
    const outdoorModelColumn = this.pickColumn(capacityColumns, [
      'outdoorModel',
      'outdoor_model',
    ]);
    const srpColumn = this.pickColumn(capacityColumns, ['srp', 'SRP']);
    const netPriceColumn = this.pickColumn(capacityColumns, [
      'netPrice',
      'net_price',
    ]);
    const supplierIdColumn = this.pickColumn(capacityColumns, [
      'supplierId',
      'supplier_id',
    ]);
    const purchaseOrderIdColumn = this.pickColumn(capacityColumns, [
      'purchaseOrderId',
      'purchase_order_id',
      'poId',
      'po_id',
    ]);
    const purchaseOrderNoColumn = this.pickColumn(capacityColumns, [
      'purchaseOrderNo',
      'purchase_order_no',
      'poNo',
      'po_no',
    ]);
    const createdByColumn = this.pickColumn(capacityColumns, [
      'created_by',
      'createdBy',
      'createdby',
    ]);

    if (
      !capacityProductIdColumn ||
      !capacityValueColumn ||
      !indoorModelColumn ||
      !outdoorModelColumn ||
      !srpColumn ||
      !netPriceColumn
    ) {
      throw new Error(
        'tblcapacity columns are not aligned with required fields',
      );
    }

    const capacityRecord: Record<string, unknown> = {
      [capacityProductIdColumn]: productId,
      [capacityValueColumn]: capacityItem.capacity,
      [indoorModelColumn]: capacityItem.indoorModel,
      [outdoorModelColumn]: capacityItem.outdoorModel,
      [srpColumn]: srp,
      [netPriceColumn]: netPrice,
    };

    if (supplierIdColumn && supplierId != null) {
      capacityRecord[supplierIdColumn] = supplierId;
    }
    if (purchaseOrderIdColumn && purchaseOrderId != null) {
      capacityRecord[purchaseOrderIdColumn] = purchaseOrderId;
    }
    if (purchaseOrderNoColumn && purchaseOrderNo) {
      capacityRecord[purchaseOrderNoColumn] = purchaseOrderNo;
    }
    if (createdByColumn) {
      capacityRecord[createdByColumn] = userId;
    }

    await this.runInsert(executor, 'tblcapacity', capacityRecord);

    const historyColumns = await this.getTableColumns(
      executor,
      'tblcapacity_netprice_history',
    );

    if (historyColumns.length === 0) {
      return;
    }

    const historyProductIdColumn = this.pickColumn(historyColumns, [
      'prodId',
      'productId',
      'prod_id',
      'product_id',
    ]);
    const historyCapacityColumn = this.pickColumn(historyColumns, [
      'capacity',
      'capacityValue',
      'capacity_value',
    ]);
    const historyNetPriceColumn = this.pickColumn(historyColumns, [
      'netPrice',
      'net_price',
    ]);
    const historySupplierIdColumn = this.pickColumn(historyColumns, [
      'supplierId',
      'supplier_id',
    ]);
    const historyPurchaseOrderIdColumn = this.pickColumn(historyColumns, [
      'purchaseOrderId',
      'purchase_order_id',
      'poId',
      'po_id',
    ]);
    const historyPurchaseOrderNoColumn = this.pickColumn(historyColumns, [
      'purchaseOrderNo',
      'purchase_order_no',
      'poNo',
      'po_no',
    ]);
    const historyCreatedByColumn = this.pickColumn(historyColumns, [
      'created_by',
      'createdBy',
      'createdby',
    ]);

    if (!historyProductIdColumn || !historyCapacityColumn || !historyNetPriceColumn) {
      return;
    }

    const whereClauses = [
      `"${historyProductIdColumn}"::text = $1::text`,
      `"${historyCapacityColumn}"::text = $2::text`,
    ];
    const whereValues: unknown[] = [productId, capacityItem.capacity];

    if (historySupplierIdColumn && supplierId != null) {
      whereValues.push(supplierId);
      whereClauses.push(
        `"${historySupplierIdColumn}"::text = $${whereValues.length}::text`,
      );
    }

    if (historyPurchaseOrderIdColumn && purchaseOrderId != null) {
      whereValues.push(purchaseOrderId);
      whereClauses.push(
        `"${historyPurchaseOrderIdColumn}"::text = $${whereValues.length}::text`,
      );
    }

    if (historyPurchaseOrderNoColumn && purchaseOrderNo) {
      whereValues.push(purchaseOrderNo);
      whereClauses.push(
        `LOWER(TRIM("${historyPurchaseOrderNoColumn}"::text)) = LOWER(TRIM($${whereValues.length}::text))`,
      );
    }

    const latestPriceResult = await executor.query<{ net_price_value: string | null }>(
      `SELECT "${historyNetPriceColumn}"::text AS net_price_value
       FROM tblcapacity_netprice_history
       WHERE ${whereClauses.join(' AND ')}
       ORDER BY id DESC
       LIMIT 1`,
      whereValues,
    );

    const latestNetPrice = latestPriceResult.rows[0]?.net_price_value;
    const incomingNetPrice = String(netPrice);

    if (latestNetPrice === incomingNetPrice) {
      return;
    }

    const historyRecord: Record<string, unknown> = {
      [historyProductIdColumn]: productId,
      [historyCapacityColumn]: capacityItem.capacity,
      [historyNetPriceColumn]: netPrice,
    };

    if (historySupplierIdColumn && supplierId != null) {
      historyRecord[historySupplierIdColumn] = supplierId;
    }
    if (historyPurchaseOrderIdColumn && purchaseOrderId != null) {
      historyRecord[historyPurchaseOrderIdColumn] = purchaseOrderId;
    }
    if (historyPurchaseOrderNoColumn && purchaseOrderNo) {
      historyRecord[historyPurchaseOrderNoColumn] = purchaseOrderNo;
    }
    if (historyCreatedByColumn) {
      historyRecord[historyCreatedByColumn] = userId;
    }

    await this.runInsert(executor, 'tblcapacity_netprice_history', historyRecord);
  }

  async create(
    createProductDto: CreateProductDto,
    userId: number,
    auditActor?: AuditActorContext,
  ) {
    const prodData = createProductDto;
    const normalizedProductName = prodData.productName?.trim();

    if (!normalizedProductName) {
      return {
        success: false,
        message: 'Product name is required',
      };
    }

    const duplicateCheck = await this.databaseService.query<{ id: number }>(
      `SELECT id
       FROM tblproducts p
       WHERE LOWER(TRIM(COALESCE(
         to_jsonb(p)->>'productName',
         to_jsonb(p)->>'product_name',
         to_jsonb(p)->>'productname',
         ''
       ))) = LOWER(TRIM($1))
       AND COALESCE(
         to_jsonb(p)->>'brandId',
         to_jsonb(p)->>'brand_id',
         to_jsonb(p)->>'brandid'
       ) = $2::text
       AND ${catalogActiveSql('p')}
       LIMIT 1`,
      [normalizedProductName, prodData.brandId],
    );

    if (duplicateCheck.rowCount > 0) {
      return {
        success: false,
        message: 'Product already exists for this brand',
      };
    }

    const payload = {
      ...prodData,
      productName: normalizedProductName,
      unitTypes: prodData.unitTypes.join(','),
      created_by: userId,
    };

    try {
      const result = await this.databaseService.withTransaction(async (client) => {
        const availableColumns = await this.getTableColumns(client, 'tblproducts');

        const brandColumn = this.pickColumn(availableColumns, [
          'brandId',
          'brand_id',
          'brandid',
        ]);
        const productNameColumn = this.pickColumn(availableColumns, [
          'productName',
          'product_name',
          'productname',
        ]);
        const unitTypesColumn = this.pickColumn(availableColumns, [
          'unitTypes',
          'unit_types',
          'unittypes',
        ]);
        const unitColumn = this.pickColumn(availableColumns, ['unit']);
        const createdByColumn = this.pickColumn(availableColumns, [
          'created_by',
          'createdBy',
          'createdby',
        ]);

        if (
          !brandColumn ||
          !productNameColumn ||
          !unitTypesColumn ||
          !unitColumn
        ) {
          throw new Error(
            'tblproducts columns are not aligned with expected product fields',
          );
        }

        const insertRecord: Record<string, unknown> = {
          [brandColumn]: payload.brandId,
          [productNameColumn]: payload.productName,
          [unitTypesColumn]: payload.unitTypes,
          [unitColumn]: payload.unit,
        };

        if (createdByColumn) {
          insertRecord[createdByColumn] = payload.created_by;
        }

        const productInsertResult = await this.runInsert(
          client,
          'tblproducts',
          insertRecord,
        );

        if (productInsertResult.rowCount === 0) {
          throw new Error('Failed to create product');
        }

        const productId = productInsertResult.rows[0].id;
        const capacities = Array.isArray(prodData.capacities)
          ? prodData.capacities
          : [];

        for (const capacityItem of capacities) {
          await this.insertCapacityAndPriceHistory(
            client,
            productId,
            userId,
            capacityItem,
          );
        }

        return {
          id: productId,
          capacitiesInserted: capacities.length,
        };
      });

      await this.auditLogService.logMutation({
        action: 'PRODUCT_CREATE',
        entityType: 'product',
        entityId: result.id,
        actor: auditActor ?? { userId },
        description: `Created product ${normalizedProductName}`,
        requestBody: createProductDto as unknown as Record<string, unknown>,
        after: {
          id: result.id,
          productName: normalizedProductName,
          brandId: prodData.brandId,
          capacitiesInserted: result.capacitiesInserted,
        },
      });

      return {
        success: true,
        id: result.id,
        capacitiesInserted: result.capacitiesInserted,
      };
    } catch (error) {
      return {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : 'Unable to connect to PostgreSQL',
      };
    }
  }

  async findAll() {
    try {
      const result = await this.databaseService.query<{
        id: number;
        product_name: string | null;
        brand_name: string | null;
        unit: string | null;
        unit_types: string | null;
        capacities: unknown;
      }>(
        `SELECT
           p.id,
           COALESCE(
             to_jsonb(p)->>'productName',
             to_jsonb(p)->>'product_name',
             to_jsonb(p)->>'productname'
           ) AS product_name,
           (
             SELECT COALESCE(
               to_jsonb(b)->>'name',
               to_jsonb(b)->>'brandName',
               to_jsonb(b)->>'brand_name'
             )
             FROM tblbrands b
             WHERE b.id::text = COALESCE(
               to_jsonb(p)->>'brandId',
               to_jsonb(p)->>'brand_id',
               to_jsonb(p)->>'brandid'
             )
             LIMIT 1
           ) AS brand_name,
           (
             SELECT COALESCE(
               to_jsonb(b)->>'type',
               to_jsonb(b)->>'brandType',
               to_jsonb(b)->>'brand_type',
               ''
             )
             FROM tblbrands b
             WHERE b.id::text = COALESCE(
               to_jsonb(p)->>'brandId',
               to_jsonb(p)->>'brand_id',
               to_jsonb(p)->>'brandid'
             )
             LIMIT 1
           ) AS brand_type,
           COALESCE(
             to_jsonb(p)->>'unit',
             ''
           ) AS unit,
           COALESCE(
             to_jsonb(p)->>'unitTypes',
             to_jsonb(p)->>'unit_types',
             to_jsonb(p)->>'unittypes',
             ''
           ) AS unit_types,
           COALESCE(
             (
               SELECT json_agg(
                 json_build_object(
                   'id', c.id,
                   'name', COALESCE(
                     to_jsonb(c)->>'capacity',
                     to_jsonb(c)->>'capacityValue',
                     to_jsonb(c)->>'capacity_value',
                     to_jsonb(c)->>'name'
                    ),
                   'sellPrice', COALESCE(
                     NULLIF(
                       COALESCE(
                         to_jsonb(c)->>'srp',
                         to_jsonb(c)->>'SRP',
                         ''
                       ),
                       ''
                     )::numeric,
                     0
                   ),
                   'unitPrice', COALESCE(
                     NULLIF(
                       COALESCE(
                         to_jsonb(c)->>'netPrice',
                         to_jsonb(c)->>'net_price',
                         ''
                       ),
                       ''
                     )::numeric,
                     0
                  ),
                  'indoorModel', COALESCE(
                    to_jsonb(c)->>'indoorModel',
                    to_jsonb(c)->>'indoor_model',
                    ''
                  ),
                  'outdoorModel', COALESCE(
                    to_jsonb(c)->>'outdoorModel',
                    to_jsonb(c)->>'outdoor_model',
                    ''
                   )
                 )
                 ORDER BY c.id
               )
               FROM tblcapacity c
               WHERE COALESCE(
                 to_jsonb(c)->>'prodId',
                 to_jsonb(c)->>'productId',
                 to_jsonb(c)->>'prod_id',
                 to_jsonb(c)->>'product_id'
               ) = p.id::text
                 AND ${catalogActiveSql('c')}
             ),
             '[]'::json
           ) AS capacities
         FROM tblproducts p
         WHERE ${catalogActiveSql('p')}
         ORDER BY p.id DESC`,
      );

      return {
        success: true,
        items: result.rows.map((row) => ({
          id: row.id,
          name: row.product_name ?? `Product ${row.id}`,
          brandName: row.brand_name ?? undefined,
          unit: (row.unit ?? '').trim() || undefined,
          unitTypes: String(row.unit_types ?? '')
            .split(',')
            .map((entry) => entry.trim())
            .filter((entry) => entry.length > 0),
          capacities: Array.isArray(row.capacities) ? row.capacities : [],
        })),
      };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to load products',
        items: [],
      };
    }
  }

  async findOne(id: number) {
    if (!Number.isFinite(id) || id <= 0) {
      return { success: false, message: 'Invalid product id' };
    }

    const all = await this.findAll();
    const items = Array.isArray((all as { items?: unknown }).items)
      ? ((all as { items: Array<{ id: number }> }).items)
      : [];
    const product = items.find((item) => item.id === id);

    if (!product) {
      return { success: false, message: `Product ${id} not found` };
    }

    return { success: true, item: product };
  }

  async update(
    id: number,
    updateProductDto: UpdateProductDto,
    auditActor?: AuditActorContext,
  ) {
    if (!Number.isFinite(id) || id <= 0) {
      return { success: false, message: 'Invalid product id' };
    }

    if (!updateProductDto || typeof updateProductDto !== 'object') {
      return { success: false, message: 'Invalid update payload' };
    }

    try {
      const result = await this.databaseService.withTransaction(async (client) => {
        const existingResult = await client.query<{
          id: number;
          brand_id: string | null;
          product_name: string | null;
        }>(
          `SELECT
             p.id,
             COALESCE(
               to_jsonb(p)->>'brandId',
               to_jsonb(p)->>'brand_id',
               to_jsonb(p)->>'brandid'
             ) AS brand_id,
             COALESCE(
               to_jsonb(p)->>'productName',
               to_jsonb(p)->>'product_name',
               to_jsonb(p)->>'productname'
             ) AS product_name
           FROM tblproducts p
           WHERE p.id = $1
           LIMIT 1`,
          [id],
        );

        if (existingResult.rowCount === 0) {
          return { success: false, message: `Product ${id} not found` };
        }

        const existing = existingResult.rows[0];

        const availableColumns = await this.getTableColumns(client, 'tblproducts');
        const brandColumn = this.pickColumn(availableColumns, [
          'brandId',
          'brand_id',
          'brandid',
        ]);
        const productNameColumn = this.pickColumn(availableColumns, [
          'productName',
          'product_name',
          'productname',
        ]);
        const unitTypesColumn = this.pickColumn(availableColumns, [
          'unitTypes',
          'unit_types',
          'unittypes',
        ]);
        const unitColumn = this.pickColumn(availableColumns, ['unit']);

        const updates: string[] = [];
        const values: unknown[] = [];

        const nextBrandId = Number(updateProductDto.brandId);
        if (brandColumn && Number.isFinite(nextBrandId) && nextBrandId > 0) {
          values.push(nextBrandId);
          updates.push(`"${brandColumn}" = $${values.length}`);
        }

        const nextProductName = String(updateProductDto.productName ?? '').trim();
        const hasProductNameUpdate = nextProductName.length > 0;
        if (productNameColumn && hasProductNameUpdate) {
          const duplicateBrandId =
            Number.isFinite(nextBrandId) && nextBrandId > 0
              ? String(nextBrandId)
              : String(existing.brand_id ?? '').trim();

          if (!duplicateBrandId) {
            return { success: false, message: 'Unable to resolve brand for product update' };
          }

          const duplicateCheck = await client.query<{ id: number }>(
            `SELECT id
             FROM tblproducts p
             WHERE LOWER(TRIM(COALESCE(
               to_jsonb(p)->>'productName',
               to_jsonb(p)->>'product_name',
               to_jsonb(p)->>'productname',
               ''
             ))) = LOWER(TRIM($1))
             AND COALESCE(
               to_jsonb(p)->>'brandId',
               to_jsonb(p)->>'brand_id',
               to_jsonb(p)->>'brandid'
             ) = $2::text
             AND p.id <> $3
             AND ${catalogActiveSql('p')}
             LIMIT 1`,
            [nextProductName, duplicateBrandId, id],
          );

          if (duplicateCheck.rowCount > 0) {
            return { success: false, message: 'Product already exists for this brand' };
          }

          values.push(nextProductName);
          updates.push(`"${productNameColumn}" = $${values.length}`);
        }

        if (unitColumn && typeof updateProductDto.unit === 'string') {
          const unitValue = updateProductDto.unit.trim().toUpperCase();
          if (unitValue) {
            values.push(unitValue);
            updates.push(`"${unitColumn}" = $${values.length}`);
          }
        }

        // --- Unit Types update with cascade ---
        let oldUnitTypes: string[] = [];
        let newUnitTypes: string[] = [];

        if (unitTypesColumn && Array.isArray(updateProductDto.unitTypes)) {
          newUnitTypes = updateProductDto.unitTypes
            .map((entry) => String(entry ?? '').trim())
            .filter((entry) => entry.length > 0);

          if (newUnitTypes.length > 0) {
            // Fetch old unit types before updating
            const oldResult = await client.query<{ unit_types: string | null }>(
              `SELECT COALESCE(
                to_jsonb(p)->>'unitTypes',
                to_jsonb(p)->>'unit_types',
                to_jsonb(p)->>'unittypes',
                ''
              ) AS unit_types
              FROM tblproducts p WHERE p.id = $1`,
              [id],
            );
            oldUnitTypes = String(oldResult.rows[0]?.unit_types ?? '')
              .split(',')
              .map((e) => e.trim().toLowerCase())
              .filter((e) => e.length > 0);

            values.push(newUnitTypes.join(','));
            updates.push(`"${unitTypesColumn}" = $${values.length}`);
          }
        }

        if (updates.length === 0) {
          return { success: true, message: 'No product fields changed' };
        }

        values.push(id);
        await client.query(
          `UPDATE tblproducts p
           SET ${updates.join(', ')}
           WHERE p.id = $${values.length}`,
          values,
        );

        // --- Cascade unit type changes to serial numbers and transaction items ---
        const normalizedNewTypes = newUnitTypes.map((t) => t.toLowerCase());
        const normalizedOldTypes = oldUnitTypes;
        const unitTypesChanged =
          newUnitTypes.length > 0 &&
          (normalizedOldTypes.length !== normalizedNewTypes.length ||
            normalizedOldTypes.some((t) => !normalizedNewTypes.includes(t)));

        if (unitTypesChanged || newUnitTypes.length > 0) {
          // Determine old types that no longer exist in new types (need remapping)
          const removedTypes = normalizedOldTypes.filter((t) => !normalizedNewTypes.includes(t));
          // The target type is the first new unit type (primary replacement)
          const targetType = normalizedNewTypes[0] || 'set';

          // 1. Update serial numbers: change ANY unitType that is NOT in the new types to the target
          //    This covers both: removed old types AND serials that were never updated from a prior edit
          await client.query(
            `UPDATE tblserial_numbers
             SET "unitType" = $1
             WHERE "productId" = $2
               AND LOWER(TRIM(COALESCE("unitType", ''))) <> ALL($3::text[])
               AND COALESCE("unitType", '') <> ''`,
            [targetType, id, normalizedNewTypes],
          );

          // 2. Update transaction product items: remap unitTypesQty JSONB
          // Always run this to catch stale data from prior failed cascades
          {
            const transItemsResult = await client.query<{ id: number; unitTypesQty: unknown }>(
              `SELECT tpi.id,
                      COALESCE(to_jsonb(tpi)->'unitTypesQty', to_jsonb(tpi)->'unit_types_qty', '[]'::jsonb) AS "unitTypesQty"
               FROM tbltransaction_product_items tpi
               WHERE COALESCE(to_jsonb(tpi)->>'productId', to_jsonb(tpi)->>'product_id', '')::int = $1`,
              [id],
            );

            // Determine the unitTypesQty column name
            const transColumns = await this.getTableColumns(client, 'tbltransaction_product_items');
            const uqColumn = this.pickColumn(transColumns, ['unitTypesQty', 'unit_types_qty']);

            if (uqColumn && transItemsResult.rows.length > 0) {
              for (const row of transItemsResult.rows) {
                const entries: Array<{ label: string; value: number }> = Array.isArray(row.unitTypesQty)
                  ? row.unitTypesQty
                  : [];

                if (entries.length === 0) continue;

                // Check if this row has any labels NOT in the new valid types
                const hasObsoleteLabels = entries.some(
                  (e) => !normalizedNewTypes.includes(String(e.label ?? '').trim().toLowerCase()),
                );
                if (!hasObsoleteLabels) continue;

                // Remap: keep only new valid types, merge obsolete values into target
                const remapped = new Map<string, number>();
                for (const entry of entries) {
                  const label = String(entry.label ?? '').trim().toLowerCase();
                  const value = Number(entry.value) || 0;

                  if (normalizedNewTypes.includes(label)) {
                    // Valid new type — keep its value (take max if duplicated)
                    const current = remapped.get(label) ?? 0;
                    remapped.set(label, Math.max(current, value));
                  } else {
                    // Obsolete type — merge its value into the target (use max)
                    const current = remapped.get(targetType) ?? 0;
                    remapped.set(targetType, Math.max(current, value));
                  }
                }

                // Ensure all new types are represented
                for (const nt of normalizedNewTypes) {
                  if (!remapped.has(nt)) {
                    remapped.set(nt, 0);
                  }
                }

                const newEntries = [...remapped.entries()].map(([label, value]) => ({ label, value }));

                await client.query(
                  `UPDATE tbltransaction_product_items SET "${uqColumn}" = $1::jsonb WHERE id = $2`,
                  [JSON.stringify(newEntries), row.id],
                );
              }
            }
          }
        }

        const cascadeMsg = (unitTypesChanged || newUnitTypes.length > 0)
          ? ' Unit types cascaded to serial numbers and sales orders.'
          : '';
        return { success: true, message: `Product updated successfully.${cascadeMsg}` };
      });

      if (result?.success) {
        await this.auditLogService.logMutation({
          action: 'PRODUCT_UPDATE',
          entityType: 'product',
          entityId: id,
          actor: auditActor,
          description: `Updated product #${id}`,
          requestBody: updateProductDto as unknown as Record<string, unknown>,
          after: { id, message: result.message },
        });
      }

      return result;
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to update product',
      };
    }
  }

  async findPendingCatalogAlerts(productId?: number, capacityId?: number) {
    try {
      const items = await findPendingCatalogAlerts(this.databaseService, {
        productId,
        capacityId,
      });
      return {
        success: true,
        items,
        salesOrders: items.filter((item) => item.orderType === 'sales'),
        purchaseOrders: items.filter((item) => item.orderType === 'purchase'),
      };
    } catch (error) {
      return {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : 'Failed to load pending catalog alerts',
        items: [],
        salesOrders: [],
        purchaseOrders: [],
      };
    }
  }

  async remove(id: number, userId?: number, auditActor?: AuditActorContext) {
    if (!Number.isFinite(id) || id <= 0) {
      return { success: false, message: 'Invalid product id' };
    }

    try {
      const existingResult = await this.databaseService.query<{
        id: number;
        product_name: string | null;
      }>(
        `SELECT
           p.id,
           COALESCE(
             to_jsonb(p)->>'productName',
             to_jsonb(p)->>'product_name',
             to_jsonb(p)->>'productname'
           ) AS product_name
         FROM tblproducts p
         WHERE p.id = $1
           AND ${catalogActiveSql('p')}
         LIMIT 1`,
        [id],
      );

      if (existingResult.rowCount === 0) {
        return { success: false, message: `Product ${id} not found` };
      }

      const productName = existingResult.rows[0].product_name ?? `Product ${id}`;
      const actorUserId =
        Number.isFinite(Number(userId)) && Number(userId) > 0
          ? Number(userId)
          : Number(auditActor?.userId);

      await this.databaseService.withTransaction(async (client) => {
        const productColumns = await this.getTableColumns(client, 'tblproducts');
        const productDeletedAtColumn = this.pickColumn(productColumns, [
          'deleted_at',
          'deletedAt',
        ]);
        const productDeletedByColumn = this.pickColumn(productColumns, [
          'deleted_by',
          'deletedBy',
        ]);

        if (!productDeletedAtColumn) {
          throw new Error('tblproducts.deleted_at is not configured');
        }

        const productValues: unknown[] = [new Date().toISOString()];
        const productSets = [`"${productDeletedAtColumn}" = $1`];
        if (productDeletedByColumn && Number.isFinite(actorUserId) && actorUserId > 0) {
          productValues.push(actorUserId);
          productSets.push(`"${productDeletedByColumn}" = $${productValues.length}`);
        }
        productValues.push(id);
        await client.query(
          `UPDATE tblproducts
           SET ${productSets.join(', ')}
           WHERE id = $${productValues.length}`,
          productValues,
        );

        const capacityColumns = await this.getTableColumns(client, 'tblcapacity');
        const capacityDeletedAtColumn = this.pickColumn(capacityColumns, [
          'deleted_at',
          'deletedAt',
        ]);
        const capacityDeletedByColumn = this.pickColumn(capacityColumns, [
          'deleted_by',
          'deletedBy',
        ]);
        const capacityProductIdColumn = this.pickColumn(capacityColumns, [
          'prodId',
          'productId',
          'prod_id',
          'product_id',
        ]);

        if (capacityDeletedAtColumn && capacityProductIdColumn) {
          const capacityValues: unknown[] = [new Date().toISOString()];
          const capacitySets = [`"${capacityDeletedAtColumn}" = $1`];
          if (capacityDeletedByColumn && Number.isFinite(actorUserId) && actorUserId > 0) {
            capacityValues.push(actorUserId);
            capacitySets.push(`"${capacityDeletedByColumn}" = $${capacityValues.length}`);
          }
          capacityValues.push(String(id));
          await client.query(
            `UPDATE tblcapacity c
             SET ${capacitySets.join(', ')}
             WHERE c."${capacityProductIdColumn}"::text = $${capacityValues.length}
               AND ${catalogActiveSql('c')}`,
            capacityValues,
          );
        }
      });

      const affectedPendingOrders = await findPendingCatalogAlerts(
        this.databaseService,
        { productId: id },
      );

      await this.auditLogService.logMutation({
        action: 'PRODUCT_DELETE',
        entityType: 'product',
        entityId: id,
        actor: auditActor ?? { userId: actorUserId },
        description: `Soft deleted product ${productName}`,
        before: { id, productName },
      });

      return {
        success: true,
        message: 'Product deleted successfully',
        affectedPendingOrders,
      };
    } catch (error) {
      return {
        success: false,
        message:
          error instanceof Error ? error.message : 'Failed to delete product',
      };
    }
  }
}
