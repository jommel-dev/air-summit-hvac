import { Test, TestingModule } from '@nestjs/testing';
import { BrandsController } from './brands.controller';
import { BrandsService } from './brands.service';
import { DatabaseService } from 'src/database/database.service';
import { ConfigService } from '@nestjs/config';
import { AuditLogService } from 'src/audit-log/audit-log.service';

describe('BrandsController', () => {
  let controller: BrandsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [BrandsController],
      providers: [
        BrandsService,
        { provide: DatabaseService, useValue: {} },
        { provide: ConfigService, useValue: { get: () => 'test-secret' } },
        { provide: AuditLogService, useValue: { logMutation: jest.fn(), log: jest.fn() } },
      ],
    }).compile();

    controller = module.get<BrandsController>(BrandsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
