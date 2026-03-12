import { Module } from '@nestjs/common';
import { DatabaseModule } from 'src/database/database.module';
import { MaterialStockService } from './material-stock.service';
import { MaterialStockController } from './material-stock.controller';

@Module({
  imports: [DatabaseModule],
  providers: [MaterialStockService],
  controllers: [MaterialStockController],
  exports: [MaterialStockService],
})
export class MaterialStockModule {}