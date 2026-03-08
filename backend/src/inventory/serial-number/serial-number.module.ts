import { Module } from '@nestjs/common';
import { SerialNumberService } from './serial-number.service';
import { SerialNumberController } from './serial-number.controller';
import { DatabaseModule } from 'src/database/database.module';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';

@Module({
  imports: [DatabaseModule],
  controllers: [SerialNumberController],
  providers: [SerialNumberService, JwtAuthGuard],
})
export class SerialNumberModule {}
