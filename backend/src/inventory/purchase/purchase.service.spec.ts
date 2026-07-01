import { Test, TestingModule } from '@nestjs/testing';
import { PurchaseService } from './purchase.service';
import { DatabaseService } from 'src/database/database.service';
import { MaterialStockService } from 'src/inventory/material-stock/material-stock.service';
import { AuditLogService } from 'src/audit-log/audit-log.service';

describe('PurchaseService', () => {
  let service: PurchaseService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PurchaseService,
        { provide: DatabaseService, useValue: {} },
        { provide: MaterialStockService, useValue: {} },
        { provide: AuditLogService, useValue: {} },
      ],
    }).compile();

    service = module.get<PurchaseService>(PurchaseService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('builds a branch visibility clause that includes unassigned legacy records', () => {
    const clause = (service as any).buildBranchVisibilityClause(3);

    expect(clause).toContain('base.branch_id = $3');
    expect(clause).toContain("NULLIF(COALESCE(base.branch_id, ''), '') IS NULL");
  });
});
