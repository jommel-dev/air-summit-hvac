import { Module } from '@nestjs/common';
import { PurchaseService } from './purchase.service';
import { PurchaseController } from './purchase.controller';
import { DatabaseModule } from 'src/database/database.module';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { MaterialStockModule } from 'src/inventory/material-stock/material-stock.module';
import { AuditLogModule } from 'src/audit-log/audit-log.module';
import { SerialNumberModule } from 'src/inventory/serial-number/serial-number.module';

@Module({
  imports: [DatabaseModule, MaterialStockModule, AuditLogModule, SerialNumberModule],
  controllers: [PurchaseController],
  providers: [PurchaseService, JwtAuthGuard],
  exports: [PurchaseService],
})
export class PurchaseModule {}
