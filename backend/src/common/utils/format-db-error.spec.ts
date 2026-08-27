import { explainNumericOverflow, toUserFacingError } from './format-db-error';

describe('format-db-error', () => {
  it('turns NUMERIC(5,2) overflow into a service-qty message', () => {
    const message = explainNumericOverflow({
      code: '22003',
      message: 'numeric field overflow',
      detail: 'A field with precision 5, scale 2 must round to an absolute value less than 10^3.',
    });

    expect(message).toMatch(/Service Qty is too large/i);
    expect(message).toMatch(/999\.99/);
  });

  it('turns NUMERIC(12,2) overflow into a money-amount message', () => {
    const message = toUserFacingError(
      {
        code: '22003',
        message: 'numeric field overflow',
        detail: 'A field with precision 12, scale 2 must round to an absolute value less than 10^10.',
      },
      'Failed to update sales order',
    );

    expect(message).toMatch(/money amount is too large/i);
    expect(message).toMatch(/9,999,999,999\.99/);
  });

  it('keeps already-specific application errors', () => {
    expect(toUserFacingError(new Error('Project 999 not found'), 'Failed')).toBe(
      'Project 999 not found',
    );
  });

  it('reads nested pg errors', () => {
    const wrapped = {
      message: 'Failed query',
      cause: {
        code: '22003',
        message: 'numeric field overflow',
        detail: 'A field with precision 5, scale 2 must round to an absolute value less than 10^3.',
      },
    };

    expect(toUserFacingError(wrapped, 'Failed to remit')).toMatch(/Service Qty/i);
  });
});
