import { Test, TestingModule } from '@nestjs/testing';
import { LoginService } from './login.service';
import { DatabaseService } from 'src/database/database.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AuditLogService } from 'src/audit-log/audit-log.service';

describe('LoginService', () => {
  let service: LoginService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LoginService,
        { provide: DatabaseService, useValue: {} },
        { provide: JwtService, useValue: {} },
        { provide: ConfigService, useValue: {} },
        {
          provide: AuditLogService,
          useValue: { log: jest.fn(), logMutation: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<LoginService>(LoginService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
