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

@Injectable()
export class AuditLogService {
  constructor(private readonly databaseService: DatabaseService) {}

  /**
   * Fire-and-forget audit log. Never throws — failures are silently swallowed
   * so that a logging failure never breaks the actual business operation.
   */
  log(entry: AuditLogEntry): void {
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

    this.databaseService
      .query(
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
      )
      .catch(() => {
        // Intentionally silent — audit log failures must not break the main flow
      });
  }
}
