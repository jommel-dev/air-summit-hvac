import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  BadRequestException,
} from '@nestjs/common';
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
      srp: number;
    }>(
      `SELECT
         p.id AS "productId",
         COALESCE(to_jsonb(p)->>'productName', to_jsonb(p)->>'product_name', to_jsonb(p)->>'name', '') AS "productName",
         COALESCE(to_jsonb(b)->>'name', to_jsonb(b)->>'brandName', '') AS "brandName",
         COALESCE(to_jsonb(p)->>'unitTypes', to_jsonb(p)->>'unit_types', '') AS "unitTypes",
         c.id AS "capacityId",
         COALESCE(to_jsonb(c)->>'capacity', '') AS capacity,
         COALESCE(NULLIF(to_jsonb(c)->>'sellPrice', '')::numeric, 0) AS "sellPrice",
         COALESCE(NULLIF(to_jsonb(c)->>'unitPrice', '')::numeric, 0) AS "unitPrice",
         COALESCE(NULLIF(to_jsonb(c)->>'srp', '')::numeric, 0) AS "srp"
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
      capacities: Array<{ id: number; capacity: string; sellPrice: number; unitPrice: number; srp: number }>;
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
        srp: Number(row.srp),
      });
    }

    return { success: true, items: [...productMap.values()] };
  }

  @Get('materials')
  async getMaterials() {
    const result = await this.databaseService.query<{
      id: number;
      code: string;
      name: string;
      unit: string;
      unitPrice: number;
      category: string;
    }>(
      `SELECT
         id,
         COALESCE(material_code, '') AS code,
         COALESCE(material_name, '') AS name,
         COALESCE(unit, 'PCS') AS unit,
         COALESCE(unit_price, 0) AS "unitPrice",
         COALESCE(category, 'general') AS category
       FROM tblmaterials
       WHERE deleted_at IS NULL
       ORDER BY category ASC, material_name ASC`,
    );

    const grouped = new Map<string, Array<{ id: number; code: string; name: string; unit: string; unitPrice: number }>>();

    for (const row of result.rows) {
      const cat = row.category || 'general';
      if (!grouped.has(cat)) {
        grouped.set(cat, []);
      }
      grouped.get(cat)!.push({
        id: Number(row.id),
        code: row.code,
        name: row.name,
        unit: row.unit,
        unitPrice: Number(row.unitPrice),
      });
    }

    const items = [...grouped.entries()].map(([category, materials]) => ({
      category,
      materials,
    }));

    return { success: true, items };
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

    // Validate miscItems before proceeding
    const miscItems = Array.isArray(dto.miscItems) ? dto.miscItems : [];
    if (miscItems.length > 0) {
      // Validate each misc item has required fields
      const validCategories = ['excess', 'electrical', 'material', 'general'];
      for (let i = 0; i < miscItems.length; i++) {
        const item = miscItems[i];
        if (!item.itemName || typeof item.itemName !== 'string' || !item.itemName.trim()) {
          throw new BadRequestException(`Misc item at index ${i}: itemName is required`);
        }
        if (!item.category || !validCategories.includes(item.category)) {
          throw new BadRequestException(
            `Misc item at index ${i}: category must be one of: ${validCategories.join(', ')}`,
          );
        }
        if (typeof item.quantity !== 'number' || item.quantity <= 0) {
          throw new BadRequestException(`Misc item at index ${i}: quantity must be a positive number`);
        }
        if (!item.unit || typeof item.unit !== 'string') {
          throw new BadRequestException(`Misc item at index ${i}: unit is required`);
        }
        if (typeof item.unitPrice !== 'number' || item.unitPrice < 0) {
          throw new BadRequestException(`Misc item at index ${i}: unitPrice must be a non-negative number`);
        }
      }

      // Validate materialIds exist in tblmaterial_items
      const materialIds = miscItems
        .map((item) => item.materialId)
        .filter((id): id is number => id != null && typeof id === 'number');

      if (materialIds.length > 0) {
        const uniqueIds = [...new Set(materialIds)];
        const materialCheck = await this.databaseService.query<{ id: number }>(
          `SELECT id FROM tblmaterial_items WHERE id = ANY($1)`,
          [uniqueIds],
        );
        const foundIds = new Set(materialCheck.rows.map((r) => Number(r.id)));
        for (const id of uniqueIds) {
          if (!foundIds.has(id)) {
            throw new BadRequestException(
              `Misc item references non-existent material_id: ${id}`,
            );
          }
        }
      }

      // Use transaction to wrap sales order creation + misc items insertion
      return this.databaseService.withTransaction(async (client) => {
        // Create the sales order
        const orderResult = await this.salesOrderService.create(payload as any);
        if (!orderResult || !orderResult.success || !orderResult.data?.salesOrderId) {
          throw new BadRequestException(
            orderResult?.message || 'Failed to create sales order',
          );
        }

        const salesOrderId = orderResult.data.salesOrderId;

        // Insert misc items
        for (const item of miscItems) {
          const totalPrice = item.quantity * item.unitPrice;
          await client.query(
            `INSERT INTO tblso_miscellaneous_items
              (sales_id, category, item_name, description, material_id, quantity, unit, unit_price, total_price, is_inclusion)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [
              salesOrderId,
              item.category,
              item.itemName.trim(),
              item.description?.trim() || null,
              item.materialId ?? null,
              item.quantity,
              item.unit,
              item.unitPrice,
              totalPrice,
              item.isInclusion ?? false,
            ],
          );
        }

        return orderResult;
      });
    }

    return this.salesOrderService.create(payload as any);
  }
}
