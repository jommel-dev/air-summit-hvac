import { Module } from '@nestjs/common';
import { BrandsService } from './brands.service';
import { BrandsController } from './brands.controller';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { DatabaseModule } from 'src/database/database.module';
import { AuditLogModule } from 'src/audit-log/audit-log.module';

@Module({
  imports: [DatabaseModule, AuditLogModule],
  controllers: [BrandsController],
  providers: [BrandsService, JwtAuthGuard],
})
export class BrandsModule {}
