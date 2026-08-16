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
});
