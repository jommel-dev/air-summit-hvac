import { Test, TestingModule } from '@nestjs/testing';
import { VendorService } from './vendor.service';
import { DatabaseService } from 'src/database/database.service';
import { AuditLogService } from 'src/audit-log/audit-log.service';

describe('VendorService', () => {
  let service: VendorService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VendorService,
        { provide: DatabaseService, useValue: {} },
        { provide: AuditLogService, useValue: {} },
      ],
    }).compile();

    service = module.get<VendorService>(VendorService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
