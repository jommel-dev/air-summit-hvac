import { Module } from '@nestjs/common';
import { MaterialStockService } from './material-stock.service';

@Module({
  providers: [MaterialStockService],
  exports: [MaterialStockService],
})
export class MaterialStockModule {}
