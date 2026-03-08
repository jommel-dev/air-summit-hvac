import { Injectable } from '@nestjs/common';
import { DatabaseService } from 'src/database/database.service';

type Trend = 'up' | 'down';

type KpiCard = {
  label: string;
  value: string;
  change: string;
  trend: Trend;
};

type OpsLevel = 'normal' | 'warning' | 'critical';

type OpsItem = {
  label: string;
  value: string;
  hint: string;
  level: OpsLevel;
};

type MarginItem = {
  label: string;
  margin: number;
};

type ActivityItem = {
  time: string;
  text: string;
  status: 'received' | 'dispatch' | 'install' | 'payment';
};

type DashboardResponse = {
  success: boolean;
  message?: string;
  item?: {
    generatedAt: string;
    topKpis: KpiCard[];
    operations: OpsItem[];
    salesSummary: KpiCard[];
    topCustomers: Array<{ name: string; orders: number; balance: string }>;
    topCapacities: Array<{ label: string; units: number; sellThrough: number }>;
    marginByBrand: MarginItem[];
    marginByVendor: MarginItem[];
    activityFeed: ActivityItem[];
    todayFocus: string;
  };
};

type CountRow = { count: string };
type SalesRow = { todaySales: string; yesterdaySales: string; mtdSales: string; prevMtdSales: string };
type GrossMarginRow = { marginPercent: string };
type ReceivableRow = { amount: string };
type TopCustomerRow = { name: string; orders: string; balance: string };
type TopCapacityRow = { label: string; units: string; sellThrough: string };
type MarginRow = { label: string; margin: string };
type ActivityRow = { eventAt: string | null; text: string; status: 'received' | 'dispatch' | 'install' | 'payment' };

@Injectable()
export class DashboardService {
  constructor(private readonly databaseService: DatabaseService) {}

  private toNumber(value: unknown): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private formatInteger(value: number): string {
    return Math.round(value).toLocaleString('en-PH');
  }

  private formatCurrency(value: number): string {
    return `PHP ${value.toLocaleString('en-PH', { maximumFractionDigits: 0 })}`;
  }

  private formatPercent(value: number): string {
    return `${value.toFixed(1)}%`;
  }

  private buildDelta(current: number, previous: number): { change: string; trend: Trend } {
    const safePrevious = previous === 0 ? current || 1 : previous;
    const diff = ((current - safePrevious) / safePrevious) * 100;
    const trend: Trend = diff >= 0 ? 'up' : 'down';
    const sign = diff >= 0 ? '+' : '';
    return {
      change: `${sign}${diff.toFixed(1)}%`,
      trend,
    };
  }

  private normalizeStatus(value: unknown): string {
    return String(value ?? '')
      .trim()
      .toLowerCase()
      .replace(/[\s_]+/g, '-');
  }

  private formatActivityTime(value: string | null): string {
    if (!value) {
      return '--:--';
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return '--:--';
    }

    const hours = String(parsed.getHours()).padStart(2, '0');
    const minutes = String(parsed.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
  }

  async getOverview(branchId?: number): Promise<DashboardResponse> {
    try {
      const branchParam = branchId ? String(branchId) : null;

      const inStockCountResult = await this.databaseService.query<CountRow>(
        `WITH serial_scope AS (
           SELECT
             COALESCE(to_jsonb(sn)->>'serialNumber', to_jsonb(sn)->>'serial_number', '') AS serial_number,
             REPLACE(REPLACE(LOWER(TRIM(COALESCE(to_jsonb(sn)->>'status', ''))), '_', '-'), ' ', '-') AS normalized_status,
             COALESCE(to_jsonb(sn)->>'branchId', to_jsonb(sn)->>'branch_id', to_jsonb(sn)->>'branchid', '') AS branch_id
           FROM tblserial_numbers sn
         )
         SELECT COUNT(*)::text AS count
         FROM serial_scope ss
         WHERE ss.serial_number <> ''
           AND ss.normalized_status NOT IN (
             'scanned', 'reserved', 'delivered', 'installed', 'sold', 'released', 'out', 'outbound'
           )
           AND ($1::text IS NULL OR ss.branch_id = $1::text)`,
        [branchParam],
      );

      const openPoCountResult = await this.databaseService.query<CountRow>(
        `SELECT COUNT(*)::text AS count
         FROM tblpurchase_orders po
         WHERE REPLACE(REPLACE(LOWER(TRIM(COALESCE(to_jsonb(po)->>'status', 'pending'))), '_', '-'), ' ', '-') NOT IN (
           'approved', 'completed', 'cancelled', 'rejected'
         )`,
      );

      const dispatchCountResult = await this.databaseService.query<CountRow>(
        `WITH sales_scope AS (
           SELECT
             REPLACE(REPLACE(LOWER(TRIM(COALESCE(to_jsonb(so)->>'status', 'pending'))), '_', '-'), ' ', '-') AS normalized_status,
             COALESCE(to_jsonb(so)->>'branchId', to_jsonb(so)->>'branch_id', '') AS branch_id
           FROM tblsales_order so
         )
         SELECT COUNT(*)::text AS count
         FROM sales_scope ss
         WHERE ss.normalized_status IN ('pending', 'for-delivery', 'to-remit', 'released', 'in-progress')
           AND ($1::text IS NULL OR ss.branch_id = $1::text)`,
        [branchParam],
      );

      const installQueueCountResult = await this.databaseService.query<CountRow>(
        `WITH sales_scope AS (
           SELECT
             REPLACE(REPLACE(LOWER(TRIM(COALESCE(to_jsonb(so)->>'status', 'pending'))), '_', '-'), ' ', '-') AS normalized_status,
             COALESCE(to_jsonb(so)->>'branchId', to_jsonb(so)->>'branch_id', '') AS branch_id
           FROM tblsales_order so
         )
         SELECT COUNT(*)::text AS count
         FROM sales_scope ss
         WHERE ss.normalized_status LIKE '%install%'
           AND ss.normalized_status NOT IN ('installed', 'completed', 'cancelled')
           AND ($1::text IS NULL OR ss.branch_id = $1::text)`,
        [branchParam],
      );

      const stockAlertsResult = await this.databaseService.query<CountRow>(
        `WITH serial_scope AS (
           SELECT
             COALESCE(to_jsonb(sn)->>'productId', to_jsonb(sn)->>'product_id', '') AS product_id,
             COALESCE(to_jsonb(sn)->>'capacityId', to_jsonb(sn)->>'capacity_id', '') AS capacity_id,
             REPLACE(REPLACE(LOWER(TRIM(COALESCE(to_jsonb(sn)->>'status', ''))), '_', '-'), ' ', '-') AS normalized_status,
             COALESCE(to_jsonb(sn)->>'branchId', to_jsonb(sn)->>'branch_id', '') AS branch_id
           FROM tblserial_numbers sn
         ),
         grouped AS (
           SELECT
             product_id,
             capacity_id,
             COUNT(*) FILTER (
               WHERE normalized_status NOT IN (
                 'scanned', 'reserved', 'delivered', 'installed', 'sold', 'released', 'out', 'outbound'
               )
             )::int AS in_stock
           FROM serial_scope
           WHERE product_id <> ''
             AND capacity_id <> ''
             AND ($1::text IS NULL OR branch_id = $1::text)
           GROUP BY product_id, capacity_id
         )
         SELECT COUNT(*)::text AS count
         FROM grouped
         WHERE in_stock <= 5`,
        [branchParam],
      );

      const receivingTodayResult = await this.databaseService.query<CountRow>(
        `SELECT COUNT(*)::text AS count
         FROM tblpurchase_orders po
         WHERE (COALESCE(NULLIF(to_jsonb(po)->>'created_at', ''), NULLIF(to_jsonb(po)->>'createdAt', ''))::timestamptz AT TIME ZONE 'UTC')::date = CURRENT_DATE`,
      );

      const scannedTodayResult = await this.databaseService.query<CountRow>(
        `WITH serial_scope AS (
           SELECT
             COALESCE(to_jsonb(sn)->>'purchaseId', to_jsonb(sn)->>'purchase_id', to_jsonb(sn)->>'po_id', '') AS purchase_id,
             COALESCE(to_jsonb(sn)->>'branchId', to_jsonb(sn)->>'branch_id', '') AS branch_id,
             COALESCE(NULLIF(to_jsonb(sn)->>'created_at', ''), NULLIF(to_jsonb(sn)->>'createdAt', '')) AS created_at
           FROM tblserial_numbers sn
         )
         SELECT COUNT(*)::text AS count
         FROM serial_scope ss
         WHERE ss.purchase_id <> ''
           AND ($1::text IS NULL OR ss.branch_id = $1::text)
           AND (ss.created_at::timestamptz AT TIME ZONE 'UTC')::date = CURRENT_DATE`,
        [branchParam],
      );

      const salesSummaryResult = await this.databaseService.query<SalesRow>(
        `WITH sales_scope AS (
           SELECT
             CASE
               WHEN COALESCE(to_jsonb(so)->>'total_amount', to_jsonb(so)->>'totalAmount', '0') ~ '^-?\\d+(\\.\\d+)?$'
                 THEN COALESCE(to_jsonb(so)->>'total_amount', to_jsonb(so)->>'totalAmount', '0')::numeric
               ELSE 0
             END AS total_amount,
             COALESCE(NULLIF(to_jsonb(so)->>'created_at', ''), NULLIF(to_jsonb(so)->>'createdAt', ''))::timestamptz AS created_at,
             COALESCE(to_jsonb(so)->>'branchId', to_jsonb(so)->>'branch_id', '') AS branch_id
           FROM tblsales_order so
         )
         SELECT
           COALESCE(SUM(total_amount) FILTER (WHERE (created_at AT TIME ZONE 'UTC')::date = CURRENT_DATE), 0)::text AS "todaySales",
           COALESCE(SUM(total_amount) FILTER (WHERE (created_at AT TIME ZONE 'UTC')::date = CURRENT_DATE - INTERVAL '1 day'), 0)::text AS "yesterdaySales",
           COALESCE(SUM(total_amount) FILTER (
             WHERE date_trunc('month', created_at AT TIME ZONE 'UTC') = date_trunc('month', CURRENT_DATE::timestamp)
               AND (created_at AT TIME ZONE 'UTC')::date <= CURRENT_DATE
           ), 0)::text AS "mtdSales",
           COALESCE(SUM(total_amount) FILTER (
             WHERE date_trunc('month', created_at AT TIME ZONE 'UTC') = date_trunc('month', (CURRENT_DATE - INTERVAL '1 month')::timestamp)
               AND EXTRACT(DAY FROM created_at AT TIME ZONE 'UTC') <= EXTRACT(DAY FROM CURRENT_DATE)
           ), 0)::text AS "prevMtdSales"
         FROM sales_scope ss
         WHERE ($1::text IS NULL OR ss.branch_id = $1::text)`,
        [branchParam],
      );

      const grossMarginResult = await this.databaseService.query<GrossMarginRow>(
        `WITH item_scope AS (
           SELECT
             CASE
               WHEN COALESCE(to_jsonb(tpi)->>'unitPrice', to_jsonb(tpi)->>'unit_price', '0') ~ '^-?\\d+(\\.\\d+)?$'
                 THEN COALESCE(to_jsonb(tpi)->>'unitPrice', to_jsonb(tpi)->>'unit_price', '0')::numeric
               ELSE 0
             END AS unit_price,
             CASE
               WHEN COALESCE(to_jsonb(tpi)->>'sellPrice', to_jsonb(tpi)->>'sell_price', '0') ~ '^-?\\d+(\\.\\d+)?$'
                 THEN COALESCE(to_jsonb(tpi)->>'sellPrice', to_jsonb(tpi)->>'sell_price', '0')::numeric
               ELSE 0
             END AS sell_price,
             CASE
               WHEN COALESCE(to_jsonb(tpi)->>'discountPrice', to_jsonb(tpi)->>'discount_price', '0') ~ '^-?\\d+(\\.\\d+)?$'
                 THEN COALESCE(to_jsonb(tpi)->>'discountPrice', to_jsonb(tpi)->>'discount_price', '0')::numeric
               ELSE 0
             END AS discount_price,
             CASE
               WHEN COALESCE(to_jsonb(tpi)->>'totalSetQty', to_jsonb(tpi)->>'total_set_qty', '0') ~ '^-?\\d+(\\.\\d+)?$'
                 THEN COALESCE(to_jsonb(tpi)->>'totalSetQty', to_jsonb(tpi)->>'total_set_qty', '0')::numeric
               ELSE 0
             END AS qty,
             LOWER(COALESCE(to_jsonb(tpi)->>'transType', to_jsonb(tpi)->>'trans_type', 'sales')) AS trans_type
           FROM tbltransaction_product_items tpi
         ),
         totals AS (
           SELECT
             SUM((CASE WHEN discount_price > 0 THEN discount_price ELSE sell_price END) * qty) AS gross_sales,
             SUM(((CASE WHEN discount_price > 0 THEN discount_price ELSE sell_price END) - unit_price) * qty) AS gross_margin
           FROM item_scope
           WHERE trans_type = 'sales'
         )
         SELECT
           COALESCE((gross_margin / NULLIF(gross_sales, 0)) * 100, 0)::text AS "marginPercent"
         FROM totals`,
      );

      const receivableResult = await this.databaseService.query<ReceivableRow>(
        `WITH payment_totals AS (
           SELECT
             COALESCE(to_jsonb(sp)->>'so_id', to_jsonb(sp)->>'soId') AS so_id,
             SUM(
               CASE
                 WHEN COALESCE(to_jsonb(sp)->>'amount', '0') ~ '^-?\\d+(\\.\\d+)?$'
                   THEN COALESCE(to_jsonb(sp)->>'amount', '0')::numeric
                 ELSE 0
               END
             ) AS paid_amount
           FROM tblso_payments sp
           GROUP BY COALESCE(to_jsonb(sp)->>'so_id', to_jsonb(sp)->>'soId')
         ),
         sales_scope AS (
           SELECT
             so.id::text AS so_id,
             CASE
               WHEN COALESCE(to_jsonb(so)->>'total_amount', to_jsonb(so)->>'totalAmount', '0') ~ '^-?\\d+(\\.\\d+)?$'
                 THEN COALESCE(to_jsonb(so)->>'total_amount', to_jsonb(so)->>'totalAmount', '0')::numeric
               ELSE 0
             END AS total_amount,
             REPLACE(REPLACE(LOWER(TRIM(COALESCE(to_jsonb(so)->>'status', 'pending'))), '_', '-'), ' ', '-') AS normalized_status,
             COALESCE(to_jsonb(so)->>'branchId', to_jsonb(so)->>'branch_id', '') AS branch_id
           FROM tblsales_order so
         )
         SELECT COALESCE(SUM(GREATEST(ss.total_amount - COALESCE(pt.paid_amount, 0), 0)), 0)::text AS amount
         FROM sales_scope ss
         LEFT JOIN payment_totals pt
           ON pt.so_id = ss.so_id
         WHERE ss.normalized_status IN ('approved', 'released', 'delivered', 'partial', 'remitted', 'paid')
           AND ($1::text IS NULL OR ss.branch_id = $1::text)`,
        [branchParam],
      );

      const topCustomersResult = await this.databaseService.query<TopCustomerRow>(
        `WITH payment_totals AS (
           SELECT
             COALESCE(to_jsonb(sp)->>'so_id', to_jsonb(sp)->>'soId') AS so_id,
             SUM(
               CASE
                 WHEN COALESCE(to_jsonb(sp)->>'amount', '0') ~ '^-?\\d+(\\.\\d+)?$'
                   THEN COALESCE(to_jsonb(sp)->>'amount', '0')::numeric
                 ELSE 0
               END
             ) AS paid_amount
           FROM tblso_payments sp
           GROUP BY COALESCE(to_jsonb(sp)->>'so_id', to_jsonb(sp)->>'soId')
         ),
         sales_scope AS (
           SELECT
             so.id::text AS so_id,
             COALESCE(to_jsonb(so)->>'customer_id', to_jsonb(so)->>'customerId', '') AS customer_id,
             CASE
               WHEN COALESCE(to_jsonb(so)->>'total_amount', to_jsonb(so)->>'totalAmount', '0') ~ '^-?\\d+(\\.\\d+)?$'
                 THEN COALESCE(to_jsonb(so)->>'total_amount', to_jsonb(so)->>'totalAmount', '0')::numeric
               ELSE 0
             END AS total_amount,
             COALESCE(NULLIF(to_jsonb(so)->>'created_at', ''), NULLIF(to_jsonb(so)->>'createdAt', ''))::timestamptz AS created_at,
             COALESCE(to_jsonb(so)->>'branchId', to_jsonb(so)->>'branch_id', '') AS branch_id
           FROM tblsales_order so
         )
         SELECT
           COALESCE(to_jsonb(c)->>'name', 'Unknown Customer') AS name,
           COUNT(*)::text AS orders,
           COALESCE(SUM(GREATEST(ss.total_amount - COALESCE(pt.paid_amount, 0), 0)), 0)::text AS balance
         FROM sales_scope ss
         LEFT JOIN tblcustomer c
           ON c.id::text = ss.customer_id
         LEFT JOIN payment_totals pt
           ON pt.so_id = ss.so_id
         WHERE ss.created_at >= (CURRENT_DATE - INTERVAL '30 day')::timestamp
           AND ($1::text IS NULL OR ss.branch_id = $1::text)
         GROUP BY COALESCE(to_jsonb(c)->>'name', 'Unknown Customer')
         ORDER BY COUNT(*) DESC, SUM(ss.total_amount) DESC
         LIMIT 3`,
        [branchParam],
      );

      const topCapacitiesResult = await this.databaseService.query<TopCapacityRow>(
        `WITH sold_units AS (
           SELECT
             COALESCE(to_jsonb(tpi)->>'productId', to_jsonb(tpi)->>'product_id', '') AS product_id,
             COALESCE(to_jsonb(tpi)->>'capacityId', to_jsonb(tpi)->>'capacity_id', '') AS capacity_id,
             SUM(
               CASE
                 WHEN COALESCE(to_jsonb(tpi)->>'totalSetQty', to_jsonb(tpi)->>'total_set_qty', '0') ~ '^-?\\d+(\\.\\d+)?$'
                   THEN COALESCE(to_jsonb(tpi)->>'totalSetQty', to_jsonb(tpi)->>'total_set_qty', '0')::numeric
                 ELSE 0
               END
             ) AS units
           FROM tbltransaction_product_items tpi
           WHERE LOWER(COALESCE(to_jsonb(tpi)->>'transType', to_jsonb(tpi)->>'trans_type', 'sales')) = 'sales'
           GROUP BY
             COALESCE(to_jsonb(tpi)->>'productId', to_jsonb(tpi)->>'product_id', ''),
             COALESCE(to_jsonb(tpi)->>'capacityId', to_jsonb(tpi)->>'capacity_id', '')
         ),
         in_stock_units AS (
           SELECT
             COALESCE(to_jsonb(sn)->>'productId', to_jsonb(sn)->>'product_id', '') AS product_id,
             COALESCE(to_jsonb(sn)->>'capacityId', to_jsonb(sn)->>'capacity_id', '') AS capacity_id,
             COUNT(*) FILTER (
               WHERE REPLACE(REPLACE(LOWER(TRIM(COALESCE(to_jsonb(sn)->>'status', ''))), '_', '-'), ' ', '-') NOT IN (
                 'scanned', 'reserved', 'delivered', 'installed', 'sold', 'released', 'out', 'outbound'
               )
             )::numeric AS in_stock,
             COALESCE(to_jsonb(sn)->>'branchId', to_jsonb(sn)->>'branch_id', '') AS branch_id
           FROM tblserial_numbers sn
           GROUP BY
             COALESCE(to_jsonb(sn)->>'productId', to_jsonb(sn)->>'product_id', ''),
             COALESCE(to_jsonb(sn)->>'capacityId', to_jsonb(sn)->>'capacity_id', ''),
             COALESCE(to_jsonb(sn)->>'branchId', to_jsonb(sn)->>'branch_id', '')
         )
         SELECT
           TRIM(CONCAT(
             COALESCE(to_jsonb(p)->>'productName', to_jsonb(p)->>'product_name', to_jsonb(p)->>'productname', 'Unknown Product'),
             ' ',
             COALESCE(to_jsonb(c)->>'capacity', to_jsonb(c)->>'capacityValue', to_jsonb(c)->>'capacity_value', '')
           )) AS label,
           COALESCE(su.units, 0)::text AS units,
           COALESCE(
             ROUND((su.units / NULLIF(su.units + COALESCE(SUM(isu.in_stock), 0), 0)) * 100),
             0
           )::text AS "sellThrough"
         FROM sold_units su
         LEFT JOIN tblproducts p
           ON p.id::text = su.product_id
         LEFT JOIN tblcapacity c
           ON c.id::text = su.capacity_id
         LEFT JOIN in_stock_units isu
           ON isu.product_id = su.product_id
          AND isu.capacity_id = su.capacity_id
          AND ($1::text IS NULL OR isu.branch_id = $1::text)
         GROUP BY label, su.units
         ORDER BY su.units DESC
         LIMIT 4`,
        [branchParam],
      );

      const marginByBrandResult = await this.databaseService.query<MarginRow>(
        `WITH item_scope AS (
           SELECT
             COALESCE(to_jsonb(tpi)->>'productId', to_jsonb(tpi)->>'product_id', '') AS product_id,
             CASE
               WHEN COALESCE(to_jsonb(tpi)->>'unitPrice', to_jsonb(tpi)->>'unit_price', '0') ~ '^-?\\d+(\\.\\d+)?$'
                 THEN COALESCE(to_jsonb(tpi)->>'unitPrice', to_jsonb(tpi)->>'unit_price', '0')::numeric
               ELSE 0
             END AS unit_price,
             CASE
               WHEN COALESCE(to_jsonb(tpi)->>'sellPrice', to_jsonb(tpi)->>'sell_price', '0') ~ '^-?\\d+(\\.\\d+)?$'
                 THEN COALESCE(to_jsonb(tpi)->>'sellPrice', to_jsonb(tpi)->>'sell_price', '0')::numeric
               ELSE 0
             END AS sell_price,
             CASE
               WHEN COALESCE(to_jsonb(tpi)->>'discountPrice', to_jsonb(tpi)->>'discount_price', '0') ~ '^-?\\d+(\\.\\d+)?$'
                 THEN COALESCE(to_jsonb(tpi)->>'discountPrice', to_jsonb(tpi)->>'discount_price', '0')::numeric
               ELSE 0
             END AS discount_price,
             CASE
               WHEN COALESCE(to_jsonb(tpi)->>'totalSetQty', to_jsonb(tpi)->>'total_set_qty', '0') ~ '^-?\\d+(\\.\\d+)?$'
                 THEN COALESCE(to_jsonb(tpi)->>'totalSetQty', to_jsonb(tpi)->>'total_set_qty', '0')::numeric
               ELSE 0
             END AS qty
           FROM tbltransaction_product_items tpi
           WHERE LOWER(COALESCE(to_jsonb(tpi)->>'transType', to_jsonb(tpi)->>'trans_type', 'sales')) = 'sales'
         )
         SELECT
           COALESCE(to_jsonb(b)->>'name', 'Unknown Brand') AS label,
           COALESCE(
             (SUM(((CASE WHEN item_scope.discount_price > 0 THEN item_scope.discount_price ELSE item_scope.sell_price END) - item_scope.unit_price) * item_scope.qty)
               / NULLIF(SUM((CASE WHEN item_scope.discount_price > 0 THEN item_scope.discount_price ELSE item_scope.sell_price END) * item_scope.qty), 0)
             ) * 100,
             0
           )::text AS margin
         FROM item_scope
         LEFT JOIN tblproducts p
           ON p.id::text = item_scope.product_id
         LEFT JOIN tblbrands b
           ON b.id::text = COALESCE(to_jsonb(p)->>'brand_id', to_jsonb(p)->>'brandId', '')
         GROUP BY COALESCE(to_jsonb(b)->>'name', 'Unknown Brand')
         ORDER BY margin DESC
         LIMIT 4`,
      );

      const marginByVendorResult = await this.databaseService.query<MarginRow>(
        `WITH serial_scope AS (
           SELECT
             COALESCE(to_jsonb(sn)->>'productId', to_jsonb(sn)->>'product_id', '') AS product_id,
             COALESCE(to_jsonb(sn)->>'capacityId', to_jsonb(sn)->>'capacity_id', '') AS capacity_id,
             COALESCE(to_jsonb(sn)->>'purchaseId', to_jsonb(sn)->>'purchase_id', to_jsonb(sn)->>'po_id', '') AS purchase_id,
             REPLACE(REPLACE(LOWER(TRIM(COALESCE(to_jsonb(sn)->>'status', ''))), '_', '-'), ' ', '-') AS normalized_status,
             COALESCE(to_jsonb(sn)->>'branchId', to_jsonb(sn)->>'branch_id', '') AS branch_id
           FROM tblserial_numbers sn
         )
         SELECT
           COALESCE(to_jsonb(v)->>'name', 'Unknown Vendor') AS label,
           COALESCE(SUM(
             COALESCE(NULLIF(to_jsonb(c)->>'srp', '')::numeric, 0)
             - COALESCE(NULLIF(COALESCE(to_jsonb(tpi)->>'unitPrice', to_jsonb(tpi)->>'unit_price', ''), '')::numeric, 0)
           ), 0)::text AS margin
         FROM serial_scope ss
         LEFT JOIN tblcapacity c
           ON c.id::text = ss.capacity_id
         LEFT JOIN tblpurchase_orders po
           ON po.id::text = ss.purchase_id
         LEFT JOIN tblvendors v
           ON v.id::text = COALESCE(to_jsonb(po)->>'vendor_id', to_jsonb(po)->>'vendorId', '')
         LEFT JOIN tbltransaction_product_items tpi
           ON COALESCE(to_jsonb(tpi)->>'purchaseId', to_jsonb(tpi)->>'purchase_id', to_jsonb(tpi)->>'po_id', '') = ss.purchase_id
          AND COALESCE(to_jsonb(tpi)->>'productId', to_jsonb(tpi)->>'product_id', '') = ss.product_id
          AND COALESCE(to_jsonb(tpi)->>'capacityId', to_jsonb(tpi)->>'capacity_id', '') = ss.capacity_id
          AND LOWER(COALESCE(to_jsonb(tpi)->>'transType', to_jsonb(tpi)->>'trans_type', 'purchase')) = 'purchase'
         WHERE ss.purchase_id <> ''
           AND ss.normalized_status NOT IN (
             'scanned', 'reserved', 'delivered', 'installed', 'sold', 'released', 'out', 'outbound'
           )
           AND ($1::text IS NULL OR ss.branch_id = $1::text)
         GROUP BY COALESCE(to_jsonb(v)->>'name', 'Unknown Vendor')
         ORDER BY margin DESC
         LIMIT 4`,
        [branchParam],
      );

      const activityResult = await this.databaseService.query<ActivityRow>(
        `WITH po_events AS (
           SELECT
             COALESCE(NULLIF(to_jsonb(po)->>'created_at', ''), NULLIF(to_jsonb(po)->>'createdAt', '')) AS "eventAt",
             CONCAT('PO ', COALESCE(to_jsonb(po)->>'po_number', to_jsonb(po)->>'poNumber', CONCAT('#', po.id::text)), ' created') AS text,
             'received'::text AS status
           FROM tblpurchase_orders po
           ORDER BY po.id DESC
           LIMIT 3
         ),
         so_events AS (
           SELECT
             COALESCE(NULLIF(to_jsonb(so)->>'created_at', ''), NULLIF(to_jsonb(so)->>'createdAt', '')) AS "eventAt",
             CONCAT('SO ', COALESCE(to_jsonb(so)->>'so_number', to_jsonb(so)->>'soNumber', CONCAT('#', so.id::text)), ' queued for processing') AS text,
             'dispatch'::text AS status
           FROM tblsales_order so
           WHERE ($1::text IS NULL OR COALESCE(to_jsonb(so)->>'branchId', to_jsonb(so)->>'branch_id', '') = $1::text)
           ORDER BY so.id DESC
           LIMIT 3
         ),
         payment_events AS (
           SELECT
             COALESCE(NULLIF(to_jsonb(sp)->>'created_at', ''), NULLIF(to_jsonb(sp)->>'createdAt', '')) AS "eventAt",
             CONCAT(
               'Payment posted for ',
               COALESCE(to_jsonb(so)->>'so_number', to_jsonb(so)->>'soNumber', CONCAT('SO#', so.id::text))
             ) AS text,
             'payment'::text AS status
           FROM tblso_payments sp
           LEFT JOIN tblsales_order so
             ON so.id::text = COALESCE(to_jsonb(sp)->>'so_id', to_jsonb(sp)->>'soId', '')
           ORDER BY sp.id DESC
           LIMIT 2
         )
         SELECT * FROM po_events
         UNION ALL
         SELECT * FROM so_events
         UNION ALL
         SELECT * FROM payment_events
         LIMIT 8`,
        [branchParam],
      );

      const inStockCount = this.toNumber(inStockCountResult.rows[0]?.count);
      const openPoCount = this.toNumber(openPoCountResult.rows[0]?.count);
      const dispatchCount = this.toNumber(dispatchCountResult.rows[0]?.count);
      const installQueueCount = this.toNumber(installQueueCountResult.rows[0]?.count);
      const stockAlertsCount = this.toNumber(stockAlertsResult.rows[0]?.count);
      const poTodayCount = this.toNumber(receivingTodayResult.rows[0]?.count);
      const scannedTodayCount = this.toNumber(scannedTodayResult.rows[0]?.count);

      const todaySales = this.toNumber(salesSummaryResult.rows[0]?.todaySales);
      const yesterdaySales = this.toNumber(salesSummaryResult.rows[0]?.yesterdaySales);
      const mtdSales = this.toNumber(salesSummaryResult.rows[0]?.mtdSales);
      const prevMtdSales = this.toNumber(salesSummaryResult.rows[0]?.prevMtdSales);
      const grossMarginPercent = this.toNumber(grossMarginResult.rows[0]?.marginPercent);
      const unpaidReceivable = this.toNumber(receivableResult.rows[0]?.amount);

      const inStockDelta = this.buildDelta(inStockCount, inStockCount);
      const openPoDelta = this.buildDelta(openPoCount, openPoCount);
      const dispatchDelta = this.buildDelta(dispatchCount, dispatchCount);
      const installDelta = this.buildDelta(installQueueCount, installQueueCount);
      const salesTodayDelta = this.buildDelta(todaySales, yesterdaySales);
      const mtdDelta = this.buildDelta(mtdSales, prevMtdSales);

      const topKpis: KpiCard[] = [
        {
          label: 'In-Stock Units',
          value: this.formatInteger(inStockCount),
          change: inStockDelta.change,
          trend: inStockDelta.trend,
        },
        {
          label: 'Open Purchase Orders',
          value: this.formatInteger(openPoCount),
          change: openPoDelta.change,
          trend: openPoDelta.trend,
        },
        {
          label: 'Dispatch Today',
          value: this.formatInteger(dispatchCount),
          change: dispatchDelta.change,
          trend: dispatchDelta.trend,
        },
        {
          label: 'Install Queue',
          value: this.formatInteger(installQueueCount),
          change: installDelta.change,
          trend: installDelta.trend,
        },
      ];

      const operations: OpsItem[] = [
        {
          label: 'Receiving Today',
          value: `${this.formatInteger(poTodayCount)} PO / ${this.formatInteger(scannedTodayCount)} Serials`,
          hint: 'Live from purchase and serial logs',
          level: 'normal',
        },
        {
          label: 'For Dispatch',
          value: `${this.formatInteger(dispatchCount)} Orders`,
          hint: 'Statuses: pending, for-delivery, to-remit',
          level: dispatchCount > 10 ? 'warning' : 'normal',
        },
        {
          label: 'For Installation',
          value: `${this.formatInteger(installQueueCount)} Bookings`,
          hint: 'Statuses containing installation steps',
          level: installQueueCount > 8 ? 'warning' : 'normal',
        },
        {
          label: 'Stock Alerts',
          value: `${this.formatInteger(stockAlertsCount)} capacities low`,
          hint: 'Threshold: <= 5 in-stock units',
          level: stockAlertsCount > 0 ? 'critical' : 'normal',
        },
      ];

      const salesSummary: KpiCard[] = [
        {
          label: 'Sales Today',
          value: this.formatCurrency(todaySales),
          change: salesTodayDelta.change,
          trend: salesTodayDelta.trend,
        },
        {
          label: 'Month-to-Date Sales',
          value: this.formatCurrency(mtdSales),
          change: mtdDelta.change,
          trend: mtdDelta.trend,
        },
        {
          label: 'Gross Margin',
          value: this.formatPercent(grossMarginPercent),
          change: '+0.0%',
          trend: 'up',
        },
        {
          label: 'Unpaid Receivables',
          value: this.formatCurrency(unpaidReceivable),
          change: '+0.0%',
          trend: unpaidReceivable > 0 ? 'down' : 'up',
        },
      ];

      const topCustomers = topCustomersResult.rows.map((row) => ({
        name: String(row.name || 'Unknown Customer').trim(),
        orders: this.toNumber(row.orders),
        balance: this.formatCurrency(this.toNumber(row.balance)),
      }));

      const topCapacities = topCapacitiesResult.rows.map((row) => ({
        label: String(row.label || 'Unknown Capacity').trim(),
        units: this.toNumber(row.units),
        sellThrough: Math.max(0, Math.min(100, this.toNumber(row.sellThrough))),
      }));

      const marginByBrand = marginByBrandResult.rows.map((row) => ({
        label: String(row.label || 'Unknown Brand').trim(),
        margin: this.toNumber(row.margin),
      }));

      const marginByVendor = marginByVendorResult.rows.map((row) => ({
        label: String(row.label || 'Unknown Vendor').trim(),
        margin: this.toNumber(row.margin) / 1000000,
      }));

      const activityFeed = activityResult.rows
        .map((row) => ({
          time: this.formatActivityTime(row.eventAt),
          text: String(row.text ?? '').trim() || 'System activity recorded',
          status: row.status,
          sortableDate: row.eventAt ? new Date(row.eventAt).getTime() : 0,
        }))
        .sort((a, b) => b.sortableDate - a.sortableDate)
        .slice(0, 6)
        .map(({ time, text, status }) => ({ time, text, status }));

      const focusSegments: string[] = [];
      if (dispatchCount > 0) {
        focusSegments.push(`${this.formatInteger(dispatchCount)} dispatch orders`);
      }
      if (stockAlertsCount > 0) {
        focusSegments.push(`${this.formatInteger(stockAlertsCount)} low-stock capacities`);
      }
      if (installQueueCount > 0) {
        focusSegments.push(`${this.formatInteger(installQueueCount)} installs in queue`);
      }

      return {
        success: true,
        item: {
          generatedAt: new Date().toISOString(),
          topKpis,
          operations,
          salesSummary,
          topCustomers,
          topCapacities,
          marginByBrand,
          marginByVendor,
          activityFeed,
          todayFocus: focusSegments.length > 0 ? focusSegments.join(', ') : 'All core queues are stable today',
        },
      };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Unable to load dashboard overview',
      };
    }
  }
}
