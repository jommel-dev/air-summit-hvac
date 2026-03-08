import { Module } from '@nestjs/common';
import { CapacityService } from './capacity.service';
import { CapacityController } from './capacity.controller';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { DatabaseModule } from 'src/database/database.module';

@Module({
  imports: [DatabaseModule],
  controllers: [CapacityController],
  providers: [CapacityService, JwtAuthGuard],
})
export class CapacityModule {}
