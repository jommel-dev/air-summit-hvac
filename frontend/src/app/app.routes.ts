import { Routes } from '@angular/router';
import { EcommerceComponent } from './pages/dashboard/ecommerce/ecommerce.component';
import { ProfileComponent } from './pages/profile/profile.component';
import { FormElementsComponent } from './pages/forms/form-elements/form-elements.component';
import { BasicTablesComponent } from './pages/tables/basic-tables/basic-tables.component';
import { BlankComponent } from './pages/blank/blank.component';
import { NotFoundComponent } from './pages/other-page/not-found/not-found.component';
import { AppLayoutComponent } from './shared/layout/app-layout/app-layout.component';
import { InvoicesComponent } from './pages/invoices/invoices.component';
import { LineChartComponent } from './pages/charts/line-chart/line-chart.component';
import { BarChartComponent } from './pages/charts/bar-chart/bar-chart.component';
import { AlertsComponent } from './pages/ui-elements/alerts/alerts.component';
import { AvatarElementComponent } from './pages/ui-elements/avatar-element/avatar-element.component';
import { BadgesComponent } from './pages/ui-elements/badges/badges.component';
import { ButtonsComponent } from './pages/ui-elements/buttons/buttons.component';
import { ImagesComponent } from './pages/ui-elements/images/images.component';
import { VideosComponent } from './pages/ui-elements/videos/videos.component';
import { SignInComponent } from './pages/auth-pages/sign-in/sign-in.component';
import { SignUpComponent } from './pages/auth-pages/sign-up/sign-up.component';
import { CalenderComponent } from './pages/calender/calender.component';
import { authChildGuard, guestOnlyGuard, guestOnlyMatchGuard, rbacGuard } from './shared/guards/auth.guards';
import { UserManagementComponent } from './pages/user-management/user-management.component';
import { SalesOrderComponent } from './pages/sales-order/sales-order.component';
import { PurchaseOrderComponent } from './pages/purchase-order/purchase-order.component';
import { ScheduleTodaySalesOrderComponent } from './pages/schedule-today-sales-order/schedule-today-sales-order.component';
import { InventoryComponent } from './pages/inventory/inventory.component';
import { QuotationComponent } from './pages/quotation/quotation.component';

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
      // {
      //   path:'calendar',
      //   component:CalenderComponent,
      //   title:'Angular Calender | TailAdmin - Angular Admin Dashboard Template'
      // },
      // {
      //   path:'profile',
      //   component:ProfileComponent,
      //   title:'Angular Profile Dashboard | TailAdmin - Angular Admin Dashboard Template'
      // },
      // {
      //   path:'form-elements',
      //   component:FormElementsComponent,
      //   title:'Angular Form Elements Dashboard | TailAdmin - Angular Admin Dashboard Template'
      // },
      // {
      //   path:'basic-tables',
      //   component:BasicTablesComponent,
      //   title:'Angular Basic Tables Dashboard | TailAdmin - Angular Admin Dashboard Template'
      // },
      // {
      //   path:'blank',
      //   component:BlankComponent,
      //   title:'Angular Blank Dashboard | TailAdmin - Angular Admin Dashboard Template'
      // },
      // // support tickets
      // {
      //   path:'invoice',
      //   component:InvoicesComponent,
      //   title:'Angular Invoice Details Dashboard | TailAdmin - Angular Admin Dashboard Template'
      // },
      // {
      //   path:'line-chart',
      //   component:LineChartComponent,
      //   title:'Angular Line Chart Dashboard | TailAdmin - Angular Admin Dashboard Template'
      // },
      // {
      //   path:'bar-chart',
      //   component:BarChartComponent,
      //   title:'Angular Bar Chart Dashboard | TailAdmin - Angular Admin Dashboard Template'
      // },
      // {
      //   path:'alerts',
      //   component:AlertsComponent,
      //   title:'Angular Alerts Dashboard | TailAdmin - Angular Admin Dashboard Template'
      // },
      // {
      //   path:'avatars',
      //   component:AvatarElementComponent,
      //   title:'Angular Avatars Dashboard | TailAdmin - Angular Admin Dashboard Template'
      // },
      // {
      //   path:'badge',
      //   component:BadgesComponent,
      //   title:'Angular Badges Dashboard | TailAdmin - Angular Admin Dashboard Template'
      // },
      // {
      //   path:'buttons',
      //   component:ButtonsComponent,
      //   title:'Angular Buttons Dashboard | TailAdmin - Angular Admin Dashboard Template'
      // },
      // {
      //   path:'images',
      //   component:ImagesComponent,
      //   title:'Angular Images Dashboard | TailAdmin - Angular Admin Dashboard Template'
      // },
      // {
      //   path:'videos',
      //   component:VideosComponent,
      //   title:'Angular Videos Dashboard | TailAdmin - Angular Admin Dashboard Template'
      // },
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
