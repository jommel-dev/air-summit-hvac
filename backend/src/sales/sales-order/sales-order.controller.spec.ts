import { Test, TestingModule } from '@nestjs/testing';
import { SalesOrderController } from './sales-order.controller';
import { SalesOrderService } from './sales-order.service';

describe('SalesOrderController', () => {
  let controller: SalesOrderController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SalesOrderController],
      providers: [SalesOrderService],
    }).compile();

    controller = module.get<SalesOrderController>(SalesOrderController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
