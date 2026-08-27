import {
  assertSalesOrderNumericLimits,
  collectSalesOrderNumericErrors,
  exceedsNumericLimit,
  formatNumericMax,
  getMiscellaneousItemOverflowMessage,
  getNumericOverflowMessage,
} from './numeric-limits';

describe('numeric-limits', () => {
  it('formats NUMERIC maxima the way PostgreSQL enforces them', () => {
    expect(formatNumericMax(5, 2)).toBe('999.99');
    expect(formatNumericMax(12, 2)).toBe('9,999,999,999.99');
  });

  it('treats rounding up to the exclusive bound as overflow', () => {
    expect(exceedsNumericLimit(999.99, 5, 2)).toBe(false);
    expect(exceedsNumericLimit(999.994, 5, 2)).toBe(false);
    expect(exceedsNumericLimit(999.995, 5, 2)).toBe(true);
    expect(exceedsNumericLimit(1000, 5, 2)).toBe(true);
    expect(exceedsNumericLimit(9_999_999_999.99, 12, 2)).toBe(false);
    expect(exceedsNumericLimit(10_000_000_000, 12, 2)).toBe(true);
  });

  it('names the overflowing service qty', () => {
    const errors = collectSalesOrderNumericErrors({
      serviceItems: [
        { serviceName: 'CLEANING', serviceDurationHours: 1500, serviceCost: 500 },
      ],
    });

    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/Service qty for "CLEANING" is 1,500/);
    expect(errors[0]).toMatch(/999\.99/);
  });

  it('names overflowing payment amounts', () => {
    const errors = collectSalesOrderNumericErrors({
      paymentDetails: [{ method: 'Cash', amount: 12_000_000_000 }],
    });

    expect(errors[0]).toMatch(/Payment 1 \(Cash\) amount/);
    expect(errors[0]).toMatch(/9,999,999,999\.99/);
  });

  it('throws a combined user-facing message', () => {
    expect(() =>
      assertSalesOrderNumericLimits({
        serviceItems: [{ serviceName: 'CLEANING', serviceDurationHours: 1500 }],
        paymentDetails: [{ method: 'Cash', amount: 12_000_000_000 }],
      }),
    ).toThrow(/Cannot save this sales order because a number is too large/);
  });

  it('ignores empty numeric fields', () => {
    expect(getNumericOverflowMessage('', 'Order total', { precision: 12, scale: 2 })).toBeNull();
    expect(getNumericOverflowMessage(undefined, 'Order total', { precision: 12, scale: 2 })).toBeNull();
    expect(
      collectSalesOrderNumericErrors({
        totalAmount: 150000,
        serviceItems: [{ serviceName: 'CLEANING', serviceDurationHours: 2, serviceCost: 1500 }],
      }),
    ).toEqual([]);
  });

  it('names overflowing miscellaneous item values', () => {
    const message = getMiscellaneousItemOverflowMessage({
      itemName: 'Copper pipe',
      quantity: 1,
      unitPrice: 12_000_000_000,
      totalPrice: 12_000_000_000,
    });

    expect(message).toMatch(/Cannot add this item/);
    expect(message).toMatch(/Copper pipe/);
  });
});
