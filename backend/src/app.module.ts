import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { LoginModule } from './auth/login/login.module';
import { DatabaseModule } from './database/database.module';
import { BrandsModule } from './inventory/brands/brands.module';
import { ProductsModule } from './inventory/products/products.module';
import { CapacityModule } from './inventory/capacity/capacity.module';
import { MaterialItemsModule } from './inventory/material-items/material-items.module';
import { UsersModule } from './usermanage/users/users.module';
import { PurchaseModule } from './inventory/purchase/purchase.module';
import { VendorModule } from './inventory/vendor/vendor.module';
import { SerialNumberModule } from './inventory/serial-number/serial-number.module';
import { SalesOrderModule } from './sales/sales-order/sales-order.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { QuotationModule } from './sales/quotation/quotation.module';
import { ProjectsModule } from './sales/projects/projects.module';
import { MaterialsModule } from './inventory/materials/materials.module';
import { MaterialTransactionsModule } from './inventory/material-transactions/material-transactions.module';
import { SettingsModule } from './settings/settings.module';
import { AccountingModule } from './accounting/accounting.module';
import { AuditLogModule } from './audit-log/audit-log.module';
import { PublicOrderFormModule } from './sales/public-order-form/public-order-form.module';
import { PublicFeedbackModule } from './sales/public-feedback/public-feedback.module';

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
    MaterialItemsModule,
    MaterialsModule, // NEW: Material Inventory Module
    MaterialTransactionsModule, // NEW: Material Transactions Module
    UsersModule,
    PurchaseModule,
    VendorModule,
    SerialNumberModule,
    SalesOrderModule,
    DashboardModule,
    QuotationModule,
    ProjectsModule,
    SettingsModule,
    AccountingModule,
    AuditLogModule,
    PublicOrderFormModule,
    PublicFeedbackModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
