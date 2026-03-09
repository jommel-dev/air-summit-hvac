import { Module } from '@nestjs/common';
import { QuotationService } from './quotation.service';
import { QuotationController } from './quotation.controller';
import { DatabaseModule } from 'src/database/database.module';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';

@Module({
  imports: [DatabaseModule],
  controllers: [QuotationController],
  providers: [QuotationService, JwtAuthGuard],
})
export class QuotationModule {}
