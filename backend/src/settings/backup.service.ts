import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { existsSync, mkdirSync, statSync, unlinkSync, writeFileSync } from 'fs';
import { join } from 'path';
import { DatabaseService } from 'src/database/database.service';
import type { BackupType } from './dto/create-backup.dto';

export interface BackupLogRecord {
  id: number;
  backupType: string;
  fileName: string;
  fileSizeBytes: number;
  status: string;
  errorMessage: string | null;
  initiatedBy: number | null;
  initiatedByName?: string | null;
  startedAt: string;
  completedAt: string | null;
  createdAt: string;
}

@Injectable()
export class BackupService {
  private readonly logger = new Logger(BackupService.name);
  private readonly backupDir: string;

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly configService: ConfigService,
  ) {
    this.backupDir = join(process.cwd(), 'backups');
    if (!existsSync(this.backupDir)) {
      mkdirSync(this.backupDir, { recursive: true });
    }
  }

  private generateFileName(backupType: BackupType): string {
    const now = new Date();
    const timestamp = now.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
    const typeLabel = backupType.replace('_', '-');
    return `backup-${typeLabel}-${timestamp}.sql`;
  }

  // ─── Pure-SQL backup generation (no pg_dump required) ───────────────────────

  private async getTableNames(): Promise<string[]> {
    const result = await this.databaseService.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables
       WHERE schemaname = 'public'
       ORDER BY tablename`,
    );
    return result.rows.map((r) => r.tablename);
  }

  private async getTableDDL(tableName: string): Promise<string> {
    // Get columns
    const cols = await this.databaseService.query<{
      column_name: string;
      data_type: string;
      udt_name: string;
      is_nullable: string;
      column_default: string | null;
      character_maximum_length: number | null;
    }>(
      `SELECT column_name, data_type, udt_name, is_nullable, column_default, character_maximum_length
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1
       ORDER BY ordinal_position`,
      [tableName],
    );

    if (cols.rows.length === 0) return '';

    const columnDefs = cols.rows.map((col) => {
      let typeName = col.data_type;
      if (col.data_type === 'USER-DEFINED') {
        typeName = col.udt_name;
      } else if (col.data_type === 'character varying') {
        typeName = col.character_maximum_length ? `VARCHAR(${col.character_maximum_length})` : 'VARCHAR';
      } else if (col.data_type === 'integer' && col.column_default?.startsWith('nextval(')) {
        typeName = 'SERIAL';
      } else if (col.data_type === 'bigint' && col.column_default?.startsWith('nextval(')) {
        typeName = 'BIGSERIAL';
      }

      let def = `  "${col.column_name}" ${typeName}`;
      if (col.is_nullable === 'NO') def += ' NOT NULL';
      // Add DEFAULT unless it's a SERIAL/BIGSERIAL (already implied)
      if (col.column_default && !typeName.includes('SERIAL')) {
        def += ` DEFAULT ${col.column_default}`;
      }
      return def;
    });

    // Get primary key
    const pkResult = await this.databaseService.query<{ column_name: string }>(
      `SELECT kcu.column_name
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name
         AND tc.table_schema = kcu.table_schema
       WHERE tc.table_schema = 'public'
         AND tc.table_name = $1
         AND tc.constraint_type = 'PRIMARY KEY'
       ORDER BY kcu.ordinal_position`,
      [tableName],
    );

    if (pkResult.rows.length > 0) {
      const pkCols = pkResult.rows.map((r) => `"${r.column_name}"`).join(', ');
      columnDefs.push(`  PRIMARY KEY (${pkCols})`);
    }

    return `CREATE TABLE IF NOT EXISTS "${tableName}" (\n${columnDefs.join(',\n')}\n);\n`;
  }

  private async getIndexes(tableName: string): Promise<string> {
    const result = await this.databaseService.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes
       WHERE schemaname = 'public' AND tablename = $1
       AND indexname NOT LIKE '%_pkey'`,
      [tableName],
    );
    if (result.rows.length === 0) return '';
    return result.rows.map((r) => `${r.indexdef};`).join('\n') + '\n';
  }

  private async getForeignKeys(tableName: string): Promise<string> {
    const result = await this.databaseService.query<{
      constraint_name: string;
      column_name: string;
      foreign_table_name: string;
      foreign_column_name: string;
    }>(
      `SELECT
         tc.constraint_name,
         kcu.column_name,
         ccu.table_name AS foreign_table_name,
         ccu.column_name AS foreign_column_name
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name
         AND tc.table_schema = kcu.table_schema
       JOIN information_schema.constraint_column_usage ccu
         ON ccu.constraint_name = tc.constraint_name
         AND ccu.table_schema = tc.table_schema
       WHERE tc.table_schema = 'public'
         AND tc.table_name = $1
         AND tc.constraint_type = 'FOREIGN KEY'`,
      [tableName],
    );

    if (result.rows.length === 0) return '';

    return result.rows.map((r) =>
      `ALTER TABLE "${tableName}" ADD CONSTRAINT "${r.constraint_name}" FOREIGN KEY ("${r.column_name}") REFERENCES "${r.foreign_table_name}" ("${r.foreign_column_name}");`,
    ).join('\n') + '\n';
  }

  private async getFunctions(): Promise<string> {
    const result = await this.databaseService.query<{ definition: string; func_name: string }>(
      `SELECT
         p.proname AS func_name,
         pg_get_functiondef(p.oid) AS definition
       FROM pg_proc p
       JOIN pg_namespace n ON p.pronamespace = n.oid
       WHERE n.nspname = 'public'
       ORDER BY p.proname`,
    );

    if (result.rows.length === 0) return '';

    return result.rows.map((r) => `${r.definition};\n`).join('\n');
  }

  private async getTriggers(): Promise<string> {
    const result = await this.databaseService.query<{ trigger_def: string }>(
      `SELECT pg_get_triggerdef(t.oid) AS trigger_def
       FROM pg_trigger t
       JOIN pg_class c ON t.tgrelid = c.oid
       JOIN pg_namespace n ON c.relnamespace = n.oid
       WHERE n.nspname = 'public'
         AND NOT t.tgisinternal
       ORDER BY c.relname, t.tgname`,
    );

    if (result.rows.length === 0) return '';

    return result.rows.map((r) => `${r.trigger_def};`).join('\n') + '\n';
  }

  private async getTableData(tableName: string): Promise<string> {
    const result = await this.databaseService.query(`SELECT * FROM "${tableName}"`);
    if (result.rows.length === 0) return '';

    const columns = Object.keys(result.rows[0]);
    const lines: string[] = [];

    for (const row of result.rows) {
      const values = columns.map((col) => {
        const val = row[col];
        if (val === null || val === undefined) return 'NULL';
        if (typeof val === 'number') return String(val);
        if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE';
        if (val instanceof Date) return `'${val.toISOString()}'`;
        // Escape single quotes
        return `'${String(val).replace(/'/g, "''")}'`;
      });

      lines.push(`INSERT INTO "${tableName}" (${columns.map((c) => `"${c}"`).join(', ')}) VALUES (${values.join(', ')});`);
    }

    return lines.join('\n') + '\n';
  }

  private async generateBackupContent(backupType: BackupType): Promise<string> {
    const parts: string[] = [];
    const tables = await this.getTableNames();
    const now = new Date().toISOString();

    parts.push(`-- Database Backup`);
    parts.push(`-- Type: ${backupType}`);
    parts.push(`-- Generated: ${now}`);
    parts.push(`-- Tables: ${tables.length}`);
    parts.push('');

    if (backupType === 'full' || backupType === 'schema_only') {
      parts.push('-- ═══════════════════════════════════════════════════════════════');
      parts.push('-- SCHEMA');
      parts.push('-- ═══════════════════════════════════════════════════════════════');
      parts.push('');

      // Table definitions
      for (const table of tables) {
        parts.push(`-- Table: ${table}`);
        const ddl = await this.getTableDDL(table);
        if (ddl) parts.push(ddl);

        const indexes = await this.getIndexes(table);
        if (indexes) parts.push(indexes);

        parts.push('');
      }

      // Foreign keys (after all tables are created)
      parts.push('-- Foreign Keys');
      for (const table of tables) {
        const fks = await this.getForeignKeys(table);
        if (fks) parts.push(fks);
      }
      parts.push('');

      // Functions
      parts.push('-- ═══════════════════════════════════════════════════════════════');
      parts.push('-- FUNCTIONS');
      parts.push('-- ═══════════════════════════════════════════════════════════════');
      parts.push('');
      const functions = await this.getFunctions();
      if (functions) parts.push(functions);

      // Triggers
      parts.push('-- ═══════════════════════════════════════════════════════════════');
      parts.push('-- TRIGGERS');
      parts.push('-- ═══════════════════════════════════════════════════════════════');
      parts.push('');
      const triggers = await this.getTriggers();
      if (triggers) parts.push(triggers);
      parts.push('');
    }

    if (backupType === 'full' || backupType === 'data_only') {
      parts.push('-- ═══════════════════════════════════════════════════════════════');
      parts.push('-- DATA');
      parts.push('-- ═══════════════════════════════════════════════════════════════');
      parts.push('');

      for (const table of tables) {
        const data = await this.getTableData(table);
        if (data) {
          parts.push(`-- Data for: ${table}`);
          parts.push(data);
          parts.push('');
        }
      }
    }

    return parts.join('\n');
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  async createBackup(backupType: BackupType, userId?: number): Promise<BackupLogRecord> {
    const fileName = this.generateFileName(backupType);
    const filePath = join(this.backupDir, fileName);

    // Insert a backup log record with status 'in_progress'
    const insertResult = await this.databaseService.query<{ id: number }>(
      `INSERT INTO tbl_backup_logs (backup_type, file_name, status, initiated_by, started_at)
       VALUES ($1, $2, 'in_progress', $3, NOW())
       RETURNING id`,
      [backupType, fileName, userId ?? null],
    );

    const logId = insertResult.rows[0].id;

    try {
      const content = await this.generateBackupContent(backupType);
      writeFileSync(filePath, content, 'utf-8');

      // Get file size
      const fileStat = statSync(filePath);
      const fileSizeBytes = fileStat.size;

      // Update log record to completed
      await this.databaseService.query(
        `UPDATE tbl_backup_logs
         SET status = 'completed', file_size_bytes = $1, completed_at = NOW()
         WHERE id = $2`,
        [fileSizeBytes, logId],
      );

      this.logger.log(`Backup completed: ${fileName} (${fileSizeBytes} bytes)`);

      return this.getBackupLog(logId);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      // Clean up partial file if it exists
      try {
        if (existsSync(filePath)) {
          unlinkSync(filePath);
        }
      } catch {
        // Ignore cleanup errors
      }

      // Update log record to failed
      await this.databaseService.query(
        `UPDATE tbl_backup_logs
         SET status = 'failed', error_message = $1, completed_at = NOW()
         WHERE id = $2`,
        [errorMessage, logId],
      );

      this.logger.error(`Backup failed: ${errorMessage}`);

      return this.getBackupLog(logId);
    }
  }

  async getBackupLogs(page = 1, pageSize = 15): Promise<{ items: BackupLogRecord[]; total: number; totalPages: number }> {
    const offset = (page - 1) * pageSize;

    const countResult = await this.databaseService.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM tbl_backup_logs`,
    );
    const total = parseInt(countResult.rows[0]?.count ?? '0', 10);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    const result = await this.databaseService.query<{
      id: number;
      backup_type: string;
      file_name: string;
      file_size_bytes: string;
      status: string;
      error_message: string | null;
      initiated_by: number | null;
      started_at: string;
      completed_at: string | null;
      created_at: string;
      initiated_by_name: string | null;
    }>(
      `SELECT
         bl.id,
         bl.backup_type,
         bl.file_name,
         bl.file_size_bytes::text AS file_size_bytes,
         bl.status,
         bl.error_message,
         bl.initiated_by,
         bl.started_at::text AS started_at,
         bl.completed_at::text AS completed_at,
         bl.created_at::text AS created_at,
         u.username AS initiated_by_name
       FROM tbl_backup_logs bl
       LEFT JOIN tblusers u ON u.id = bl.initiated_by
       ORDER BY bl.started_at DESC
       LIMIT $1 OFFSET $2`,
      [pageSize, offset],
    );

    const items: BackupLogRecord[] = result.rows.map((row) => ({
      id: row.id,
      backupType: row.backup_type,
      fileName: row.file_name,
      fileSizeBytes: parseInt(row.file_size_bytes ?? '0', 10),
      status: row.status,
      errorMessage: row.error_message,
      initiatedBy: row.initiated_by,
      initiatedByName: row.initiated_by_name,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      createdAt: row.created_at,
    }));

    return { items, total, totalPages };
  }

  async getBackupLog(id: number): Promise<BackupLogRecord> {
    const result = await this.databaseService.query<{
      id: number;
      backup_type: string;
      file_name: string;
      file_size_bytes: string;
      status: string;
      error_message: string | null;
      initiated_by: number | null;
      started_at: string;
      completed_at: string | null;
      created_at: string;
    }>(
      `SELECT
         id,
         backup_type,
         file_name,
         file_size_bytes::text AS file_size_bytes,
         status,
         error_message,
         initiated_by,
         started_at::text AS started_at,
         completed_at::text AS completed_at,
         created_at::text AS created_at
       FROM tbl_backup_logs
       WHERE id = $1`,
      [id],
    );

    const row = result.rows[0];
    return {
      id: row.id,
      backupType: row.backup_type,
      fileName: row.file_name,
      fileSizeBytes: parseInt(row.file_size_bytes ?? '0', 10),
      status: row.status,
      errorMessage: row.error_message,
      initiatedBy: row.initiated_by,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      createdAt: row.created_at,
    };
  }

  async downloadBackup(fileName: string): Promise<{ filePath: string; exists: boolean }> {
    const filePath = join(this.backupDir, fileName);
    const exists = existsSync(filePath);
    return { filePath, exists };
  }

  async deleteBackup(id: number): Promise<{ success: boolean; message: string }> {
    const log = await this.getBackupLog(id);
    if (!log) {
      return { success: false, message: 'Backup record not found' };
    }

    // Delete the file if it exists
    const filePath = join(this.backupDir, log.fileName);
    try {
      if (existsSync(filePath)) {
        unlinkSync(filePath);
      }
    } catch {
      // Continue even if file deletion fails
    }

    await this.databaseService.query(`DELETE FROM tbl_backup_logs WHERE id = $1`, [id]);

    return { success: true, message: 'Backup deleted successfully' };
  }
}
