import { Module } from '@nestjs/common';
import { MaterialItemsService } from './material-items.service';
import { MaterialItemsController } from './material-items.controller';

@Module({
  providers: [MaterialItemsService],
  controllers: [MaterialItemsController],
  exports: [MaterialItemsService],
})
export class MaterialItemsModule {}
