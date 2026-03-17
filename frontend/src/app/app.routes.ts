import { Routes } from '@angular/router';
import { EcommerceComponent } from './pages/dashboard/ecommerce/ecommerce.component';
import { NotFoundComponent } from './pages/other-page/not-found/not-found.component';
import { AppLayoutComponent } from './shared/layout/app-layout/app-layout.component';
import { SignInComponent } from './pages/auth-pages/sign-in/sign-in.component';
import { authChildGuard, guestOnlyGuard, guestOnlyMatchGuard, rbacGuard } from './shared/guards/auth.guards';
import { UserManagementComponent } from './pages/user-management/user-management.component';
import { SalesOrderComponent } from './pages/sales-order/sales-order.component';
import { CustomersComponent } from './pages/customers/customers.component';
import { PurchaseOrderComponent } from './pages/purchase-order/purchase-order.component';
import { ScheduleTodaySalesOrderComponent } from './pages/schedule-today-sales-order/schedule-today-sales-order.component';
import { InventoryComponent } from './pages/inventory/inventory.component';
import { QuotationComponent } from './pages/quotation/quotation.component';
import { MaterialInventoryComponent } from './pages/material-inventory/material-inventory.component';
import { SalesOrderMaterialsComponent } from './pages/sales-order-materials/sales-order-materials.component';
import { SettingsComponent } from './pages/settings/settings.component';

export const routes: Routes = [
  {
    path:'users',
    component:AppLayoutComponent,
    canActivateChild: [authChildGuard],
    children:[
      {
        path: 'dashboard',
        component: EcommerceComponent,
        canActivate: [rbacGuard],
        data: {
          menu: 'dashboard',
          permission: 'canRead',
        },
        pathMatch: 'full',
        title: 'Air Summit Aircon Services | Dashboard',
      },
      {
        path: 'sales-order',
        component: SalesOrderComponent,
        canActivate: [rbacGuard],
        data: {
          menu: 'sales_order',
          permission: 'canRead',
        },
        title: 'Air Summit Aircon Services | Sales Order',
      },
      {
        path: 'customers',
        component: CustomersComponent,
        canActivate: [rbacGuard],
        data: {
          menu: 'customers',
          permission: 'canRead',
        },
        title: 'Air Summit Aircon Services | Customers',
      },
      {
        path: 'schedule-today-sales-order',
        component: ScheduleTodaySalesOrderComponent,
        canActivate: [rbacGuard],
        data: {
          menu: 'today_schedule',
          permission: 'canRead',
        },
        title: 'Air Summit Aircon Services | Schedule Today Sales Order',
      },
      {
        path: 'purchase-order',
        component: PurchaseOrderComponent,
        canActivate: [rbacGuard],
        data: {
          menu: 'purchase_order',
          permission: 'canRead',
        },
        title: 'Air Summit Aircon Services | Purchase Order',
      },
      {
        path: 'inventory',
        component: InventoryComponent,
        canActivate: [rbacGuard],
        data: {
          menu: 'inventory',
          permission: 'canRead',
        },
        title: 'Air Summit Aircon Services | Inventory',
      },
      {
        path: 'material-inventory',
        component: MaterialInventoryComponent,
        canActivate: [rbacGuard],
        data: {
          menu: 'material_inventory',
          permission: 'canRead',
        },
        title: 'Air Summit Aircon Services | Material Inventory',
      },
      {
        path: 'sales-order-materials',
        component: SalesOrderMaterialsComponent,
        canActivate: [rbacGuard],
        data: {
          menu: 'sales_order_materials',
          permission: 'canRead',
        },
        title: 'Air Summit Aircon Services | Sales Order Materials',
      },
      {
        path: 'quotation',
        component: QuotationComponent,
        canActivate: [rbacGuard],
        data: {
          menu: 'quotation',
          permission: 'canRead',
        },
        title: 'Air Summit Aircon Services | Quotation',
      },
      {
        path: 'user-management',
        component: UserManagementComponent,
        canActivate: [rbacGuard],
        data: {
          menu: 'user_management',
          permission: 'canRead',
        },
        title: 'Air Summit Aircon Services | User Management',
      },
      {
        path: 'settings',
        component: SettingsComponent,
        canActivate: [rbacGuard],
        data: {
          menu: 'settings',
          permission: 'canRead',
        },
        title: 'Air Summit Aircon Services | Settings',
      },
    ]
  },
  // auth pages
  {
    path:'',
    component:SignInComponent,
    canActivate: [guestOnlyGuard],
    canMatch: [guestOnlyMatchGuard],
    title:'Air Summit Aircon Services | Login'
  },
  // error pages
  {
    path:'**',
    component:NotFoundComponent,
    title:'Air Summit Aircon Services | Not Found'
  },
];
