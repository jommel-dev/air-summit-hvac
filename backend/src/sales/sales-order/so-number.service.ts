import { BadRequestException, Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from 'src/database/database.service';

@Injectable()
export class SoNumberService {
  /**
   * Peeks at the next SO number that would be generated (without incrementing).
   * This is a non-locking read for preview purposes.
   */
  async peekNext(databaseService: DatabaseService): Promise<string> {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const yearMonth = `${year}-${month.toString().padStart(2, '0')}`;

    try {
      const result = await databaseService.query<{ last_sequence: number }>(
        `SELECT last_sequence FROM tblso_number_sequences WHERE year_month = $1`,
        [yearMonth],
      );

      const nextSequence = result.rowCount > 0 ? result.rows[0].last_sequence + 1 : 1;
      return this.formatSoNumber(year, month, nextSequence);
    } catch {
      // Table may not exist yet (migration not applied) — fall back to counting current month's orders
      try {
        const countResult = await databaseService.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM tblsales_order WHERE created_at >= DATE_TRUNC('month', NOW())`,
          [],
        );
        const count = Number(countResult.rows[0]?.count ?? 0);
        return this.formatSoNumber(year, month, count + 1);
      } catch {
        // If even that fails, just show sequence 1
        return this.formatSoNumber(year, month, 1);
      }
    }
  }

  /**
   * Generates the next SO number within a transaction.
   * Uses SELECT FOR UPDATE to prevent concurrent duplicates.
   * @param client - The active PoolClient (must be within a transaction)
   * @param createdAt - Optional timestamp override for year-month derivation (defaults to NOW)
   * @returns The formatted SO number string (e.g., 'SO2026-0600001')
   * @throws BadRequestException if monthly sequence exceeds 99999
   */
  async generateNext(client: PoolClient, createdAt?: Date): Promise<string> {
    const timestamp = createdAt ?? new Date();
    const year = timestamp.getFullYear();
    const month = timestamp.getMonth() + 1;
    const yearMonth = `${year}-${month.toString().padStart(2, '0')}`;

    // Attempt to lock the existing row for this year-month
    const selectResult = await client.query<{ last_sequence: number }>(
      `SELECT last_sequence FROM tblso_number_sequences WHERE year_month = $1 FOR UPDATE`,
      [yearMonth],
    );

    let sequence: number;

    if (selectResult.rowCount > 0) {
      // Row exists — increment the sequence
      const updateResult = await client.query<{ last_sequence: number }>(
        `UPDATE tblso_number_sequences
         SET last_sequence = last_sequence + 1, updated_at = NOW()
         WHERE year_month = $1
         RETURNING last_sequence`,
        [yearMonth],
      );
      sequence = updateResult.rows[0].last_sequence;
    } else {
      // No row — insert a new row with sequence = 1
      const insertResult = await client.query<{ last_sequence: number }>(
        `INSERT INTO tblso_number_sequences (year_month, last_sequence)
         VALUES ($1, 1)
         RETURNING last_sequence`,
        [yearMonth],
      );
      sequence = insertResult.rows[0].last_sequence;
    }

    if (sequence > 99999) {
      throw new BadRequestException(
        `Monthly SO number limit (99999) reached for ${yearMonth}`,
      );
    }

    return this.formatSoNumber(year, month, sequence);
  }

  /**
   * Formats a sequence number into the SO number string.
   * @param year - 4-digit year
   * @param month - Month number (1-12)
   * @param sequence - Sequence number (1-99999)
   * @returns Formatted SO number (e.g., 'SO2026-0600001')
   */
  formatSoNumber(year: number, month: number, sequence: number): string {
    return `${year}-${month.toString().padStart(2, '0')}${sequence.toString().padStart(5, '0')}`;
  }
}
