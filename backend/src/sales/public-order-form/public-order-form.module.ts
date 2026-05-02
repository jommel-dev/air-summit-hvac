import { Module } from '@nestjs/common';
import { PublicOrderFormController } from './public-order-form.controller';
import { SalesOrderModule } from '../sales-order/sales-order.module';
import { DatabaseModule } from 'src/database/database.module';

@Module({
  imports: [SalesOrderModule, DatabaseModule],
  controllers: [PublicOrderFormController],
})
export class PublicOrderFormModule {}
