export const MONEY_PRECISION = { precision: 12, scale: 2 } as const;
export const SERVICE_QTY_PRECISION = { precision: 5, scale: 2 } as const;

export type NumericPrecision = {
  precision: number;
  scale: number;
};

export function formatNumericMax(precision: number, scale: number): string {
  const max = 10 ** (precision - scale) - 10 ** -scale;
  return max.toLocaleString('en-US', {
    minimumFractionDigits: scale,
    maximumFractionDigits: scale,
  });
}

export function formatNumericValue(value: number): string {
  if (!Number.isFinite(value)) {
    return String(value);
  }
  return value.toLocaleString('en-US', { maximumFractionDigits: 4 });
}

/**
 * PostgreSQL NUMERIC(p, s) rounds to `s` decimals, then rejects values whose
 * absolute value is >= 10^(p - s).
 */
export function exceedsNumericLimit(
  value: number,
  precision: number,
  scale: number,
): boolean {
  if (!Number.isFinite(value)) {
    return true;
  }
  if (Math.abs(value) >= 1e15) {
    return true;
  }

  const rounded = Number(Math.abs(value).toFixed(scale));
  if (!Number.isFinite(rounded)) {
    return true;
  }

  return rounded >= 10 ** (precision - scale);
}

export function getNumericOverflowMessage(
  value: unknown,
  fieldLabel: string,
  limits: NumericPrecision,
): string | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return `${fieldLabel} is not a valid number.`;
  }

  if (!exceedsNumericLimit(parsed, limits.precision, limits.scale)) {
    return null;
  }

  return `${fieldLabel} is ${formatNumericValue(parsed)}. Maximum allowed is ${formatNumericMax(limits.precision, limits.scale)}.`;
}

export function formatNumericOverflowList(errors: string[]): string {
  if (errors.length === 0) {
    return '';
  }

  const lines = errors.map((error) => `• ${error}`).join('\n');
  return `Cannot save this sales order because a number is too large:\n${lines}\n\nCorrect these values and try again.`;
}

function asRecordArray(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (entry): entry is Record<string, unknown> =>
      Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry),
  );
}

function asPaymentList(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) {
    return asRecordArray(value);
  }
  if (value && typeof value === 'object') {
    return [value as Record<string, unknown>];
  }
  return [];
}

function serviceLabel(item: Record<string, unknown>, index: number): string {
  const name = String(item.serviceName ?? '').trim();
  return name ? `"${name}"` : `line ${index + 1}`;
}

export function collectSalesOrderNumericErrors(payload: {
  totalAmount?: unknown;
  paymentDetails?: unknown;
  productItems?: unknown;
  serviceItems?: unknown;
  expenseDetails?: unknown;
}): string[] {
  const errors: string[] = [];
  const push = (message: string | null) => {
    if (message) {
      errors.push(message);
    }
  };

  push(getNumericOverflowMessage(payload.totalAmount, 'Order total', MONEY_PRECISION));

  asPaymentList(payload.paymentDetails).forEach((payment, index) => {
    const method = String(payment.method ?? '').trim();
    const prefix = method
      ? `Payment ${index + 1} (${method})`
      : `Payment ${index + 1}`;
    push(getNumericOverflowMessage(payment.amount, `${prefix} amount`, MONEY_PRECISION));
    push(
      getNumericOverflowMessage(
        payment.downPayment,
        `${prefix} down payment`,
        MONEY_PRECISION,
      ),
    );
  });

  asRecordArray(payload.productItems).forEach((item, index) => {
    const prefix = `Product line ${index + 1}`;
    push(getNumericOverflowMessage(item.unitPrice, `${prefix} unit price`, MONEY_PRECISION));
    push(getNumericOverflowMessage(item.sellPrice, `${prefix} sell price`, MONEY_PRECISION));
    push(
      getNumericOverflowMessage(item.discountPrice, `${prefix} discount price`, MONEY_PRECISION),
    );
    const unitPrice = Number(item.unitPrice) || 0;
    const sellPrice = Number(item.sellPrice) || 0;
    const discountPrice = Number(item.discountPrice) || 0;
    const qty = Number(item.totalSetQty) || 0;
    const priceToUse = discountPrice > 0 ? discountPrice : sellPrice > 0 ? sellPrice : unitPrice;
    push(getNumericOverflowMessage(priceToUse * qty, `${prefix} line total`, MONEY_PRECISION));
  });

  asRecordArray(payload.serviceItems).forEach((item, index) => {
    const label = serviceLabel(item, index);
    push(
      getNumericOverflowMessage(
        item.serviceDurationHours,
        `Service qty for ${label}`,
        SERVICE_QTY_PRECISION,
      ),
    );
    push(getNumericOverflowMessage(item.serviceCost, `Service cost for ${label}`, MONEY_PRECISION));
    push(getNumericOverflowMessage(item.partsCost, `Parts cost for ${label}`, MONEY_PRECISION));
    push(getNumericOverflowMessage(item.laborCost, `Labor cost for ${label}`, MONEY_PRECISION));
    const qty = Number(item.serviceDurationHours) || 0;
    const cost = Number(item.serviceCost) || 0;
    push(getNumericOverflowMessage(qty * cost, `Service total for ${label}`, MONEY_PRECISION));
  });

  asRecordArray(payload.expenseDetails).forEach((item, index) => {
    const expenseType = String(item.expenseType ?? '').trim();
    const prefix = expenseType
      ? `Expense ${index + 1} (${expenseType})`
      : `Expense ${index + 1}`;
    push(getNumericOverflowMessage(item.amount, `${prefix} amount`, MONEY_PRECISION));
  });

  return errors;
}

export function assertSalesOrderNumericLimits(payload: {
  totalAmount?: unknown;
  paymentDetails?: unknown;
  productItems?: unknown;
  serviceItems?: unknown;
  expenseDetails?: unknown;
}): void {
  const errors = collectSalesOrderNumericErrors(payload);
  if (errors.length > 0) {
    throw new Error(formatNumericOverflowList(errors));
  }
}

export function getMiscellaneousItemOverflowMessage(params: {
  itemName?: string;
  quantity?: unknown;
  unitPrice?: unknown;
  totalPrice?: unknown;
}): string | null {
  const label = String(params.itemName ?? '').trim() || 'this item';
  const errors = [
    getNumericOverflowMessage(params.quantity, `Quantity for "${label}"`, MONEY_PRECISION),
    getNumericOverflowMessage(params.unitPrice, `Unit price for "${label}"`, MONEY_PRECISION),
    getNumericOverflowMessage(params.totalPrice, `Line total for "${label}"`, MONEY_PRECISION),
  ].filter((message): message is string => Boolean(message));

  if (errors.length === 0) {
    return null;
  }

  return `Cannot add this item because a number is too large:\n${errors
    .map((error) => `• ${error}`)
    .join('\n')}\n\nCorrect these values and try again.`;
}
