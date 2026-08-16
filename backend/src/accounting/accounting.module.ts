import { Module } from '@nestjs/common';
import { DatabaseModule } from 'src/database/database.module';
import { AuditLogModule } from 'src/audit-log/audit-log.module';
import { AccountingController } from './accounting.controller';
import { AccountingService } from './accounting.service';

@Module({
  imports: [DatabaseModule, AuditLogModule],
  controllers: [AccountingController],
  providers: [AccountingService],
  exports: [AccountingService],
})
export class AccountingModule {}
