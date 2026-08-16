import { Test, TestingModule } from '@nestjs/testing';
import { CapacityService } from './capacity.service';
import { DatabaseService } from 'src/database/database.service';
import { AuditLogService } from 'src/audit-log/audit-log.service';

describe('CapacityService', () => {
  let service: CapacityService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CapacityService,
        { provide: DatabaseService, useValue: {} },
        { provide: AuditLogService, useValue: { logMutation: jest.fn(), log: jest.fn() } },
      ],
    }).compile();

    service = module.get<CapacityService>(CapacityService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
