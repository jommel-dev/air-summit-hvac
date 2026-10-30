import { Test, TestingModule } from '@nestjs/testing';
import { AuditLogService } from 'src/audit-log/audit-log.service';
import { DatabaseService } from 'src/database/database.service';
import { BeginningStockService } from './beginning-stock.service';

describe('BeginningStockService', () => {
  let service: BeginningStockService;
  let query: jest.Mock;
  const auditLog = { log: jest.fn().mockResolvedValue(undefined) };

  beforeEach(async () => {
    query = jest.fn(async (sql: string) => {
      if (sql.includes('FROM tblbeginning_stock_capture')) {
        return { rows: [], rowCount: 0 };
      }

      if (sql.includes('INSERT INTO tblbeginning_stock (')) {
        return { rows: [], rowCount: 3 };
      }

      if (sql.includes('INSERT INTO tblbeginning_stock_capture')) {
        return { rows: [], rowCount: 1 };
      }

      return { rows: [], rowCount: 0 };
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BeginningStockService,
        {
          provide: DatabaseService,
          useValue: {
            withTransaction: async (callback: (client: { query: jest.Mock }) => Promise<unknown>) =>
              callback({ query }),
            query: jest.fn(),
          },
        },
        { provide: AuditLogService, useValue: auditLog },
      ],
    }).compile();

    service = module.get(BeginningStockService);
    auditLog.log.mockClear();
  });

  it('saves one count for today and does not run the insert again', async () => {
    const first = await service.captureToday();
    expect(first.item.alreadyCaptured).toBe(false);
    expect(first.item.inserted).toBe(3);
    expect(query.mock.calls.some((call) => String(call[0]).includes('INSERT INTO tblbeginning_stock ('))).toBe(
      true,
    );

    query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM tblbeginning_stock_capture')) {
        return { rows: [{ snapshot_date: first.item.snapshotDate }], rowCount: 1 };
      }

      return { rows: [], rowCount: 0 };
    });

    const second = await service.captureToday();
    expect(second.item.alreadyCaptured).toBe(true);
    expect(second.item.inserted).toBe(0);
    expect(
      query.mock.calls.filter((call) => String(call[0]).includes('INSERT INTO tblbeginning_stock (')).length,
    ).toBe(1);
  });
});
