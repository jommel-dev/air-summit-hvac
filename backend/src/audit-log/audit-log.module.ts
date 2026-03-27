import { Module } from '@nestjs/common';
import { AuditLogService } from './audit-log.service';
import { DatabaseModule } from 'src/database/database.module';

@Module({
  imports: [DatabaseModule],
  providers: [AuditLogService],
  exports: [AuditLogService],
})
export class AuditLogModule {}
