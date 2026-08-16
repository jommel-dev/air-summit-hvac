import { Test, TestingModule } from '@nestjs/testing';
import { ProductsService } from './products.service';
import { DatabaseService } from 'src/database/database.service';
import { AuditLogService } from 'src/audit-log/audit-log.service';

describe('ProductsService', () => {
  let service: ProductsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductsService,
        { provide: DatabaseService, useValue: {} },
        { provide: AuditLogService, useValue: { logMutation: jest.fn(), log: jest.fn() } },
      ],
    }).compile();

    service = module.get<ProductsService>(ProductsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
