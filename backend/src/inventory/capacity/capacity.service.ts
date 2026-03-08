import { Injectable } from '@nestjs/common';
import { CreateCapacityDto } from './dto/create-capacity.dto';
import { UpdateCapacityDto } from './dto/update-capacity.dto';
import { DatabaseService } from 'src/database/database.service';
import { PoolClient } from 'pg';

@Injectable()
export class CapacityService {
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

  async create(createCapacityDto: CreateCapacityDto) {
    const productId = Number(createCapacityDto.productId);
    const capacityValue = String(createCapacityDto.capacity ?? '').trim();
    const indoorModel = String(createCapacityDto.indoorModel ?? '').trim();
    const outdoorModel = String(createCapacityDto.outdoorModel ?? '').trim();
    const srp = Number.isFinite(Number(createCapacityDto.srp))
      ? Number(createCapacityDto.srp)
      : 0;
    const netPrice = Number.isFinite(Number(createCapacityDto.netPrice))
      ? Number(createCapacityDto.netPrice)
      : 0;

    if (!Number.isFinite(productId) || productId <= 0) {
      return {
        success: false,
        message: 'Product is required',
      };
    }

    if (!capacityValue) {
      return {
        success: false,
        message: 'Capacity is required',
      };
    }

    const columns = await this.getTableColumns(this.databaseService, 'tblcapacity');
    if (columns.length === 0) {
      return {
        success: false,
        message: 'tblcapacity table was not found in current schema',
      };
    }

    const productIdColumn = this.pickColumn(columns, [
      'prodId',
      'productId',
      'prod_id',
      'product_id',
    ]);
    const capacityColumn = this.pickColumn(columns, ['capacity', 'capacityValue']);
    const indoorModelColumn = this.pickColumn(columns, ['indoorModel', 'indoor_model']);
    const outdoorModelColumn = this.pickColumn(columns, [
      'outdoorModel',
      'outdoor_model',
    ]);
    const srpColumn = this.pickColumn(columns, ['srp', 'SRP']);
    const netPriceColumn = this.pickColumn(columns, ['netPrice', 'net_price']);

    if (
      !productIdColumn ||
      !capacityColumn ||
      !indoorModelColumn ||
      !outdoorModelColumn ||
      !srpColumn ||
      !netPriceColumn
    ) {
      return {
        success: false,
        message: 'tblcapacity columns are not aligned with required fields',
      };
    }

    const duplicateCheck = await this.databaseService.query<{ id: number }>(
      `SELECT id
       FROM tblcapacity c
       WHERE COALESCE(to_jsonb(c)->>$1, '') = $2::text
         AND LOWER(TRIM(COALESCE(to_jsonb(c)->>$3, ''))) = LOWER(TRIM($4))
       LIMIT 1`,
      [productIdColumn, String(productId), capacityColumn, capacityValue],
    );

    if ((duplicateCheck.rowCount ?? 0) > 0) {
      return {
        success: false,
        message: 'Capacity already exists for this product',
      };
    }

    const record: Record<string, unknown> = {
      [productIdColumn]: productId,
      [capacityColumn]: capacityValue,
      [indoorModelColumn]: indoorModel,
      [outdoorModelColumn]: outdoorModel,
      [srpColumn]: srp,
      [netPriceColumn]: netPrice,
    };

    const recordColumns = Object.keys(record);
    const recordValues = Object.values(record);

    const insertResult = await this.databaseService.query<{ id: number }>(
      `INSERT INTO tblcapacity (${recordColumns.map((column) => `"${column}"`).join(', ')})
       VALUES (${recordValues.map((_, index) => `$${index + 1}`).join(', ')})
       RETURNING id`,
      recordValues,
    );

    return {
      success: true,
      message: 'Capacity added successfully',
      item: {
        id: insertResult.rows[0]?.id ?? null,
      },
    };
  }

  findAll() {
    return `This action returns all capacity`;
  }

  findOne(id: number) {
    return `This action returns a #${id} capacity`;
  }

  async update(id: number, updateCapacityDto: UpdateCapacityDto) {
    if (!Number.isFinite(id) || id <= 0) {
      return { success: false, message: 'Invalid capacity id' };
    }

    if (!updateCapacityDto || typeof updateCapacityDto !== 'object') {
      return { success: false, message: 'Invalid update payload' };
    }

    try {
      return await this.databaseService.withTransaction(async (client) => {
        const columns = await this.getTableColumns(client, 'tblcapacity');
        if (columns.length === 0) {
          return {
            success: false,
            message: 'tblcapacity table was not found in current schema',
          };
        }

        const idColumn = this.pickColumn(columns, ['id']);
        const productIdColumn = this.pickColumn(columns, [
          'prodId',
          'productId',
          'prod_id',
          'product_id',
        ]);
        const capacityColumn = this.pickColumn(columns, ['capacity', 'capacityValue']);
        const indoorModelColumn = this.pickColumn(columns, ['indoorModel', 'indoor_model']);
        const outdoorModelColumn = this.pickColumn(columns, ['outdoorModel', 'outdoor_model']);
        const srpColumn = this.pickColumn(columns, ['srp', 'SRP']);
        const netPriceColumn = this.pickColumn(columns, ['netPrice', 'net_price']);

        if (!idColumn || !productIdColumn || !capacityColumn) {
          return {
            success: false,
            message: 'tblcapacity columns are not aligned with required fields',
          };
        }

        const existingResult = await client.query<{
          product_id: string | null;
          capacity_value: string | null;
        }>(
          `SELECT
             c."${productIdColumn}"::text AS product_id,
             c."${capacityColumn}"::text AS capacity_value
           FROM tblcapacity c
           WHERE c."${idColumn}" = $1
           LIMIT 1`,
          [id],
        );

        if (existingResult.rowCount === 0) {
          return { success: false, message: `Capacity ${id} not found` };
        }

        const existing = existingResult.rows[0];

        const updates: string[] = [];
        const values: unknown[] = [];

        const nextProductId = Number(updateCapacityDto.productId);
        const hasProductIdUpdate = Number.isFinite(nextProductId) && nextProductId > 0;
        if (hasProductIdUpdate) {
          values.push(nextProductId);
          updates.push(`"${productIdColumn}" = $${values.length}`);
        }

        const nextCapacity = String(updateCapacityDto.capacity ?? '').trim();
        const hasCapacityUpdate = nextCapacity.length > 0;
        if (hasCapacityUpdate) {
          values.push(nextCapacity);
          updates.push(`"${capacityColumn}" = $${values.length}`);
        }

        if (indoorModelColumn && typeof updateCapacityDto.indoorModel === 'string') {
          values.push(updateCapacityDto.indoorModel.trim());
          updates.push(`"${indoorModelColumn}" = $${values.length}`);
        }

        if (outdoorModelColumn && typeof updateCapacityDto.outdoorModel === 'string') {
          values.push(updateCapacityDto.outdoorModel.trim());
          updates.push(`"${outdoorModelColumn}" = $${values.length}`);
        }

        if (srpColumn && updateCapacityDto.srp !== undefined) {
          const nextSrp = Number(updateCapacityDto.srp);
          if (!Number.isFinite(nextSrp)) {
            return { success: false, message: 'srp must be a valid number' };
          }

          values.push(nextSrp);
          updates.push(`"${srpColumn}" = $${values.length}`);
        }

        if (netPriceColumn && updateCapacityDto.netPrice !== undefined) {
          const nextNetPrice = Number(updateCapacityDto.netPrice);
          if (!Number.isFinite(nextNetPrice)) {
            return { success: false, message: 'netPrice must be a valid number' };
          }

          values.push(nextNetPrice);
          updates.push(`"${netPriceColumn}" = $${values.length}`);
        }

        if (updates.length === 0) {
          return { success: true, message: 'No capacity fields changed' };
        }

        const duplicateProductId = hasProductIdUpdate
          ? String(nextProductId)
          : String(existing.product_id ?? '').trim();
        const duplicateCapacityValue = hasCapacityUpdate
          ? nextCapacity
          : String(existing.capacity_value ?? '').trim();

        if (duplicateProductId && duplicateCapacityValue) {
          const duplicateCheck = await client.query<{ id: number }>(
            `SELECT c."${idColumn}" AS id
             FROM tblcapacity c
             WHERE c."${productIdColumn}"::text = $1::text
               AND LOWER(TRIM(c."${capacityColumn}"::text)) = LOWER(TRIM($2::text))
               AND c."${idColumn}" <> $3
             LIMIT 1`,
            [duplicateProductId, duplicateCapacityValue, id],
          );

          if (duplicateCheck.rowCount > 0) {
            return {
              success: false,
              message: 'Capacity already exists for this product',
            };
          }
        }

        values.push(id);
        await client.query(
          `UPDATE tblcapacity c
           SET ${updates.join(', ')}
           WHERE c."${idColumn}" = $${values.length}`,
          values,
        );

        return { success: true, message: 'Capacity updated successfully' };
      });
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to update capacity',
      };
    }
  }

  remove(id: number) {
    return `This action removes a #${id} capacity`;
  }
}
