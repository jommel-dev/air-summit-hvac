import { Injectable } from '@nestjs/common';
import { DatabaseService } from 'src/database/database.service';
import { AuditActorContext, AuditLogService } from 'src/audit-log/audit-log.service';

@Injectable()
export class MaterialStockService {
  constructor(
    private readonly db: DatabaseService,
    private readonly auditLogService: AuditLogService,
  ) {}

  async getBalance(materialId: number) {
    const res = await this.db.query(
      `SELECT material_id, on_hand, reserved, available, updated_at FROM tblmaterial_stock_balance WHERE material_id = $1`,
      [materialId],
    );
    if (res.rowCount === 0) {
      return { material_id: materialId, on_hand: 0, reserved: 0, available: 0, updated_at: null };
    }
    return res.rows[0];
  }

  async listMovements(opts: { materialId?: number; limit?: number }) {
    const params: any[] = [];
    let where = '';
    if (opts.materialId) {
      params.push(opts.materialId);
      where = `WHERE material_id = $${params.length}`;
    }
    const q = `SELECT id, material_id, movement_type, qty, source_type, source_id, source_line_key, status_snapshot, remarks, created_by, created_at
               FROM tblmaterial_stock_movement
               ${where}
               ORDER BY created_at DESC
               LIMIT ${opts.limit ?? 100}`;
    const res = await this.db.query(q, params);
    return res.rows;
  }

  /**
   * recordMovement:
   * - Inserts a movement row (idempotent if you prefer: uses unique constraint)
   * - Updates/creates the balance row inside a transaction
   */
  async recordMovement(
    dto: {
      materialId: number;
      movementType: string;
      qty: number;
      sourceType: string;
      sourceId: number;
      sourceLineKey: string;
      statusSnapshot?: string;
      remarks?: string;
      createdBy?: number;
    },
    options?: {
      client?: { query: (text: string, params?: unknown[]) => Promise<any> };
      auditActor?: AuditActorContext;
    },
  ) {
    if (!dto.materialId || !dto.movementType || !dto.qty || !dto.sourceType || dto.sourceId === undefined || !dto.sourceLineKey) {
      throw new Error('Missing required movement fields');
    }
    if (dto.qty <= 0) {
      throw new Error('Quantity must be > 0');
    }

    const executor = options?.client ?? this.db;
    const isExternalClient = Boolean(options?.client);

    try {
      if (!isExternalClient) {
        await this.db.query('BEGIN');
      }

      // Insert movement — let unique constraint error bubble or handle idempotency by ON CONFLICT if desired
      const insertRes = await executor.query(
        `INSERT INTO tblmaterial_stock_movement
         (material_id, movement_type, qty, source_type, source_id, source_line_key, status_snapshot, remarks, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING id, material_id, movement_type, qty, source_type, source_id, source_line_key, status_snapshot, remarks, created_by, created_at`,
        [
          dto.materialId,
          dto.movementType,
          dto.qty,
          dto.sourceType,
          dto.sourceId,
          dto.sourceLineKey,
          dto.statusSnapshot ?? null,
          dto.remarks ?? null,
          dto.createdBy ?? null,
        ],
      );
      const movement = insertRes.rows[0];

      // Lock balance row for update; create if missing
      const balRes = await executor.query(
        `SELECT id, material_id, on_hand, reserved FROM tblmaterial_stock_balance WHERE material_id = $1 FOR UPDATE`,
        [dto.materialId],
      );
      if (balRes.rowCount === 0) {
        await executor.query(`INSERT INTO tblmaterial_stock_balance (material_id, on_hand, reserved) VALUES ($1, 0, 0)`, [
          dto.materialId,
        ]);
      }

      // Apply movement
      if (['IN', 'RETURN', 'ADJUST'].includes(dto.movementType)) {
        await executor.query(`UPDATE tblmaterial_stock_balance SET on_hand = on_hand + $1, updated_at = now() WHERE material_id = $2`, [
          dto.qty,
          dto.materialId,
        ]);
      } else if (dto.movementType === 'OUT') {
        await executor.query(`UPDATE tblmaterial_stock_balance SET on_hand = on_hand - $1, updated_at = now() WHERE material_id = $2`, [
          dto.qty,
          dto.materialId,
        ]);
      } else if (dto.movementType === 'RESERVE') {
        await executor.query(`UPDATE tblmaterial_stock_balance SET reserved = reserved + $1, updated_at = now() WHERE material_id = $2`, [
          dto.qty,
          dto.materialId,
        ]);
      } else if (dto.movementType === 'RELEASE') {
        await executor.query(
          `UPDATE tblmaterial_stock_balance SET reserved = GREATEST(reserved - $1, 0), updated_at = now() WHERE material_id = $2`,
          [dto.qty, dto.materialId],
        );
      } else {
        // fallback: no-op or throw
        throw new Error(`Unsupported movementType: ${dto.movementType}`);
      }

      if (!isExternalClient) {
        await this.db.query('COMMIT');
      }

      // Return current balance and movement
      const balanceRow = (await executor.query(`SELECT material_id, on_hand, reserved, available, updated_at FROM tblmaterial_stock_balance WHERE material_id = $1`, [dto.materialId])).rows[0];

      if (options?.auditActor) {
        await this.auditLogService.logMutation({
          action: 'MATERIAL_STOCK_MOVEMENT',
          entityType: 'material-stock',
          entityId: movement?.id ?? dto.materialId,
          actor: options.auditActor,
          description: `Recorded ${dto.movementType} movement of ${dto.qty} for material #${dto.materialId}`,
          requestBody: dto as unknown as Record<string, unknown>,
          after: { movement, balance: balanceRow } as unknown as Record<string, unknown>,
        });
      }

      return { movement, balance: balanceRow };
    } catch (err) {
      if (!isExternalClient) {
        await this.db.query('ROLLBACK');
      }
      throw err;
    }
  }
}
