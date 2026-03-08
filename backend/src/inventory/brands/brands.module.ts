import { Module } from '@nestjs/common';
import { BrandsService } from './brands.service';
import { BrandsController } from './brands.controller';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { DatabaseModule } from 'src/database/database.module';

@Module({
  imports: [DatabaseModule],
  controllers: [BrandsController],
  providers: [BrandsService, JwtAuthGuard],
})
export class BrandsModule {}
