import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DatabaseService } from 'src/database/database.service';
import { AuditLogService } from 'src/audit-log/audit-log.service';
import { ProjectsService } from './projects.service';

describe('ProjectsService', () => {
  let service: ProjectsService;
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
        ProjectsService,
        { provide: DatabaseService, useValue: database },
        { provide: AuditLogService, useValue: { logMutation: jest.fn(), log: jest.fn() } },
      ],
    }).compile();

    service = module.get(ProjectsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('rejects missing project code/name', async () => {
      await expect(
        service.create({
          projectCode: '',
          projectName: '',
          customerId: 'cust-1',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects missing customer', async () => {
      await expect(
        service.create({
          projectCode: 'PRJ-1',
          projectName: 'Test',
          customerId: '',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects unknown customer', async () => {
      database.query.mockResolvedValueOnce({ rowCount: 0, rows: [] });

      await expect(
        service.create({
          projectCode: 'PRJ-1',
          projectName: 'Test',
          customerId: 'missing-customer',
        }),
      ).rejects.toThrow('Selected customer was not found');
    });

    it('rejects duplicate project code', async () => {
      database.query
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'cust-1' }] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 9 }] });

      await expect(
        service.create({
          projectCode: 'PRJ-1',
          projectName: 'Test',
          customerId: 'cust-1',
        }),
      ).rejects.toThrow('already exists');
    });

    it('creates project and returns detail', async () => {
      database.query
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'cust-1' }] }) // customer exists
        .mockResolvedValueOnce({ rowCount: 0, rows: [] }) // no duplicate
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 42 }] }); // insert

      const findOneSpy = jest.spyOn(service, 'findOne').mockResolvedValue({
        success: true,
        data: {
          id: 42,
          projectCode: 'PRJ-1',
          projectName: 'Test',
          projectStatus: 'planning',
          customerId: 'cust-1',
          relatedSalesOrders: [],
        } as any,
      });

      const result = await service.create({
        projectCode: 'PRJ-1',
        projectName: 'Test',
        customerId: 'cust-1',
        pocName: 'Juan',
      });

      expect(result.data.id).toBe(42);
      expect(findOneSpy).toHaveBeenCalledWith(42);
    });
  });

  describe('remove', () => {
    beforeEach(() => {
      jest.spyOn(service, 'findOne').mockResolvedValue({
        success: true,
        data: {
          id: 7,
          projectCode: 'PRJ-7',
          projectName: 'Job',
          relatedSalesOrders: [],
        } as any,
      });
    });

    it('soft-cancels when linked sales orders exist', async () => {
      database.query
        .mockResolvedValueOnce({ rows: [{ count: '2' }] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [] });

      const result = await service.remove(7);

      expect(result.softCancelled).toBe(true);
      expect(result.message).toContain('cancelled');
      expect(database.query).toHaveBeenCalledWith(
        expect.stringContaining("project_status = 'cancelled'"),
        [7],
      );
    });

    it('hard deletes when no linked sales orders', async () => {
      database.query
        .mockResolvedValueOnce({ rows: [{ count: '0' }] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [] });

      const result = await service.remove(7);

      expect(result.softCancelled).toBe(false);
      expect(database.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM tblprojects'),
        [7],
      );
    });

    it('throws when hard delete finds nothing', async () => {
      database.query
        .mockResolvedValueOnce({ rows: [{ count: '0' }] })
        .mockResolvedValueOnce({ rowCount: 0, rows: [] });

      await expect(service.remove(99)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('getBilling', () => {
    it('rolls up totals from related sales orders', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue({
        success: true,
        data: {
          id: 1,
          projectCode: 'PRJ-1',
          projectName: 'Job',
          customerId: 'cust-1',
          customerName: 'Acme',
          relatedSalesOrders: [
            {
              id: 10,
              soNumber: 'SO-1',
              customerId: 'cust-1',
              customerName: 'Acme',
              totalAmount: 1000,
              paidAmount: 250,
              balance: 750,
              status: 'remitted',
            },
            {
              id: 11,
              soNumber: 'SO-2',
              customerId: 'cust-1',
              customerName: 'Acme',
              totalAmount: 500,
              paidAmount: 500,
              balance: 0,
              status: 'complete',
            },
          ],
        } as any,
      });

      const billing = await service.getBilling(1);

      expect(billing.data.totalAmount).toBe(1500);
      expect(billing.data.paidAmount).toBe(750);
      expect(billing.data.balance).toBe(750);
      expect(billing.data.salesOrders).toHaveLength(2);
    });
  });

  describe('createSettlement', () => {
    it('rejects when project has no open balances', async () => {
      jest.spyOn(service, 'getBilling').mockResolvedValue({
        success: true,
        data: {
          projectId: 1,
          projectCode: 'PRJ-1',
          projectName: 'Job',
          customerId: 'cust-1',
          customerName: 'Acme',
          totalAmount: 100,
          paidAmount: 100,
          balance: 0,
          salesOrders: [
            {
              id: 10,
              soNumber: 'SO-1',
              customerId: 'cust-1',
              customerName: 'Acme',
              totalAmount: 100,
              paidAmount: 100,
              balance: 0,
              status: 'complete',
            },
          ],
        },
      });

      await expect(
        service.createSettlement(1, { amount: 50, mode: 'partial' }),
      ).rejects.toThrow('no open sales-order balances');
    });

    it('allocates payment to oldest open SO first', async () => {
      const openBilling = {
        success: true as const,
        data: {
          projectId: 1,
          projectCode: 'PRJ-1',
          projectName: 'Job',
          customerId: 'cust-1',
          customerName: 'Acme',
          totalAmount: 300,
          paidAmount: 0,
          balance: 300,
          salesOrders: [
            {
              id: 20,
              soNumber: 'SO-NEW',
              customerId: 'cust-1',
              customerName: 'Acme',
              totalAmount: 200,
              paidAmount: 0,
              balance: 200,
              status: 'remitted',
              createdAt: '2026-02-01T00:00:00.000Z',
            },
            {
              id: 10,
              soNumber: 'SO-OLD',
              customerId: 'cust-1',
              customerName: 'Acme',
              totalAmount: 100,
              paidAmount: 0,
              balance: 100,
              status: 'remitted',
              createdAt: '2026-01-01T00:00:00.000Z',
            },
          ],
        },
      };

      jest
        .spyOn(service, 'getBilling')
        .mockResolvedValueOnce(openBilling)
        .mockResolvedValueOnce({
          ...openBilling,
          data: { ...openBilling.data, paidAmount: 100, balance: 200 },
        });

      database.query
        .mockResolvedValueOnce({ rowCount: 1, rows: [] })
        .mockResolvedValueOnce({ rows: [{ paid: '100', outstanding: '0' }] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [] });

      const result = await service.createSettlement(1, {
        amount: 100,
        mode: 'partial',
        method: 'Bank Transfer',
      });

      expect(result.success).toBe(true);
      expect(result.allocations).toEqual([
        { salesOrderId: 10, amount: 100, method: 'Bank Transfer' },
      ]);
      expect(database.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO tblso_payments'),
        [10, 'Bank Transfer', 100, 'paid', expect.any(String), null, null, null],
      );
    });
  });

  describe('createStatement', () => {
    it('rejects project without customer', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue({
        success: true,
        data: {
          id: 1,
          projectCode: 'PRJ-1',
          projectName: 'Job',
          customerId: '',
          relatedSalesOrders: [],
        } as any,
      });

      await expect(
        service.createStatement(1, {
          periodFrom: '2026-01-01',
          periodTo: '2026-01-31',
        }),
      ).rejects.toThrow('no customer');
    });
  });
});
