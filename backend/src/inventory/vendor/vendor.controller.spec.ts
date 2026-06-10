import { Test, TestingModule } from '@nestjs/testing';
import { VendorController } from './vendor.controller';
import { VendorService } from './vendor.service';
import { DatabaseService } from 'src/database/database.service';
import { AuditLogService } from 'src/audit-log/audit-log.service';
import { ConfigService } from '@nestjs/config';

describe('VendorController', () => {
  let controller: VendorController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [VendorController],
      providers: [
        VendorService,
        { provide: DatabaseService, useValue: {} },
        { provide: AuditLogService, useValue: {} },
        { provide: ConfigService, useValue: { get: () => 'test-secret' } },
      ],
    }).compile();

    controller = module.get<VendorController>(VendorController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
