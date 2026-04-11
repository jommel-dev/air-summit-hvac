import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PoolClient } from 'pg';
import { DatabaseService } from 'src/database/database.service';
import { CreateVendorDto } from './dto/create-vendor.dto';
import { UpdateVendorDto } from './dto/update-vendor.dto';
import { AuditActorContext, AuditLogService } from 'src/audit-log/audit-log.service';

@Injectable()
export class VendorService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly auditLogService: AuditLogService,
  ) {}

  private async getVendorAuditSnapshot(id: string): Promise<Record<string, unknown> | null> {
    const result = await this.findOne(id);
    if (!result.success || !result.data || typeof result.data !== 'object') {
      return null;
    }

    return result.data as Record<string, unknown>;
  }

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

    return executor.query<{ id: string }>(
      `INSERT INTO ${tableName} (${quotedColumns}) VALUES (${placeholders}) RETURNING id`,
      values,
    );
  }

  private async findVendorIdByName(vendorName: string): Promise<string | null> {
    const normalizedVendorName = String(vendorName ?? '').trim();
    if (!normalizedVendorName) {
      return null;
    }

    const existingVendorResult = await this.databaseService.query<{ id: string }>(
      `SELECT v.id::text AS id
       FROM tblvendors v
       WHERE LOWER(TRIM(COALESCE(to_jsonb(v)->>'name', to_jsonb(v)->>'vendor_name', ''))) = LOWER(TRIM($1))
       LIMIT 1`,
      [normalizedVendorName],
    );

    return existingVendorResult.rows[0]?.id ? String(existingVendorResult.rows[0].id) : null;
  }

  async create(dto: CreateVendorDto, auditActor?: AuditActorContext) {
    try {
      const vendorColumns = await this.getTableColumns(this.databaseService, 'tblvendors');
      const vendorIdColumn = this.pickColumn(vendorColumns, ['id']);
      const vendorNameColumn = this.pickColumn(vendorColumns, ['name', 'vendor_name']);
      const vendorAddressColumn = this.pickColumn(vendorColumns, ['address']);
      const contactPersonColumn = this.pickColumn(vendorColumns, ['contact_person', 'contactPerson']);
      const contactNumberColumn = this.pickColumn(vendorColumns, ['contact_number', 'contactNumber']);
      const emailColumn = this.pickColumn(vendorColumns, ['email']);
      const tinColumn = this.pickColumn(vendorColumns, ['tin_number', 'tinNumber']);
      const createdAtColumn = this.pickColumn(vendorColumns, ['created_at', 'createdAt']);
      const updatedAtColumn = this.pickColumn(vendorColumns, ['updated_at', 'updatedAt']);

      const name = String(dto.name ?? '').trim();
      if (!name) {
        return { success: false, message: 'Vendor name is required' };
      }

      if (!vendorNameColumn) {
        return { success: false, message: 'Vendor name column is missing in tblvendors' };
      }

      const existingVendorId = await this.findVendorIdByName(name);
      if (existingVendorId) {
        const record: Record<string, unknown> = {
          [vendorNameColumn]: name,
        };

        if (vendorAddressColumn && dto.address !== undefined) record[vendorAddressColumn] = String(dto.address ?? '').trim();
        if (contactPersonColumn && dto.contactPerson !== undefined) record[contactPersonColumn] = String(dto.contactPerson ?? '').trim();
        if (contactNumberColumn && dto.contactNumber !== undefined) record[contactNumberColumn] = String(dto.contactNumber ?? '').trim();
        if (emailColumn && dto.email !== undefined) record[emailColumn] = String(dto.email ?? '').trim();
        if (tinColumn && dto.tinNumber !== undefined) record[tinColumn] = String(dto.tinNumber ?? '').trim();
        if (updatedAtColumn) record[updatedAtColumn] = new Date().toISOString();

        const fields = Object.keys(record);
        const values = Object.values(record);
        const assignments = fields
          .map((field, index) => `"${field}" = $${index + 1}`)
          .join(', ');

        await this.databaseService.query(
          `UPDATE tblvendors SET ${assignments} WHERE id::text = $${fields.length + 1}`,
          [...values, existingVendorId],
        );

        const afterSnapshot = await this.getVendorAuditSnapshot(existingVendorId);
        await this.auditLogService.logMutation({
          action: 'STAKEHOLDER_UPDATE',
          entityType: 'stakeholder',
          entityId: existingVendorId,
          actor: auditActor,
          description: `Updated stakeholder ${name}`,
          requestBody: dto as unknown as Record<string, unknown>,
          before: null,
          after: afterSnapshot,
          metadata: {
            upsertMatchedExisting: true,
          },
        });

        return {
          success: true,
          data: { id: existingVendorId },
        };
      }

      const record: Record<string, unknown> = {
        [vendorNameColumn]: name,
      };

      if (vendorIdColumn) record[vendorIdColumn] = randomUUID();
      if (vendorAddressColumn && dto.address) record[vendorAddressColumn] = String(dto.address).trim();
      if (contactPersonColumn && dto.contactPerson) record[contactPersonColumn] = String(dto.contactPerson).trim();
      if (contactNumberColumn && dto.contactNumber) record[contactNumberColumn] = String(dto.contactNumber).trim();
      if (emailColumn && dto.email) record[emailColumn] = String(dto.email).trim();
      if (tinColumn && dto.tinNumber) record[tinColumn] = String(dto.tinNumber).trim();
      if (createdAtColumn) record[createdAtColumn] = new Date().toISOString();
      if (updatedAtColumn) record[updatedAtColumn] = new Date().toISOString();

      const inserted = await this.runInsert(this.databaseService, 'tblvendors', record);
      const insertedId = String(inserted.rows[0]?.id ?? '');
      const afterSnapshot = await this.getVendorAuditSnapshot(insertedId);
      await this.auditLogService.logMutation({
        action: 'STAKEHOLDER_CREATE',
        entityType: 'stakeholder',
        entityId: insertedId,
        actor: auditActor,
        description: `Created stakeholder ${name}`,
        requestBody: dto as unknown as Record<string, unknown>,
        after: afterSnapshot,
      });

      return {
        success: true,
        data: { id: insertedId },
      };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to create vendor',
      };
    }
  }

  async findAll(options: { search?: string; page?: number; limit?: number } = {}) {
    const page = Math.max(1, Number(options.page ?? 1));
    const limit = Math.max(1, Math.min(200, Number(options.limit ?? 50)));
    const offset = (page - 1) * limit;
    const search = String(options.search ?? '').trim();

    try {
      const params: unknown[] = [];
      const whereParts: string[] = [];

      if (search) {
        params.push(`%${search}%`);
        whereParts.push(`(
          LOWER(COALESCE(to_jsonb(v)->>'name', to_jsonb(v)->>'vendor_name', '')) LIKE LOWER($${params.length})
          OR LOWER(COALESCE(to_jsonb(v)->>'address', '')) LIKE LOWER($${params.length})
          OR LOWER(COALESCE(to_jsonb(v)->>'contact_person', to_jsonb(v)->>'contactPerson', '')) LIKE LOWER($${params.length})
          OR LOWER(COALESCE(to_jsonb(v)->>'contact_number', to_jsonb(v)->>'contactNumber', '')) LIKE LOWER($${params.length})
        )`);
      }

      const whereSql = whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : '';
      const countResult = await this.databaseService.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM tblvendors v ${whereSql}`,
        params,
      );
      const total = Number(countResult.rows[0]?.count ?? 0);
      const totalPages = Math.max(1, Math.ceil(total / limit));

      const listParams = [...params, limit, offset];
      const result = await this.databaseService.query<{
        id: string;
        name: string | null;
        address: string | null;
        contactPerson: string | null;
        contactNumber: string | null;
        email: string | null;
        tinNumber: string | null;
        createdAt: string | null;
        updatedAt: string | null;
      }>(
        `SELECT
           v.id::text AS id,
           COALESCE(to_jsonb(v)->>'name', to_jsonb(v)->>'vendor_name') AS name,
           COALESCE(to_jsonb(v)->>'address', '') AS address,
           COALESCE(to_jsonb(v)->>'contact_person', to_jsonb(v)->>'contactPerson', '') AS "contactPerson",
           COALESCE(to_jsonb(v)->>'contact_number', to_jsonb(v)->>'contactNumber', '') AS "contactNumber",
           COALESCE(to_jsonb(v)->>'email', '') AS email,
           COALESCE(to_jsonb(v)->>'tin_number', to_jsonb(v)->>'tinNumber', '') AS "tinNumber",
           COALESCE(to_jsonb(v)->>'created_at', to_jsonb(v)->>'createdAt', null) AS "createdAt",
           COALESCE(to_jsonb(v)->>'updated_at', to_jsonb(v)->>'updatedAt', null) AS "updatedAt"
         FROM tblvendors v
         ${whereSql}
         ORDER BY COALESCE(to_jsonb(v)->>'name', to_jsonb(v)->>'vendor_name', '') ASC
         LIMIT $${listParams.length - 1}
         OFFSET $${listParams.length}`,
        listParams,
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
        message: error instanceof Error ? error.message : 'Failed to list vendors',
        items: [],
        meta: { page, limit, total: 0, totalPages: 1 },
      };
    }
  }

  async findOne(id: string) {
    const vendorId = String(id ?? '').trim();
    if (!vendorId) {
      return { success: false, message: 'Invalid vendor id' };
    }

    try {
      const result = await this.databaseService.query<{
        id: string;
        name: string | null;
        address: string | null;
        contactPerson: string | null;
        contactNumber: string | null;
        email: string | null;
        tinNumber: string | null;
        createdAt: string | null;
        updatedAt: string | null;
      }>(
        `SELECT
           v.id::text AS id,
           COALESCE(to_jsonb(v)->>'name', to_jsonb(v)->>'vendor_name') AS name,
           COALESCE(to_jsonb(v)->>'address', '') AS address,
           COALESCE(to_jsonb(v)->>'contact_person', to_jsonb(v)->>'contactPerson', '') AS "contactPerson",
           COALESCE(to_jsonb(v)->>'contact_number', to_jsonb(v)->>'contactNumber', '') AS "contactNumber",
           COALESCE(to_jsonb(v)->>'email', '') AS email,
           COALESCE(to_jsonb(v)->>'tin_number', to_jsonb(v)->>'tinNumber', '') AS "tinNumber",
           COALESCE(to_jsonb(v)->>'created_at', to_jsonb(v)->>'createdAt', null) AS "createdAt",
           COALESCE(to_jsonb(v)->>'updated_at', to_jsonb(v)->>'updatedAt', null) AS "updatedAt"
         FROM tblvendors v
         WHERE v.id::text = $1
         LIMIT 1`,
        [vendorId],
      );

      if (result.rowCount === 0) {
        return { success: false, message: `Vendor ${vendorId} not found` };
      }

      const row = result.rows[0];
      return {
        success: true,
        data: {
          id: row.id,
          name: row.name ?? row.id,
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
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to get vendor',
      };
    }
  }

  async update(id: string, dto: UpdateVendorDto, auditActor?: AuditActorContext) {
    const vendorId = String(id ?? '').trim();
    if (!vendorId) {
      return { success: false, message: 'Invalid vendor id' };
    }

    const beforeSnapshot = await this.getVendorAuditSnapshot(vendorId);

    try {
      const vendorColumns = await this.getTableColumns(this.databaseService, 'tblvendors');
      const vendorNameColumn = this.pickColumn(vendorColumns, ['name', 'vendor_name']);
      const vendorAddressColumn = this.pickColumn(vendorColumns, ['address']);
      const contactPersonColumn = this.pickColumn(vendorColumns, ['contact_person', 'contactPerson']);
      const contactNumberColumn = this.pickColumn(vendorColumns, ['contact_number', 'contactNumber']);
      const emailColumn = this.pickColumn(vendorColumns, ['email']);
      const tinColumn = this.pickColumn(vendorColumns, ['tin_number', 'tinNumber']);
      const updatedAtColumn = this.pickColumn(vendorColumns, ['updated_at', 'updatedAt']);

      const record: Record<string, unknown> = {};
      if (vendorNameColumn && dto.name !== undefined) record[vendorNameColumn] = String(dto.name ?? '').trim();
      if (vendorAddressColumn && dto.address !== undefined) record[vendorAddressColumn] = String(dto.address ?? '').trim();
      if (contactPersonColumn && dto.contactPerson !== undefined) record[contactPersonColumn] = String(dto.contactPerson ?? '').trim();
      if (contactNumberColumn && dto.contactNumber !== undefined) record[contactNumberColumn] = String(dto.contactNumber ?? '').trim();
      if (emailColumn && dto.email !== undefined) record[emailColumn] = String(dto.email ?? '').trim();
      if (tinColumn && dto.tinNumber !== undefined) record[tinColumn] = String(dto.tinNumber ?? '').trim();
      if (updatedAtColumn) record[updatedAtColumn] = new Date().toISOString();

      const fields = Object.keys(record);
      if (fields.length === 0) {
        return { success: false, message: 'No vendor fields provided for update' };
      }

      const values = Object.values(record);
      const assignments = fields
        .map((field, index) => `"${field}" = $${index + 1}`)
        .join(', ');

      const updateResult = await this.databaseService.query(
        `UPDATE tblvendors SET ${assignments} WHERE id::text = $${fields.length + 1}`,
        [...values, vendorId],
      );

      if ((updateResult.rowCount ?? 0) === 0) {
        return { success: false, message: `Vendor ${vendorId} not found` };
      }

      const afterSnapshot = await this.getVendorAuditSnapshot(vendorId);
      await this.auditLogService.logMutation({
        action: 'STAKEHOLDER_UPDATE',
        entityType: 'stakeholder',
        entityId: vendorId,
        actor: auditActor,
        description: `Updated stakeholder ${String((afterSnapshot?.name as string | undefined) ?? vendorId).trim() || vendorId}`,
        requestBody: dto as Record<string, unknown>,
        before: beforeSnapshot,
        after: afterSnapshot,
      });

      return { success: true };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to update vendor',
      };
    }
  }

  async remove(id: string) {
    const vendorId = String(id ?? '').trim();
    if (!vendorId) {
      return { success: false, message: 'Invalid vendor id' };
    }

    try {
      const deleteResult = await this.databaseService.query(
        `DELETE FROM tblvendors WHERE id::text = $1`,
        [vendorId],
      );

      if ((deleteResult.rowCount ?? 0) === 0) {
        return { success: false, message: `Vendor ${vendorId} not found` };
      }

      return { success: true };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to delete vendor',
      };
    }
  }
}
