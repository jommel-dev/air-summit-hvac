import { Injectable } from '@nestjs/common';
import { DatabaseService } from 'src/database/database.service';

export interface AuditLogEntry {
  action: string;
  entityType: string;
  entityId?: string | number | null;
  userId?: number | null;
  username?: string | null;
  roleName?: string | null;
  branchId?: number | null;
  ipAddress?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface AuditActorContext {
  userId?: number | null;
  username?: string | null;
  roleName?: string | null;
  branchId?: number | null;
  ipAddress?: string | null;
}

export interface AuditFieldChange {
  field: string;
  oldValue: unknown;
  newValue: unknown;
}

export interface AuditMutationEntry {
  action: string;
  entityType: string;
  entityId?: string | number | null;
  actor?: AuditActorContext | null;
  description: string;
  requestBody?: Record<string, unknown> | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
}

type AuditLogListRow = {
  id: string;
  action: string | null;
  entityType: string | null;
  entityId: string | null;
  userId: string | null;
  username: string | null;
  roleName: string | null;
  branchId: string | null;
  ipAddress: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string | null;
};

type AuditLogCountRow = { total: string };

@Injectable()
export class AuditLogService {
  constructor(private readonly databaseService: DatabaseService) {}

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
      return 20;
    }

    return Math.min(100, Math.floor(parsed));
  }

  private toPlainMetadata(value: unknown): Record<string, unknown> | null {
    if (!value) {
      return null;
    }

    if (typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }

    try {
      const parsed = JSON.parse(String(value));
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }

  async findAll(
    query: {
      page?: unknown;
      limit?: unknown;
      search?: unknown;
      action?: unknown;
      entityType?: unknown;
    },
    branchId?: number,
  ) {
    const page = this.normalizePage(query.page);
    const limit = this.normalizeLimit(query.limit);
    const offset = (page - 1) * limit;
    const search = String(query.search ?? '').trim().toLowerCase();
    const action = String(query.action ?? '').trim().toUpperCase();
    const entityType = String(query.entityType ?? '').trim().toLowerCase();

    const params: unknown[] = [];
    const whereParts: string[] = [];

    if (branchId) {
      params.push(branchId);
      whereParts.push(`al.branch_id = $${params.length}`);
    }

    if (search) {
      params.push(`%${search}%`);
      const idx = params.length;
      whereParts.push(`(
        LOWER(COALESCE(al.action, '')) LIKE $${idx}
        OR LOWER(COALESCE(al.entity_type, '')) LIKE $${idx}
        OR LOWER(COALESCE(al.entity_id, '')) LIKE $${idx}
        OR LOWER(COALESCE(al.username, '')) LIKE $${idx}
        OR LOWER(COALESCE(al.metadata->>'description', '')) LIKE $${idx}
      )`);
    }

    if (action) {
      params.push(action);
      whereParts.push(`UPPER(COALESCE(al.action, '')) = $${params.length}`);
    }

    if (entityType) {
      params.push(entityType);
      whereParts.push(`LOWER(COALESCE(al.entity_type, '')) = $${params.length}`);
    }

    const whereSql = whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : '';

    const countResult = await this.databaseService.query<AuditLogCountRow>(
      `SELECT COUNT(*)::text AS total
       FROM tblaudit_logs al
       ${whereSql}`,
      params,
    );

    const total = Number(countResult.rows[0]?.total ?? 0);
    const listParams = [...params, limit, offset];
    const limitIndex = listParams.length - 1;
    const offsetIndex = listParams.length;

    const result = await this.databaseService.query<AuditLogListRow>(
      `SELECT
         al.id::text AS id,
         al.action,
         al.entity_type AS "entityType",
         al.entity_id AS "entityId",
         al.user_id::text AS "userId",
         al.username,
         al.role_name AS "roleName",
         al.branch_id::text AS "branchId",
         al.ip_address AS "ipAddress",
         al.metadata,
         al.created_at::text AS "createdAt"
       FROM tblaudit_logs al
       ${whereSql}
       ORDER BY al.created_at DESC, al.id DESC
       LIMIT $${limitIndex}
       OFFSET $${offsetIndex}`,
      listParams,
    );

    return {
      success: true,
      items: result.rows.map((row) => {
        const metadata = this.toPlainMetadata(row.metadata);
        return {
          id: Number(row.id),
          action: String(row.action ?? '').trim(),
          entityType: String(row.entityType ?? '').trim(),
          entityId: String(row.entityId ?? '').trim(),
          userId: row.userId ? Number(row.userId) : null,
          username: String(row.username ?? '').trim(),
          roleName: String(row.roleName ?? '').trim(),
          branchId: row.branchId ? Number(row.branchId) : null,
          ipAddress: String(row.ipAddress ?? '').trim(),
          description: String(metadata?.description ?? '').trim(),
          metadata,
          createdAt: row.createdAt,
        };
      }),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  async findOne(id: number, branchId?: number) {
    if (!Number.isFinite(id) || id <= 0) {
      return { success: false, message: 'Invalid audit log id' };
    }

    const params: unknown[] = [id];
    let branchSql = '';
    if (branchId) {
      params.push(branchId);
      branchSql = `AND al.branch_id = $2`;
    }

    const result = await this.databaseService.query<AuditLogListRow>(
      `SELECT
         al.id::text AS id,
         al.action,
         al.entity_type AS "entityType",
         al.entity_id AS "entityId",
         al.user_id::text AS "userId",
         al.username,
         al.role_name AS "roleName",
         al.branch_id::text AS "branchId",
         al.ip_address AS "ipAddress",
         al.metadata,
         al.created_at::text AS "createdAt"
       FROM tblaudit_logs al
       WHERE al.id = $1
       ${branchSql}
       LIMIT 1`,
      params,
    );

    if (result.rowCount === 0) {
      return { success: false, message: 'Audit log not found' };
    }

    const row = result.rows[0];
    const metadata = this.toPlainMetadata(row.metadata);

    return {
      success: true,
      item: {
        id: Number(row.id),
        action: String(row.action ?? '').trim(),
        entityType: String(row.entityType ?? '').trim(),
        entityId: String(row.entityId ?? '').trim(),
        userId: row.userId ? Number(row.userId) : null,
        username: String(row.username ?? '').trim(),
        roleName: String(row.roleName ?? '').trim(),
        branchId: row.branchId ? Number(row.branchId) : null,
        ipAddress: String(row.ipAddress ?? '').trim(),
        description: String(metadata?.description ?? '').trim(),
        metadata,
        createdAt: row.createdAt,
      },
    };
  }

  private normalizeRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    return value as Record<string, unknown>;
  }

  private valuesEqual(left: unknown, right: unknown): boolean {
    if (left === right) {
      return true;
    }

    if (left instanceof Date || right instanceof Date) {
      return String(left) === String(right);
    }

    if (
      left &&
      right &&
      typeof left === 'object' &&
      typeof right === 'object'
    ) {
      try {
        return JSON.stringify(left) === JSON.stringify(right);
      } catch {
        return false;
      }
    }

    return false;
  }

  private buildChangesInternal(
    before: Record<string, unknown> | null,
    after: Record<string, unknown> | null,
    prefix = '',
    depth = 0,
  ): AuditFieldChange[] {
    const beforeRecord = before ?? {};
    const afterRecord = after ?? {};
    const keys = new Set([
      ...Object.keys(beforeRecord),
      ...Object.keys(afterRecord),
    ]);
    const changes: AuditFieldChange[] = [];

    for (const key of keys) {
      const field = prefix ? `${prefix}.${key}` : key;
      const previousValue = beforeRecord[key];
      const nextValue = afterRecord[key];

      if (this.valuesEqual(previousValue, nextValue)) {
        continue;
      }

      const previousRecord = this.normalizeRecord(previousValue);
      const nextRecord = this.normalizeRecord(nextValue);
      if (depth < 2 && previousRecord && nextRecord) {
        changes.push(...this.buildChangesInternal(previousRecord, nextRecord, field, depth + 1));
        continue;
      }

      changes.push({
        field,
        oldValue: previousValue ?? null,
        newValue: nextValue ?? null,
      });
    }

    return changes;
  }

  buildChanges(
    before?: Record<string, unknown> | null,
    after?: Record<string, unknown> | null,
  ): AuditFieldChange[] {
    return this.buildChangesInternal(before ?? null, after ?? null);
  }

  async logMutation(entry: AuditMutationEntry): Promise<void> {
    const before = this.normalizeRecord(entry.before);
    const after = this.normalizeRecord(entry.after);
    const requestBody = this.normalizeRecord(entry.requestBody);
    const changes = this.buildChanges(before, after);

    await this.log({
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      userId: entry.actor?.userId ?? null,
      username: entry.actor?.username ?? null,
      roleName: entry.actor?.roleName ?? null,
      branchId: entry.actor?.branchId ?? null,
      ipAddress: entry.actor?.ipAddress ?? null,
      metadata: {
        description: entry.description,
        requestBody,
        before,
        after,
        changes,
        ...(entry.metadata ?? {}),
      },
    });
  }

  /**
   * Fire-and-forget audit log. Never throws — failures are silently swallowed
   * so that a logging failure never breaks the actual business operation.
   */
  async log(entry: AuditLogEntry): Promise<void> {
    const {
      action,
      entityType,
      entityId = null,
      userId = null,
      username = null,
      roleName = null,
      branchId = null,
      ipAddress = null,
      metadata = null,
    } = entry;

    try {
      await this.databaseService.query(
        `INSERT INTO tblaudit_logs
           (action, entity_type, entity_id, user_id, username, role_name, branch_id, ip_address, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          String(action ?? '').trim(),
          String(entityType ?? '').trim(),
          entityId != null ? String(entityId) : null,
          userId != null && Number.isFinite(Number(userId)) ? Number(userId) : null,
          username ? String(username).trim() : null,
          roleName ? String(roleName).trim() : null,
          branchId != null && Number.isFinite(Number(branchId)) ? Number(branchId) : null,
          ipAddress ? String(ipAddress).trim() : null,
          metadata ? JSON.stringify(metadata) : null,
        ],
      );
    } catch (error) {
      console.error('[AuditLogService] Failed to persist audit log', {
        action,
        entityType,
        entityId,
        error: error instanceof Error ? error.message : error,
      });
    }
  }
}
