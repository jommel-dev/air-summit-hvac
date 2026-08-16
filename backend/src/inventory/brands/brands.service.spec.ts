import { Test, TestingModule } from '@nestjs/testing';
import { BrandsService } from './brands.service';
import { DatabaseService } from 'src/database/database.service';
import { AuditLogService } from 'src/audit-log/audit-log.service';

describe('BrandsService', () => {
  let service: BrandsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BrandsService,
        { provide: DatabaseService, useValue: {} },
        { provide: AuditLogService, useValue: { logMutation: jest.fn(), log: jest.fn() } },
      ],
    }).compile();

    service = module.get<BrandsService>(BrandsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
