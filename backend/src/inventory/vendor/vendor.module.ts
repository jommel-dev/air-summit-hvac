import { Module } from '@nestjs/common';
import { DatabaseModule } from 'src/database/database.module';
import { VendorService } from './vendor.service';
import { VendorController } from './vendor.controller';
import { AuditLogModule } from 'src/audit-log/audit-log.module';

@Module({
  imports: [DatabaseModule, AuditLogModule],
  controllers: [VendorController],
  providers: [VendorService],
})
export class VendorModule {}
