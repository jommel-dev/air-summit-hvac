import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from 'src/database/database.service';

export type SerialEventType =
  | 'SCANNED_IN_PO'
  | 'REMOVED_FROM_PO'
  | 'ASSIGNED_TO_SO'
  | 'REMOVED_FROM_SO'
  | 'TRANSFERRED'
  | 'ASSIGNED_ORDER'
  | 'DELIVERED'
  | 'RETURNED'
  | 'MARKED_DEFECTIVE'
  | 'STATUS_CHANGED'
  | 'BRANCH_CHANGED'
  | 'CUSTOMER_CHANGED'
  | 'FORCE_INSERT_SO';

export interface LogEventParams {
  serialId: number;
  serialNumber: string;
  eventType: SerialEventType;
  previousStatus?: string | null;
  newStatus?: string | null;
  previousPurchaseId?: number | null;
  newPurchaseId?: number | null;
  previousSalesId?: number | null;
  newSalesId?: number | null;
  previousBranchId?: number | null;
  newBranchId?: number | null;
  previousCustomerId?: string | null;
  newCustomerId?: string | null;
  performedBy?: number | null;
  performedByUsername?: string | null;
  ipAddress?: string | null;
  reason?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface SerialEvent {
  id: number;
  serialId: number;
  serialNumber: string;
  eventType: string;
  previousStatus: string | null;
  newStatus: string | null;
  previousPurchaseId: number | null;
  newPurchaseId: number | null;
  previousSalesId: number | null;
  newSalesId: number | null;
  previousBranchId: number | null;
  newBranchId: number | null;
  previousCustomerId: string | null;
  newCustomerId: string | null;
  performedBy: number | null;
  performedByUsername: string | null;
  ipAddress: string | null;
  reason: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

@Injectable()
export class SerialEventLogService {
  constructor(private readonly databaseService: DatabaseService) {}

  async logEvent(params: LogEventParams, client?: PoolClient): Promise<void> {
    const sql = `
      INSERT INTO tblserial_number_events (
        serial_id, serial_number, event_type,
        previous_status, new_status,
        previous_purchase_id, new_purchase_id,
        previous_sales_id, new_sales_id,
        previous_branch_id, new_branch_id,
        previous_customer_id, new_customer_id,
        performed_by, performed_by_username,
        ip_address, reason, metadata
      ) VALUES (
        $1, $2, $3,
        $4, $5,
        $6, $7,
        $8, $9,
        $10, $11,
        $12, $13,
        $14, $15,
        $16, $17, $18
      )
    `;

    const values = [
      params.serialId,
      params.serialNumber,
      params.eventType,
      params.previousStatus ?? null,
      params.newStatus ?? null,
      params.previousPurchaseId ?? null,
      params.newPurchaseId ?? null,
      params.previousSalesId ?? null,
      params.newSalesId ?? null,
      params.previousBranchId ?? null,
      params.newBranchId ?? null,
      params.previousCustomerId ?? null,
      params.newCustomerId ?? null,
      params.performedBy ?? null,
      params.performedByUsername ?? null,
      params.ipAddress ?? null,
      params.reason ?? null,
      params.metadata ? JSON.stringify(params.metadata) : null,
    ];

    try {
      if (client) {
        await client.query(sql, values);
      } else {
        await this.databaseService.query(sql, values);
      }
    } catch (error) {
      console.error('Failed to log serial event:', error);
    }
  }

  async getHistoryBySerialId(serialId: number): Promise<SerialEvent[]> {
    const sql = `
      SELECT * FROM tblserial_number_events
      WHERE serial_id = $1
      ORDER BY created_at DESC
    `;

    const result = await this.databaseService.query(sql, [serialId]);
    return this.mapRows(result.rows);
  }

  async getHistoryBySerialNumber(serialNumber: string): Promise<SerialEvent[]> {
    const sql = `
      SELECT * FROM tblserial_number_events
      WHERE serial_number = $1
      ORDER BY created_at DESC
    `;

    const result = await this.databaseService.query(sql, [serialNumber]);
    return this.mapRows(result.rows);
  }

  private mapRows(rows: any[]): SerialEvent[] {
    return rows.map((row) => ({
      id: row.id,
      serialId: row.serial_id,
      serialNumber: row.serial_number,
      eventType: row.event_type,
      previousStatus: row.previous_status,
      newStatus: row.new_status,
      previousPurchaseId: row.previous_purchase_id,
      newPurchaseId: row.new_purchase_id,
      previousSalesId: row.previous_sales_id,
      newSalesId: row.new_sales_id,
      previousBranchId: row.previous_branch_id,
      newBranchId: row.new_branch_id,
      previousCustomerId: row.previous_customer_id,
      newCustomerId: row.new_customer_id,
      performedBy: row.performed_by,
      performedByUsername: row.performed_by_username,
      ipAddress: row.ip_address,
      reason: row.reason,
      metadata: row.metadata,
      createdAt: row.created_at,
    }));
  }
}
