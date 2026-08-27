import { formatNumericMax } from './numeric-limits';

type PgErrorLike = {
  code?: string;
  message?: string;
  detail?: string;
  column?: string;
  constraint?: string;
  table?: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  return value as Record<string, unknown>;
}

export function getPgError(error: unknown): PgErrorLike | null {
  const visited = new Set<unknown>();
  let current: unknown = error;

  while (current && !visited.has(current)) {
    visited.add(current);
    const record = asRecord(current);
    if (!record) {
      break;
    }

    const code = typeof record.code === 'string' ? record.code : undefined;
    const message = typeof record.message === 'string' ? record.message : undefined;
    const detail = typeof record.detail === 'string' ? record.detail : undefined;
    if (code || /numeric field overflow|value too long|duplicate key|foreign key/i.test(message ?? '')) {
      return {
        code,
        message,
        detail,
        column: typeof record.column === 'string' ? record.column : undefined,
        constraint: typeof record.constraint === 'string' ? record.constraint : undefined,
        table: typeof record.table === 'string' ? record.table : undefined,
      };
    }

    current = record.cause ?? record.originalError ?? record.error;
  }

  if (error instanceof Error && error.message.trim()) {
    return { message: error.message };
  }

  return null;
}

function parseNumericPrecision(detail: string | undefined): { precision: number; scale: number } | null {
  if (!detail) {
    return null;
  }
  const match = detail.match(/precision\s+(\d+),\s*scale\s+(\d+)/i);
  if (!match) {
    return null;
  }
  return {
    precision: Number(match[1]),
    scale: Number(match[2]),
  };
}

export function explainNumericOverflow(error: PgErrorLike): string {
  const limits = parseNumericPrecision(error.detail);
  if (limits?.precision === 5 && limits.scale === 2) {
    return [
      'Cannot save this sales order because Service Qty is too large.',
      `Service Qty maximum is ${formatNumericMax(5, 2)}.`,
      'Open the sales order, reduce the Qty on the service line, then remit again.',
    ].join('\n');
  }

  if (limits) {
    return [
      'Cannot save this sales order because a money amount is too large.',
      `Maximum allowed is ${formatNumericMax(limits.precision, limits.scale)}.`,
      'Check payment amount, prices, and the order total, then try again.',
    ].join('\n');
  }

  return [
    'Cannot save this sales order because a number is too large for the database.',
    'Check Service Qty (maximum 999.99), payment amounts, prices, and the order total, then try again.',
  ].join('\n');
}

function explainUniqueViolation(error: PgErrorLike): string {
  if (error.constraint) {
    return `This record already exists (${error.constraint}). Change the duplicate value and try again.`;
  }
  return 'This record already exists. Change the duplicate value and try again.';
}

function explainForeignKey(error: PgErrorLike): string {
  return 'This record is linked to missing or invalid related data. Refresh the page and try again.';
}

function explainNotNull(error: PgErrorLike): string {
  if (error.column) {
    return `${error.column} is required. Fill it in and try again.`;
  }
  return 'A required field is missing. Fill in the required fields and try again.';
}

function explainValueTooLong(error: PgErrorLike): string {
  if (error.column) {
    return `${error.column} is too long. Shorten the text and try again.`;
  }
  return 'One of the text fields is too long. Shorten it and try again.';
}

export function toUserFacingError(error: unknown, fallback: string): string {
  if (typeof error === 'string' && error.trim()) {
    return error.trim();
  }

  const pg = getPgError(error);
  const code = pg?.code ?? '';
  const message = pg?.message ?? (error instanceof Error ? error.message : '');

  if (code === '22003' || /numeric field overflow|integer out of range/i.test(message)) {
    return explainNumericOverflow(pg ?? { message });
  }

  if (code === '22001' || /value too long/i.test(message)) {
    return explainValueTooLong(pg ?? { message });
  }

  if (code === '23505' || /duplicate key/i.test(message)) {
    return explainUniqueViolation(pg ?? { message });
  }

  if (code === '23503' || /foreign key/i.test(message)) {
    return explainForeignKey(pg ?? { message });
  }

  if (code === '23502' || /null value .* violates not-null/i.test(message)) {
    return explainNotNull(pg ?? { message });
  }

  if (code === '22P02' || /invalid input syntax/i.test(message)) {
    return 'One of the values is in the wrong format. Check numbers and dates, then try again.';
  }

  const trimmed = message.trim();
  if (trimmed && !/^(error:|failed query|internal server error)/i.test(trimmed)) {
    return trimmed;
  }

  return fallback;
}
