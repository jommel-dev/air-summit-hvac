import { Test, TestingModule } from '@nestjs/testing';
import { BrandsService } from './brands.service';
import { DatabaseService } from 'src/database/database.service';

describe('BrandsService', () => {
  let service: BrandsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BrandsService,
        { provide: DatabaseService, useValue: {} },
      ],
    }).compile();

    service = module.get<BrandsService>(BrandsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
