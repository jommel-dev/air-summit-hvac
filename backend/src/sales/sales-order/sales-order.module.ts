import { Module } from '@nestjs/common';
import { SalesOrderService } from './sales-order.service';
import { SalesOrderController } from './sales-order.controller';
import { DatabaseModule } from 'src/database/database.module';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { MaterialStockModule } from 'src/inventory/material-stock/material-stock.module';
import { MaterialTransactionsModule } from 'src/inventory/material-transactions/material-transactions.module';

@Module({
  imports: [DatabaseModule, MaterialStockModule, MaterialTransactionsModule],
  controllers: [SalesOrderController],
  providers: [SalesOrderService, JwtAuthGuard],
})
export class SalesOrderModule {}
