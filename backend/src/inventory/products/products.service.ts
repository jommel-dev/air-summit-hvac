import { Injectable } from '@nestjs/common';
import {
  CreateProductCapacityDto,
  CreateProductDto,
} from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { DatabaseService } from 'src/database/database.service';
import { PoolClient } from 'pg';

@Injectable()
export class ProductsService {
  constructor(private readonly databaseService: DatabaseService) {}

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

  async create(createProductDto: CreateProductDto, userId: number) {
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
             ),
             '[]'::json
           ) AS capacities
         FROM tblproducts p
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

  async update(id: number, updateProductDto: UpdateProductDto) {
    if (!Number.isFinite(id) || id <= 0) {
      return { success: false, message: 'Invalid product id' };
    }

    if (!updateProductDto || typeof updateProductDto !== 'object') {
      return { success: false, message: 'Invalid update payload' };
    }

    try {
      return await this.databaseService.withTransaction(async (client) => {
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

        if (unitTypesColumn && Array.isArray(updateProductDto.unitTypes)) {
          const unitTypes = updateProductDto.unitTypes
            .map((entry) => String(entry ?? '').trim())
            .filter((entry) => entry.length > 0);

          if (unitTypes.length > 0) {
            values.push(unitTypes.join(','));
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

        return { success: true, message: 'Product updated successfully' };
      });
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to update product',
      };
    }
  }

  remove(id: number) {
    return `This action removes a #${id} product`;
  }
}
