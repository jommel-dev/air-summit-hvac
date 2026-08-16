import { Module } from '@nestjs/common';
import { DatabaseModule } from 'src/database/database.module';
import { AuditLogModule } from 'src/audit-log/audit-log.module';
import { MaterialStockService } from './material-stock.service';
import { MaterialStockController } from './material-stock.controller';

@Module({
  imports: [DatabaseModule, AuditLogModule],
  providers: [MaterialStockService],
  controllers: [MaterialStockController],
  exports: [MaterialStockService],
})
export class MaterialStockModule {}