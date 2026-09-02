import { Test, TestingModule } from '@nestjs/testing';
import { SerialNumberService } from './serial-number.service';
import { DatabaseService } from 'src/database/database.service';
import { AuditLogService } from 'src/audit-log/audit-log.service';
import { SerialEventLogService } from './serial-event-log.service';
import { ScanFileLoggerService } from './scan-file-logger.service';

describe('SerialNumberService', () => {
  let service: SerialNumberService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SerialNumberService,
        { provide: DatabaseService, useValue: {} },
        { provide: AuditLogService, useValue: { logMutation: jest.fn(), log: jest.fn() } },
        { provide: SerialEventLogService, useValue: {} },
        { provide: ScanFileLoggerService, useValue: {} },
      ],
    }).compile();

    service = module.get<SerialNumberService>(SerialNumberService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('bulkSearch rejects an empty serial list', async () => {
    await expect(service.bulkSearch({ serialNumbers: ['  ', ''] })).rejects.toMatchObject({
      status: 400,
    });
  });

  it('bulkSearch returns found rows and notFound serials', async () => {
    const databaseService = {
      query: jest.fn().mockResolvedValue({
        rows: [
          {
            id: 1,
            serialNumber: 'SN-001',
            status: 'in-stock',
            unitType: 'indoor',
            brandName: 'Carrier',
            productName: 'Unit A',
            capacity: '1.0 HP',
            branchName: 'Arayat',
            poNumber: 'PO-1',
            soNumber: null,
            customerName: null,
            isDefective: false,
            isReturned: false,
            createdAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      }),
    };
    (service as unknown as { databaseService: typeof databaseService }).databaseService = databaseService;

    const result = await service.bulkSearch({
      serialNumbers: ['SN-001', 'sn-001', 'MISSING-99'],
    });

    expect(databaseService.query).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);
    expect(result.queriedCount).toBe(2);
    expect(result.total).toBe(1);
    expect(result.items[0].serialNumber).toBe('SN-001');
    expect(result.notFound).toEqual(['MISSING-99']);
  });

  it('excludes defective serials from in-stock in getSerialNumbersByScope', async () => {
    const databaseService = {
      query: jest
        .fn()
        .mockResolvedValueOnce({
          rows: [
            {
              serialNumber: 'SN-OK',
              status: 'in-stock',
              unitType: 'Indoor',
              isDefective: false,
            },
            {
              serialNumber: 'SN-DEF-STATUS',
              status: 'defective',
              unitType: 'Indoor',
              isDefective: false,
            },
            {
              serialNumber: 'SN-DEF-FLAG',
              status: 'in-stock',
              unitType: 'Outdoor',
              isDefective: true,
            },
            {
              serialNumber: 'SN-RESERVED',
              status: 'reserved',
              unitType: 'Indoor',
              isDefective: false,
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [{ unit: 'set', unitTypes: 'Indoor,Outdoor' }],
        }),
    };
    (service as unknown as { databaseService: typeof databaseService }).databaseService =
      databaseService;

    const result = await service.getSerialNumbersByScope('1', '2');

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }

    expect(result.item.serials.inStock.map((entry) => entry.serialNumber)).toEqual(['SN-OK']);
    expect(result.item.counts.inStock).toBe(1);
    expect(result.item.counts.reserved).toBe(1);
  });

  it('excludes defective serials from in-stock in getCapacityStockSummary', async () => {
    const databaseService = {
      query: jest
        .fn()
        .mockResolvedValueOnce({
          rows: [
            { serialNumber: 'SN-OK', status: 'in-stock', isDefective: false },
            { serialNumber: 'SN-DEFECTIVE', status: 'defective', isDefective: true },
          ],
        })
        .mockResolvedValueOnce({
          rows: [{ unit: 'pc', unitTypes: 'Window' }],
        }),
    };
    (service as unknown as { databaseService: typeof databaseService }).databaseService =
      databaseService;

    const result = await service.getCapacityStockSummary('1', '2');

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }

    expect(result.item.serials.inStock).toEqual(['SN-OK']);
    expect(result.item.counts.inStock).toBe(1);
  });
});
