import { Module } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { SettingsController } from './settings.controller';
import { BackupService } from './backup.service';
import { DatabaseModule } from 'src/database/database.module';
import { AuditLogModule } from 'src/audit-log/audit-log.module';

@Module({
  imports: [DatabaseModule, AuditLogModule],
  controllers: [SettingsController],
  providers: [SettingsService, BackupService],
})
export class SettingsModule {}
