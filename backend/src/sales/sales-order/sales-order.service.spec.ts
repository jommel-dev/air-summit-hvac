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

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SalesOrderService,
        { provide: DatabaseService, useValue: {} },
        { provide: MaterialStockService, useValue: {} },
        { provide: MaterialTransactionsService, useValue: {} },
        { provide: MaterialsService, useValue: {} },
        { provide: PurchaseService, useValue: {} },
        { provide: AuditLogService, useValue: {} },
        { provide: SoNumberService, useValue: {} },
      ],
    }).compile();

    service = module.get<SalesOrderService>(SalesOrderService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
