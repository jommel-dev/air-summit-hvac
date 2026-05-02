import { Controller, Get, Post, Body, Query } from '@nestjs/common';
import { SalesOrderService } from '../sales-order/sales-order.service';
import { PublicOrderFormDto } from '../sales-order/dto/public-order-form.dto';
import { DatabaseService } from 'src/database/database.service';

@Controller('public/order-form')
export class PublicOrderFormController {
  constructor(
    private readonly salesOrderService: SalesOrderService,
    private readonly databaseService: DatabaseService,
  ) {}

  @Get('products')
  async getProducts() {
    const result = await this.databaseService.query<{
      productId: number;
      productName: string;
      brandName: string;
      unitTypes: string | null;
      capacityId: number;
      capacity: string;
      sellPrice: number;
      unitPrice: number;
    }>(
      `SELECT
         p.id AS "productId",
         COALESCE(to_jsonb(p)->>'productName', to_jsonb(p)->>'product_name', to_jsonb(p)->>'name', '') AS "productName",
         COALESCE(to_jsonb(b)->>'name', to_jsonb(b)->>'brandName', '') AS "brandName",
         COALESCE(to_jsonb(p)->>'unitTypes', to_jsonb(p)->>'unit_types', '') AS "unitTypes",
         c.id AS "capacityId",
         COALESCE(to_jsonb(c)->>'capacity', '') AS capacity,
         COALESCE(NULLIF(to_jsonb(c)->>'sellPrice', '')::numeric, 0) AS "sellPrice",
         COALESCE(NULLIF(to_jsonb(c)->>'unitPrice', '')::numeric, 0) AS "unitPrice"
       FROM tblproducts p
       JOIN tblcapacity c ON COALESCE(to_jsonb(c)->>'prodId', to_jsonb(c)->>'prod_id', to_jsonb(c)->>'productId', to_jsonb(c)->>'product_id') = p.id::text
       LEFT JOIN tblbrands b ON b.id::text = COALESCE(to_jsonb(p)->>'brandId', to_jsonb(p)->>'brand_id')
       ORDER BY "brandName" ASC, "productName" ASC, capacity ASC`,
    );

    const productMap = new Map<number, {
      id: number;
      name: string;
      brandName: string;
      unitTypes: string[];
      capacities: Array<{ id: number; capacity: string; sellPrice: number; unitPrice: number }>;
    }>();

    for (const row of result.rows) {
      if (!productMap.has(row.productId)) {
        let unitTypes: string[] = [];
        try {
          const raw = String(row.unitTypes ?? '').trim();
          if (raw.startsWith('[')) {
            const parsed = JSON.parse(raw);
            unitTypes = Array.isArray(parsed) ? parsed.map((u: unknown) => String(u).toLowerCase()).filter(Boolean) : [];
          } else if (raw.startsWith('{')) {
            unitTypes = raw.slice(1, -1).split(',').map(u => u.replace(/"/g, '').trim().toLowerCase()).filter(Boolean);
          } else if (raw.length > 0) {
            // Plain comma-separated string: "Indoor,Outdoor"
            unitTypes = raw.split(',').map(u => u.trim().toLowerCase()).filter(Boolean);
          }
        } catch {}

        productMap.set(row.productId, {
          id: row.productId,
          name: row.productName,
          brandName: row.brandName,
          unitTypes,
          capacities: [],
        });
      }
      productMap.get(row.productId)!.capacities.push({
        id: row.capacityId,
        capacity: row.capacity,
        sellPrice: Number(row.sellPrice),
        unitPrice: Number(row.unitPrice),
      });
    }

    return { success: true, items: [...productMap.values()] };
  }

  @Get('customers/search')
  async searchCustomers(@Query('q') q: string) {
    const search = String(q ?? '').trim();
    if (!search) return { success: true, items: [] };

    const result = await this.databaseService.query<{
      id: string;
      name: string;
      address: string;
      contactNumber: string;
    }>(
      `SELECT
         id::text AS id,
         COALESCE(to_jsonb(c)->>'name', to_jsonb(c)->>'customer_name', '') AS name,
         COALESCE(to_jsonb(c)->>'address', '') AS address,
         COALESCE(to_jsonb(c)->>'contact_number', to_jsonb(c)->>'contactNumber', '') AS "contactNumber"
       FROM tblcustomer c
       WHERE LOWER(COALESCE(to_jsonb(c)->>'name', to_jsonb(c)->>'customer_name', '')) LIKE LOWER($1)
       ORDER BY name ASC
       LIMIT 10`,
      [`%${search}%`],
    );

    return { success: true, items: result.rows };
  }

  @Post()
  async submitOrder(@Body() dto: PublicOrderFormDto) {
    const salesTypeMap: Record<string, string> = {
      sales: 'sales', service: 'service', concern: 'concern', 'sub-dealer': 'sub-dealer',
    };
    const salesType = salesTypeMap[dto.salesType] ?? 'sales';
    const customerType = dto.salesType === 'sub-dealer' ? 'sub_dealer' : 'regular';
    const body = dto as any;

    const productItems = (dto.productItems ?? []).map((item) => {
      const unitTypes: string[] = Array.isArray(item.unitTypes) && item.unitTypes.length > 0
        ? item.unitTypes
        : ['set'];
      return {
        transType: 'sales', productId: item.productId, capacityId: item.capacityId,
        unitPrice: item.unitPrice ?? 0, sellPrice: item.sellPrice ?? 0, discountPrice: 0,
        totalSetQty: item.qty,
        unitTypesQty: unitTypes.map((label) => ({ label: label.toLowerCase(), value: item.qty })),
      };
    });

    const serviceItems = salesType === 'service' && Array.isArray(body.serviceItems)
      ? body.serviceItems.map((s: any) => ({ serviceName: String(s.serviceName ?? '').trim() }))
      : [];

    const concernDetails = salesType === 'concern'
      ? {
          concernSubject: String(body.concernSubject ?? '').trim(),
          concernDescription: String(body.concernDescription ?? '').trim(),
          concernStatus: 'open',
          priority: 'low',
        }
      : undefined;

    const payload = {
      salesType,
      scheduleDate: dto.scheduleDate,
      customer: {
        name: dto.customerName,
        customer_type: customerType as 'regular' | 'sub_dealer',
        address: dto.address,
        contact_number: dto.contactNumber,
      },
      remarks: dto.landmark ? `Landmark: ${dto.landmark}` : undefined,
      paymentDetails: salesType !== 'service' && salesType !== 'concern'
        ? [{ method: dto.paymentMethod, amount: 0, status: 'unpaid' }]
        : undefined,
      productItems,
      serviceItems: serviceItems.length > 0 ? serviceItems : undefined,
      concernDetails,
      status: 'pending',
    };

    return this.salesOrderService.create(payload as any);
  }
}
