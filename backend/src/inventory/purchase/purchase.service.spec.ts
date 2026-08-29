import { Test, TestingModule } from '@nestjs/testing';
import { PurchaseService } from './purchase.service';
import { DatabaseService } from 'src/database/database.service';
import { MaterialStockService } from 'src/inventory/material-stock/material-stock.service';
import { AuditLogService } from 'src/audit-log/audit-log.service';
import { SerialEventLogService } from 'src/inventory/serial-number/serial-event-log.service';

describe('PurchaseService', () => {
  let service: PurchaseService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PurchaseService,
        { provide: DatabaseService, useValue: {} },
        { provide: MaterialStockService, useValue: {} },
        { provide: AuditLogService, useValue: { logMutation: jest.fn(), log: jest.fn() } },
        { provide: SerialEventLogService, useValue: { logEvent: jest.fn().mockResolvedValue(undefined) } },
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

  it('treats approved and received POs as post-approval so serial statuses stay locked', () => {
    expect((service as any).isPostApprovalPurchaseStatus('approved')).toBe(true);
    expect((service as any).isPostApprovalPurchaseStatus('completed')).toBe(true);
    expect((service as any).isPostApprovalPurchaseStatus('received')).toBe(true);
    expect((service as any).isPostApprovalPurchaseStatus('pending')).toBe(false);
    expect((service as any).isPostApprovalPurchaseStatus('for_approval')).toBe(false);
  });

  it('preserves in-stock and later serial statuses instead of reverting to scanned', () => {
    expect((service as any).shouldPreserveExistingSerialStatus('in-stock')).toBe(true);
    expect((service as any).shouldPreserveExistingSerialStatus('installed')).toBe(true);
    expect((service as any).shouldPreserveExistingSerialStatus('sold')).toBe(true);
    expect((service as any).shouldPreserveExistingSerialStatus('reserved')).toBe(true);
    expect((service as any).shouldPreserveExistingSerialStatus('for-delivery')).toBe(true);
    expect((service as any).shouldPreserveExistingSerialStatus('scanned')).toBe(false);
  });

  it('allows scanned serials on approved POs to be promoted to in-stock', () => {
    expect((service as any).isPostApprovalPurchaseStatus('approved')).toBe(true);
    expect((service as any).shouldPreserveExistingSerialStatus('scanned')).toBe(false);
  });
});
