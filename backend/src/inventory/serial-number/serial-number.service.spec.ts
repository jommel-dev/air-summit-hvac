import { Test, TestingModule } from '@nestjs/testing';
import { SerialNumberService } from './serial-number.service';
import { DatabaseService } from 'src/database/database.service';
import { AuditLogService } from 'src/audit-log/audit-log.service';
import { SerialEventLogService } from './serial-event-log.service';
import { ScanFileLoggerService } from './scan-file-logger.service';

describe('SerialNumberService', () => {
  let service: SerialNumberService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SerialNumberService,
        { provide: DatabaseService, useValue: {} },
        { provide: AuditLogService, useValue: {} },
        { provide: SerialEventLogService, useValue: {} },
        { provide: ScanFileLoggerService, useValue: {} },
      ],
    }).compile();

    service = module.get<SerialNumberService>(SerialNumberService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
