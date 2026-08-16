import { Module } from '@nestjs/common';
import { PublicFeedbackController } from './public-feedback.controller';
import { DatabaseModule } from 'src/database/database.module';
import { AuditLogModule } from 'src/audit-log/audit-log.module';

@Module({
  imports: [DatabaseModule, AuditLogModule],
  controllers: [PublicFeedbackController],
})
export class PublicFeedbackModule {}
