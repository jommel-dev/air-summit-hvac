import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AuditActorContext, AuditLogService } from 'src/audit-log/audit-log.service';
import { DatabaseService } from 'src/database/database.service';
import { BEGINNING_STOCK_INSERT_SQL } from './beginning-stock.sql';
import {
  BEGINNING_STOCK_TIME_ZONE,
  beginningStockBusinessDate,
} from './beginning-stock.rules';

export type BeginningStockCaptureSource = 'cron' | 'manual';

export interface BeginningStockRow {
  id: number;
  snapshotDate: string;
  brandId: number | null;
  brandName: string | null;
  productId: number;
  productName: string | null;
  capacityId: number;
  capacityName: string | null;
  indoorStock: number;
  outdoorStock: number;
  windowStock: number;
  panelStock: number;
  otherStock: number;
  createdAt: string;
}

export interface BeginningStockCaptureResult {
  success: true;
  message: string;
  item: {
    snapshotDate: string;
    inserted: number;
    alreadyCaptured: boolean;
    source: BeginningStockCaptureSource;
  };
}

@Injectable()
export class BeginningStockService {
  private readonly logger = new Logger(BeginningStockService.name);

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly auditLogService: AuditLogService,
  ) {}

  @Cron('5 0 * * *', {
    name: 'beginning-stock-daily',
    timeZone: BEGINNING_STOCK_TIME_ZONE,
  })
  async runDailyCapture(): Promise<void> {
    const snapshotDate = beginningStockBusinessDate();

    try {
      const result = await this.captureForDate(snapshotDate, 'cron');
      this.logger.log(result.message);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown beginning stock error';
      this.logger.error(`Beginning stock capture failed for ${snapshotDate}: ${message}`);
    }
  }

  async captureToday(actor?: AuditActorContext): Promise<BeginningStockCaptureResult> {
    return this.captureForDate(beginningStockBusinessDate(), 'manual', actor);
  }

  async list(dateInput?: string) {
    const snapshotDate = dateInput?.trim() || beginningStockBusinessDate();

    if (!/^\d{4}-\d{2}-\d{2}$/.test(snapshotDate)) {
      return { success: false, message: 'date must be YYYY-MM-DD' };
    }

    const result = await this.databaseService.query<BeginningStockRow>(
      `SELECT
         id,
         snapshot_date::text AS "snapshotDate",
         brand_id AS "brandId",
         brand_name AS "brandName",
         product_id AS "productId",
         product_name AS "productName",
         capacity_id AS "capacityId",
         capacity_name AS "capacityName",
         indoor_stock AS "indoorStock",
         outdoor_stock AS "outdoorStock",
         window_stock AS "windowStock",
         panel_stock AS "panelStock",
         other_stock AS "otherStock",
         created_at::text AS "createdAt"
       FROM tblbeginning_stock
       WHERE snapshot_date = $1::date
       ORDER BY brand_name NULLS LAST, product_name NULLS LAST, capacity_name NULLS LAST, capacity_id`,
      [snapshotDate],
    );

    const rows = result.rows;
    const totals = rows.reduce(
      (sum, row) => {
        sum.indoorStock += Number(row.indoorStock) || 0;
        sum.outdoorStock += Number(row.outdoorStock) || 0;
        sum.windowStock += Number(row.windowStock) || 0;
        sum.panelStock += Number(row.panelStock) || 0;
        sum.otherStock += Number(row.otherStock) || 0;
        return sum;
      },
      {
        indoorStock: 0,
        outdoorStock: 0,
        windowStock: 0,
        panelStock: 0,
        otherStock: 0,
      },
    );

    return {
      success: true,
      item: {
        snapshotDate,
        rowCount: rows.length,
        totals,
        rows,
      },
    };
  }

  private async captureForDate(
    snapshotDate: string,
    source: BeginningStockCaptureSource,
    actor?: AuditActorContext,
  ): Promise<BeginningStockCaptureResult> {
    const item = await this.databaseService.withTransaction(async (client) => {
      await client.query(`SELECT pg_advisory_xact_lock(87421031, hashtext($1::text))`, [
        snapshotDate,
      ]);

      const existing = await client.query(
        `SELECT snapshot_date
         FROM tblbeginning_stock_capture
         WHERE snapshot_date = $1::date`,
        [snapshotDate],
      );

      if ((existing.rowCount ?? 0) > 0) {
        return { inserted: 0, alreadyCaptured: true };
      }

      const inserted = await client.query(BEGINNING_STOCK_INSERT_SQL, [snapshotDate]);
      const insertedCount = inserted.rowCount ?? 0;

      await client.query(
        `INSERT INTO tblbeginning_stock_capture (snapshot_date, row_count, source)
         VALUES ($1::date, $2, $3)`,
        [snapshotDate, insertedCount, source],
      );

      return { inserted: insertedCount, alreadyCaptured: false };
    });

    const message = item.alreadyCaptured
      ? `Beginning stock for ${snapshotDate} is already saved.`
      : `Saved beginning stock for ${snapshotDate} (${item.inserted} capacity row(s)).`;

    await this.auditLogService.log({
      action: item.alreadyCaptured ? 'BEGINNING_STOCK_SKIPPED' : 'BEGINNING_STOCK_CAPTURED',
      entityType: 'beginning-stock',
      entityId: snapshotDate,
      userId: actor?.userId ?? null,
      username: actor?.username ?? null,
      roleName: actor?.roleName ?? null,
      branchId: actor?.branchId ?? null,
      ipAddress: actor?.ipAddress ?? null,
      metadata: {
        snapshotDate,
        inserted: item.inserted,
        alreadyCaptured: item.alreadyCaptured,
        source,
      },
    });

    return {
      success: true,
      message,
      item: {
        snapshotDate,
        inserted: item.inserted,
        alreadyCaptured: item.alreadyCaptured,
        source,
      },
    };
  }
}
