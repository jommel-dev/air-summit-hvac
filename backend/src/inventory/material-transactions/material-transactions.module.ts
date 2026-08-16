import { Module } from '@nestjs/common';
import { MaterialTransactionsService } from './material-transactions.service';
import { MaterialTransactionsController } from './material-transactions.controller';
import { DatabaseModule } from 'src/database/database.module';
import { AuditLogModule } from 'src/audit-log/audit-log.module';
import { MaterialsModule } from '../materials/materials.module';
import { MaterialStockModule } from '../material-stock/material-stock.module';

@Module({
  imports: [DatabaseModule, AuditLogModule, MaterialsModule, MaterialStockModule],
  controllers: [MaterialTransactionsController],
  providers: [MaterialTransactionsService],
  exports: [MaterialTransactionsService],
})
export class MaterialTransactionsModule {}
