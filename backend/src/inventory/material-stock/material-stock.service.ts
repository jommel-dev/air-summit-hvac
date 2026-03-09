import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';

type SqlExecutor = { query: PoolClient['query'] };

type MaterialRequirementRow = {
  line_id: number;
  material_id: number;
  qty: string | number;
};

type SalesStatusSyncInput = {
  salesOrderId: number;
  previousStatus: string | null | undefined;
  nextStatus: string | null | undefined;
  remarks?: string | null | undefined;
  userId?: number;
};

@Injectable()
export class MaterialStockService {
  private normalizeStatus(value: unknown): string {
    return String(value ?? '')
      .trim()
      .toLowerCase()
      .replace(/[\s_]+/g, '-');
  }

  private toNumber(value: unknown): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private async tableExists(executor: SqlExecutor, tableName: string): Promise<boolean> {
    const result = await executor.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1
         FROM information_schema.tables
         WHERE table_schema = current_schema()
           AND table_name = $1
       ) AS exists`,
      [tableName],
    );

    return Boolean(result.rows[0]?.exists);
  }

  private async hasRequiredMaterialTables(executor: SqlExecutor): Promise<boolean> {
    const required = [
      'tblproduct_capacity_material_map',
      'tblmaterial_stock_balance',
      'tblmaterial_stock_movement',
    ];

    for (const tableName of required) {
      const exists = await this.tableExists(executor, tableName);
      if (!exists) {
        return false;
      }
    }

    return true;
  }

  private async getPurchaseMaterialRequirements(
    executor: SqlExecutor,
    purchaseId: number,
  ): Promise<MaterialRequirementRow[]> {
    const result = await executor.query<MaterialRequirementRow>(
      `SELECT
         tpi.id AS line_id,
         pcm.material_id,
         (
           COALESCE(NULLIF(
             COALESCE(
               to_jsonb(tpi)->>'totalSetQty',
               to_jsonb(tpi)->>'total_set_qty',
               '0'
             ),
             ''
           )::numeric, 0)
           * COALESCE(pcm.qty_per_set, 1)
         )::text AS qty
       FROM tbltransaction_product_items tpi
       INNER JOIN tblproduct_capacity_material_map pcm
         ON pcm.product_id::text = COALESCE(to_jsonb(tpi)->>'productId', to_jsonb(tpi)->>'product_id', '')
        AND pcm.capacity_id::text = COALESCE(to_jsonb(tpi)->>'capacityId', to_jsonb(tpi)->>'capacity_id', '')
       WHERE COALESCE(
           to_jsonb(tpi)->>'purchaseId',
           to_jsonb(tpi)->>'purchase_id',
           to_jsonb(tpi)->>'po_id',
           ''
         ) = $1
         AND LOWER(COALESCE(
           to_jsonb(tpi)->>'transType',
           to_jsonb(tpi)->>'trans_type',
           'purchase'
         )) = 'purchase'
         AND COALESCE(pcm.is_active, true) = true`,
      [String(purchaseId)],
    );

    return result.rows.filter((row) => this.toNumber(row.qty) > 0);
  }

  private async getSalesMaterialRequirements(
    executor: SqlExecutor,
    salesOrderId: number,
  ): Promise<MaterialRequirementRow[]> {
    const result = await executor.query<MaterialRequirementRow>(
      `SELECT
         tpi.id AS line_id,
         pcm.material_id,
         (
           COALESCE(NULLIF(
             COALESCE(
               to_jsonb(tpi)->>'totalSetQty',
               to_jsonb(tpi)->>'total_set_qty',
               '0'
             ),
             ''
           )::numeric, 0)
           * COALESCE(pcm.qty_per_set, 1)
         )::text AS qty
       FROM tbltransaction_product_items tpi
       INNER JOIN tblproduct_capacity_material_map pcm
         ON pcm.product_id::text = COALESCE(to_jsonb(tpi)->>'productId', to_jsonb(tpi)->>'product_id', '')
        AND pcm.capacity_id::text = COALESCE(to_jsonb(tpi)->>'capacityId', to_jsonb(tpi)->>'capacity_id', '')
       WHERE COALESCE(
           to_jsonb(tpi)->>'salesId',
           to_jsonb(tpi)->>'sales_id',
           ''
         ) = $1
         AND LOWER(COALESCE(
           to_jsonb(tpi)->>'transType',
           to_jsonb(tpi)->>'trans_type',
           'sales'
         )) = 'sales'
         AND COALESCE(pcm.is_active, true) = true`,
      [String(salesOrderId)],
    );

    return result.rows.filter((row) => this.toNumber(row.qty) > 0);
  }

  private async ensureBalanceRow(executor: SqlExecutor, materialId: number): Promise<void> {
    await executor.query(
      `INSERT INTO tblmaterial_stock_balance (material_id, on_hand, reserved)
       VALUES ($1, 0, 0)
       ON CONFLICT (material_id) DO NOTHING`,
      [materialId],
    );
  }

  private async lockBalanceRow(
    executor: SqlExecutor,
    materialId: number,
  ): Promise<{ on_hand: number; reserved: number }> {
    await this.ensureBalanceRow(executor, materialId);

    const result = await executor.query<{ on_hand: string | number; reserved: string | number }>(
      `SELECT on_hand, reserved
       FROM tblmaterial_stock_balance
       WHERE material_id = $1
       FOR UPDATE`,
      [materialId],
    );

    return {
      on_hand: this.toNumber(result.rows[0]?.on_hand),
      reserved: this.toNumber(result.rows[0]?.reserved),
    };
  }

  private async tryInsertMovement(
    executor: SqlExecutor,
    input: {
      materialId: number;
      movementType: 'IN' | 'OUT' | 'RESERVE' | 'RELEASE' | 'RETURN' | 'ADJUST';
      qty: number;
      sourceType: 'PO' | 'SO' | 'MANUAL';
      sourceId: number;
      sourceLineKey: string;
      statusSnapshot?: string;
      remarks?: string;
      userId?: number;
    },
  ): Promise<boolean> {
    const result = await executor.query<{ id: number }>(
      `INSERT INTO tblmaterial_stock_movement (
         material_id,
         movement_type,
         qty,
         source_type,
         source_id,
         source_line_key,
         status_snapshot,
         remarks,
         created_by
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (source_type, source_id, movement_type, source_line_key)
       DO NOTHING
       RETURNING id`,
      [
        input.materialId,
        input.movementType,
        input.qty,
        input.sourceType,
        input.sourceId,
        input.sourceLineKey,
        input.statusSnapshot ?? null,
        input.remarks ?? null,
        input.userId ?? null,
      ],
    );

    return (result.rowCount ?? 0) > 0;
  }

  async applyInboundFromPo(
    executor: SqlExecutor,
    purchaseId: number,
    statusSnapshot: string,
    userId?: number,
  ): Promise<{ posted: number; skipped: number; reason?: string }> {
    if (!(await this.hasRequiredMaterialTables(executor))) {
      return { posted: 0, skipped: 0, reason: 'Material inventory tables are not ready' };
    }

    const requirements = await this.getPurchaseMaterialRequirements(executor, purchaseId);
    let posted = 0;
    let skipped = 0;

    for (const req of requirements) {
      const qty = this.toNumber(req.qty);
      if (qty <= 0) {
        skipped += 1;
        continue;
      }

      const inserted = await this.tryInsertMovement(executor, {
        materialId: req.material_id,
        movementType: 'IN',
        qty,
        sourceType: 'PO',
        sourceId: purchaseId,
        sourceLineKey: `po-line-${req.line_id}-mat-${req.material_id}`,
        statusSnapshot,
        userId,
      });

      if (!inserted) {
        skipped += 1;
        continue;
      }

      await this.ensureBalanceRow(executor, req.material_id);
      await executor.query(
        `UPDATE tblmaterial_stock_balance
         SET
           on_hand = on_hand + $2,
           updated_at = now()
         WHERE material_id = $1`,
        [req.material_id, qty],
      );

      posted += 1;
    }

    return { posted, skipped };
  }

  private async reserveFromSo(
    executor: SqlExecutor,
    salesOrderId: number,
    statusSnapshot: string,
    userId?: number,
  ): Promise<{ posted: number; skipped: number }> {
    const requirements = await this.getSalesMaterialRequirements(executor, salesOrderId);
    let posted = 0;
    let skipped = 0;

    for (const req of requirements) {
      const qty = this.toNumber(req.qty);
      if (qty <= 0) {
        skipped += 1;
        continue;
      }

      const inserted = await this.tryInsertMovement(executor, {
        materialId: req.material_id,
        movementType: 'RESERVE',
        qty,
        sourceType: 'SO',
        sourceId: salesOrderId,
        sourceLineKey: `so-line-${req.line_id}-mat-${req.material_id}`,
        statusSnapshot,
        userId,
      });

      if (!inserted) {
        skipped += 1;
        continue;
      }

      const balance = await this.lockBalanceRow(executor, req.material_id);
      const available = balance.on_hand - balance.reserved;
      if (available < qty) {
        throw new Error(
          `Insufficient material stock for material ${req.material_id}. Required ${qty}, available ${available}.`,
        );
      }

      await executor.query(
        `UPDATE tblmaterial_stock_balance
         SET
           reserved = reserved + $2,
           updated_at = now()
         WHERE material_id = $1`,
        [req.material_id, qty],
      );

      posted += 1;
    }

    return { posted, skipped };
  }

  private async outboundFromSo(
    executor: SqlExecutor,
    salesOrderId: number,
    statusSnapshot: string,
    userId?: number,
  ): Promise<{ posted: number; skipped: number }> {
    const requirements = await this.getSalesMaterialRequirements(executor, salesOrderId);
    let posted = 0;
    let skipped = 0;

    for (const req of requirements) {
      const qty = this.toNumber(req.qty);
      if (qty <= 0) {
        skipped += 1;
        continue;
      }

      const inserted = await this.tryInsertMovement(executor, {
        materialId: req.material_id,
        movementType: 'OUT',
        qty,
        sourceType: 'SO',
        sourceId: salesOrderId,
        sourceLineKey: `so-line-${req.line_id}-mat-${req.material_id}`,
        statusSnapshot,
        userId,
      });

      if (!inserted) {
        skipped += 1;
        continue;
      }

      const balance = await this.lockBalanceRow(executor, req.material_id);
      if (balance.on_hand < qty) {
        throw new Error(
          `Insufficient on-hand material stock for material ${req.material_id}. Required ${qty}, on-hand ${balance.on_hand}.`,
        );
      }

      const reservedToConsume = Math.min(balance.reserved, qty);
      await executor.query(
        `UPDATE tblmaterial_stock_balance
         SET
           on_hand = on_hand - $2,
           reserved = GREATEST(0, reserved - $3),
           updated_at = now()
         WHERE material_id = $1`,
        [req.material_id, qty, reservedToConsume],
      );

      posted += 1;
    }

    return { posted, skipped };
  }

  private async releaseFromSo(
    executor: SqlExecutor,
    salesOrderId: number,
    statusSnapshot: string,
    remarks: string,
    userId?: number,
  ): Promise<{ posted: number; skipped: number }> {
    const requirements = await this.getSalesMaterialRequirements(executor, salesOrderId);
    let posted = 0;
    let skipped = 0;

    for (const req of requirements) {
      const qty = this.toNumber(req.qty);
      if (qty <= 0) {
        skipped += 1;
        continue;
      }

      const inserted = await this.tryInsertMovement(executor, {
        materialId: req.material_id,
        movementType: 'RELEASE',
        qty,
        sourceType: 'SO',
        sourceId: salesOrderId,
        sourceLineKey: `so-line-${req.line_id}-mat-${req.material_id}`,
        statusSnapshot,
        remarks,
        userId,
      });

      if (!inserted) {
        skipped += 1;
        continue;
      }

      const balance = await this.lockBalanceRow(executor, req.material_id);
      const qtyToRelease = Math.min(balance.reserved, qty);
      if (qtyToRelease <= 0) {
        skipped += 1;
        continue;
      }

      await executor.query(
        `UPDATE tblmaterial_stock_balance
         SET
           reserved = GREATEST(0, reserved - $2),
           updated_at = now()
         WHERE material_id = $1`,
        [req.material_id, qtyToRelease],
      );

      posted += 1;
    }

    return { posted, skipped };
  }

  async applyFromSalesStatusChange(
    executor: SqlExecutor,
    input: SalesStatusSyncInput,
  ): Promise<{
    action: 'none' | 'reserve' | 'outbound' | 'release';
    posted: number;
    skipped: number;
    reason?: string;
  }> {
    if (!(await this.hasRequiredMaterialTables(executor))) {
      return {
        action: 'none',
        posted: 0,
        skipped: 0,
        reason: 'Material inventory tables are not ready',
      };
    }

    const prev = this.normalizeStatus(input.previousStatus);
    const next = this.normalizeStatus(input.nextStatus);
    const normalizedRemarks = String(input.remarks ?? '').trim().toLowerCase();

    const isReturnToPending =
      next === 'pending' &&
      prev === 'for-delivery' &&
      normalizedRemarks.startsWith('returned units:');

    if (next === 'for-delivery' && prev !== 'for-delivery') {
      const result = await this.reserveFromSo(
        executor,
        input.salesOrderId,
        next,
        input.userId,
      );
      return { action: 'reserve', ...result };
    }

    if (
      ['remitted', 'complete', 'completed'].includes(next) &&
      !['remitted', 'complete', 'completed'].includes(prev)
    ) {
      const result = await this.outboundFromSo(
        executor,
        input.salesOrderId,
        next,
        input.userId,
      );
      return { action: 'outbound', ...result };
    }

    if (next === 'return' || next === 'returned' || isReturnToPending) {
      const result = await this.releaseFromSo(
        executor,
        input.salesOrderId,
        next,
        String(input.remarks ?? ''),
        input.userId,
      );
      return { action: 'release', ...result };
    }

    return {
      action: 'none',
      posted: 0,
      skipped: 0,
      reason: 'No material movement rule for this status transition',
    };
  }
}
