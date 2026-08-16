import { Module } from '@nestjs/common';
import { MaterialItemsService } from './material-items.service';
import { MaterialItemsController } from './material-items.controller';
import { DatabaseModule } from 'src/database/database.module';
import { AuditLogModule } from 'src/audit-log/audit-log.module';

@Module({
  imports: [DatabaseModule, AuditLogModule],
  providers: [MaterialItemsService],
  controllers: [MaterialItemsController],
  exports: [MaterialItemsService],
})
export class MaterialItemsModule {}
