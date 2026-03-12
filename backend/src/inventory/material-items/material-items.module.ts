import { Module } from '@nestjs/common';
import { MaterialItemsService } from './material-items.service';
import { MaterialItemsController } from './material-items.controller';
import { DatabaseModule } from 'src/database/database.module';

@Module({
  imports: [DatabaseModule],
  providers: [MaterialItemsService],
  controllers: [MaterialItemsController],
  exports: [MaterialItemsService],
})
export class MaterialItemsModule {}
