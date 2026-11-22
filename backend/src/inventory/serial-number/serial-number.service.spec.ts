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

  it('restores the pending purchase order when a serial is removed from a sales order', async () => {
    const clientQuery = jest.fn(async (sql: string) => {
      if (String(sql).includes('previous_purchase_id') || String(sql).includes('previousPurchaseId')) {
        return {
          rows: [{ id: 7, purchase_id: '', previous_purchase_id: '185' }],
        };
      }
      return { rowCount: 1, rows: [{ id: 7 }] };
    });
    const logEvent = jest.fn().mockResolvedValue(undefined);
    const databaseService = {
      query: jest.fn(async (sql: string) => {
        if (String(sql).includes('information_schema.columns')) {
          return {
            rows: [
              { column_name: 'salesId' },
              { column_name: 'status' },
              { column_name: 'purchaseId' },
              { column_name: 'previousPurchaseId' },
            ],
          };
        }
        if (String(sql).includes('tblpurchase_orders')) {
          return { rowCount: 1, rows: [{ id: '185', status: 'in-progress' }] };
        }
        return {
          rowCount: 1,
          rows: [
            {
              id: 7,
              salesId: '3502',
              unitType: 'indoor',
              status: 'reserved',
              productId: '1',
              capacityId: '2',
            },
          ],
        };
      }),
      withTransaction: jest.fn(async (callback: (client: { query: jest.Mock }) => Promise<unknown>) =>
        callback({ query: clientQuery }),
      ),
    };
    (service as unknown as { databaseService: typeof databaseService }).databaseService = databaseService;
    (service as unknown as { serialEventLogService: { logEvent: jest.Mock } }).serialEventLogService = {
      logEvent,
    };
    (service as unknown as { auditLogService: { logMutation: jest.Mock } }).auditLogService = {
      logMutation: jest.fn().mockResolvedValue(undefined),
    };

    const result = await service.removeSalesOrderSerial(
      { serialNumber: 'SN-185', salesId: 3502, unitType: 'indoor' },
      { userId: 4, username: 'myln', ipAddress: null },
    );

    expect(result.success).toBe(true);
    const restoreUpdate = clientQuery.mock.calls
      .map((call) => String(call[0]))
      .find((sql) => sql.includes('previousPurchaseId') && sql.includes('UPDATE'));
    expect(restoreUpdate).toContain('"purchaseId" = $1');
    expect(restoreUpdate).toContain('"status" = $2');
    const restoreParams = clientQuery.mock.calls.find((call) =>
      String(call[0]).includes('UPDATE') && String(call[0]).includes('previousPurchaseId'),
    )?.[1] as unknown[];
    expect(restoreParams?.[0]).toBe(185);
    expect(restoreParams?.[1]).toBe('scanned');
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'REMOVED_FROM_SO',
        previousStatus: 'reserved',
        newStatus: 'scanned',
        newPurchaseId: 185,
        newSalesId: null,
      }),
      expect.anything(),
    );
  });

  it('does not restore a purchase order that was cancelled while the serial was on a sales order', async () => {
    const clientQuery = jest.fn(async (sql: string) => {
      if (String(sql).includes('SELECT') && String(sql).includes('previousPurchaseId')) {
        return {
          rows: [{ id: 7, purchase_id: '', previous_purchase_id: '185' }],
        };
      }
      return { rowCount: 1, rows: [{ id: 7 }] };
    });
    const databaseService = {
      query: jest.fn(async (sql: string) => {
        if (String(sql).includes('information_schema.columns')) {
          return {
            rows: [
              { column_name: 'salesId' },
              { column_name: 'status' },
              { column_name: 'purchaseId' },
              { column_name: 'previousPurchaseId' },
            ],
          };
        }
        if (String(sql).includes('tblpurchase_orders')) {
          return { rowCount: 1, rows: [{ id: '185', status: 'cancelled' }] };
        }
        if (String(sql).includes('previousPurchaseId') && String(sql).includes('SELECT')) {
          return { rows: [{ id: 7, purchase_id: '', previous_purchase_id: '185' }] };
        }
        return {
          rowCount: 1,
          rows: [
            {
              id: 7,
              salesId: '3502',
              unitType: 'indoor',
              status: 'reserved',
              productId: '1',
              capacityId: '2',
            },
          ],
        };
      }),
      withTransaction: jest.fn(async (callback: (client: { query: jest.Mock }) => Promise<unknown>) =>
        callback({ query: clientQuery }),
      ),
    };
    (service as unknown as { databaseService: typeof databaseService }).databaseService = databaseService;
    (service as unknown as { serialEventLogService: { logEvent: jest.Mock } }).serialEventLogService = {
      logEvent: jest.fn().mockResolvedValue(undefined),
    };
    (service as unknown as { auditLogService: { logMutation: jest.Mock } }).auditLogService = {
      logMutation: jest.fn().mockResolvedValue(undefined),
    };

    const result = await service.removeSalesOrderSerial({
      serialNumber: 'SN-185',
      salesId: 3502,
      unitType: 'indoor',
    });

    expect(result.success).toBe(true);
    const restoreUpdate = clientQuery.mock.calls
      .map((call) => String(call[0]))
      .find((sql) => sql.includes('UPDATE') && sql.includes('previousPurchaseId'));
    expect(restoreUpdate).toBeUndefined();
  });
});
