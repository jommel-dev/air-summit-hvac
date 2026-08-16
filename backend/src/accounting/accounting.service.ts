import { BadRequestException, Injectable } from '@nestjs/common';
import { DatabaseService } from 'src/database/database.service';
import { AuditActorContext, AuditLogService } from 'src/audit-log/audit-log.service';

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

interface GeneralJournalRow {
  id: number;
  journalNumber: string;
  journalDate: string;
  description: string;
  totalDebit: number;
  totalCredit: number;
  status: 'draft' | 'posted' | 'reversed';
  postedAt: string | null;
  referenceNumber: string | null;
}

interface GeneralJournalLinePayload {
  accountNumber?: string;
  description?: string;
  debit?: number;
  credit?: number;
}

type PrintPaperSize = 'A4' | 'LETTER' | 'LEGAL' | 'CUSTOM';
type PrintOrientation = 'portrait' | 'landscape';

interface AccountingReportPrintSettingsRow {
  reportKey: string;
  branchId: number | null;
  settings: Record<string, unknown>;
}

interface AccountingReportSignatoryConfig {
  id: string;
  label: string;
  valueSource: 'prepared_by' | 'custom';
  customValue: string;
  signatureSource: 'none' | 'preparedBy' | 'checkedBy' | 'approvedBy';
}

type DisbursementBaseColumnKey =
  | 'date'
  | 'referenceNo'
  | 'checkNo'
  | 'payee'
  | 'description'
  | 'tinNumber'
  | 'address'
  | 'zipCode'
  | 'invoice'
  | 'invoiceDate'
  | 'voucherType'
  | 'preparedBy'
  | 'releasedAt'
  | 'bankName'
  | 'chequeDate';

interface DisbursementBaseColumnPayload {
  id: string;
  key: DisbursementBaseColumnKey;
  label: string;
}

interface DisbursementDefaultColumnPayload {
  id: string;
  accountNumber: string;
  label: string;
  side: 'DR' | 'CR';
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

export interface CreateGeneralJournalPayload {
  journalNo?: string;
  journalDate?: string;
  description?: string;
  sundries?: GeneralJournalLinePayload[];
}

export interface UpdateGeneralJournalPayload {
  journalDate?: string;
  description?: string;
  sundries?: GeneralJournalLinePayload[];
}

export interface AccountingReportPrintSettingsPayload {
  showHeader?: boolean;
  showLogo?: boolean;
  showAddress?: boolean;
  showPreparedBy?: boolean;
  showSignatureLine?: boolean;
  showChequeDetails?: boolean;
  paperSize?: string;
  orientation?: string;
  customWidthMm?: number;
  customHeightMm?: number;
  marginTopMm?: number;
  marginRightMm?: number;
  marginBottomMm?: number;
  marginLeftMm?: number;
  defaultAddress?: string;
  footerLeft?: string;
  footerCenter?: string;
  footerRight?: string;
  signatories?: unknown[];
  baseColumns?: unknown[];
  defaultColumns?: unknown[];
}

@Injectable()
export class AccountingService {
  constructor(
    private readonly db: DatabaseService,
    private readonly auditLogService: AuditLogService,
  ) {}

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

  async upsertAccountTitle(
    payload: UpsertAccountTitlePayload,
    auditActor?: AuditActorContext,
  ): Promise<AccountTitleRow> {
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

    const row = result.rows[0];
    await this.auditLogService.logMutation({
      action: 'ACCOUNTING_ACCOUNT_TITLE_CREATE',
      entityType: 'account-title',
      entityId: row?.id,
      actor: auditActor,
      description: `Created account title ${accountNumber} - ${description}`,
      requestBody: payload as unknown as Record<string, unknown>,
      after: row as unknown as Record<string, unknown>,
    });

    return row;
  }

  async getNextChequeVoucherNumber(): Promise<string> {
    const { prefix, suffix } = await this.getChequeVoucherNumberFormat();
    const nextSequence = await this.getNextChequeVoucherSequence(prefix);
    return this.buildChequeVoucherNumber(nextSequence, prefix, suffix);
  }

  async getNextGeneralJournalNumber(): Promise<string> {
    const { prefix, suffix } = await this.getGeneralJournalNumberFormat();
    const nextSequence = await this.getNextGeneralJournalSequence(prefix);
    return this.buildGeneralJournalNumber(nextSequence, prefix, suffix);
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

  async releaseChequeVoucher(
    payload: CreateChequeVoucherPayload,
    auditActor?: AuditActorContext,
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
      await client.query('LOCK TABLE tblcheque_vouchers IN EXCLUSIVE MODE');

      const { prefix, suffix } = await this.getChequeVoucherNumberFormat();
      const nextSequence = await this.getNextChequeVoucherSequence(prefix, client);
      const cvNo = this.buildChequeVoucherNumber(nextSequence, prefix, suffix);

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

    await this.auditLogService.logMutation({
      action: 'ACCOUNTING_CHEQUE_VOUCHER_RELEASE',
      entityType: 'cheque-voucher',
      entityId: result.id,
      actor: auditActor,
      description: `Released cheque voucher ${result.cvNo}`,
      requestBody: payload as unknown as Record<string, unknown>,
      after: result as unknown as Record<string, unknown>,
    });

    return result;
  }

  async updateChequeVoucher(
    cvNo: string,
    payload: UpdateChequeVoucherPayload,
    auditActor?: AuditActorContext,
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

    const beforeResult = await this.db.query<ChequeVoucherRow>(
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
        WHERE cv_no = $1
        LIMIT 1`,
      [cvNo],
    );
    const beforeSnapshot = (beforeResult.rows[0] ?? null) as unknown as Record<string, unknown> | null;

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

    await this.auditLogService.logMutation({
      action: 'ACCOUNTING_CHEQUE_VOUCHER_UPDATE',
      entityType: 'cheque-voucher',
      entityId: result.id,
      actor: auditActor,
      description: `Updated cheque voucher ${result.cvNo}`,
      requestBody: payload as unknown as Record<string, unknown>,
      before: beforeSnapshot,
      after: result as unknown as Record<string, unknown>,
    });

    return result;
  }

  async listGeneralJournals(filters: { dateFrom?: string; dateTo?: string }): Promise<Array<GeneralJournalRow & {
    lines: Array<{ accountNumber: string; description: string; debit: number; credit: number }>;
  }>> {
    let dateFrom = this.normalizeDateOrNull(filters.dateFrom);
    let dateTo = this.normalizeDateOrNull(filters.dateTo);

    if (!dateFrom && !dateTo) {
      const currentDate = new Date();
      const firstDateOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
      dateFrom = this.normalizeDateOrNull(firstDateOfMonth.toISOString());
      dateTo = this.normalizeDateOrNull(currentDate.toISOString());
    }

    const journalResult = await this.db.query<GeneralJournalRow>(
      `SELECT
          id,
          COALESCE(reference_number, journal_number) AS "journalNumber",
          journal_date::text AS "journalDate",
          description,
          COALESCE(total_debit, 0)::float8 AS "totalDebit",
          COALESCE(total_credit, 0)::float8 AS "totalCredit",
          status,
          posted_at::text AS "postedAt",
          reference_number AS "referenceNumber"
        FROM tblgeneral_journal
        WHERE ($1::date IS NULL OR journal_date >= $1::date)
          AND ($2::date IS NULL OR journal_date <= $2::date)
        ORDER BY journal_date DESC, id DESC`,
      [dateFrom, dateTo],
    );

    if (journalResult.rows.length === 0) {
      return [];
    }

    const journalIds = journalResult.rows.map((row) => row.id);
    const lineResult = await this.db.query<{
      journalId: number;
      accountNumber: string;
      description: string;
      debit: string;
      credit: string;
    }>(
      `SELECT
          journal_id AS "journalId",
          account_code AS "accountNumber",
          COALESCE(account_name, '') AS description,
          COALESCE(debit_amount, 0)::text AS debit,
          COALESCE(credit_amount, 0)::text AS credit
        FROM tbljournal_entry_lines
        WHERE journal_id = ANY($1::bigint[])
        ORDER BY journal_id DESC, line_number ASC`,
      [journalIds],
    );

    const linesByJournal = new Map<number, Array<{ accountNumber: string; description: string; debit: number; credit: number }>>();
    for (const row of lineResult.rows) {
      const list = linesByJournal.get(row.journalId) ?? [];
      list.push({
        accountNumber: row.accountNumber,
        description: row.description,
        debit: Number(row.debit) || 0,
        credit: Number(row.credit) || 0,
      });
      linesByJournal.set(row.journalId, list);
    }

    return journalResult.rows.map((journal) => ({
      ...journal,
      lines: linesByJournal.get(journal.id) ?? [],
    }));
  }

  async postGeneralJournal(
    payload: CreateGeneralJournalPayload,
    auditActor?: AuditActorContext,
  ): Promise<GeneralJournalRow & {
    lines: Array<{ accountNumber: string; description: string; debit: number; credit: number }>;
  }> {
    const journalDate = this.normalizeDateOrNull(payload.journalDate);
    const description = String(payload.description ?? '').trim();
    if (!journalDate) {
      throw new BadRequestException('journalDate is required.');
    }

    if (!description) {
      throw new BadRequestException('description is required.');
    }

    const lines = Array.isArray(payload.sundries)
      ? payload.sundries.map((line) => ({
          accountNumber: String(line.accountNumber ?? '').trim(),
          description: String(line.description ?? '').trim(),
          debit: Number(line.debit) || 0,
          credit: Number(line.credit) || 0,
        }))
          .filter((line) => line.accountNumber || line.description || line.debit > 0 || line.credit > 0)
      : [];

    if (lines.length === 0) {
      throw new BadRequestException('At least one journal line is required.');
    }

    const hasIncompleteLine = lines.some((line) => !line.accountNumber || !line.description);
    if (hasIncompleteLine) {
      throw new BadRequestException('Each journal line must have accountNumber and description.');
    }

    const totalDebit = lines.reduce((sum, line) => sum + line.debit, 0);
    const totalCredit = lines.reduce((sum, line) => sum + line.credit, 0);

    if (totalDebit <= 0 && totalCredit <= 0) {
      throw new BadRequestException('Journal totals cannot both be zero.');
    }

    if (Math.abs(totalDebit - totalCredit) > 0.0001) {
      throw new BadRequestException('Total debit must equal total credit.');
    }

    const result = await this.db.withTransaction(async (client) => {
      await client.query('LOCK TABLE tblgeneral_journal IN EXCLUSIVE MODE');

      const { prefix, suffix } = await this.getGeneralJournalNumberFormat();
      const nextSequence = await this.getNextGeneralJournalSequence(prefix, client);
      const referenceNumber = this.buildGeneralJournalNumber(nextSequence, prefix, suffix);

      const headerResult = await client.query<GeneralJournalRow>(
        `INSERT INTO tblgeneral_journal (
            journal_date,
            reference_type,
            reference_number,
            description,
            total_debit,
            total_credit,
            status,
            posted_at
          )
          VALUES ($1::date, 'Manual', $2, $3, $4, $5, 'posted', NOW())
          RETURNING
            id,
            COALESCE(reference_number, journal_number) AS "journalNumber",
            journal_date::text AS "journalDate",
            description,
            COALESCE(total_debit, 0)::float8 AS "totalDebit",
            COALESCE(total_credit, 0)::float8 AS "totalCredit",
            status,
            posted_at::text AS "postedAt",
            reference_number AS "referenceNumber"`,
        [journalDate, referenceNumber, description, totalDebit, totalCredit],
      );

      const journal = headerResult.rows[0];
      if (!journal) {
        throw new BadRequestException('Unable to create general journal entry.');
      }

      const savedLines: Array<{ accountNumber: string; description: string; debit: number; credit: number }> = [];
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        const inserted = await client.query<{
          accountNumber: string;
          description: string;
          debit: string;
          credit: string;
        }>(
          `INSERT INTO tbljournal_entry_lines (
              journal_id,
              line_number,
              account_code,
              account_name,
              description,
              debit_amount,
              credit_amount
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING
              account_code AS "accountNumber",
              COALESCE(account_name, '') AS description,
              COALESCE(debit_amount, 0)::text AS debit,
              COALESCE(credit_amount, 0)::text AS credit`,
          [journal.id, index + 1, line.accountNumber, line.description, null, line.debit, line.credit],
        );

        const insertedRow = inserted.rows[0];
        if (insertedRow) {
          savedLines.push({
            accountNumber: insertedRow.accountNumber,
            description: insertedRow.description,
            debit: Number(insertedRow.debit) || 0,
            credit: Number(insertedRow.credit) || 0,
          });
        }
      }

      return {
        ...journal,
        lines: savedLines,
      };
    });

    await this.auditLogService.logMutation({
      action: 'ACCOUNTING_JOURNAL_POST',
      entityType: 'general-journal',
      entityId: result.id,
      actor: auditActor,
      description: `Posted general journal ${result.journalNumber}`,
      requestBody: payload as unknown as Record<string, unknown>,
      after: result as unknown as Record<string, unknown>,
    });

    return result;
  }

  async updateGeneralJournal(
    journalNumber: string,
    payload: UpdateGeneralJournalPayload,
    auditActor?: AuditActorContext,
  ): Promise<GeneralJournalRow & {
    lines: Array<{ accountNumber: string; description: string; debit: number; credit: number }>;
  }> {
    const normalizedJournalNumber = String(journalNumber ?? '').trim();
    const journalDate = this.normalizeDateOrNull(payload.journalDate);
    const description = String(payload.description ?? '').trim();

    if (!normalizedJournalNumber) {
      throw new BadRequestException('journalNumber is required.');
    }

    if (!journalDate) {
      throw new BadRequestException('journalDate is required.');
    }

    if (!description) {
      throw new BadRequestException('description is required.');
    }

    const lines = Array.isArray(payload.sundries)
      ? payload.sundries
          .map((line) => ({
            accountNumber: String(line.accountNumber ?? '').trim(),
            description: String(line.description ?? '').trim(),
            debit: Number(line.debit) || 0,
            credit: Number(line.credit) || 0,
          }))
          .filter((line) => line.accountNumber || line.description || line.debit > 0 || line.credit > 0)
      : [];

    if (lines.length === 0) {
      throw new BadRequestException('At least one journal line is required.');
    }

    const hasIncompleteLine = lines.some((line) => !line.accountNumber || !line.description);
    if (hasIncompleteLine) {
      throw new BadRequestException('Each journal line must have accountNumber and description.');
    }

    const totalDebit = lines.reduce((sum, line) => sum + line.debit, 0);
    const totalCredit = lines.reduce((sum, line) => sum + line.credit, 0);

    if (totalDebit <= 0 && totalCredit <= 0) {
      throw new BadRequestException('Journal totals cannot both be zero.');
    }

    if (Math.abs(totalDebit - totalCredit) > 0.0001) {
      throw new BadRequestException('Total debit must equal total credit.');
    }

    const beforeResult = await this.db.query<GeneralJournalRow>(
      `SELECT
          id,
          COALESCE(reference_number, journal_number) AS "journalNumber",
          journal_date::text AS "journalDate",
          description,
          COALESCE(total_debit, 0)::float8 AS "totalDebit",
          COALESCE(total_credit, 0)::float8 AS "totalCredit",
          status,
          posted_at::text AS "postedAt",
          reference_number AS "referenceNumber"
        FROM tblgeneral_journal
        WHERE COALESCE(reference_number, journal_number) = $1
        LIMIT 1`,
      [normalizedJournalNumber],
    );
    const beforeSnapshot = (beforeResult.rows[0] ?? null) as unknown as Record<string, unknown> | null;

    const result = await this.db.withTransaction(async (client) => {
      const journalResult = await client.query<GeneralJournalRow>(
        `UPDATE tblgeneral_journal
          SET
            journal_date = $2::date,
            description = $3,
            total_debit = $4,
            total_credit = $5,
            updated_at = NOW()
          WHERE COALESCE(reference_number, journal_number) = $1
          RETURNING
            id,
            COALESCE(reference_number, journal_number) AS "journalNumber",
            journal_date::text AS "journalDate",
            description,
            COALESCE(total_debit, 0)::float8 AS "totalDebit",
            COALESCE(total_credit, 0)::float8 AS "totalCredit",
            status,
            posted_at::text AS "postedAt",
            reference_number AS "referenceNumber"`,
        [normalizedJournalNumber, journalDate, description, totalDebit, totalCredit],
      );

      const journal = journalResult.rows[0];
      if (!journal) {
        throw new BadRequestException('General journal entry not found.');
      }

      await client.query('DELETE FROM tbljournal_entry_lines WHERE journal_id = $1', [journal.id]);

      const savedLines: Array<{ accountNumber: string; description: string; debit: number; credit: number }> = [];
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        const inserted = await client.query<{
          accountNumber: string;
          description: string;
          debit: string;
          credit: string;
        }>(
          `INSERT INTO tbljournal_entry_lines (
              journal_id,
              line_number,
              account_code,
              account_name,
              description,
              debit_amount,
              credit_amount
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING
              account_code AS "accountNumber",
              COALESCE(account_name, '') AS description,
              COALESCE(debit_amount, 0)::text AS debit,
              COALESCE(credit_amount, 0)::text AS credit`,
          [journal.id, index + 1, line.accountNumber, line.description, null, line.debit, line.credit],
        );

        const insertedRow = inserted.rows[0];
        if (insertedRow) {
          savedLines.push({
            accountNumber: insertedRow.accountNumber,
            description: insertedRow.description,
            debit: Number(insertedRow.debit) || 0,
            credit: Number(insertedRow.credit) || 0,
          });
        }
      }

      return {
        ...journal,
        lines: savedLines,
      };
    });

    await this.auditLogService.logMutation({
      action: 'ACCOUNTING_JOURNAL_UPDATE',
      entityType: 'general-journal',
      entityId: result.id,
      actor: auditActor,
      description: `Updated general journal ${result.journalNumber}`,
      requestBody: payload as unknown as Record<string, unknown>,
      before: beforeSnapshot,
      after: result as unknown as Record<string, unknown>,
    });

    return result;
  }

  async getReportPrintSettings(
    reportKeyInput: string,
    branchId?: number,
  ): Promise<{ reportKey: string; branchId: number | null; settings: Record<string, unknown> }> {
    const reportKey = this.normalizeReportKey(reportKeyInput);
    const scopeBranchId = branchId ?? 0;

    const result = await this.db.query<AccountingReportPrintSettingsRow>(
      `SELECT
          report_key AS "reportKey",
          branch_id AS "branchId",
          COALESCE(settings_json, '{}'::jsonb) AS settings
        FROM tblaccounting_report_print_settings
        WHERE report_key = $1
          AND (branch_id = $2::bigint OR branch_id = 0 OR branch_id IS NULL)
        ORDER BY
          CASE
            WHEN branch_id = $2::bigint THEN 0
            WHEN branch_id = 0 THEN 1
            WHEN branch_id IS NULL THEN 2
            ELSE 3
          END,
          id DESC
        LIMIT 1`,
      [reportKey, scopeBranchId],
    );

    const row = result.rows[0];
    if (!row) {
      return {
        reportKey,
        branchId: scopeBranchId === 0 ? null : scopeBranchId,
        settings: this.createDefaultReportPrintSettings(),
      };
    }

    return {
      reportKey: row.reportKey,
      branchId: row.branchId === 0 ? null : row.branchId,
      settings: this.normalizeReportPrintSettings(row.settings),
    };
  }

  async upsertReportPrintSettings(
    reportKeyInput: string,
    payload: AccountingReportPrintSettingsPayload,
    options: { branchId?: number; userId?: number },
    auditActor?: AuditActorContext,
  ): Promise<{ reportKey: string; branchId: number | null; settings: Record<string, unknown> }> {
    const reportKey = this.normalizeReportKey(reportKeyInput);
    const settings = this.normalizeReportPrintSettings(payload);
    const branchId = options.branchId ?? 0;
    const userId = options.userId ?? null;
    const beforeSnapshot = (await this.getReportPrintSettings(
      reportKey,
      branchId || undefined,
    )) as unknown as Record<string, unknown>;

    const settingsJson = JSON.stringify(settings);

    const updated = await this.db.query<AccountingReportPrintSettingsRow>(
      `UPDATE tblaccounting_report_print_settings
          SET
            settings_json = $3::jsonb,
            updated_by = $4,
            updated_at = NOW()
        WHERE report_key = $1
          AND (
            branch_id = $2::bigint
            OR ($2::bigint = 0 AND branch_id IS NULL)
          )
        RETURNING
          report_key AS "reportKey",
          COALESCE(branch_id, 0) AS "branchId",
          COALESCE(settings_json, '{}'::jsonb) AS settings`,
      [reportKey, branchId, settingsJson, userId],
    );

    const updatedRow = updated.rows[0];
    if (updatedRow) {
      const after = {
        reportKey: updatedRow.reportKey,
        branchId: updatedRow.branchId === 0 ? null : updatedRow.branchId,
        settings: this.normalizeReportPrintSettings(updatedRow.settings),
      };

      await this.auditLogService.logMutation({
        action: 'ACCOUNTING_REPORT_PRINT_SETTINGS_UPSERT',
        entityType: 'report-print-settings',
        entityId: reportKey,
        actor: auditActor,
        description: `Upserted report print settings for ${reportKey}`,
        requestBody: payload as unknown as Record<string, unknown>,
        before: beforeSnapshot,
        after: after as unknown as Record<string, unknown>,
      });

      return after;
    }

    const inserted = await this.db.query<AccountingReportPrintSettingsRow>(
      `INSERT INTO tblaccounting_report_print_settings (
          report_key,
          branch_id,
          settings_json,
          created_by,
          updated_by,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3::jsonb, $4, $4, NOW(), NOW())
        RETURNING
          report_key AS "reportKey",
          COALESCE(branch_id, 0) AS "branchId",
          COALESCE(settings_json, '{}'::jsonb) AS settings`,
      [reportKey, branchId, settingsJson, userId],
    );

    const insertedRow = inserted.rows[0];
    if (!insertedRow) {
      throw new BadRequestException('Unable to save report print settings.');
    }

    const after = {
      reportKey: insertedRow.reportKey,
      branchId: insertedRow.branchId === 0 ? null : insertedRow.branchId,
      settings: this.normalizeReportPrintSettings(insertedRow.settings),
    };

    await this.auditLogService.logMutation({
      action: 'ACCOUNTING_REPORT_PRINT_SETTINGS_UPSERT',
      entityType: 'report-print-settings',
      entityId: reportKey,
      actor: auditActor,
      description: `Upserted report print settings for ${reportKey}`,
      requestBody: payload as unknown as Record<string, unknown>,
      before: beforeSnapshot,
      after: after as unknown as Record<string, unknown>,
    });

    return after;
  }

  private async getChequeVoucherNumberFormat(): Promise<{ prefix: string; suffix: string }> {
    try {
      const result = await this.db.query<{ cvNumberPrefix: string | null; cvNumberSuffix: string | null }>(
        `SELECT
           COALESCE(to_jsonb(s)->>'cv_number_prefix', null) AS "cvNumberPrefix",
           COALESCE(to_jsonb(s)->>'cv_number_suffix', null) AS "cvNumberSuffix"
         FROM tblsettings s
         ORDER BY s.id ASC
         LIMIT 1`,
      );
      const row = result.rows[0];
      const prefix = String(row?.cvNumberPrefix ?? '').trim() || 'CV';
      const suffix = String(row?.cvNumberSuffix ?? '').trim();
      return { prefix, suffix };
    } catch {
      return { prefix: 'CV', suffix: '' };
    }
  }

  private async getNextChequeVoucherSequence(prefix: string, client?: { query: <T = unknown>(text: string, params?: unknown[]) => Promise<{ rows: T[] }> }): Promise<number> {
    const queryClient = client ?? this.db;
    const result = await queryClient.query<{ maxSequence: string | null }>(
      `SELECT
          COALESCE(MAX(CAST(SUBSTRING(cv_no FROM ' ([0-9]+)') AS INTEGER)), 0)::text AS "maxSequence"
        FROM tblcheque_vouchers
        WHERE cv_no LIKE $1`,
      [`${prefix} %`],
    );

    return (Number(result.rows[0]?.maxSequence) || 0) + 1;
  }

  private buildChequeVoucherNumber(sequence: number, prefix: string, suffix: string): string {
    return `${prefix} ${String(sequence).padStart(6, '0')}${suffix}`;
  }

  private async getGeneralJournalNumberFormat(): Promise<{ prefix: string; suffix: string }> {
    try {
      const result = await this.db.query<{ gjNumberPrefix: string | null; gjNumberSuffix: string | null }>(
        `SELECT
           COALESCE(to_jsonb(s)->>'gj_number_prefix', null) AS "gjNumberPrefix",
           COALESCE(to_jsonb(s)->>'gj_number_suffix', null) AS "gjNumberSuffix"
         FROM tblsettings s
         ORDER BY s.id ASC
         LIMIT 1`,
      );
      const row = result.rows[0];
      const prefix = String(row?.gjNumberPrefix ?? '').trim() || 'GJ';
      const suffix = String(row?.gjNumberSuffix ?? '').trim();
      return { prefix, suffix };
    } catch {
      return { prefix: 'GJ', suffix: '' };
    }
  }

  private async getNextGeneralJournalSequence(prefix: string, client?: { query: <T = unknown>(text: string, params?: unknown[]) => Promise<{ rows: T[] }> }): Promise<number> {
    const queryClient = client ?? this.db;
    const result = await queryClient.query<{ maxSequence: string | null }>(
      `SELECT
          COALESCE(MAX(CAST(SUBSTRING(reference_number FROM ' ([0-9]+)') AS INTEGER)), 0)::text AS "maxSequence"
        FROM tblgeneral_journal
        WHERE reference_number LIKE $1`,
      [`${prefix} %`],
    );

    return (Number(result.rows[0]?.maxSequence) || 0) + 1;
  }

  private buildGeneralJournalNumber(sequence: number, prefix: string, suffix: string): string {
    return `${prefix} ${String(sequence).padStart(6, '0')}${suffix}`;
  }

  private normalizeReportKey(value: unknown): string {
    const normalized = String(value ?? '').trim().toLowerCase();
    if (!normalized || normalized.length > 120 || !/^[a-z0-9-]+$/.test(normalized)) {
      throw new BadRequestException('Invalid report key.');
    }
    return normalized;
  }

  private createDefaultReportPrintSettings(): Record<string, unknown> {
    return {
      showHeader: true,
      showLogo: true,
      showAddress: true,
      showPreparedBy: true,
      showSignatureLine: false,
      paperSize: 'A4',
      orientation: 'portrait',
      customWidthMm: 210,
      customHeightMm: 297,
      marginTopMm: 15,
      marginRightMm: 15,
      marginBottomMm: 15,
      marginLeftMm: 15,
      defaultAddress: '',
      footerLeft: '',
      footerCenter: '',
      footerRight: '',
      signatories: [
        {
          id: 'prepared-by',
          label: 'Prepared by',
          valueSource: 'prepared_by',
          customValue: '',
          signatureSource: 'preparedBy',
        },
        {
          id: 'checked-by',
          label: 'Checked by',
          valueSource: 'custom',
          customValue: '',
          signatureSource: 'checkedBy',
        },
        {
          id: 'approved-by',
          label: 'Approved by',
          valueSource: 'custom',
          customValue: '',
          signatureSource: 'approvedBy',
        },
      ] as AccountingReportSignatoryConfig[],
    };
  }

  private normalizeReportSignatories(value: unknown): AccountingReportSignatoryConfig[] {
    if (!Array.isArray(value)) {
      return (this.createDefaultReportPrintSettings().signatories as AccountingReportSignatoryConfig[]).map((item) => ({ ...item }));
    }

    const normalized = value
      .map((item, index) => {
        const source = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
        const valueSource = String(source.valueSource ?? '').trim().toLowerCase() === 'prepared_by' ? 'prepared_by' : 'custom';
        const signatureSourceRaw = String(source.signatureSource ?? '').trim();
        const signatureSource =
          signatureSourceRaw === 'preparedBy' ||
          signatureSourceRaw === 'checkedBy' ||
          signatureSourceRaw === 'approvedBy'
            ? signatureSourceRaw
            : 'none';

        return {
          id: this.toStringWithLimit(source.id, `sig-${index + 1}`, 80),
          label: this.toStringWithLimit(source.label, `Signatory ${index + 1}`, 80),
          valueSource,
          customValue: this.toStringWithLimit(source.customValue, '', 120),
          signatureSource,
        } as AccountingReportSignatoryConfig;
      })
      .filter((item) => item.label.length > 0)
      .slice(0, 8);

    if (normalized.length > 0) {
      return normalized;
    }

    return (this.createDefaultReportPrintSettings().signatories as AccountingReportSignatoryConfig[]).map((item) => ({ ...item }));
  }

  private toBoolean(value: unknown, fallback: boolean): boolean {
    if (typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (['1', 'true', 'yes', 'on'].includes(normalized)) {
        return true;
      }
      if (['0', 'false', 'no', 'off'].includes(normalized)) {
        return false;
      }
    }
    return fallback;
  }

  private toNumberInRange(value: unknown, fallback: number, min: number, max: number): number {
    const normalized = Number(value);
    if (!Number.isFinite(normalized)) {
      return fallback;
    }
    if (normalized < min) {
      return min;
    }
    if (normalized > max) {
      return max;
    }
    return Number(normalized.toFixed(2));
  }

  private toStringWithLimit(value: unknown, fallback: string, maxLength: number): string {
    const normalized = String(value ?? '').trim();
    if (!normalized) {
      return fallback;
    }
    return normalized.slice(0, maxLength);
  }

  private normalizePaperSize(value: unknown, fallback: PrintPaperSize): PrintPaperSize {
    const normalized = String(value ?? '').trim().toUpperCase();
    if (normalized === 'A4' || normalized === 'LETTER' || normalized === 'LEGAL' || normalized === 'CUSTOM') {
      return normalized;
    }
    return fallback;
  }

  private normalizeOrientation(value: unknown, fallback: PrintOrientation): PrintOrientation {
    const normalized = String(value ?? '').trim().toLowerCase();
    if (normalized === 'portrait' || normalized === 'landscape') {
      return normalized;
    }
    return fallback;
  }

  private normalizeDisbursementBaseColumns(value: unknown): DisbursementBaseColumnPayload[] {
    if (!Array.isArray(value)) {
      return [];
    }

    const allowedKeys = new Set<DisbursementBaseColumnKey>([
      'date',
      'referenceNo',
      'checkNo',
      'payee',
      'description',
      'tinNumber',
      'address',
      'zipCode',
      'invoice',
      'invoiceDate',
      'voucherType',
      'preparedBy',
      'releasedAt',
      'bankName',
      'chequeDate',
    ]);

    return value
      .map((item, index) => {
        const source = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
        const rawKey = String(source.key ?? '').trim() as DisbursementBaseColumnKey;
        if (!allowedKeys.has(rawKey)) {
          return null;
        }

        return {
          id: this.toStringWithLimit(source.id, `dbc-${index + 1}`, 80),
          key: rawKey,
          label: this.toStringWithLimit(source.label, 'Column', 80),
        } as DisbursementBaseColumnPayload;
      })
      .filter((item): item is DisbursementBaseColumnPayload => item !== null)
      .slice(0, 10);
  }

  private normalizeDisbursementDefaultColumns(value: unknown): DisbursementDefaultColumnPayload[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .map((item, index) => {
        const source = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
        const sideRaw = String(source.side ?? '').trim().toUpperCase();
        const side: 'DR' | 'CR' = sideRaw === 'CR' ? 'CR' : 'DR';
        return {
          id: this.toStringWithLimit(source.id, `col-${index + 1}`, 80),
          accountNumber: this.toStringWithLimit(source.accountNumber, '', 30),
          label: this.toStringWithLimit(source.label, '', 80),
          side,
        } as DisbursementDefaultColumnPayload;
      })
      .slice(0, 12);
  }

  private normalizeReportPrintSettings(payload: unknown): Record<string, unknown> {
    const defaults = this.createDefaultReportPrintSettings();
    const source = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};

    return {
      showHeader: this.toBoolean(source.showHeader, defaults.showHeader as boolean),
      showLogo: this.toBoolean(source.showLogo, defaults.showLogo as boolean),
      showAddress: this.toBoolean(source.showAddress, defaults.showAddress as boolean),
      showPreparedBy: this.toBoolean(source.showPreparedBy, defaults.showPreparedBy as boolean),
      showSignatureLine: this.toBoolean(source.showSignatureLine, defaults.showSignatureLine as boolean),
      showChequeDetails: this.toBoolean(source.showChequeDetails, true),
      paperSize: this.normalizePaperSize(source.paperSize, defaults.paperSize as PrintPaperSize),
      orientation: this.normalizeOrientation(source.orientation, defaults.orientation as PrintOrientation),
      customWidthMm: this.toNumberInRange(source.customWidthMm, defaults.customWidthMm as number, 10, 1200),
      customHeightMm: this.toNumberInRange(source.customHeightMm, defaults.customHeightMm as number, 10, 1200),
      marginTopMm: this.toNumberInRange(source.marginTopMm, defaults.marginTopMm as number, 0, 50),
      marginRightMm: this.toNumberInRange(source.marginRightMm, defaults.marginRightMm as number, 0, 50),
      marginBottomMm: this.toNumberInRange(source.marginBottomMm, defaults.marginBottomMm as number, 0, 50),
      marginLeftMm: this.toNumberInRange(source.marginLeftMm, defaults.marginLeftMm as number, 0, 50),
      defaultAddress: this.toStringWithLimit(source.defaultAddress, defaults.defaultAddress as string, 300),
      footerLeft: this.toStringWithLimit(source.footerLeft, defaults.footerLeft as string, 200),
      footerCenter: this.toStringWithLimit(source.footerCenter, defaults.footerCenter as string, 200),
      footerRight: this.toStringWithLimit(source.footerRight, defaults.footerRight as string, 200),
      signatories: this.normalizeReportSignatories(source.signatories),
      baseColumns: this.normalizeDisbursementBaseColumns(source.baseColumns),
      defaultColumns: this.normalizeDisbursementDefaultColumns(source.defaultColumns),
    };
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
