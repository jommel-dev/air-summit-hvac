import { Injectable, OnModuleInit } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

export interface ScanLogEntry {
  timestamp: string;
  type: 'purchase' | 'sales';
  serialNumber: string;
  productId: number | null;
  capacityId: number | null;
  unitType: string | null;
  orderId: number | null;
  orderNumber: string | null;
  success: boolean;
  message?: string;
  userId?: number | null;
}

@Injectable()
export class ScanFileLoggerService implements OnModuleInit {
  private readonly logDir: string;
  private readonly retentionDays = 3;

  constructor() {
    this.logDir = path.resolve(process.cwd(), 'logs', 'serial-scans');
  }

  onModuleInit() {
    // Ensure log directory exists
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
    // Clean old logs on startup
    this.cleanOldLogs();
  }

  logScan(entry: ScanLogEntry): void {
    try {
      const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
      const filePath = path.join(this.logDir, `scan-log-${today}.jsonl`);
      const line = JSON.stringify(entry) + '\n';
      fs.appendFileSync(filePath, line, 'utf-8');
    } catch {
      // Silent fail — logging should never break the main flow
    }
  }

  logPurchaseScan(params: {
    serialNumber: string;
    productId: number | null;
    capacityId: number | null;
    unitType: string | null;
    purchaseId: number | null;
    poNumber: string | null;
    success: boolean;
    message?: string;
    userId?: number | null;
  }): void {
    this.logScan({
      timestamp: new Date().toISOString(),
      type: 'purchase',
      serialNumber: params.serialNumber,
      productId: params.productId,
      capacityId: params.capacityId,
      unitType: params.unitType,
      orderId: params.purchaseId,
      orderNumber: params.poNumber,
      success: params.success,
      message: params.message,
      userId: params.userId,
    });
  }

  logSalesScan(params: {
    serialNumber: string;
    productId: number | null;
    capacityId: number | null;
    unitType: string | null;
    salesId: number | null;
    soNumber: string | null;
    success: boolean;
    message?: string;
    userId?: number | null;
  }): void {
    this.logScan({
      timestamp: new Date().toISOString(),
      type: 'sales',
      serialNumber: params.serialNumber,
      productId: params.productId,
      capacityId: params.capacityId,
      unitType: params.unitType,
      orderId: params.salesId,
      orderNumber: params.soNumber,
      success: params.success,
      message: params.message,
      userId: params.userId,
    });
  }

  private cleanOldLogs(): void {
    try {
      const files = fs.readdirSync(this.logDir);
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - this.retentionDays);

      for (const file of files) {
        if (!file.startsWith('scan-log-') || !file.endsWith('.jsonl')) continue;
        const dateStr = file.replace('scan-log-', '').replace('.jsonl', '');
        const fileDate = new Date(dateStr);
        if (isNaN(fileDate.getTime())) continue;
        if (fileDate < cutoff) {
          fs.unlinkSync(path.join(this.logDir, file));
        }
      }
    } catch {
      // Silent fail
    }
  }

  listLogFiles(): Array<{ filename: string; date: string; sizeKb: number }> {
    try {
      if (!fs.existsSync(this.logDir)) return [];
      const files = fs.readdirSync(this.logDir)
        .filter((f) => f.startsWith('scan-log-') && f.endsWith('.jsonl'))
        .sort()
        .reverse();

      return files.map((filename) => {
        const filePath = path.join(this.logDir, filename);
        const stats = fs.statSync(filePath);
        const date = filename.replace('scan-log-', '').replace('.jsonl', '');
        return { filename, date, sizeKb: Math.round(stats.size / 1024) };
      });
    } catch {
      return [];
    }
  }

  readLogFile(date: string): ScanLogEntry[] {
    try {
      const filePath = path.join(this.logDir, `scan-log-${date}.jsonl`);
      if (!fs.existsSync(filePath)) return [];
      const content = fs.readFileSync(filePath, 'utf-8');
      return content
        .split('\n')
        .filter((line) => line.trim().length > 0)
        .map((line) => {
          try { return JSON.parse(line); }
          catch { return null; }
        })
        .filter((entry) => entry !== null);
    } catch {
      return [];
    }
  }
}
