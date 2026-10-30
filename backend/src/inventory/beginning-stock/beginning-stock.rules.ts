export const BEGINNING_STOCK_TIME_ZONE = 'Asia/Manila';

/** Statuses that are not on-hand beginning stock. Matches the inventory screen buckets. */
export const BEGINNING_STOCK_EXCLUDED_STATUSES = [
  'defective',
  'scanned',
  'reserved',
  'delivered',
  'installed',
  'for-delivery',
  'sold',
  'released',
  'out',
  'outbound',
] as const;

const EXCLUDED_STATUSES = new Set<string>(BEGINNING_STOCK_EXCLUDED_STATUSES);

export type BeginningStockUnitBucket = 'indoor' | 'outdoor' | 'window' | 'panel' | 'other';

export function beginningStockBusinessDate(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: BEGINNING_STOCK_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function normalizeBeginningStockStatus(status: unknown): string {
  return String(status ?? '')
    .trim()
    .toLowerCase()
    .replace(/_/g, '-')
    .replace(/\s+/g, '-');
}

export function normalizeBeginningStockUnitType(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[\s_-]*qty$/i, '')
    .replace(/quantity$/i, '')
    .trim();
}

export function isBeginningInStock(status: unknown, isDefective?: boolean | null): boolean {
  if (Boolean(isDefective) || normalizeBeginningStockStatus(status) === 'defective') {
    return false;
  }

  return !EXCLUDED_STATUSES.has(normalizeBeginningStockStatus(status));
}

export function classifyBeginningStockUnit(unitType: unknown): BeginningStockUnitBucket {
  const normalized = normalizeBeginningStockUnitType(unitType);

  if (normalized.includes('indoor')) {
    return 'indoor';
  }

  if (normalized.includes('outdoor')) {
    return 'outdoor';
  }

  if (normalized.includes('window')) {
    return 'window';
  }

  if (normalized.includes('panel')) {
    return 'panel';
  }

  return 'other';
}
