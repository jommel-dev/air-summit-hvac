import { Test, TestingModule } from '@nestjs/testing';
import { LoginController } from './login.controller';
import { LoginService } from './login.service';
import { DatabaseService } from 'src/database/database.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AuditLogService } from 'src/audit-log/audit-log.service';

describe('LoginController', () => {
  let controller: LoginController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [LoginController],
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

    controller = module.get<LoginController>(LoginController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
