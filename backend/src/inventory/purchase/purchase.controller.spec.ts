import { Test, TestingModule } from '@nestjs/testing';
import { PurchaseController } from './purchase.controller';
import { PurchaseService } from './purchase.service';
import { DatabaseService } from 'src/database/database.service';
import { MaterialStockService } from 'src/inventory/material-stock/material-stock.service';
import { AuditLogService } from 'src/audit-log/audit-log.service';
import { ConfigService } from '@nestjs/config';

describe('PurchaseController', () => {
  let controller: PurchaseController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PurchaseController],
      providers: [
        PurchaseService,
        { provide: DatabaseService, useValue: {} },
        { provide: MaterialStockService, useValue: {} },
        { provide: AuditLogService, useValue: {} },
        { provide: ConfigService, useValue: { get: () => 'test-secret' } },
      ],
    }).compile();

    controller = module.get<PurchaseController>(PurchaseController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
