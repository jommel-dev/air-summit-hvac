import { Injectable } from '@nestjs/common';
import { CreateBrandDto } from './dto/create-brand.dto';
import { UpdateBrandDto } from './dto/update-brand.dto';
import { DatabaseService } from 'src/database/database.service';
import { PoolClient } from 'pg';

@Injectable()
export class BrandsService {
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

  async create(createBrandDto: CreateBrandDto) {
    const brandName = String(createBrandDto.name ?? '').trim();
    if (!brandName) {
      return {
        success: false,
        message: 'Brand name is required',
      };
    }

    const columns = await this.getTableColumns(this.databaseService, 'tblbrands');
    const nameColumn = this.pickColumn(columns, ['name', 'brandName', 'brand_name']);

    if (!nameColumn) {
      return {
        success: false,
        message: 'tblbrands name column is not configured',
      };
    }

    const duplicateCheck = await this.databaseService.query<{ id: number }>(
      `SELECT b.id
       FROM tblbrands b
       WHERE LOWER(TRIM(COALESCE(to_jsonb(b)->>$1, ''))) = LOWER(TRIM($2))
       LIMIT 1`,
      [nameColumn, brandName],
    );

    if ((duplicateCheck.rowCount ?? 0) > 0) {
      return {
        success: false,
        message: 'Brand already exists',
      };
    }

    const insertResult = await this.databaseService.query<{ id: number }>(
      `INSERT INTO tblbrands ("${nameColumn}") VALUES ($1) RETURNING id`,
      [brandName],
    );

    return {
      success: true,
      message: 'Brand created successfully',
      item: {
        id: insertResult.rows[0]?.id ?? null,
        name: brandName,
      },
    };
  }

  async findAll() {
    try {
      const result = await this.databaseService.query<{
        id: number;
        name_value: string | null;
        type_value: string | null;
      }>(
        `SELECT
           b.id,
           COALESCE(
             to_jsonb(b)->>'name',
             to_jsonb(b)->>'brandName',
             to_jsonb(b)->>'brand_name'
           ) AS name_value,
           COALESCE(
             to_jsonb(b)->>'type',
             to_jsonb(b)->>'brandType',
             to_jsonb(b)->>'brand_type'
           ) AS type_value
         FROM tblbrands b
         ORDER BY b.id DESC`,
      );

      return {
        success: true,
        items: result.rows.map((row) => ({
          id: row.id,
          name: row.name_value ?? `Brand ${row.id}`,
          type: String(row.type_value ?? '').trim(),
        })),
      };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to load brands',
        items: [],
      };
    }
  }

  async findOne(id: number) {
    if (!Number.isFinite(id) || id <= 0) {
      return { success: false, message: 'Invalid brand id' };
    }

    const result = await this.databaseService.query<{
      id: number;
      name_value: string | null;
    }>(
      `SELECT
         b.id,
         COALESCE(
           to_jsonb(b)->>'name',
           to_jsonb(b)->>'brandName',
           to_jsonb(b)->>'brand_name'
         ) AS name_value
       FROM tblbrands b
       WHERE b.id = $1
       LIMIT 1`,
      [id],
    );

    if ((result.rowCount ?? 0) === 0) {
      return { success: false, message: `Brand ${id} not found` };
    }

    const row = result.rows[0];
    return {
      success: true,
      item: {
        id: row.id,
        name: row.name_value ?? `Brand ${row.id}`,
      },
    };
  }

  async update(id: number, updateBrandDto: UpdateBrandDto) {
    if (!Number.isFinite(id) || id <= 0) {
      return { success: false, message: 'Invalid brand id' };
    }

    const brandName = String(updateBrandDto.name ?? '').trim();
    if (!brandName) {
      return {
        success: false,
        message: 'Brand name is required',
      };
    }

    const columns = await this.getTableColumns(this.databaseService, 'tblbrands');
    const nameColumn = this.pickColumn(columns, ['name', 'brandName', 'brand_name']);

    if (!nameColumn) {
      return {
        success: false,
        message: 'tblbrands name column is not configured',
      };
    }

    const duplicateCheck = await this.databaseService.query<{ id: number }>(
      `SELECT b.id
       FROM tblbrands b
       WHERE b.id <> $1
         AND LOWER(TRIM(COALESCE(to_jsonb(b)->>$2, ''))) = LOWER(TRIM($3))
       LIMIT 1`,
      [id, nameColumn, brandName],
    );

    if ((duplicateCheck.rowCount ?? 0) > 0) {
      return {
        success: false,
        message: 'Brand already exists',
      };
    }

    const updateResult = await this.databaseService.query<{ id: number }>(
      `UPDATE tblbrands
       SET "${nameColumn}" = $1
       WHERE id = $2
       RETURNING id`,
      [brandName, id],
    );

    if ((updateResult.rowCount ?? 0) === 0) {
      return { success: false, message: `Brand ${id} not found` };
    }

    return {
      success: true,
      message: 'Brand updated successfully',
      item: {
        id,
        name: brandName,
      },
    };
  }

  async remove(id: number) {
    if (!Number.isFinite(id) || id <= 0) {
      return { success: false, message: 'Invalid brand id' };
    }

    const productCheck = await this.databaseService.query<{ id: number }>(
      `SELECT p.id
       FROM tblproducts p
       WHERE COALESCE(
         to_jsonb(p)->>'brandId',
         to_jsonb(p)->>'brand_id',
         to_jsonb(p)->>'brandid'
       ) = $1::text
       LIMIT 1`,
      [String(id)],
    );

    if ((productCheck.rowCount ?? 0) > 0) {
      return {
        success: false,
        message: 'Cannot delete brand with existing products',
      };
    }

    const deleteResult = await this.databaseService.query<{ id: number }>(
      `DELETE FROM tblbrands WHERE id = $1 RETURNING id`,
      [id],
    );

    if ((deleteResult.rowCount ?? 0) === 0) {
      return { success: false, message: `Brand ${id} not found` };
    }

    return {
      success: true,
      message: 'Brand deleted successfully',
    };
  }
}
