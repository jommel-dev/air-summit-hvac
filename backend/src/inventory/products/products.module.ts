import { Module } from '@nestjs/common';
import { ProductsService } from './products.service';
import { ProductsController } from './products.controller';
import { DatabaseModule } from 'src/database/database.module';
import { AuditLogModule } from 'src/audit-log/audit-log.module';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';

@Module({
  imports: [DatabaseModule, AuditLogModule],
  controllers: [ProductsController],
  providers: [ProductsService, JwtAuthGuard],
})
export class ProductsModule {}
