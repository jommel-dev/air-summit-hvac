import { BadRequestException, Injectable } from '@nestjs/common';
import { DatabaseService } from 'src/database/database.service';

interface AccountTitleRow {
  id: number;
  accountNumber: string;
  description: string;
}

interface ChequeVoucherRow {
  id: number;
  cvNo: string;
  voucherType: string;
  payee: string;
  voucherDate: string;
  tinNumber: string | null;
  address: string | null;
  zipCode: string | null;
  particulars: string | null;
  releasedAt: string;
  preparedBy: string | null;
}

interface ChequeDepositPayload {
  bankName?: string;
  chequeNo?: string;
  chequeDate?: string;
  amount?: number;
}

interface InvoicePayload {
  invoiceNo?: string;
  invoiceDate?: string;
  description?: string;
  amount?: number;
}

interface VoucherAccountTitlePayload {
  accountNumber?: string;
  description?: string;
  debit?: number;
  credit?: number;
}

export interface UpsertAccountTitlePayload {
  accountNumber?: string;
  description?: string;
}

export interface CreateChequeVoucherPayload {
  voucherType?: string;
  payee?: string;
  voucherDate?: string;
  tinNumber?: string;
  address?: string;
  zipCode?: string;
  particulars?: string;
  deposits?: ChequeDepositPayload[];
  invoices?: InvoicePayload[];
  accountTitles?: VoucherAccountTitlePayload[];
  preparedBy?: string;
}

export interface UpdateChequeVoucherPayload {
  voucherType?: string;
  payee?: string;
  voucherDate?: string;
  tinNumber?: string;
  address?: string;
  zipCode?: string;
  particulars?: string;
  deposits?: ChequeDepositPayload[];
  invoices?: InvoicePayload[];
  accountTitles?: VoucherAccountTitlePayload[];
  preparedBy?: string;
}

@Injectable()
export class AccountingService {
  private readonly chequeVoucherPrefix = 'ASARTS';

  constructor(private readonly db: DatabaseService) {}

  async getAccountTitles(): Promise<AccountTitleRow[]> {
    const result = await this.db.query<AccountTitleRow>(
      `SELECT
          id,
          account_number AS "accountNumber",
          description
        FROM tblaccount_titles
        WHERE is_active = TRUE
        ORDER BY account_number ASC, description ASC`,
    );

    return result.rows;
  }

  async upsertAccountTitle(payload: UpsertAccountTitlePayload): Promise<AccountTitleRow> {
    const accountNumber = String(payload.accountNumber ?? '').trim();
    const description = String(payload.description ?? '').trim();

    if (!accountNumber || !description) {
      throw new BadRequestException('accountNumber and description are required.');
    }

    const result = await this.db.query<AccountTitleRow>(
      `INSERT INTO tblaccount_titles (account_number, description, is_active)
       VALUES ($1, $2, TRUE)
       ON CONFLICT (account_number, description)
       DO UPDATE SET
         is_active = TRUE,
         updated_at = NOW()
       RETURNING
         id,
         account_number AS "accountNumber",
         description`,
      [accountNumber, description],
    );

    return result.rows[0];
  }

  async getNextChequeVoucherNumber(): Promise<string> {
    const nextSequence = await this.getNextChequeVoucherSequence();
    return this.buildChequeVoucherNumber(nextSequence);
  }

  async listChequeVouchers(filters: { dateFrom?: string; dateTo?: string }): Promise<Array<ChequeVoucherRow & {
    deposits: Array<{ bankName: string; chequeNo: string; chequeDate: string | null; amount: number }>;
    invoices: Array<{ invoiceNo: string; invoiceDate: string | null; description: string; amount: number }>;
    accountTitles: Array<{ accountNumber: string; description: string; debit: number; credit: number }>;
  }>> {
    let dateFrom = this.normalizeDateOrNull(filters.dateFrom);
    let dateTo = this.normalizeDateOrNull(filters.dateTo);

    if (!dateFrom && !dateTo) {
      const currentDate = new Date();
      const firstDateOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
      dateFrom = this.normalizeDateOrNull(firstDateOfMonth.toISOString());
      dateTo = this.normalizeDateOrNull(currentDate.toISOString());
    }

    const voucherResult = await this.db.query<ChequeVoucherRow>(
      `SELECT
          id,
          cv_no AS "cvNo",
          voucher_type AS "voucherType",
          payee,
          voucher_date::text AS "voucherDate",
          tin_number AS "tinNumber",
          address,
          zip_code AS "zipCode",
          particulars,
          released_at::text AS "releasedAt",
          prepared_by AS "preparedBy"
        FROM tblcheque_vouchers
        WHERE ($1::date IS NULL OR voucher_date >= $1::date)
          AND ($2::date IS NULL OR voucher_date <= $2::date)
        ORDER BY voucher_date DESC, id DESC`,
      [dateFrom, dateTo],
    );

    if (voucherResult.rows.length === 0) {
      return [];
    }

    const voucherIds = voucherResult.rows.map((row) => row.id);

    const depositResult = await this.db.query<{
      voucherId: number;
      bankName: string;
      chequeNo: string;
      chequeDate: string | null;
      amount: string;
    }>(
      `SELECT
          voucher_id AS "voucherId",
          COALESCE(bank_name, '') AS "bankName",
          COALESCE(cheque_no, '') AS "chequeNo",
          cheque_date::text AS "chequeDate",
          amount::text AS amount
        FROM tblcheque_voucher_deposits
        WHERE voucher_id = ANY($1::bigint[])
        ORDER BY id ASC`,
      [voucherIds],
    );

    const invoiceResult = await this.db.query<{
      voucherId: number;
      invoiceNo: string;
      invoiceDate: string | null;
      description: string;
      amount: string;
    }>(
      `SELECT
          voucher_id AS "voucherId",
          COALESCE(invoice_no, '') AS "invoiceNo",
          invoice_date::text AS "invoiceDate",
          COALESCE(description, '') AS description,
          amount::text AS amount
        FROM tblcheque_voucher_invoices
        WHERE voucher_id = ANY($1::bigint[])
        ORDER BY id ASC`,
      [voucherIds],
    );

    const accountTitleResult = await this.db.query<{
      voucherId: number;
      accountNumber: string;
      description: string;
      debit: string;
      credit: string;
    }>(
      `SELECT
          voucher_id AS "voucherId",
          account_number AS "accountNumber",
          description,
          debit::text AS debit,
          credit::text AS credit
        FROM tblcheque_voucher_account_titles
        WHERE voucher_id = ANY($1::bigint[])
        ORDER BY id ASC`,
      [voucherIds],
    );

    const depositsByVoucher = new Map<number, Array<{ bankName: string; chequeNo: string; chequeDate: string | null; amount: number }>>();
    for (const row of depositResult.rows) {
      const list = depositsByVoucher.get(row.voucherId) ?? [];
      list.push({
        bankName: row.bankName,
        chequeNo: row.chequeNo,
        chequeDate: row.chequeDate,
        amount: Number(row.amount) || 0,
      });
      depositsByVoucher.set(row.voucherId, list);
    }

    const invoicesByVoucher = new Map<number, Array<{ invoiceNo: string; invoiceDate: string | null; description: string; amount: number }>>();
    for (const row of invoiceResult.rows) {
      const list = invoicesByVoucher.get(row.voucherId) ?? [];
      list.push({
        invoiceNo: row.invoiceNo,
        invoiceDate: row.invoiceDate,
        description: row.description,
        amount: Number(row.amount) || 0,
      });
      invoicesByVoucher.set(row.voucherId, list);
    }

    const accountTitlesByVoucher = new Map<number, Array<{ accountNumber: string; description: string; debit: number; credit: number }>>();
    for (const row of accountTitleResult.rows) {
      const list = accountTitlesByVoucher.get(row.voucherId) ?? [];
      list.push({
        accountNumber: row.accountNumber,
        description: row.description,
        debit: Number(row.debit) || 0,
        credit: Number(row.credit) || 0,
      });
      accountTitlesByVoucher.set(row.voucherId, list);
    }

    return voucherResult.rows.map((voucher) => ({
      ...voucher,
      deposits: depositsByVoucher.get(voucher.id) ?? [],
      invoices: invoicesByVoucher.get(voucher.id) ?? [],
      accountTitles: accountTitlesByVoucher.get(voucher.id) ?? [],
    }));
  }

  async releaseChequeVoucher(payload: CreateChequeVoucherPayload): Promise<ChequeVoucherRow & {
    deposits: Array<{ bankName: string; chequeNo: string; chequeDate: string | null; amount: number }>;
    invoices: Array<{ invoiceNo: string; invoiceDate: string | null; description: string; amount: number }>;
    accountTitles: Array<{ accountNumber: string; description: string; debit: number; credit: number }>;
  }> {
    const voucherType = String(payload.voucherType ?? '').trim() || 'Bank Voucher';
    const payee = String(payload.payee ?? '').trim();
    const voucherDate = this.normalizeDateOrNull(payload.voucherDate);

    if (!payee) {
      throw new BadRequestException('payee is required.');
    }

    if (!voucherDate) {
      throw new BadRequestException('voucherDate is required.');
    }

    const deposits = Array.isArray(payload.deposits)
      ? payload.deposits.map((item) => ({
          bankName: String(item.bankName ?? '').trim(),
          chequeNo: String(item.chequeNo ?? '').trim(),
          chequeDate: this.normalizeDateOrNull(item.chequeDate),
          amount: Number(item.amount) || 0,
        }))
      : [];

    const invoices = Array.isArray(payload.invoices)
      ? payload.invoices.map((item) => ({
          invoiceNo: String(item.invoiceNo ?? '').trim(),
          invoiceDate: this.normalizeDateOrNull(item.invoiceDate),
          description: String(item.description ?? '').trim(),
          amount: Number(item.amount) || 0,
        }))
      : [];

    const accountTitles = Array.isArray(payload.accountTitles)
      ? payload.accountTitles.map((item) => ({
          accountNumber: String(item.accountNumber ?? '').trim(),
          description: String(item.description ?? '').trim(),
          debit: Number(item.debit) || 0,
          credit: Number(item.credit) || 0,
        }))
      : [];

    const result = await this.db.withTransaction(async (client) => {
      await client.query('LOCK TABLE tblcheque_vouchers IN EXCLUSIVE MODE');

      const nextSequence = await this.getNextChequeVoucherSequence(client);
      const cvNo = this.buildChequeVoucherNumber(nextSequence);

      const preparedBy = this.nullIfBlank(payload.preparedBy);

      const voucherResult = await client.query<ChequeVoucherRow>(
        `INSERT INTO tblcheque_vouchers (
            cv_no,
            voucher_type,
            payee,
            voucher_date,
            tin_number,
            address,
            zip_code,
            particulars,
            prepared_by,
            released_at
          )
          VALUES ($1, $2, $3, $4::date, $5, $6, $7, $8, $9, NOW())
          RETURNING
            id,
            cv_no AS "cvNo",
            voucher_type AS "voucherType",
            payee,
            voucher_date::text AS "voucherDate",
            tin_number AS "tinNumber",
            address,
            zip_code AS "zipCode",
            particulars,
            released_at::text AS "releasedAt",
            prepared_by AS "preparedBy"`,
        [
          cvNo,
          voucherType,
          payee,
          voucherDate,
          this.nullIfBlank(payload.tinNumber),
          this.nullIfBlank(payload.address),
          this.nullIfBlank(payload.zipCode),
          this.nullIfBlank(payload.particulars),
          preparedBy,
        ],
      );

      const voucher = voucherResult.rows[0];
      if (!voucher) {
        throw new BadRequestException('Unable to create cheque voucher.');
      }

      const savedDeposits: Array<{ bankName: string; chequeNo: string; chequeDate: string | null; amount: number }> = [];
      for (const row of deposits) {
        const inserted = await client.query<{
          bankName: string;
          chequeNo: string;
          chequeDate: string | null;
          amount: string;
        }>(
          `INSERT INTO tblcheque_voucher_deposits (
              voucher_id,
              bank_name,
              cheque_no,
              cheque_date,
              amount
            )
            VALUES ($1, $2, $3, $4::date, $5)
            RETURNING
              COALESCE(bank_name, '') AS "bankName",
              COALESCE(cheque_no, '') AS "chequeNo",
              cheque_date::text AS "chequeDate",
              amount::text AS amount`,
          [voucher.id, this.nullIfBlank(row.bankName), this.nullIfBlank(row.chequeNo), row.chequeDate, row.amount],
        );

        const insertedRow = inserted.rows[0];
        if (insertedRow) {
          savedDeposits.push({
            bankName: insertedRow.bankName,
            chequeNo: insertedRow.chequeNo,
            chequeDate: insertedRow.chequeDate,
            amount: Number(insertedRow.amount) || 0,
          });
        }
      }

      const savedInvoices: Array<{ invoiceNo: string; invoiceDate: string | null; description: string; amount: number }> = [];
      for (const row of invoices) {
        const inserted = await client.query<{
          invoiceNo: string;
          invoiceDate: string | null;
          description: string;
          amount: string;
        }>(
          `INSERT INTO tblcheque_voucher_invoices (
              voucher_id,
              invoice_no,
              invoice_date,
              description,
              amount
            )
            VALUES ($1, $2, $3::date, $4, $5)
            RETURNING
              COALESCE(invoice_no, '') AS "invoiceNo",
              invoice_date::text AS "invoiceDate",
              COALESCE(description, '') AS description,
              amount::text AS amount`,
          [voucher.id, this.nullIfBlank(row.invoiceNo), row.invoiceDate, this.nullIfBlank(row.description), row.amount],
        );

        const insertedRow = inserted.rows[0];
        if (insertedRow) {
          savedInvoices.push({
            invoiceNo: insertedRow.invoiceNo,
            invoiceDate: insertedRow.invoiceDate,
            description: insertedRow.description,
            amount: Number(insertedRow.amount) || 0,
          });
        }
      }

      const savedAccountTitles: Array<{ accountNumber: string; description: string; debit: number; credit: number }> = [];
      for (const row of accountTitles) {
        if (!row.accountNumber || !row.description) {
          continue;
        }

        const accountTitleResult = await client.query<{ id: number }>(
          `INSERT INTO tblaccount_titles (account_number, description, is_active)
           VALUES ($1, $2, TRUE)
           ON CONFLICT (account_number, description)
           DO UPDATE SET
             is_active = TRUE,
             updated_at = NOW()
           RETURNING id`,
          [row.accountNumber, row.description],
        );

        const accountTitleId = accountTitleResult.rows[0]?.id ?? null;

        await client.query(
          `INSERT INTO tblcheque_voucher_account_titles (
              voucher_id,
              account_title_id,
              account_number,
              description,
              debit,
              credit
            )
            VALUES ($1, $2, $3, $4, $5, $6)`,
          [voucher.id, accountTitleId, row.accountNumber, row.description, row.debit, row.credit],
        );

        savedAccountTitles.push({
          accountNumber: row.accountNumber,
          description: row.description,
          debit: row.debit,
          credit: row.credit,
        });
      }

      return {
        ...voucher,
        deposits: savedDeposits,
        invoices: savedInvoices,
        accountTitles: savedAccountTitles,
      };
    });

    return result;
  }

  async updateChequeVoucher(
    cvNo: string,
    payload: UpdateChequeVoucherPayload,
  ): Promise<ChequeVoucherRow & {
    deposits: Array<{ bankName: string; chequeNo: string; chequeDate: string | null; amount: number }>;
    invoices: Array<{ invoiceNo: string; invoiceDate: string | null; description: string; amount: number }>;
    accountTitles: Array<{ accountNumber: string; description: string; debit: number; credit: number }>;
  }> {
    const voucherType = String(payload.voucherType ?? '').trim() || 'Bank Voucher';
    const payee = String(payload.payee ?? '').trim();
    const voucherDate = this.normalizeDateOrNull(payload.voucherDate);

    if (!payee) {
      throw new BadRequestException('payee is required.');
    }

    if (!voucherDate) {
      throw new BadRequestException('voucherDate is required.');
    }

    const deposits = Array.isArray(payload.deposits)
      ? payload.deposits.map((item) => ({
          bankName: String(item.bankName ?? '').trim(),
          chequeNo: String(item.chequeNo ?? '').trim(),
          chequeDate: this.normalizeDateOrNull(item.chequeDate),
          amount: Number(item.amount) || 0,
        }))
      : [];

    const invoices = Array.isArray(payload.invoices)
      ? payload.invoices.map((item) => ({
          invoiceNo: String(item.invoiceNo ?? '').trim(),
          invoiceDate: this.normalizeDateOrNull(item.invoiceDate),
          description: String(item.description ?? '').trim(),
          amount: Number(item.amount) || 0,
        }))
      : [];

    const accountTitles = Array.isArray(payload.accountTitles)
      ? payload.accountTitles.map((item) => ({
          accountNumber: String(item.accountNumber ?? '').trim(),
          description: String(item.description ?? '').trim(),
          debit: Number(item.debit) || 0,
          credit: Number(item.credit) || 0,
        }))
      : [];

    const result = await this.db.withTransaction(async (client) => {
      const preparedBy = this.nullIfBlank(payload.preparedBy);

      const voucherResult = await client.query<ChequeVoucherRow>(
        `UPDATE tblcheque_vouchers
          SET
            voucher_type = $2,
            payee = $3,
            voucher_date = $4::date,
            tin_number = $5,
            address = $6,
            zip_code = $7,
            particulars = $8,
            prepared_by = $9,
            updated_at = NOW()
          WHERE cv_no = $1
          RETURNING
            id,
            cv_no AS "cvNo",
            voucher_type AS "voucherType",
            payee,
            voucher_date::text AS "voucherDate",
            tin_number AS "tinNumber",
            address,
            zip_code AS "zipCode",
            particulars,
            released_at::text AS "releasedAt",
            prepared_by AS "preparedBy"`,
        [
          cvNo,
          voucherType,
          payee,
          voucherDate,
          this.nullIfBlank(payload.tinNumber),
          this.nullIfBlank(payload.address),
          this.nullIfBlank(payload.zipCode),
          this.nullIfBlank(payload.particulars),
          preparedBy,
        ],
      );

      const voucher = voucherResult.rows[0];
      if (!voucher) {
        throw new BadRequestException('Voucher not found.');
      }

      await client.query('DELETE FROM tblcheque_voucher_deposits WHERE voucher_id = $1', [voucher.id]);
      await client.query('DELETE FROM tblcheque_voucher_invoices WHERE voucher_id = $1', [voucher.id]);
      await client.query('DELETE FROM tblcheque_voucher_account_titles WHERE voucher_id = $1', [voucher.id]);

      const savedDeposits: Array<{ bankName: string; chequeNo: string; chequeDate: string | null; amount: number }> = [];
      for (const row of deposits) {
        const inserted = await client.query<{
          bankName: string;
          chequeNo: string;
          chequeDate: string | null;
          amount: string;
        }>(
          `INSERT INTO tblcheque_voucher_deposits (voucher_id, bank_name, cheque_no, cheque_date, amount)
            VALUES ($1, $2, $3, $4::date, $5)
            RETURNING
              COALESCE(bank_name, '') AS "bankName",
              COALESCE(cheque_no, '') AS "chequeNo",
              cheque_date::text AS "chequeDate",
              amount::text AS amount`,
          [voucher.id, this.nullIfBlank(row.bankName), this.nullIfBlank(row.chequeNo), row.chequeDate, row.amount],
        );
        const insertedRow = inserted.rows[0];
        if (insertedRow) {
          savedDeposits.push({
            bankName: insertedRow.bankName,
            chequeNo: insertedRow.chequeNo,
            chequeDate: insertedRow.chequeDate,
            amount: Number(insertedRow.amount) || 0,
          });
        }
      }

      const savedInvoices: Array<{ invoiceNo: string; invoiceDate: string | null; description: string; amount: number }> = [];
      for (const row of invoices) {
        const inserted = await client.query<{
          invoiceNo: string;
          invoiceDate: string | null;
          description: string;
          amount: string;
        }>(
          `INSERT INTO tblcheque_voucher_invoices (voucher_id, invoice_no, invoice_date, description, amount)
            VALUES ($1, $2, $3::date, $4, $5)
            RETURNING
              COALESCE(invoice_no, '') AS "invoiceNo",
              invoice_date::text AS "invoiceDate",
              COALESCE(description, '') AS description,
              amount::text AS amount`,
          [voucher.id, this.nullIfBlank(row.invoiceNo), row.invoiceDate, this.nullIfBlank(row.description), row.amount],
        );
        const insertedRow = inserted.rows[0];
        if (insertedRow) {
          savedInvoices.push({
            invoiceNo: insertedRow.invoiceNo,
            invoiceDate: insertedRow.invoiceDate,
            description: insertedRow.description,
            amount: Number(insertedRow.amount) || 0,
          });
        }
      }

      const savedAccountTitles: Array<{ accountNumber: string; description: string; debit: number; credit: number }> = [];
      for (const row of accountTitles) {
        if (!row.accountNumber || !row.description) {
          continue;
        }
        const accountTitleResult = await client.query<{ id: number }>(
          `INSERT INTO tblaccount_titles (account_number, description, is_active)
           VALUES ($1, $2, TRUE)
           ON CONFLICT (account_number, description)
           DO UPDATE SET
             is_active = TRUE,
             updated_at = NOW()
           RETURNING id`,
          [row.accountNumber, row.description],
        );
        const accountTitleId = accountTitleResult.rows[0]?.id ?? null;
        await client.query(
          `INSERT INTO tblcheque_voucher_account_titles
              (voucher_id, account_title_id, account_number, description, debit, credit)
            VALUES ($1, $2, $3, $4, $5, $6)`,
          [voucher.id, accountTitleId, row.accountNumber, row.description, row.debit, row.credit],
        );
        savedAccountTitles.push({
          accountNumber: row.accountNumber,
          description: row.description,
          debit: row.debit,
          credit: row.credit,
        });
      }

      return {
        ...voucher,
        deposits: savedDeposits,
        invoices: savedInvoices,
        accountTitles: savedAccountTitles,
      };
    });

    return result;
  }

  private async getNextChequeVoucherSequence(client?: { query: <T = unknown>(text: string, params?: unknown[]) => Promise<{ rows: T[] }> }): Promise<number> {
    const queryClient = client ?? this.db;
    const result = await queryClient.query<{ maxSequence: string | null }>(
      `SELECT
          COALESCE(MAX(CAST(SUBSTRING(cv_no FROM '([0-9]+)$') AS INTEGER)), 0)::text AS "maxSequence"
        FROM tblcheque_vouchers
        WHERE cv_no LIKE $1`,
      [`${this.chequeVoucherPrefix} %`],
    );

    return (Number(result.rows[0]?.maxSequence) || 0) + 1;
  }

  private buildChequeVoucherNumber(sequence: number): string {
    return `${this.chequeVoucherPrefix} ${String(sequence).padStart(6, '0')}`;
  }

  private normalizeDateOrNull(value: unknown): string | null {
    const trimmed = String(value ?? '').trim();
    if (!trimmed) {
      return null;
    }

    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) {
      return null;
    }

    return parsed.toISOString().slice(0, 10);
  }

  private nullIfBlank(value: unknown): string | null {
    const trimmed = String(value ?? '').trim();
    return trimmed.length > 0 ? trimmed : null;
  }
}
