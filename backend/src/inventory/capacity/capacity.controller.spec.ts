import { Test, TestingModule } from '@nestjs/testing';
import { CapacityController } from './capacity.controller';
import { CapacityService } from './capacity.service';
import { DatabaseService } from 'src/database/database.service';
import { ConfigService } from '@nestjs/config';
import { AuditLogService } from 'src/audit-log/audit-log.service';

describe('CapacityController', () => {
  let controller: CapacityController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CapacityController],
      providers: [
        CapacityService,
        { provide: DatabaseService, useValue: {} },
        { provide: ConfigService, useValue: { get: () => 'test-secret' } },
        { provide: AuditLogService, useValue: { logMutation: jest.fn(), log: jest.fn() } },
      ],
    }).compile();

    controller = module.get<CapacityController>(CapacityController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
