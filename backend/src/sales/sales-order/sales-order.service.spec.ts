import { Test, TestingModule } from '@nestjs/testing';
import { SalesOrderService } from './sales-order.service';
import { DatabaseService } from 'src/database/database.service';
import { MaterialStockService } from 'src/inventory/material-stock/material-stock.service';
import { MaterialTransactionsService } from 'src/inventory/material-transactions/material-transactions.service';
import { MaterialsService } from 'src/inventory/materials/materials.service';
import { PurchaseService } from 'src/inventory/purchase/purchase.service';
import { AuditLogService } from 'src/audit-log/audit-log.service';
import { SoNumberService } from './so-number.service';

describe('SalesOrderService', () => {
  let service: SalesOrderService;
  let database: {
    query: jest.Mock;
    withTransaction: jest.Mock;
  };

  beforeEach(async () => {
    database = {
      query: jest.fn(),
      withTransaction: jest.fn(async (callback: (client: { query: jest.Mock }) => Promise<unknown>) =>
        callback({ query: database.query }),
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SalesOrderService,
        { provide: DatabaseService, useValue: database },
        { provide: MaterialStockService, useValue: {} },
        { provide: MaterialTransactionsService, useValue: {} },
        { provide: MaterialsService, useValue: {} },
        { provide: PurchaseService, useValue: {} },
        { provide: AuditLogService, useValue: { logMutation: jest.fn(), log: jest.fn() } },
        { provide: SoNumberService, useValue: { generateNext: jest.fn().mockResolvedValue('SO-000001') } },
      ],
    }).compile();

    service = module.get<SalesOrderService>(SalesOrderService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create — project sales type (projects-first)', () => {
    it('fails when project sales order has no projectId', async () => {
      const result = await service.create({
        salesType: 'project',
        productItems: [
          {
            productId: 1,
            totalSetQty: 1,
            unitPrice: 100,
          } as any,
        ],
      } as any);

      expect(result.success).toBe(false);
      expect(result.message).toMatch(/projectId is required/i);
    });

    it('fails when selected project does not exist', async () => {
      database.query.mockResolvedValueOnce({ rowCount: 0, rows: [] });

      const result = await service.create({
        salesType: 'project',
        projectId: 999,
        productItems: [
          {
            productId: 1,
            totalSetQty: 1,
            unitPrice: 100,
          } as any,
        ],
      } as any);

      expect(result.success).toBe(false);
      expect(result.message).toMatch(/Project 999 not found/i);
    });

    it('fails when selected project has no customer', async () => {
      database.query.mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            id: 5,
            customer_id: null,
            project_code: 'PRJ-5',
            project_name: 'No Customer Job',
          },
        ],
      });

      const result = await service.create({
        salesType: 'project',
        projectId: 5,
        productItems: [
          {
            productId: 1,
            totalSetQty: 1,
            unitPrice: 100,
          } as any,
        ],
      } as any);

      expect(result.success).toBe(false);
      expect(result.message).toMatch(/no customer/i);
    });

    it('does not require projectId for non-project sales types', async () => {
      // Early validation: empty payload without items should fail for a different reason
      const result = await service.create({
        salesType: 'sales',
      } as any);

      expect(result.success).toBe(false);
      expect(result.message).not.toMatch(/projectId is required/i);
      expect(result.message).toMatch(/product item|service item|project detail/i);
    });
  });

  describe('resolveSalesOrderTotalAmount', () => {
    it('multiplies service unit price by qty and includes payload excess', () => {
      const total = (service as any).resolveSalesOrderTotalAmount({
        productItems: [{ unitPrice: 10000, totalSetQty: 2 }],
        serviceItems: [{ serviceCost: 500, serviceDurationHours: 3 }],
        payloadTotalAmount: 23000, // 20000 products + 1500 service + 1500 excess
      });

      expect(total).toBe(23000);
    });

    it('falls back to computed line total when payload is lower', () => {
      const total = (service as any).resolveSalesOrderTotalAmount({
        productItems: [{ sellPrice: 96000, totalSetQty: 1 }],
        serviceItems: [{ serviceCost: 1000, serviceDurationHours: 2 }],
        payloadTotalAmount: 1000,
      });

      expect(total).toBe(98000);
    });
  });

  describe('syncSalesOrderTotalFromComponents', () => {
    it('persists product + service + excess total on the sales order', async () => {
      database.query
        .mockResolvedValueOnce({ rows: [{ total: '111000' }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 });

      const total = await (service as any).syncSalesOrderTotalFromComponents(42);

      expect(total).toBe(111000);
      expect(database.query).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('UPDATE tblsales_order'),
        [111000, 42],
      );
    });
  });

  describe('completeProjectSalesOrder', () => {
    it('rejects non-project sales orders', async () => {
      jest.spyOn(service as any, 'getSalesOrderAuditSnapshot').mockResolvedValue(null);
      database.query.mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ id: 1, so_number: 'SO-1', status: 'pending', sales_type: 'sales' }],
      });

      const result = await service.completeProjectSalesOrder(1);
      expect(result.success).toBe(false);
      expect(result.message).toMatch(/only project/i);
    });

    it('completes a project sales order', async () => {
      jest.spyOn(service as any, 'getSalesOrderAuditSnapshot').mockResolvedValue({ id: 1 });
      database.query
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{ id: 1, so_number: 'SO-1', status: 'for-delivery', sales_type: 'project' }],
        })
        .mockResolvedValueOnce({ rowCount: 1, rows: [] });

      const result = await service.completeProjectSalesOrder(1, 9);
      expect(result.success).toBe(true);
      expect(result.message).toMatch(/SOA|Settlement/i);
      expect(database.query).toHaveBeenCalledWith(
        expect.stringContaining("status = 'complete'"),
        [1],
      );
    });

    it('skips project orders in bulk remit', async () => {
      database.query.mockResolvedValueOnce({
        rows: [
          {
            id: 5,
            so_number: 'SO-P',
            normalized_status: 'for-delivery',
            serial_count: '2',
            sales_type: 'project',
          },
        ],
      });

      const result = await service.bulkRemitSalesOrders([5]);
      expect(result.success).toBe(false);
      expect(result.skipped?.[0]?.reason).toMatch(/Complete \(SOA/i);
    });
  });
});
