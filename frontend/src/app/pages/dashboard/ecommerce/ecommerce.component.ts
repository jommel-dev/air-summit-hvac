import { Component, OnInit } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import {
  DashboardActivityItem,
  DashboardKpiCard,
  DashboardMarginItem,
  DashboardOpsItem,
  DashboardService,
} from '../../../shared/services/dashboard.service';

@Component({
  selector: 'app-ecommerce',
  imports: [DecimalPipe],
  templateUrl: './ecommerce.component.html',
})
export class EcommerceComponent implements OnInit {
  isLoadingDashboard = false;
  dashboardError = '';
  todayFocus = 'Loading dashboard priorities...';

  topKpis: DashboardKpiCard[] = [
    { label: 'In-Stock Units', value: '4,382', change: '+6.2%', trend: 'up' },
    { label: 'Open Purchase Orders', value: '29', change: '-3.1%', trend: 'up' },
    { label: 'Dispatch Today', value: '17', change: '+12.4%', trend: 'up' },
    { label: 'Install Queue', value: '34', change: '+4.8%', trend: 'down' },
  ];

  operations: DashboardOpsItem[] = [
    { label: 'Receiving Today', value: '9 PO / 326 Serials', hint: 'Last scan 11:42 AM', level: 'normal' },
    { label: 'For Dispatch', value: '17 Orders', hint: '5 urgent by 4:00 PM', level: 'warning' },
    { label: 'For Installation', value: '22 Bookings', hint: '7 pending tech allocation', level: 'warning' },
    { label: 'Stock Alerts', value: '6 capacities low', hint: '2 are out-of-stock', level: 'critical' },
  ];

  salesSummary: DashboardKpiCard[] = [
    { label: 'Sales Today', value: 'PHP 286,420', change: '+8.1%', trend: 'up' },
    { label: 'Month-to-Date Sales', value: 'PHP 4,832,100', change: '+11.7%', trend: 'up' },
    { label: 'Gross Margin', value: '21.9%', change: '+1.4%', trend: 'up' },
    { label: 'Unpaid Receivables', value: 'PHP 1,124,300', change: '+5.9%', trend: 'down' },
  ];

  topCustomers = [
    { name: 'Northwing Builders', orders: 18, balance: 'PHP 232,000' },
    { name: 'MetroBreeze Trading', orders: 13, balance: 'PHP 180,500' },
    { name: 'Casa Prime Supply', orders: 11, balance: 'PHP 95,200' },
  ];

  topCapacities = [
    { label: '1.0 HP Wall Mounted', units: 142, sellThrough: 84 },
    { label: '1.5 HP Inverter', units: 121, sellThrough: 79 },
    { label: '2.0 HP Inverter', units: 94, sellThrough: 66 },
    { label: '2.5 HP Floor Mounted', units: 58, sellThrough: 49 },
  ];

  marginByBrand: DashboardMarginItem[] = [
    { label: 'Daikin', margin: 23.8 },
    { label: 'Carrier', margin: 21.4 },
    { label: 'Panasonic', margin: 19.7 },
    { label: 'Gree', margin: 17.2 },
  ];

  marginByVendor: DashboardMarginItem[] = [
    { label: 'CoolTrade Supplies', margin: 7.2 },
    { label: 'Pacific HVAC Depot', margin: 6.5 },
    { label: 'Summit Industrial', margin: 5.1 },
    { label: 'NorthAir Distribution', margin: 4.3 },
  ];

  activityFeed: DashboardActivityItem[] = [
    { time: '08:45', text: 'PO-2410 received, 48 serials scanned', status: 'received' },
    { time: '09:30', text: 'SO-993 moved to dispatch queue', status: 'dispatch' },
    { time: '10:15', text: 'Install team B assigned to SO-989', status: 'install' },
    { time: '11:05', text: 'Payment posted for SO-977 (PHP 86,000)', status: 'payment' },
  ];

  constructor(private readonly dashboardService: DashboardService) {}

  ngOnInit(): void {
    void this.loadDashboardOverview();
  }

  async loadDashboardOverview(): Promise<void> {
    this.isLoadingDashboard = true;
    this.dashboardError = '';

    try {
      const payload = await this.dashboardService.getOverview();
      this.topKpis = Array.isArray(payload.topKpis) && payload.topKpis.length > 0 ? payload.topKpis : this.topKpis;
      this.operations = Array.isArray(payload.operations) && payload.operations.length > 0 ? payload.operations : this.operations;
      this.salesSummary = Array.isArray(payload.salesSummary) && payload.salesSummary.length > 0 ? payload.salesSummary : this.salesSummary;
      this.topCustomers = Array.isArray(payload.topCustomers) && payload.topCustomers.length > 0 ? payload.topCustomers : this.topCustomers;
      this.topCapacities = Array.isArray(payload.topCapacities) && payload.topCapacities.length > 0 ? payload.topCapacities : this.topCapacities;
      this.marginByBrand = Array.isArray(payload.marginByBrand) && payload.marginByBrand.length > 0 ? payload.marginByBrand : this.marginByBrand;
      this.marginByVendor = Array.isArray(payload.marginByVendor) && payload.marginByVendor.length > 0 ? payload.marginByVendor : this.marginByVendor;
      this.activityFeed = Array.isArray(payload.activityFeed) && payload.activityFeed.length > 0 ? payload.activityFeed : this.activityFeed;
      this.todayFocus = String(payload.todayFocus ?? '').trim() || this.todayFocus;
    } catch (error: unknown) {
      this.dashboardError =
        error instanceof Error ? error.message : 'Unable to load dashboard overview';
    } finally {
      this.isLoadingDashboard = false;
    }
  }

  getTrendClass(trend: 'up' | 'down'): string {
    return trend === 'up'
      ? 'bg-success-50 text-success-700 dark:bg-success-500/15 dark:text-success-400'
      : 'bg-error-50 text-error-700 dark:bg-error-500/15 dark:text-error-400';
  }

  getOpsLevelClass(level: DashboardOpsItem['level']): string {
    if (level === 'critical') {
      return 'border-error-200 bg-error-50/60 dark:border-error-500/30 dark:bg-error-500/10';
    }

    if (level === 'warning') {
      return 'border-warning-200 bg-warning-50/60 dark:border-warning-500/30 dark:bg-warning-500/10';
    }

    return 'border-gray-200 bg-white dark:border-gray-700 dark:bg-white/[0.03]';
  }

  getActivityDotClass(status: DashboardActivityItem['status']): string {
    if (status === 'dispatch') {
      return 'bg-brand-500';
    }

    if (status === 'install') {
      return 'bg-warning-500';
    }

    if (status === 'payment') {
      return 'bg-success-500';
    }

    return 'bg-gray-500';
  }
}
