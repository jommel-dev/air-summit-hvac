import { Test, TestingModule } from '@nestjs/testing';
import { SalesOrderController } from './sales-order.controller';
import { SalesOrderService } from './sales-order.service';
import { DatabaseService } from 'src/database/database.service';
import { MaterialStockService } from 'src/inventory/material-stock/material-stock.service';
import { MaterialTransactionsService } from 'src/inventory/material-transactions/material-transactions.service';
import { MaterialsService } from 'src/inventory/materials/materials.service';
import { PurchaseService } from 'src/inventory/purchase/purchase.service';
import { AuditLogService } from 'src/audit-log/audit-log.service';
import { SoNumberService } from './so-number.service';
import { ConfigService } from '@nestjs/config';

describe('SalesOrderController', () => {
  let controller: SalesOrderController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SalesOrderController],
      providers: [
        SalesOrderService,
        { provide: DatabaseService, useValue: {} },
        { provide: MaterialStockService, useValue: {} },
        { provide: MaterialTransactionsService, useValue: {} },
        { provide: MaterialsService, useValue: {} },
        { provide: PurchaseService, useValue: {} },
        { provide: AuditLogService, useValue: { logMutation: jest.fn(), log: jest.fn() } },
        { provide: SoNumberService, useValue: {} },
        { provide: ConfigService, useValue: { get: () => 'test-secret' } },
      ],
    }).compile();

    controller = module.get<SalesOrderController>(SalesOrderController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
