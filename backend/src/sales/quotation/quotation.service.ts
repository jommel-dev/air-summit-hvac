import { Injectable } from '@nestjs/common';
import { DatabaseService } from 'src/database/database.service';
import { PoolClient } from 'pg';
import { randomUUID } from 'crypto';
import { CreateQuotationDto } from './dto/create-quotation.dto';
import { ListQuotationQueryDto } from './dto/list-quotation-query.dto';
import { UpdateQuotationDto } from './dto/update-quotation.dto';

type TableQueryExecutor = { query: PoolClient['query'] };

@Injectable()
export class QuotationService {
  constructor(private readonly databaseService: DatabaseService) {}

  private async getTableColumns(
    executor: TableQueryExecutor,
    tableName: string,
  ): Promise<string[]> {
    const result = await executor.query<{ column_name: string }>(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = current_schema()
         AND table_name = $1`,
      [tableName],
    );

    return result.rows.map((row) => row.column_name);
  }

  private pickColumn(availableColumns: string[], candidates: string[]): string | undefined {
    const lowered = new Set(availableColumns.map((column) => column.toLowerCase()));
    return candidates.find((candidate) => lowered.has(candidate.toLowerCase()));
  }

  private async runInsert(
    executor: TableQueryExecutor,
    tableName: string,
    record: Record<string, unknown>,
  ) {
    const columns = Object.keys(record);
    const values = Object.values(record);
    const quotedColumns = columns.map((column) => `"${column}"`).join(', ');
    const placeholders = values.map((_, index) => `$${index + 1}`).join(', ');

    return executor.query<{ id: number }>(
      `INSERT INTO ${tableName} (${quotedColumns}) VALUES (${placeholders}) RETURNING id`,
      values,
    );
  }

  private normalizePage(value: unknown): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 1) {
      return 1;
    }

    return Math.floor(parsed);
  }

  private normalizeLimit(value: unknown): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 1) {
      return 10;
    }

    return Math.min(100, Math.floor(parsed));
  }

  private toOptionalNumber(value: unknown): number | null {
    if (value === null || value === undefined || value === '') {
      return null;
    }

    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private toIsoDateOrNull(value: unknown): string | null {
    if (!value) {
      return null;
    }

    const parsed = new Date(String(value));
    if (Number.isNaN(parsed.getTime())) {
      return null;
    }

    return parsed.toISOString();
  }

  private normalizeStatus(status: unknown): 'draft' | 'finalized' | 'converted' | 'cancelled' {
    const normalized = String(status ?? 'draft')
      .trim()
      .toLowerCase()
      .replace(/[\s_]+/g, '-');

    if (['finalized', 'converted', 'cancelled'].includes(normalized)) {
      return normalized as 'finalized' | 'converted' | 'cancelled';
    }

    return 'draft';
  }

  private calculateItemLineTotal(item: {
    unitPrice?: unknown;
    sellPrice?: unknown;
    discountPrice?: unknown;
    totalSetQty?: unknown;
  }): number {
    const unitPrice = this.toOptionalNumber(item.unitPrice) ?? 0;
    const sellPrice = this.toOptionalNumber(item.sellPrice) ?? 0;
    const discountPrice = this.toOptionalNumber(item.discountPrice) ?? 0;
    const totalSetQty = this.toOptionalNumber(item.totalSetQty) ?? 0;
    const priceToUse = discountPrice > 0 ? discountPrice : sellPrice > 0 ? sellPrice : unitPrice;
    return priceToUse * totalSetQty;
  }

  private async upsertCustomerFromPayload(
    executor: TableQueryExecutor,
    payload: CreateQuotationDto,
  ): Promise<string> {
    let customerId = String(payload.customer_id ?? '').trim();
    if (customerId) {
      const existingCustomer = await executor.query<{ id: string }>(
        `SELECT id FROM tblcustomer WHERE id::text = $1 LIMIT 1`,
        [customerId],
      );
      if (existingCustomer.rowCount > 0) {
        return customerId;
      }
    }

    const customerName = String(payload.customer?.name ?? '').trim();
    if (!customerName) {
      throw new Error('customer_id or customer.name is required');
    }

    const customerColumns = await this.getTableColumns(executor, 'tblcustomer');
    const customerIdColumn = this.pickColumn(customerColumns, ['id']);
    const customerNameColumn = this.pickColumn(customerColumns, ['name']);
    const customerAddressColumn = this.pickColumn(customerColumns, ['address']);
    const customerContactPersonColumn = this.pickColumn(customerColumns, ['contact_person', 'contactPerson']);
    const customerContactNumberColumn = this.pickColumn(customerColumns, ['contact_number', 'contactNumber']);
    const customerEmailColumn = this.pickColumn(customerColumns, ['email']);
    const customerTinColumn = this.pickColumn(customerColumns, ['tin_number', 'tinNumber']);

    if (!customerNameColumn) {
      throw new Error('tblcustomer name column is missing');
    }

    const customerRecord: Record<string, unknown> = {
      [customerNameColumn]: customerName,
    };

    if (customerIdColumn) {
      customerRecord[customerIdColumn] = randomUUID();
    }

    const address = String(payload.customer?.address ?? '').trim();
    const contactPerson = String(payload.customer?.contact_person ?? '').trim();
    const contactNumber = String(payload.customer?.contact_number ?? '').trim();
    const email = String(payload.customer?.email ?? '').trim();
    const tinNumber = String(payload.customer?.tin_number ?? '').trim();

    if (customerAddressColumn && address) customerRecord[customerAddressColumn] = address;
    if (customerContactPersonColumn && contactPerson) customerRecord[customerContactPersonColumn] = contactPerson;
    if (customerContactNumberColumn && contactNumber) customerRecord[customerContactNumberColumn] = contactNumber;
    if (customerEmailColumn && email) customerRecord[customerEmailColumn] = email;
    if (customerTinColumn && tinNumber) customerRecord[customerTinColumn] = tinNumber;

    const insertedCustomer = await this.runInsert(executor, 'tblcustomer', customerRecord);
    if (insertedCustomer.rowCount === 0) {
      throw new Error('Failed to create customer');
    }

    customerId = String(insertedCustomer.rows[0].id);
    return customerId;
  }

  async create(createQuotationDto: CreateQuotationDto, userId?: number, branchId?: number) {
    const productItems = Array.isArray(createQuotationDto.productItems)
      ? createQuotationDto.productItems
      : [];

    if (productItems.length === 0) {
      return { success: false, message: 'At least one quotation product item is required' };
    }

    try {
      const result = await this.databaseService.withTransaction(async (client) => {
        const quotationColumns = await this.getTableColumns(client, 'tblquotation');
        if (quotationColumns.length === 0) {
          throw new Error('tblquotation table does not exist. Run quotation SQL migration first.');
        }

        const quotationItemsColumns = await this.getTableColumns(client, 'tblquotation_items');
        if (quotationItemsColumns.length === 0) {
          throw new Error('tblquotation_items table does not exist. Run quotation SQL migration first.');
        }

        const customerId = await this.upsertCustomerFromPayload(client, createQuotationDto);

        const computedTotal = productItems.reduce(
          (sum, item) => sum + this.calculateItemLineTotal(item),
          0,
        );
        const totalAmount =
          computedTotal > 0 ? computedTotal : this.toOptionalNumber(createQuotationDto.totalAmount) ?? 0;

        const quoteDate = this.toIsoDateOrNull(createQuotationDto.quoteDate) ?? new Date().toISOString();
        const status = this.normalizeStatus(createQuotationDto.status);

        const quotationRecord: Record<string, unknown> = {
          quote_date: quoteDate,
          customer_id: this.toOptionalNumber(customerId),
          customer_name: String(createQuotationDto.customer?.name ?? '').trim(),
          customer_address: String(createQuotationDto.customer?.address ?? '').trim(),
          customer_contact_person: String(createQuotationDto.customer?.contact_person ?? '').trim(),
          customer_contact_number: String(createQuotationDto.customer?.contact_number ?? '').trim(),
          customer_email: String(createQuotationDto.customer?.email ?? '').trim(),
          customer_tin_number: String(createQuotationDto.customer?.tin_number ?? '').trim(),
          total_amount: totalAmount,
          status,
          remarks: String(createQuotationDto.remarks ?? '').trim(),
        };

        if (Number.isFinite(userId)) {
          quotationRecord.created_by = userId;
        }
        if (Number.isFinite(branchId)) {
          quotationRecord.branch_id = branchId;
        }

        const insertedQuotation = await this.runInsert(client, 'tblquotation', quotationRecord);
        if (insertedQuotation.rowCount === 0) {
          throw new Error('Failed to create quotation');
        }

        const quotationId = Number(insertedQuotation.rows[0].id);

        for (const item of productItems) {
          const unitPrice = this.toOptionalNumber(item.unitPrice) ?? 0;
          const sellPrice = this.toOptionalNumber(item.sellPrice) ?? 0;
          const discountPrice = this.toOptionalNumber(item.discountPrice) ?? 0;
          const totalSetQty = this.toOptionalNumber(item.totalSetQty) ?? 0;
          const lineTotal = this.calculateItemLineTotal(item);

          const itemRecord: Record<string, unknown> = {
            quotation_id: quotationId,
            product_id: this.toOptionalNumber(item.productId),
            capacity_id: this.toOptionalNumber(item.capacityId),
            unit_price: unitPrice,
            sell_price: sellPrice,
            discount_price: discountPrice,
            unit_types_qty: JSON.stringify(item.unitTypesQty ?? []),
            total_set_qty: totalSetQty,
            line_total: lineTotal,
            remarks: String(item.remarks ?? '').trim(),
          };

          await this.runInsert(client, 'tblquotation_items', itemRecord);
        }

        const quoteNoResult = await client.query<{ quote_no: string | null }>(
          `SELECT quote_no
           FROM tblquotation
           WHERE id = $1
           LIMIT 1`,
          [quotationId],
        );

        return {
          quotationId,
          quoteNo: String(quoteNoResult.rows[0]?.quote_no ?? '').trim(),
          totalAmount,
          status,
        };
      });

      return {
        success: true,
        message: 'Quotation created successfully',
        data: result,
      };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to create quotation',
      };
    }
  }

  async findAll(query: ListQuotationQueryDto) {
    const page = this.normalizePage(query.page);
    const limit = this.normalizeLimit(query.limit);
    const offset = (page - 1) * limit;
    const search = String(query.search ?? '').trim().toLowerCase();
    const status = String(query.status ?? '').trim().toLowerCase();

    const params: unknown[] = [];
    const whereParts: string[] = [];

    if (search) {
      params.push(`%${search}%`);
      const idx = params.length;
      whereParts.push(`(
        LOWER(COALESCE(q.quote_no, '')) LIKE $${idx}
        OR LOWER(COALESCE(q.customer_name, '')) LIKE $${idx}
        OR LOWER(COALESCE(q.status, '')) LIKE $${idx}
      )`);
    }

    if (status && status !== 'all') {
      params.push(status);
      const idx = params.length;
      whereParts.push(`LOWER(COALESCE(q.status, '')) = $${idx}`);
    }

    const whereSql = whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : '';

    const countResult = await this.databaseService.query<{ total: string }>(
      `SELECT COUNT(*)::text AS total
       FROM tblquotation q
       ${whereSql}`,
      params,
    );

    const total = Number(countResult.rows[0]?.total ?? 0);

    params.push(limit);
    params.push(offset);
    const limitIndex = params.length - 1;
    const offsetIndex = params.length;

    const listResult = await this.databaseService.query<{
      id: number;
      quoteNo: string | null;
      quoteDate: string | null;
      customerId: string | null;
      customerName: string | null;
      totalAmount: string | null;
      status: string | null;
      remarks: string | null;
      convertedSalesId: string | null;
      createdAt: string | null;
    }>(
      `SELECT
         q.id,
         q.quote_no AS "quoteNo",
         q.quote_date::text AS "quoteDate",
         q.customer_id::text AS "customerId",
         q.customer_name AS "customerName",
         q.total_amount::text AS "totalAmount",
         q.status,
         q.remarks,
         q.converted_sales_id::text AS "convertedSalesId",
         q.created_at::text AS "createdAt"
       FROM tblquotation q
       ${whereSql}
       ORDER BY q.id DESC
       LIMIT $${limitIndex}
       OFFSET $${offsetIndex}`,
      params,
    );

    return {
      success: true,
      items: listResult.rows.map((row) => ({
        id: row.id,
        quoteNo: String(row.quoteNo ?? '').trim(),
        quoteDate: row.quoteDate,
        customerId: row.customerId,
        customerName: String(row.customerName ?? '').trim(),
        totalAmount: Number(row.totalAmount ?? 0),
        status: String(row.status ?? 'draft').trim() || 'draft',
        remarks: String(row.remarks ?? '').trim(),
        convertedSalesId: this.toOptionalNumber(row.convertedSalesId),
        createdAt: row.createdAt,
      })),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  async findOne(id: number) {
    if (!Number.isFinite(id) || id <= 0) {
      return { success: false, message: 'Invalid quotation id' };
    }

    const quotationResult = await this.databaseService.query<{
      id: number;
      quoteNo: string | null;
      quoteDate: string | null;
      customerId: string | null;
      customerName: string | null;
      customerAddress: string | null;
      customerContactPerson: string | null;
      customerContactNumber: string | null;
      customerEmail: string | null;
      customerTinNumber: string | null;
      totalAmount: string | null;
      status: string | null;
      remarks: string | null;
      convertedSalesId: string | null;
      createdAt: string | null;
    }>(
      `SELECT
         q.id,
         q.quote_no AS "quoteNo",
         q.quote_date::text AS "quoteDate",
         q.customer_id::text AS "customerId",
         q.customer_name AS "customerName",
         q.customer_address AS "customerAddress",
         q.customer_contact_person AS "customerContactPerson",
         q.customer_contact_number AS "customerContactNumber",
         q.customer_email AS "customerEmail",
         q.customer_tin_number AS "customerTinNumber",
         q.total_amount::text AS "totalAmount",
         q.status,
         q.remarks,
         q.converted_sales_id::text AS "convertedSalesId",
         q.created_at::text AS "createdAt"
       FROM tblquotation q
       WHERE q.id = $1
       LIMIT 1`,
      [id],
    );

    if (quotationResult.rowCount === 0) {
      return { success: false, message: 'Quotation not found' };
    }

    const itemsResult = await this.databaseService.query<{
      id: number;
      productId: string | null;
      capacityId: string | null;
      productName: string | null;
      capacityName: string | null;
      unitPrice: string | null;
      sellPrice: string | null;
      discountPrice: string | null;
      unitTypesQty: unknown;
      totalSetQty: string | null;
      lineTotal: string | null;
      remarks: string | null;
    }>(
      `SELECT
         qi.id,
         qi.product_id::text AS "productId",
         qi.capacity_id::text AS "capacityId",
         COALESCE(
           to_jsonb(p)->>'productName',
           to_jsonb(p)->>'product_name',
           to_jsonb(p)->>'productname',
           ''
         ) AS "productName",
         COALESCE(
           to_jsonb(c)->>'capacity',
           to_jsonb(c)->>'capacityValue',
           to_jsonb(c)->>'capacity_value',
           to_jsonb(c)->>'name',
           ''
         ) AS "capacityName",
         qi.unit_price::text AS "unitPrice",
         qi.sell_price::text AS "sellPrice",
         qi.discount_price::text AS "discountPrice",
         qi.unit_types_qty AS "unitTypesQty",
         qi.total_set_qty::text AS "totalSetQty",
         qi.line_total::text AS "lineTotal",
         qi.remarks
       FROM tblquotation_items qi
       LEFT JOIN tblproducts p
         ON p.id::text = qi.product_id::text
       LEFT JOIN tblcapacity c
         ON c.id::text = qi.capacity_id::text
       WHERE qi.quotation_id = $1
       ORDER BY qi.id ASC`,
      [id],
    );

    const quotation = quotationResult.rows[0];

    return {
      success: true,
      item: {
        id: quotation.id,
        quoteNo: String(quotation.quoteNo ?? '').trim(),
        quoteDate: quotation.quoteDate,
        customerId: quotation.customerId,
        customerName: String(quotation.customerName ?? '').trim(),
        customerAddress: String(quotation.customerAddress ?? '').trim(),
        customerContactPerson: String(quotation.customerContactPerson ?? '').trim(),
        customerContactNumber: String(quotation.customerContactNumber ?? '').trim(),
        customerEmail: String(quotation.customerEmail ?? '').trim(),
        customerTinNumber: String(quotation.customerTinNumber ?? '').trim(),
        totalAmount: Number(quotation.totalAmount ?? 0),
        status: String(quotation.status ?? 'draft').trim() || 'draft',
        remarks: String(quotation.remarks ?? '').trim(),
        convertedSalesId: this.toOptionalNumber(quotation.convertedSalesId),
        createdAt: quotation.createdAt,
        productItems: itemsResult.rows.map((item) => ({
          id: item.id,
          productId: item.productId,
          capacityId: item.capacityId,
          productName: String(item.productName ?? '').trim(),
          capacityName: String(item.capacityName ?? '').trim(),
          unitPrice: Number(item.unitPrice ?? 0),
          sellPrice: Number(item.sellPrice ?? 0),
          discountPrice: Number(item.discountPrice ?? 0),
          unitTypesQty: Array.isArray(item.unitTypesQty)
            ? item.unitTypesQty
            : typeof item.unitTypesQty === 'string'
              ? (() => {
                  try {
                    const parsed = JSON.parse(item.unitTypesQty);
                    return Array.isArray(parsed) ? parsed : [];
                  } catch {
                    return [];
                  }
                })()
              : [],
          totalSetQty: Number(item.totalSetQty ?? 0),
          lineTotal: Number(item.lineTotal ?? 0),
          remarks: String(item.remarks ?? '').trim(),
        })),
      },
    };
  }

  async update(id: number, updateQuotationDto: UpdateQuotationDto, userId?: number, branchId?: number) {
    if (!Number.isFinite(id) || id <= 0) {
      return { success: false, message: 'Invalid quotation id' };
    }

    const productItems = Array.isArray(updateQuotationDto.productItems)
      ? updateQuotationDto.productItems
      : [];

    try {
      const result = await this.databaseService.withTransaction(async (client) => {
        const existingResult = await client.query<{ id: number; status: string | null }>(
          `SELECT id, status FROM tblquotation WHERE id = $1 LIMIT 1`,
          [id],
        );

        if (existingResult.rowCount === 0) {
          throw new Error('Quotation not found');
        }

        const currentStatus = this.normalizeStatus(existingResult.rows[0].status);
        if (currentStatus === 'converted') {
          throw new Error('Converted quotation can no longer be edited');
        }

        const patchRecord: Record<string, unknown> = {};

        if (updateQuotationDto.quoteDate !== undefined) {
          patchRecord.quote_date = this.toIsoDateOrNull(updateQuotationDto.quoteDate) ?? new Date().toISOString();
        }
        if (updateQuotationDto.remarks !== undefined) {
          patchRecord.remarks = String(updateQuotationDto.remarks ?? '').trim();
        }
        if (updateQuotationDto.status !== undefined) {
          patchRecord.status = this.normalizeStatus(updateQuotationDto.status);
        }

        if (updateQuotationDto.customer_id !== undefined || updateQuotationDto.customer?.name) {
          const customerId = await this.upsertCustomerFromPayload(client, {
            ...updateQuotationDto,
            productItems: productItems.length > 0 ? productItems : [{ totalSetQty: 0 }],
          } as CreateQuotationDto);
          patchRecord.customer_id = this.toOptionalNumber(customerId);
          patchRecord.customer_name = String(updateQuotationDto.customer?.name ?? '').trim();
          patchRecord.customer_address = String(updateQuotationDto.customer?.address ?? '').trim();
          patchRecord.customer_contact_person = String(updateQuotationDto.customer?.contact_person ?? '').trim();
          patchRecord.customer_contact_number = String(updateQuotationDto.customer?.contact_number ?? '').trim();
          patchRecord.customer_email = String(updateQuotationDto.customer?.email ?? '').trim();
          patchRecord.customer_tin_number = String(updateQuotationDto.customer?.tin_number ?? '').trim();
        }

        if (Number.isFinite(branchId)) {
          patchRecord.branch_id = branchId;
        }

        let totalAmount = this.toOptionalNumber(updateQuotationDto.totalAmount) ?? 0;
        if (productItems.length > 0) {
          totalAmount = productItems.reduce((sum, item) => sum + this.calculateItemLineTotal(item), 0);
        }
        patchRecord.total_amount = totalAmount;

        if (Object.keys(patchRecord).length > 0) {
          const entries = Object.entries(patchRecord);
          const setClause = entries.map(([key], index) => `"${key}" = $${index + 1}`).join(', ');
          const values = entries.map(([, value]) => value);

          await client.query(
            `UPDATE tblquotation
             SET ${setClause}, updated_at = NOW()
             WHERE id = $${values.length + 1}`,
            [...values, id],
          );
        }

        if (productItems.length > 0) {
          await client.query(`DELETE FROM tblquotation_items WHERE quotation_id = $1`, [id]);

          for (const item of productItems) {
            const unitPrice = this.toOptionalNumber(item.unitPrice) ?? 0;
            const sellPrice = this.toOptionalNumber(item.sellPrice) ?? 0;
            const discountPrice = this.toOptionalNumber(item.discountPrice) ?? 0;
            const totalSetQty = this.toOptionalNumber(item.totalSetQty) ?? 0;
            const lineTotal = this.calculateItemLineTotal(item);

            await this.runInsert(client, 'tblquotation_items', {
              quotation_id: id,
              product_id: this.toOptionalNumber(item.productId),
              capacity_id: this.toOptionalNumber(item.capacityId),
              unit_price: unitPrice,
              sell_price: sellPrice,
              discount_price: discountPrice,
              unit_types_qty: JSON.stringify(item.unitTypesQty ?? []),
              total_set_qty: totalSetQty,
              line_total: lineTotal,
              remarks: String(item.remarks ?? '').trim(),
            });
          }
        }

        return {
          quotationId: id,
          totalAmount,
          status: String(patchRecord.status ?? currentStatus),
          updatedBy: Number.isFinite(userId) ? userId : null,
        };
      });

      return {
        success: true,
        message: 'Quotation updated successfully',
        data: result,
      };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to update quotation',
      };
    }
  }

  async finalize(id: number) {
    if (!Number.isFinite(id) || id <= 0) {
      return { success: false, message: 'Invalid quotation id' };
    }

    const result = await this.databaseService.query(
      `UPDATE tblquotation
       SET status = 'finalized', updated_at = NOW()
       WHERE id = $1
         AND LOWER(COALESCE(status, 'draft')) IN ('draft', 'finalized')
       RETURNING id, quote_no, status`,
      [id],
    );

    if (result.rowCount === 0) {
      return { success: false, message: 'Quotation not found or not allowed to finalize' };
    }

    return {
      success: true,
      message: 'Quotation finalized successfully',
      data: {
        quotationId: Number(result.rows[0].id),
        quoteNo: result.rows[0].quote_no,
        status: result.rows[0].status,
      },
    };
  }

  async convertToSalesOrder(id: number, userId?: number, branchId?: number) {
    if (!Number.isFinite(id) || id <= 0) {
      return { success: false, message: 'Invalid quotation id' };
    }

    try {
      const result = await this.databaseService.withTransaction(async (client) => {
        const quotationResult = await client.query<{
          id: number;
          quote_no: string | null;
          quote_date: string | null;
          customer_id: string | null;
          customer_name: string | null;
          customer_address: string | null;
          customer_contact_person: string | null;
          customer_contact_number: string | null;
          customer_email: string | null;
          customer_tin_number: string | null;
          total_amount: string | null;
          status: string | null;
          remarks: string | null;
          converted_sales_id: string | null;
        }>(
          `SELECT *
           FROM tblquotation
           WHERE id = $1
           LIMIT 1`,
          [id],
        );

        if (quotationResult.rowCount === 0) {
          throw new Error('Quotation not found');
        }

        const quotation = quotationResult.rows[0];
        const status = this.normalizeStatus(quotation.status);

        if (status === 'converted' && this.toOptionalNumber(quotation.converted_sales_id)) {
          return {
            quotationId: id,
            salesOrderId: this.toOptionalNumber(quotation.converted_sales_id),
            alreadyConverted: true,
          };
        }

        if (status !== 'finalized') {
          throw new Error('Only finalized quotations can be converted to Sales Order');
        }

        const itemsResult = await client.query<{
          id: number;
          product_id: string | null;
          capacity_id: string | null;
          unit_price: string | null;
          sell_price: string | null;
          discount_price: string | null;
          unit_types_qty: unknown;
          total_set_qty: string | null;
        }>(
          `SELECT *
           FROM tblquotation_items
           WHERE quotation_id = $1
           ORDER BY id ASC`,
          [id],
        );

        if (itemsResult.rowCount === 0) {
          throw new Error('Quotation has no line items');
        }

        const customerPayload: CreateQuotationDto = {
          customer_id: quotation.customer_id,
          customer: {
            name: String(quotation.customer_name ?? '').trim(),
            address: String(quotation.customer_address ?? '').trim(),
            contact_person: String(quotation.customer_contact_person ?? '').trim(),
            contact_number: String(quotation.customer_contact_number ?? '').trim(),
            email: String(quotation.customer_email ?? '').trim(),
            tin_number: String(quotation.customer_tin_number ?? '').trim(),
          },
          productItems: [],
        };

        const customerId = await this.upsertCustomerFromPayload(client, customerPayload);

        const salesColumns = await this.getTableColumns(client, 'tblsales_order');
        const soNumberColumn = this.pickColumn(salesColumns, ['so_number', 'soNumber']);
        const salesCustomerIdColumn = this.pickColumn(salesColumns, ['customer_id', 'customerId']);
        const totalAmountColumn = this.pickColumn(salesColumns, ['total_amount', 'totalAmount']);
        const scheduleDateColumn = this.pickColumn(salesColumns, ['scheduleDate', 'schedule_date']);
        const salesTypeColumn = this.pickColumn(salesColumns, ['salesType', 'sales_type']);
        const remarksColumn = this.pickColumn(salesColumns, ['remarks']);
        const statusColumn = this.pickColumn(salesColumns, ['status']);
        const createdByColumn = this.pickColumn(salesColumns, ['created_by', 'createdBy']);
        const branchColumn = this.pickColumn(salesColumns, ['branchId', 'branch_id']);

        if (!salesCustomerIdColumn || !totalAmountColumn || !statusColumn) {
          throw new Error('tblsales_order columns are not aligned with expected fields');
        }

        const salesRecord: Record<string, unknown> = {
          [salesCustomerIdColumn]: customerId,
          [totalAmountColumn]: this.toOptionalNumber(quotation.total_amount) ?? 0,
          [statusColumn]: 'pending',
        };

        if (soNumberColumn) {
          const sourceQuoteNo = String(quotation.quote_no ?? '').trim();
          salesRecord[soNumberColumn] = sourceQuoteNo ? `SO-${sourceQuoteNo}` : `SO-QT-${id}`;
        }
        if (scheduleDateColumn) {
          salesRecord[scheduleDateColumn] = this.toIsoDateOrNull(quotation.quote_date) ?? new Date().toISOString();
        }
        if (salesTypeColumn) {
          salesRecord[salesTypeColumn] = 'sales';
        }
        if (remarksColumn) {
          salesRecord[remarksColumn] = String(quotation.remarks ?? '').trim() || `Converted from quotation #${quotation.quote_no ?? id}`;
        }
        if (createdByColumn && Number.isFinite(userId)) {
          salesRecord[createdByColumn] = userId;
        }
        if (branchColumn && Number.isFinite(branchId)) {
          salesRecord[branchColumn] = branchId;
        }

        const insertedSales = await this.runInsert(client, 'tblsales_order', salesRecord);
        if (insertedSales.rowCount === 0) {
          throw new Error('Failed to create sales order from quotation');
        }

        const salesOrderId = Number(insertedSales.rows[0].id);

        const transactionItemColumns = await this.getTableColumns(client, 'tbltransaction_product_items');
        if (transactionItemColumns.length === 0) {
          throw new Error('tbltransaction_product_items table is missing');
        }

        const transTypeColumn = this.pickColumn(transactionItemColumns, ['transType', 'trans_type']);
        const productIdColumn = this.pickColumn(transactionItemColumns, ['productId', 'product_id']);
        const capacityIdColumn = this.pickColumn(transactionItemColumns, ['capacityId', 'capacity_id']);
        const unitPriceColumn = this.pickColumn(transactionItemColumns, ['unitPrice', 'unit_price']);
        const sellPriceColumn = this.pickColumn(transactionItemColumns, ['sellPrice', 'sell_price']);
        const discountPriceColumn = this.pickColumn(transactionItemColumns, ['discountPrice', 'discount_price']);
        const unitTypesQtyColumn = this.pickColumn(transactionItemColumns, ['unitTypesQty', 'unit_types_qty']);
        const totalSetQtyColumn = this.pickColumn(transactionItemColumns, ['totalSetQty', 'total_set_qty']);
        const purchaseIdColumn = this.pickColumn(transactionItemColumns, ['purchaseId', 'purchase_id', 'po_id']);
        const salesIdColumn = this.pickColumn(transactionItemColumns, ['salesId', 'sales_id']);
        const itemStatusColumn = this.pickColumn(transactionItemColumns, ['status']);

        for (const item of itemsResult.rows) {
          const transactionItemRecord: Record<string, unknown> = {};
          if (transTypeColumn) transactionItemRecord[transTypeColumn] = 'sales';
          if (productIdColumn) transactionItemRecord[productIdColumn] = this.toOptionalNumber(item.product_id);
          if (capacityIdColumn) transactionItemRecord[capacityIdColumn] = this.toOptionalNumber(item.capacity_id);
          if (unitPriceColumn) transactionItemRecord[unitPriceColumn] = this.toOptionalNumber(item.unit_price) ?? 0;
          if (sellPriceColumn) transactionItemRecord[sellPriceColumn] = this.toOptionalNumber(item.sell_price) ?? 0;
          if (discountPriceColumn) transactionItemRecord[discountPriceColumn] = this.toOptionalNumber(item.discount_price) ?? 0;
          if (unitTypesQtyColumn) {
            transactionItemRecord[unitTypesQtyColumn] =
              typeof item.unit_types_qty === 'string'
                ? item.unit_types_qty
                : JSON.stringify(item.unit_types_qty ?? []);
          }
          if (totalSetQtyColumn) transactionItemRecord[totalSetQtyColumn] = this.toOptionalNumber(item.total_set_qty) ?? 0;
          if (purchaseIdColumn) transactionItemRecord[purchaseIdColumn] = null;
          if (salesIdColumn) transactionItemRecord[salesIdColumn] = salesOrderId;
          if (itemStatusColumn) transactionItemRecord[itemStatusColumn] = 'pending';

          await this.runInsert(client, 'tbltransaction_product_items', transactionItemRecord);
        }

        await client.query(
          `UPDATE tblquotation
           SET status = 'converted', converted_sales_id = $1, updated_at = NOW()
           WHERE id = $2`,
          [salesOrderId, id],
        );

        return {
          quotationId: id,
          salesOrderId,
          alreadyConverted: false,
        };
      });

      return {
        success: true,
        message: result.alreadyConverted
          ? 'Quotation is already converted'
          : 'Quotation converted to Sales Order successfully',
        data: result,
      };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to convert quotation to Sales Order',
      };
    }
  }
}
