import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { LoginModule } from './auth/login/login.module';
import { DatabaseModule } from './database/database.module';
import { BrandsModule } from './inventory/brands/brands.module';
import { ProductsModule } from './inventory/products/products.module';
import { CapacityModule } from './inventory/capacity/capacity.module';
import { UsersModule } from './usermanage/users/users.module';
import { PurchaseModule } from './inventory/purchase/purchase.module';
import { VendorModule } from './inventory/vendor/vendor.module';
import { SerialNumberModule } from './inventory/serial-number/serial-number.module';
import { SalesOrderModule } from './sales/sales-order/sales-order.module';
import { DashboardModule } from './dashboard/dashboard.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [`.env.${process.env.NODE_ENV ?? 'development'}`, '.env'],
    }),
    DatabaseModule,
    LoginModule,
    BrandsModule,
    ProductsModule,
    CapacityModule,
    UsersModule,
    PurchaseModule,
    VendorModule,
    SerialNumberModule,
    SalesOrderModule,
    DashboardModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
