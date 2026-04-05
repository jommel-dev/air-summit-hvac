import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, ElementRef, QueryList, ViewChildren } from '@angular/core';
import { NavigationEnd, Router, RouterModule } from '@angular/router';
import { combineLatest, Subscription } from 'rxjs';
import { SafeHtmlPipe } from '../../pipe/safe-html.pipe';
import { MenuKey, RbacService } from '../../services/rbac.service';
import { SidebarService } from '../../services/sidebar.service';
import { BusinessSettingsService } from '../../services/business-settings.service';

type NavItem = {
  name: string;
  icon: string;
  menuKey?: MenuKey;
  path?: string;
  new?: boolean;
  subItems?: { name: string; path: string; pro?: boolean; new?: boolean }[];
};

@Component({
  selector: 'app-sidebar',
  imports: [CommonModule, RouterModule, SafeHtmlPipe],
  templateUrl: './app-sidebar.component.html',
})
export class AppSidebarComponent {
  private readonly defaultBusinessLogoLight = '/images/fwdslogo.png';
  private readonly defaultBusinessLogoDark = '/images/fwdslogo-dark.png';
  logoLightSrc = this.defaultBusinessLogoLight;
  logoDarkSrc = this.defaultBusinessLogoDark;

  private readonly allNavItems: NavItem[] = [
    {
      name: 'Dashboard',
      menuKey: 'dashboard',
      path: '/users/dashboard',
      icon: `<svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M5.5 3.25C4.25736 3.25 3.25 4.25736 3.25 5.5V8.99998C3.25 10.2426 4.25736 11.25 5.5 11.25H9C10.2426 11.25 11.25 10.2426 11.25 8.99998V5.5C11.25 4.25736 10.2426 3.25 9 3.25H5.5ZM4.75 5.5C4.75 5.08579 5.08579 4.75 5.5 4.75H9C9.41421 4.75 9.75 5.08579 9.75 5.5V8.99998C9.75 9.41419 9.41421 9.74998 9 9.74998H5.5C5.08579 9.74998 4.75 9.41419 4.75 8.99998V5.5ZM5.5 12.75C4.25736 12.75 3.25 13.7574 3.25 15V18.5C3.25 19.7426 4.25736 20.75 5.5 20.75H9C10.2426 20.75 11.25 19.7427 11.25 18.5V15C11.25 13.7574 10.2426 12.75 9 12.75H5.5ZM4.75 15C4.75 14.5858 5.08579 14.25 5.5 14.25H9C9.41421 14.25 9.75 14.5858 9.75 15V18.5C9.75 18.9142 9.41421 19.25 9 19.25H5.5C5.08579 19.25 4.75 18.9142 4.75 18.5V15ZM12.75 5.5C12.75 4.25736 13.7574 3.25 15 3.25H18.5C19.7426 3.25 20.75 4.25736 20.75 5.5V8.99998C20.75 10.2426 19.7426 11.25 18.5 11.25H15C13.7574 11.25 12.75 10.2426 12.75 8.99998V5.5ZM15 4.75C14.5858 4.75 14.25 5.08579 14.25 5.5V8.99998C14.25 9.41419 14.5858 9.74998 15 9.74998H18.5C18.9142 9.74998 19.25 9.41419 19.25 8.99998V5.5C19.25 5.08579 18.9142 4.75 18.5 4.75H15ZM15 12.75C13.7574 12.75 12.75 13.7574 12.75 15V18.5C12.75 19.7426 13.7574 20.75 15 20.75H18.5C19.7426 20.75 20.75 19.7427 20.75 18.5V15C20.75 13.7574 19.7426 12.75 18.5 12.75H15ZM14.25 15C14.25 14.5858 14.5858 14.25 15 14.25H18.5C18.9142 14.25 19.25 14.5858 19.25 15V18.5C19.25 18.9142 18.9142 19.25 18.5 19.25H15C14.5858 19.25 14.25 18.9142 14.25 18.5V15Z" fill="currentColor"></path></svg>`,
    },
    {
      name: 'Sales Order',
      menuKey: 'sales_order',
      path: '/users/sales-order',
      icon: `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none"><path fill-rule="evenodd" clip-rule="evenodd" d="M8 2C8.41421 2 8.75 2.33579 8.75 2.75V3.75H15.25V2.75C15.25 2.33579 15.5858 2 16 2C16.4142 2 16.75 2.33579 16.75 2.75V3.75H18.5C19.7426 3.75 20.75 4.75736 20.75 6V9V19C20.75 20.2426 19.7426 21.25 18.5 21.25H5.5C4.25736 21.25 3.25 20.2426 3.25 19V9V6C3.25 4.75736 4.25736 3.75 5.5 3.75H7.25V2.75C7.25 2.33579 7.58579 2 8 2ZM8 5.25H5.5C5.08579 5.25 4.75 5.58579 4.75 6V8.25H19.25V6C19.25 5.58579 18.9142 5.25 18.5 5.25H16H8ZM19.25 9.75H4.75V19C4.75 19.4142 5.08579 19.75 5.5 19.75H18.5C18.9142 19.75 19.25 19.4142 19.25 19V9.75Z" fill="currentColor"></path></svg>`,
    },
    {
      name: 'Stakeholders',
      menuKey: 'customers',
      path: '/users/customers',
      icon: `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none"><path d="M12 12c2.7614 0 5-2.2386 5-5s-2.2386-5-5-5-5 2.2386-5 5 2.2386 5 5 5z" fill="currentColor"/><path d="M4 20c0-3.3137 2.6863-6 6-6h4c3.3137 0 6 2.6863 6 6v1H4v-1z" fill="currentColor"/></svg>`,
    },
    {
      name: 'Quotation',
      menuKey: 'quotation',
      path: '/users/quotation',
      icon: `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none"><path fill-rule="evenodd" clip-rule="evenodd" d="M6 3.25C4.48122 3.25 3.25 4.48122 3.25 6V18C3.25 19.5188 4.48122 20.75 6 20.75H18C19.5188 20.75 20.75 19.5188 20.75 18V9.81066C20.75 9.08134 20.4601 8.3819 19.9444 7.86624L16.1338 4.05563C15.6181 3.53995 14.9187 3.25 14.1893 3.25H6ZM14.25 4.83139V8C14.25 8.41421 14.5858 8.75 15 8.75H18.1686L14.25 4.83139ZM18.5 10.25H15C13.7574 10.25 12.75 9.24264 12.75 8V4.75H6C5.30964 4.75 4.75 5.30964 4.75 6V18C4.75 18.6904 5.30964 19.25 6 19.25H18C18.6904 19.25 19.25 18.6904 19.25 18V10.25H18.5ZM7.25 12.5C7.25 12.0858 7.58579 11.75 8 11.75H16C16.4142 11.75 16.75 12.0858 16.75 12.5C16.75 12.9142 16.4142 13.25 16 13.25H8C7.58579 13.25 7.25 12.9142 7.25 12.5ZM8 15.25C7.58579 15.25 7.25 15.5858 7.25 16C7.25 16.4142 7.58579 16.75 8 16.75H13.5C13.9142 16.75 14.25 16.4142 14.25 16C14.25 15.5858 13.9142 15.25 13.5 15.25H8Z" fill="currentColor"></path></svg>`,
    },
    {
      name: 'Schedule Today SO',
      menuKey: 'today_schedule',
      path: '/users/schedule-today-sales-order',
      icon: `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none"><path fill-rule="evenodd" clip-rule="evenodd" d="M7.25 2.75C7.25 2.33579 7.58579 2 8 2C8.41421 2 8.75 2.33579 8.75 2.75V3.25H15.25V2.75C15.25 2.33579 15.5858 2 16 2C16.4142 2 16.75 2.33579 16.75 2.75V3.25H18.5C19.7426 3.25 20.75 4.25736 20.75 5.5V18.5C20.75 19.7426 19.7426 20.75 18.5 20.75H5.5C4.25736 20.75 3.25 19.7426 3.25 18.5V5.5C3.25 4.25736 4.25736 3.25 5.5 3.25H7.25V2.75ZM4.75 8.25V18.5C4.75 18.9142 5.08579 19.25 5.5 19.25H18.5C18.9142 19.25 19.25 18.9142 19.25 18.5V8.25H4.75ZM19.25 6.75V5.5C19.25 5.08579 18.9142 4.75 18.5 4.75H5.5C5.08579 4.75 4.75 5.08579 4.75 5.5V6.75H19.25ZM12.5303 11.4697C12.8232 11.7626 12.8232 12.2374 12.5303 12.5303L10.5303 14.5303C10.2374 14.8232 9.76256 14.8232 9.46967 14.5303L8.46967 13.5303C8.17678 13.2374 8.17678 12.7626 8.46967 12.4697C8.76256 12.1768 9.23744 12.1768 9.53033 12.4697L10 12.9393L11.4697 11.4697C11.7626 11.1768 12.2374 11.1768 12.5303 11.4697Z" fill="currentColor"></path></svg>`,
    },
    {
      name: 'Purchase Order',
      menuKey: 'purchase_order',
      path: '/users/purchase-order',
      icon: `<svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M12 3.5C7.30558 3.5 3.5 7.30558 3.5 12C3.5 14.1526 4.3002 16.1184 5.61936 17.616C6.17279 15.3096 8.24852 13.5955 10.7246 13.5955H13.2746C15.7509 13.5955 17.8268 15.31 18.38 17.6167C19.6996 16.119 20.5 14.153 20.5 12C20.5 7.30558 16.6944 3.5 12 3.5ZM17.0246 18.8566V18.8455C17.0246 16.7744 15.3457 15.0955 13.2746 15.0955H10.7246C8.65354 15.0955 6.97461 16.7744 6.97461 18.8455V18.856C8.38223 19.8895 10.1198 20.5 12 20.5C13.8798 20.5 15.6171 19.8898 17.0246 18.8566ZM2 12C2 6.47715 6.47715 2 12 2C17.5228 2 22 6.47715 22 12C22 17.5228 17.5228 22 12 22C6.47715 22 2 17.5228 2 12ZM11.9991 7.25C10.8847 7.25 9.98126 8.15342 9.98126 9.26784C9.98126 10.3823 10.8847 11.2857 11.9991 11.2857C13.1135 11.2857 14.0169 10.3823 14.0169 9.26784C14.0169 8.15342 13.1135 7.25 11.9991 7.25ZM8.48126 9.26784C8.48126 7.32499 10.0563 5.75 11.9991 5.75C13.9419 5.75 15.5169 7.32499 15.5169 9.26784C15.5169 11.2107 13.9419 12.7857 11.9991 12.7857C10.0563 12.7857 8.48126 11.2107 8.48126 9.26784Z" fill="currentColor"></path></svg>`,
    },
    {
      name: 'Inventory',
      menuKey: 'inventory',
      path: '/users/inventory',
      icon: `<svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M5.5 3.25C4.25736 3.25 3.25 4.25736 3.25 5.5V18.5C3.25 19.7426 4.25736 20.75 5.5 20.75H18.5001C19.7427 20.75 20.7501 19.7426 20.7501 18.5V5.5C20.7501 4.25736 19.7427 3.25 18.5001 3.25H5.5ZM4.75 5.5C4.75 5.08579 5.08579 4.75 5.5 4.75H18.5001C18.9143 4.75 19.2501 5.08579 19.2501 5.5V18.5C19.2501 18.9142 18.9143 19.25 18.5001 19.25H5.5C5.08579 19.25 4.75 18.9142 4.75 18.5V5.5ZM6.25005 9.7143C6.25005 9.30008 6.58583 8.9643 7.00005 8.9643L17 8.96429C17.4143 8.96429 17.75 9.30008 17.75 9.71429C17.75 10.1285 17.4143 10.4643 17 10.4643L7.00005 10.4643C6.58583 10.4643 6.25005 10.1285 6.25005 9.7143ZM6.25005 14.2857C6.25005 13.8715 6.58583 13.5357 7.00005 13.5357H17C17.4143 13.5357 17.75 13.8715 17.75 14.2857C17.75 14.6999 17.4143 15.0357 17 15.0357H7.00005C6.58583 15.0357 6.25005 14.6999 6.25005 14.2857Z" fill="currentColor"></path></svg>`,
    },
    {
      name: 'Accounting',
      menuKey: 'accounting',
      path: '/users/accounting',
      icon: `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none"><path fill-rule="evenodd" clip-rule="evenodd" d="M4.75 4.5C4.75 4.08579 5.08579 3.75 5.5 3.75H18.5C18.9142 3.75 19.25 4.08579 19.25 4.5V19.5C19.25 19.9142 18.9142 20.25 18.5 20.25H5.5C5.08579 20.25 4.75 19.9142 4.75 19.5V4.5ZM3.25 4.5C3.25 3.25736 4.25736 2.25 5.5 2.25H18.5C19.7426 2.25 20.75 3.25736 20.75 4.5V19.5C20.75 20.7426 19.7426 21.75 18.5 21.75H5.5C4.25736 21.75 3.25 20.7426 3.25 19.5V4.5ZM7 7.25C6.58579 7.25 6.25 7.58579 6.25 8C6.25 8.41421 6.58579 8.75 7 8.75H17C17.4142 8.75 17.75 8.41421 17.75 8C17.75 7.58579 17.4142 7.25 17 7.25H7ZM7 11.25C6.58579 11.25 6.25 11.5858 6.25 12C6.25 12.4142 6.58579 12.75 7 12.75H12.5C12.9142 12.75 13.25 12.4142 13.25 12C13.25 11.5858 12.9142 11.25 12.5 11.25H7ZM6.25 16C6.25 15.5858 6.58579 15.25 7 15.25H10C10.4142 15.25 10.75 15.5858 10.75 16C10.75 16.4142 10.4142 16.75 10 16.75H7C6.58579 16.75 6.25 16.4142 6.25 16ZM15.25 14C15.25 13.5858 15.5858 13.25 16 13.25C16.4142 13.25 16.75 13.5858 16.75 14V16.1893L17.4697 15.4697C17.7626 15.1768 18.2374 15.1768 18.5303 15.4697C18.8232 15.7626 18.8232 16.2374 18.5303 16.5303L16.5303 18.5303C16.2374 18.8232 15.7626 18.8232 15.4697 18.5303L13.4697 16.5303C13.1768 16.2374 13.1768 15.7626 13.4697 15.4697C13.7626 15.1768 14.2374 15.1768 14.5303 15.4697L15.25 16.1893V14Z" fill="currentColor"/></svg>`,
    },
    {
      name: 'Material Sales Order',
      menuKey: 'sales_order_materials',
      path: '/users/sales-order-materials',
      icon: `<svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M5.5 3.25C4.25736 3.25 3.25 4.25736 3.25 5.5V18.5C3.25 19.7426 4.25736 20.75 5.5 20.75H18.5001C19.7427 20.75 20.7501 19.7426 20.7501 18.5V5.5C20.7501 4.25736 19.7427 3.25 18.5001 3.25H5.5ZM4.75 5.5C4.75 5.08579 5.08579 4.75 5.5 4.75H18.5001C18.9143 4.75 19.2501 5.08579 19.2501 5.5V18.5C19.2501 18.9142 18.9143 19.25 18.5001 19.25H5.5C5.08579 19.25 4.75 18.9142 4.75 18.5V5.5ZM6.25005 9.7143C6.25005 9.30008 6.58583 8.9643 7.00005 8.9643L17 8.96429C17.4143 8.96429 17.75 9.30008 17.75 9.71429C17.75 10.1285 17.4143 10.4643 17 10.4643L7.00005 10.4643C6.58583 10.4643 6.25005 10.1285 6.25005 9.7143ZM6.25005 14.2857C6.25005 13.8715 6.58583 13.5357 7.00005 13.5357H17C17.4143 13.5357 17.75 13.8715 17.75 14.2857C17.75 14.6999 17.4143 15.0357 17 15.0357H7.00005C6.58583 15.0357 6.25005 14.6999 6.25005 14.2857Z" fill="currentColor"></path></svg>`,
    },
    {
      name: 'Material Inventory',
      menuKey: 'material_inventory',
      path: '/users/material-inventory',
      icon: `<svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M5.5 3.25C4.25736 3.25 3.25 4.25736 3.25 5.5V18.5C3.25 19.7426 4.25736 20.75 5.5 20.75H18.5001C19.7427 20.75 20.7501 19.7426 20.7501 18.5V5.5C20.7501 4.25736 19.7427 3.25 18.5001 3.25H5.5ZM4.75 5.5C4.75 5.08579 5.08579 4.75 5.5 4.75H18.5001C18.9143 4.75 19.2501 5.08579 19.2501 5.5V18.5C19.2501 18.9142 18.9143 19.25 18.5001 19.25H5.5C5.08579 19.25 4.75 18.9142 4.75 18.5V5.5ZM6.25005 9.7143C6.25005 9.30008 6.58583 8.9643 7.00005 8.9643L17 8.96429C17.4143 8.96429 17.75 9.30008 17.75 9.71429C17.75 10.1285 17.4143 10.4643 17 10.4643L7.00005 10.4643C6.58583 10.4643 6.25005 10.1285 6.25005 9.7143ZM6.25005 14.2857C6.25005 13.8715 6.58583 13.5357 7.00005 13.5357H17C17.4143 13.5357 17.75 13.8715 17.75 14.2857C17.75 14.6999 17.4143 15.0357 17 15.0357H7.00005C6.58583 15.0357 6.25005 14.6999 6.25005 14.2857Z" fill="currentColor"></path></svg>`,
    },
    {
      name: 'User Management',
      menuKey: 'user_management',
      path: '/users/user-management',
      icon: `<svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M12 2C9.92893 2 8.25 3.67893 8.25 5.75C8.25 7.82107 9.92893 9.5 12 9.5C14.0711 9.5 15.75 7.82107 15.75 5.75C15.75 3.67893 14.0711 2 12 2ZM9.75 5.75C9.75 4.50736 10.7574 3.5 12 3.5C13.2426 3.5 14.25 4.50736 14.25 5.75C14.25 6.99264 13.2426 8 12 8C10.7574 8 9.75 6.99264 9.75 5.75ZM4 18.25C4 14.7982 6.79822 12 10.25 12H13.75C17.2018 12 20 14.7982 20 18.25V21.25C20 21.6642 19.6642 22 19.25 22C18.8358 22 18.5 21.6642 18.5 21.25V18.25C18.5 15.6266 16.3734 13.5 13.75 13.5H10.25C7.62665 13.5 5.5 15.6266 5.5 18.25V21.25C5.5 21.6642 5.16421 22 4.75 22C4.33579 22 4 21.6642 4 21.25V18.25Z" fill="currentColor"></path></svg>`,
    },
    {
      name: 'Settings',
      menuKey: 'settings',
      path: '/users/settings',
      icon: `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none"><path fill-rule="evenodd" clip-rule="evenodd" d="M10.2588 2.75C10.2588 2.33579 10.5946 2 11.0088 2H12.9912C13.4054 2 13.7412 2.33579 13.7412 2.75V4.04918C14.3052 4.19587 14.8474 4.42032 15.3518 4.71557L16.2713 3.79604C16.5642 3.50314 17.0391 3.50314 17.332 3.79604L18.7339 5.19796C19.0268 5.49085 19.0268 5.96572 18.7339 6.25862L17.8144 7.17815C18.1097 7.6826 18.3341 8.2248 18.4808 8.78879H19.78C20.1942 8.78879 20.53 9.12458 20.53 9.53879V11.5212C20.53 11.9354 20.1942 12.2712 19.78 12.2712H18.4808C18.3341 12.8352 18.1097 13.3774 17.8144 13.8818L18.7339 14.8014C19.0268 15.0943 19.0268 15.5691 18.7339 15.862L17.332 17.264C17.0391 17.5569 16.5642 17.5569 16.2713 17.264L15.3518 16.3444C14.8474 16.6397 14.3052 16.8641 13.7412 17.0108V18.31C13.7412 18.7242 13.4054 19.06 12.9912 19.06H11.0088C10.5946 19.06 10.2588 18.7242 10.2588 18.31V17.0108C9.69483 16.8641 9.15263 16.6397 8.64819 16.3444L7.72866 17.264C7.43577 17.5569 6.96089 17.5569 6.668 17.264L5.26608 15.862C4.97319 15.5691 4.97319 15.0943 5.26608 14.8014L6.18562 13.8818C5.89036 13.3774 5.66591 12.8352 5.51922 12.2712H4.22C3.80579 12.2712 3.47 11.9354 3.47 11.5212V9.53879C3.47 9.12458 3.80579 8.78879 4.22 8.78879H5.51922C5.66591 8.2248 5.89036 7.6826 6.18562 7.17815L5.26608 6.25862C4.97319 5.96572 4.97319 5.49085 5.26608 5.19796L6.668 3.79604C6.96089 3.50314 7.43577 3.50314 7.72866 3.79604L8.64819 4.71557C9.15263 4.42032 9.69483 4.19587 10.2588 4.04918V2.75ZM12 8.02998C10.6193 8.02998 9.5 9.14926 9.5 10.53C9.5 11.9107 10.6193 13.03 12 13.03C13.3807 13.03 14.5 11.9107 14.5 10.53C14.5 9.14926 13.3807 8.02998 12 8.02998Z" fill="currentColor"/></svg>`,
    },
  ];

  navItems: NavItem[] = [];
  othersItems: NavItem[] = [];

  openSubmenu: string | null | number = null;
  subMenuHeights: { [key: string]: number } = {};
  @ViewChildren('subMenu') subMenuRefs!: QueryList<ElementRef>;

  readonly isExpanded$;
  readonly isMobileOpen$;
  readonly isHovered$;

  private subscription: Subscription = new Subscription();

  constructor(
    public sidebarService: SidebarService,
    private router: Router,
    private cdr: ChangeDetectorRef,
    private rbacService: RbacService,
    private readonly businessSettingsService: BusinessSettingsService,
  ) {
    this.isExpanded$ = this.sidebarService.isExpanded$;
    this.isMobileOpen$ = this.sidebarService.isMobileOpen$;
    this.isHovered$ = this.sidebarService.isHovered$;
  }

  ngOnInit() {
    void this.loadBusinessBranding();
    this.applyMenuAccess();

    this.subscription.add(
      this.router.events.subscribe((event) => {
        if (event instanceof NavigationEnd) {
          this.setActiveMenuFromRoute(this.router.url);
        }
      }),
    );

    this.subscription.add(
      combineLatest([this.isExpanded$, this.isMobileOpen$, this.isHovered$]).subscribe(
        ([isExpanded, isMobileOpen, isHovered]) => {
          if (!isExpanded && !isMobileOpen && !isHovered) {
            this.cdr.detectChanges();
          }
        },
      ),
    );

    this.setActiveMenuFromRoute(this.router.url);
  }

  private async loadBusinessBranding(): Promise<void> {
    try {
      const settings = await this.businessSettingsService.getBusinessProfile();
      this.logoLightSrc = settings?.businessLogoLight || settings?.businessLogo || this.defaultBusinessLogoLight;
      this.logoDarkSrc = settings?.businessLogoDark || settings?.businessLogo || this.defaultBusinessLogoDark;
    } catch {
      this.logoLightSrc = this.defaultBusinessLogoLight;
      this.logoDarkSrc = this.defaultBusinessLogoDark;
    }
  }

  ngOnDestroy() {
    this.subscription.unsubscribe();
  }

  isActive(path: string): boolean {
    return this.router.url === path;
  }

  toggleSubmenu(section: string, index: number) {
    const key = `${section}-${index}`;

    if (this.openSubmenu === key) {
      this.openSubmenu = null;
      this.subMenuHeights[key] = 0;
    } else {
      this.openSubmenu = key;

      setTimeout(() => {
        const el = document.getElementById(key);
        if (el) {
          this.subMenuHeights[key] = el.scrollHeight;
          this.cdr.detectChanges();
        }
      });
    }
  }

  onSidebarMouseEnter() {
    if (!this.sidebarService.isExpandedValue) {
      this.sidebarService.setHovered(true);
    }
  }

  onSubmenuClick() {
    if (this.sidebarService.isMobileOpenValue) {
      this.sidebarService.setMobileOpen(false);
    }
  }

  private applyMenuAccess(): void {
    this.navItems = this.allNavItems.filter(
      (item) => !item.menuKey || this.rbacService.canAccess(item.menuKey, 'canRead'),
    );
  }

  private setActiveMenuFromRoute(currentUrl: string) {
    const menuGroups = [
      { items: this.navItems, prefix: 'main' },
      { items: this.othersItems, prefix: 'others' },
    ];

    menuGroups.forEach((group) => {
      group.items.forEach((nav, i) => {
        if (nav.subItems) {
          nav.subItems.forEach((subItem) => {
            if (currentUrl === subItem.path) {
              const key = `${group.prefix}-${i}`;
              this.openSubmenu = key;

              setTimeout(() => {
                const el = document.getElementById(key);
                if (el) {
                  this.subMenuHeights[key] = el.scrollHeight;
                  this.cdr.detectChanges();
                }
              });
            }
          });
        }
      });
    });
  }
}
