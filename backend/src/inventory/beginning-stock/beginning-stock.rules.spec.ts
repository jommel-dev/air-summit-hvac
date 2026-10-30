import {
  beginningStockBusinessDate,
  classifyBeginningStockUnit,
  isBeginningInStock,
} from './beginning-stock.rules';
import { BEGINNING_STOCK_INSERT_SQL } from './beginning-stock.sql';

describe('beginning stock rules', () => {
  it('uses the Philippines calendar date', () => {
    expect(beginningStockBusinessDate(new Date('2026-10-29T16:05:00.000Z'))).toBe('2026-10-30');
    expect(beginningStockBusinessDate(new Date('2026-10-29T15:59:00.000Z'))).toBe('2026-10-29');
  });

  it('counts on-hand serials and leaves reserved, installed, scanned, and defective out', () => {
    expect(isBeginningInStock('in-stock', false)).toBe(true);
    expect(isBeginningInStock('', false)).toBe(true);
    expect(isBeginningInStock('in_stock', false)).toBe(true);
    expect(isBeginningInStock('reserved', false)).toBe(false);
    expect(isBeginningInStock('installed', false)).toBe(false);
    expect(isBeginningInStock('for delivery', false)).toBe(false);
    expect(isBeginningInStock('scanned', false)).toBe(false);
    expect(isBeginningInStock('in-stock', true)).toBe(false);
    expect(isBeginningInStock('defective', false)).toBe(false);
  });

  it('groups unit types into indoor, outdoor, window, panel, or other', () => {
    expect(classifyBeginningStockUnit('Indoor')).toBe('indoor');
    expect(classifyBeginningStockUnit('Outdoor Qty')).toBe('outdoor');
    expect(classifyBeginningStockUnit('Window')).toBe('window');
    expect(classifyBeginningStockUnit('Panel')).toBe('panel');
    expect(classifyBeginningStockUnit('')).toBe('other');
    expect(classifyBeginningStockUnit('set')).toBe('other');
  });

  it('keeps the count query aligned with those buckets', () => {
    expect(BEGINNING_STOCK_INSERT_SQL).toContain('indoor_stock');
    expect(BEGINNING_STOCK_INSERT_SQL).toContain('outdoor_stock');
    expect(BEGINNING_STOCK_INSERT_SQL).toContain('window_stock');
    expect(BEGINNING_STOCK_INSERT_SQL).toContain('panel_stock');
    expect(BEGINNING_STOCK_INSERT_SQL).toContain('other_stock');
    expect(BEGINNING_STOCK_INSERT_SQL).toContain("'reserved'");
    expect(BEGINNING_STOCK_INSERT_SQL).toContain("'installed'");
    expect(BEGINNING_STOCK_INSERT_SQL).toContain("'scanned'");
    expect(BEGINNING_STOCK_INSERT_SQL).toContain("'for-delivery'");
  });
});
