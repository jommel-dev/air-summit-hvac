import { Test, TestingModule } from '@nestjs/testing';
import { SerialNumberController } from './serial-number.controller';
import { SerialNumberService } from './serial-number.service';

describe('SerialNumberController', () => {
  let controller: SerialNumberController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SerialNumberController],
      providers: [SerialNumberService],
    }).compile();

    controller = module.get<SerialNumberController>(SerialNumberController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
