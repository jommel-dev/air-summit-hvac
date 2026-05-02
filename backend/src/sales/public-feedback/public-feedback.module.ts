import { Module } from '@nestjs/common';
import { PublicFeedbackController } from './public-feedback.controller';
import { DatabaseModule } from 'src/database/database.module';

@Module({
  imports: [DatabaseModule],
  controllers: [PublicFeedbackController],
})
export class PublicFeedbackModule {}
