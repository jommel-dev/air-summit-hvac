import { Test, TestingModule } from '@nestjs/testing';
import { SerialNumberController } from './serial-number.controller';
import { SerialNumberService } from './serial-number.service';
import { DatabaseService } from 'src/database/database.service';
import { AuditLogService } from 'src/audit-log/audit-log.service';
import { SerialEventLogService } from './serial-event-log.service';
import { ScanFileLoggerService } from './scan-file-logger.service';
import { ConfigService } from '@nestjs/config';

describe('SerialNumberController', () => {
  let controller: SerialNumberController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SerialNumberController],
      providers: [
        SerialNumberService,
        { provide: DatabaseService, useValue: {} },
        { provide: AuditLogService, useValue: {} },
        { provide: SerialEventLogService, useValue: {} },
        { provide: ScanFileLoggerService, useValue: {} },
        { provide: ConfigService, useValue: { get: () => 'test-secret' } },
      ],
    }).compile();

    controller = module.get<SerialNumberController>(SerialNumberController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
