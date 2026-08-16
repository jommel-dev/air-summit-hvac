import { Test, TestingModule } from '@nestjs/testing';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { DatabaseService } from 'src/database/database.service';
import { AuditLogService } from 'src/audit-log/audit-log.service';

describe('UsersController', () => {
  let controller: UsersController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        UsersService,
        { provide: DatabaseService, useValue: {} },
        {
          provide: AuditLogService,
          useValue: { logMutation: jest.fn(), log: jest.fn() },
        },
      ],
    }).compile();

    controller = module.get<UsersController>(UsersController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
