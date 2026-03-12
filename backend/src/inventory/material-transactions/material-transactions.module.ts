import { Module } from '@nestjs/common';
import { MaterialTransactionsService } from './material-transactions.service';
import { MaterialTransactionsController } from './material-transactions.controller';
import { DatabaseModule } from 'src/database/database.module';
import { MaterialsModule } from '../materials/materials.module';

@Module({
  imports: [DatabaseModule, MaterialsModule],
  controllers: [MaterialTransactionsController],
  providers: [MaterialTransactionsService],
  exports: [MaterialTransactionsService],
})
export class MaterialTransactionsModule {}
