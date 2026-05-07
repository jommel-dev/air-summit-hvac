import { Module } from '@nestjs/common';
import { SerialNumberService } from './serial-number.service';
import { SerialNumberController } from './serial-number.controller';
import { SerialEventLogService } from './serial-event-log.service';
import { DatabaseModule } from 'src/database/database.module';
import { AuditLogModule } from 'src/audit-log/audit-log.module';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';

@Module({
  imports: [DatabaseModule, AuditLogModule],
  controllers: [SerialNumberController],
  providers: [SerialNumberService, SerialEventLogService, JwtAuthGuard],
  exports: [SerialNumberService, SerialEventLogService],
})
export class SerialNumberModule {}
