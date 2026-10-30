import { Module } from '@nestjs/common';
import { AuditLogModule } from 'src/audit-log/audit-log.module';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { DatabaseModule } from 'src/database/database.module';
import { BeginningStockController } from './beginning-stock.controller';
import { BeginningStockService } from './beginning-stock.service';

@Module({
  imports: [DatabaseModule, AuditLogModule],
  controllers: [BeginningStockController],
  providers: [BeginningStockService, JwtAuthGuard],
})
export class BeginningStockModule {}
