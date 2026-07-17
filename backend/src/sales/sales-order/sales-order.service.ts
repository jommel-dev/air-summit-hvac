import { BadRequestException, Injectable } from '@nestjs/common';
import { CreateSalesOrderDto } from './dto/create-sales-order.dto';
import { CreateStatementOfAccountDto } from './dto/create-statement-of-account.dto';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { UpdateSalesOrderDto } from './dto/update-sales-order.dto';
import { DatabaseService } from 'src/database/database.service';
import { PoolClient } from 'pg';
import { randomUUID } from 'crypto';
import { ListSalesOrderQueryDto } from './dto/list-sales-order-query.dto';
import { MaterialStockService } from 'src/inventory/material-stock/material-stock.service';
import { MaterialTransactionsService } from 'src/inventory/material-transactions/material-transactions.service';

import { MaterialsService } from 'src/inventory/materials/materials.service';
import { PurchaseService } from 'src/inventory/purchase/purchase.service';
import { AuditActorContext, AuditLogService } from 'src/audit-log/audit-log.service';
import { SoNumberService } from './so-number.service';

type SalesMode =
  | 'deliveries'
  | 'approvals'
  | 'master-data'
  | 'schedules'
  | 'services'
  | 'projects'
  | 'sub-dealers'
  | 'distribution'
  | 'sales-receivable'
  | 'remitted-sales';

type SalesPaymentMethod =
  | 'Cash'
  | 'Bank Transfer'
  | 'Terms'
  | 'Terms with DP'
  | 'Cheque'
  | 'Credit Card'
  | 'Installment';

type DailyReleaseSourceRow = {
  rowNumber: number;
  sourceRowNumbers: number[];
  date: string;
  dailySalesTeam: string;
  customerName: string;
  unitHp: string;
  salesName: string;
  indoorSerial: string;
  outdoorSerial: string;
  remarks: string;
};

type ProductCapacityCatalogItem = {
  productId: number;
  capacityId: number;
  brandName: string;
  productName: string;
  capacity: string;
};

@Injectable()
export class SalesOrderService {
  private readonly defaultMigrationBranchId = 1;

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly materialStockService: MaterialStockService,
    private readonly materialTransactionsService: MaterialTransactionsService,
    private readonly materialsService: MaterialsService,
    private readonly purchaseService: PurchaseService,
    private readonly auditLogService: AuditLogService,
    private readonly soNumberService: SoNumberService,
  ) {}

  async getNextSoNumber() {
    try {
      const nextSo = await this.soNumberService.peekNext(this.databaseService);
      return { success: true, nextSoNumber: nextSo };
    } catch {
      return { success: false, nextSoNumber: '' };
    }
  }

  async bulkAssignInstaller(orderIds: number[], installer: string, userId?: number) {
    if (!orderIds || orderIds.length === 0) {
      return { success: false, message: 'No orders specified' };
    }
    const cleanInstaller = String(installer ?? '').trim();
    if (!cleanInstaller) {
      return { success: false, message: 'Installer name is required' };
    }

    try {
      // Find the installer column name
      const columnsResult = await this.databaseService.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns WHERE table_name = 'tblsales_order' AND column_name IN ('installer')`,
        [],
      );
      const installerColumn = columnsResult.rows.length > 0 ? columnsResult.rows[0].column_name : 'installer';

      const result = await this.databaseService.query(
        `UPDATE tblsales_order SET "${installerColumn}" = $1 WHERE id = ANY($2::integer[])`,
        [cleanInstaller, orderIds],
      );

      return { success: true, message: `Installer assigned to ${result.rowCount} orders`, updatedCount: result.rowCount };
    } catch (error) {
      return { success: false, message: `Failed to assign installer: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  /**
   * Get all orders for a specific installer on today's date that are eligible for remitting.
   * Only returns orders with status = 'for-delivery' (the step before 'remitted').
   */
  async getInstallerOrdersForToday(installer: string, branchId?: number): Promise<{ success: boolean; orders: Array<{ id: number; soNumber: string; customerName: string; status: string }> }> {
    const cleanInstaller = String(installer ?? '').trim();
    if (!cleanInstaller) {
      return { success: false, orders: [] };
    }

    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const params: unknown[] = [cleanInstaller, today];
    const whereParts: string[] = [
      `COALESCE(to_jsonb(so)->>'installer', '') = $1`,
      `COALESCE(to_jsonb(so)->>'scheduleDate', to_jsonb(so)->>'schedule_date', '')::date = $2::date`,
      `REPLACE(REPLACE(LOWER(TRIM(COALESCE(so.status, ''))), '_', '-'), ' ', '-') = 'for-delivery'`,
    ];

    if (branchId && Number.isFinite(branchId) && branchId > 0) {
      params.push(branchId);
      whereParts.push(`COALESCE(to_jsonb(so)->>'branchId', to_jsonb(so)->>'branch_id', '')::int = $${params.length}`);
    }

    const result = await this.databaseService.query<{
      id: number;
      soNumber: string;
      customerName: string;
      status: string;
    }>(
      `SELECT
         so.id,
         COALESCE(to_jsonb(so)->>'so_number', to_jsonb(so)->>'soNumber', '') AS "soNumber",
         COALESCE(to_jsonb(c)->>'name', to_jsonb(c)->>'customer_name', '') AS "customerName",
         COALESCE(so.status, 'pending') AS status
       FROM tblsales_order so
       LEFT JOIN tblcustomer c
         ON c.id::text = COALESCE(to_jsonb(so)->>'customer_id', to_jsonb(so)->>'customerId')
       WHERE ${whereParts.join(' AND ')}
       ORDER BY so.id ASC`,
      params,
    );

    return { success: true, orders: result.rows };
  }

  /**
   * Bulk remit multiple sales orders by setting status to 'remitted'.
   * Validation:
   * - Only remits orders that are currently 'for-delivery' (not 'pending')
   * - Orders must have at least one scanned serial number
   */
  async bulkRemitSalesOrders(orderIds: number[], userId?: number): Promise<{ success: boolean; message: string; updatedCount?: number; skipped?: Array<{ id: number; soNumber: string; reason: string }> }> {
    if (!orderIds || orderIds.length === 0) {
      return { success: false, message: 'No orders specified' };
    }

    try {
      // Step 1: Validate — check status and serial count for each order
      const validationResult = await this.databaseService.query<{
        id: number;
        so_number: string;
        normalized_status: string;
        serial_count: string;
      }>(
        `SELECT
           so.id,
           COALESCE(so.so_number, '') AS so_number,
           REPLACE(REPLACE(LOWER(TRIM(COALESCE(so.status, 'pending'))), '_', '-'), ' ', '-') AS normalized_status,
           (SELECT COUNT(*)::text FROM tblserial_numbers sn
            WHERE COALESCE(to_jsonb(sn)->>'salesId', to_jsonb(sn)->>'sales_id', '')  = so.id::text
           ) AS serial_count
         FROM tblsales_order so
         WHERE so.id = ANY($1::integer[])`,
        [orderIds],
      );

      const eligible: number[] = [];
      const skipped: Array<{ id: number; soNumber: string; reason: string }> = [];

      for (const row of validationResult.rows) {
        const serialCount = parseInt(row.serial_count ?? '0', 10);
        const status = row.normalized_status;

        if (status === 'pending') {
          skipped.push({ id: row.id, soNumber: row.so_number, reason: 'Order is still in Pending status' });
        } else if (status !== 'for-delivery') {
          skipped.push({ id: row.id, soNumber: row.so_number, reason: `Order status is "${status}" (must be "for-delivery")` });
        } else if (serialCount === 0) {
          skipped.push({ id: row.id, soNumber: row.so_number, reason: 'No scanned serial numbers' });
        } else {
          eligible.push(row.id);
        }
      }

      if (eligible.length === 0) {
        const reasons = skipped.map((s) => `${s.soNumber}: ${s.reason}`).join('; ');
        return { success: false, message: `No eligible orders to remit. ${reasons}`, skipped };
      }

      // Step 2: Update only eligible orders
      const result = await this.databaseService.query(
        `UPDATE tblsales_order
         SET status = 'remitted'
         WHERE id = ANY($1::integer[])`,
        [eligible],
      );

      const updatedCount = result.rowCount ?? 0;
      let message = `${updatedCount} order(s) remitted successfully`;
      if (skipped.length > 0) {
        message += `. ${skipped.length} order(s) skipped.`;
      }

      return { success: true, message, updatedCount, skipped };
    } catch (error) {
      return { success: false, message: `Failed to remit orders: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  private async getSalesOrderAuditSnapshot(id: number): Promise<Record<string, unknown> | null> {
    const result = await this.findOne(id);
    if (!result.success || !result.item || typeof result.item !== 'object') {
      return null;
    }

    return result.item as Record<string, unknown>;
  }

  private resolveSalesOrderUpdateAuditAction(
    before: Record<string, unknown> | null,
    after: Record<string, unknown> | null,
    payload: UpdateSalesOrderDto,
  ): { action: string; description: string } {
    const beforeStatus = this.normalizeWorkflowStatus(before?.status);
    const afterStatus = this.normalizeWorkflowStatus(after?.status);
    const remarks = String(payload.remarks ?? after?.remarks ?? '').trim().toLowerCase();
    const soNumber = String(after?.soNumber ?? before?.soNumber ?? '').trim();
    const salesLabel = soNumber || `#${String(after?.id ?? before?.id ?? '')}`;

    if (afterStatus === 'for-delivery' && beforeStatus !== 'for-delivery') {
      return {
        action: 'SALES_ORDER_SEND_FOR_DELIVERY',
        description: `Sent sales order ${salesLabel} for delivery`,
      };
    }

    if (
      afterStatus === 'returned' ||
      afterStatus === 'return' ||
      Boolean(payload.returnedSerialDetails) ||
      remarks.startsWith('returned units:')
    ) {
      return {
        action: 'SALES_ORDER_RETURN_UNITS',
        description: `Processed returned units for sales order ${salesLabel}`,
      };
    }

    if (
      ['complete', 'completed'].includes(afterStatus) &&
      remarks.includes('marked as received from sales receivable table')
    ) {
      return {
        action: 'SALES_ORDER_RECEIVE_SALES',
        description: `Marked sales order ${salesLabel} as received`,
      };
    }

    if (afterStatus === 'cancelled' && beforeStatus !== 'cancelled') {
      return {
        action: 'SALES_ORDER_CANCEL',
        description: `Cancelled sales order ${salesLabel} and released linked serials to in-stock`,
      };
    }

    if (
      ['remitted', 'complete', 'completed'].includes(afterStatus) &&
      beforeStatus !== afterStatus
    ) {
      return {
        action: 'SALES_ORDER_REMIT_SALES',
        description: `Updated remittance state for sales order ${salesLabel}`,
      };
    }

    return {
      action: 'SALES_ORDER_UPDATE',
      description: `Updated sales order ${salesLabel}`,
    };
  }

  private async getTableColumns(
    executor: { query: PoolClient['query'] },
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
    const lower = new Set(availableColumns.map((c) => c.toLowerCase()));
    return candidates.find((candidate) => lower.has(candidate.toLowerCase()));
  }

  private async runInsert(
    executor: { query: PoolClient['query'] },
    tableName: string,
    record: Record<string, unknown>,
  ) {
    const columns = Object.keys(record);
    const values = Object.values(record);
    const quotedColumns = columns.map((column) => `"${column}"`).join(', ');
    const placeholders = values.map((_, index) => `$${index + 1}`).join(', ');

    return executor.query<{ id: number | string }>(
      `INSERT INTO ${tableName} (${quotedColumns}) VALUES (${placeholders}) RETURNING id`,
      values,
    );
  }

  private toOptionalNumber(value: unknown): number | null {
    if (value === null || value === undefined || value === '') {
      return null;
    }

    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private normalizeText(value: unknown): string {
    return String(value ?? '').trim();
  }

  private async updateCustomerTypeIfNeeded(
    executor: { query: PoolClient['query'] },
    customerId: string,
    customerTypeColumn: string | undefined,
    customerType: string,
  ): Promise<void> {
    if (!customerId || !customerTypeColumn || !customerType) {
      return;
    }

    await executor.query(
      `UPDATE tblcustomer SET "${customerTypeColumn}" = $1 WHERE id::text = $2`,
      [customerType, customerId],
    );
  }

  private async updateExistingCustomerDetails(
    executor: { query: PoolClient['query'] },
    customerId: string,
    customer: { name?: string; address?: string; contact_person?: string; contact_number?: string; email?: string; tin_number?: string } | undefined,
    customerColumns: string[],
  ): Promise<void> {
    if (!customerId || !customer) {
      return;
    }

    const nameColumn = this.pickColumn(customerColumns, ['name', 'customer_name']);
    const addressColumn = this.pickColumn(customerColumns, ['address']);
    const contactPersonColumn = this.pickColumn(customerColumns, ['contact_person', 'contactPerson']);
    const contactNumberColumn = this.pickColumn(customerColumns, ['contact_number', 'contactNumber']);
    const emailColumn = this.pickColumn(customerColumns, ['email']);
    const tinColumn = this.pickColumn(customerColumns, ['tin_number', 'tinNumber']);

    const updates: string[] = [];
    const values: unknown[] = [];

    const tryUpdate = (column: string | undefined, value: unknown) => {
      if (!column) return;
      const text = this.normalizeText(value as string);
      if (!text) return;
      values.push(text);
      updates.push(`"${column}" = $${values.length}`);
    };

    tryUpdate(nameColumn, customer.name);
    tryUpdate(addressColumn, customer.address);
    tryUpdate(contactPersonColumn, customer.contact_person);
    tryUpdate(contactNumberColumn, customer.contact_number);
    tryUpdate(emailColumn, customer.email);
    tryUpdate(tinColumn, customer.tin_number);

    if (updates.length === 0) {
      return;
    }

    values.push(customerId);
    await executor.query(
      `UPDATE tblcustomer SET ${updates.join(', ')} WHERE id::text = $${values.length}`,
      values,
    );
  }

  private async upsertCustomerFromPayload(
    executor: { query: PoolClient['query'] },
    payload: Pick<CreateSalesOrderDto, 'customer_id' | 'customer'>,
  ): Promise<string> {
    let customerId = this.normalizeText(payload.customer_id);

    const customerColumns = await this.getTableColumns(executor, 'tblcustomer');
    const customerIdColumn = this.pickColumn(customerColumns, ['id']);
    const customerNameColumn = this.pickColumn(customerColumns, ['name', 'customer_name']);
    const customerTypeColumn = this.pickColumn(customerColumns, ['customer_type', 'customerType']);
    const customerAddressColumn = this.pickColumn(customerColumns, ['address']);
    const customerContactPersonColumn = this.pickColumn(customerColumns, ['contact_person', 'contactPerson']);
    const customerContactNumberColumn = this.pickColumn(customerColumns, ['contact_number', 'contactNumber']);
    const customerEmailColumn = this.pickColumn(customerColumns, ['email']);
    const customerTinColumn = this.pickColumn(customerColumns, ['tin_number', 'tinNumber']);
    const requestedCustomerType = this.normalizeText(payload.customer?.customer_type);

    if (customerId) {
      const existingCustomer = await executor.query<{ id: string }>(
        `SELECT id FROM tblcustomer WHERE id::text = $1 LIMIT 1`,
        [customerId],
      );

      if (existingCustomer.rowCount > 0) {
        // Update customer details if any changes are provided
        await this.updateExistingCustomerDetails(
          executor,
          customerId,
          payload.customer,
          customerColumns,
        );
        await this.updateCustomerTypeIfNeeded(
          executor,
          customerId,
          customerTypeColumn,
          requestedCustomerType,
        );
        return customerId;
      }

      customerId = '';
    }

    const customerName = this.normalizeText(payload.customer?.name);
    if (!customerName) {
      throw new Error('customer_id or customer.name is required');
    }
    if (!customerNameColumn) {
      throw new Error('tblcustomer name column is missing');
    }

    const customerAddress = this.normalizeText(payload.customer?.address);
    const customerContactPerson = this.normalizeText(payload.customer?.contact_person);
    const customerContactNumber = this.normalizeText(payload.customer?.contact_number);
    const customerEmail = this.normalizeText(payload.customer?.email);
    const customerTin = this.normalizeText(payload.customer?.tin_number);

    const duplicateParams: string[] = [customerName];
    const duplicateWhere = [
      `LOWER(TRIM(COALESCE("${customerNameColumn}"::text, ''))) = LOWER(TRIM($1))`,
    ];

    if (customerAddressColumn && customerAddress) {
      duplicateParams.push(customerAddress);
      duplicateWhere.push(
        `LOWER(TRIM(COALESCE("${customerAddressColumn}"::text, ''))) = LOWER(TRIM($${duplicateParams.length}))`,
      );
    }
    if (customerContactPersonColumn && customerContactPerson) {
      duplicateParams.push(customerContactPerson);
      duplicateWhere.push(
        `LOWER(TRIM(COALESCE("${customerContactPersonColumn}"::text, ''))) = LOWER(TRIM($${duplicateParams.length}))`,
      );
    }
    if (customerContactNumberColumn && customerContactNumber) {
      duplicateParams.push(customerContactNumber);
      duplicateWhere.push(
        `LOWER(TRIM(COALESCE("${customerContactNumberColumn}"::text, ''))) = LOWER(TRIM($${duplicateParams.length}))`,
      );
    }
    if (customerEmailColumn && customerEmail) {
      duplicateParams.push(customerEmail);
      duplicateWhere.push(
        `LOWER(TRIM(COALESCE("${customerEmailColumn}"::text, ''))) = LOWER(TRIM($${duplicateParams.length}))`,
      );
    }
    if (customerTinColumn && customerTin) {
      duplicateParams.push(customerTin);
      duplicateWhere.push(
        `LOWER(TRIM(COALESCE("${customerTinColumn}"::text, ''))) = LOWER(TRIM($${duplicateParams.length}))`,
      );
    }

    const duplicateCustomer = await executor.query<{ id: string }>(
      `SELECT id::text AS id
       FROM tblcustomer
       WHERE ${duplicateWhere.join(' AND ')}
       ORDER BY id ASC
       LIMIT 1`,
      duplicateParams,
    );

    if (duplicateCustomer.rowCount > 0) {
      customerId = this.normalizeText(duplicateCustomer.rows[0]?.id);
      await this.updateCustomerTypeIfNeeded(
        executor,
        customerId,
        customerTypeColumn,
        requestedCustomerType,
      );
      return customerId;
    }

    const customerRecord: Record<string, unknown> = {
      [customerNameColumn]: customerName,
    };

    if (customerIdColumn) {
      customerRecord[customerIdColumn] = randomUUID();
    }
    if (customerAddressColumn && customerAddress) {
      customerRecord[customerAddressColumn] = customerAddress;
    }
    if (customerContactPersonColumn && customerContactPerson) {
      customerRecord[customerContactPersonColumn] = customerContactPerson;
    }
    if (customerContactNumberColumn && customerContactNumber) {
      customerRecord[customerContactNumberColumn] = customerContactNumber;
    }
    if (customerEmailColumn && customerEmail) {
      customerRecord[customerEmailColumn] = customerEmail;
    }
    if (customerTinColumn && customerTin) {
      customerRecord[customerTinColumn] = customerTin;
    }
    if (customerTypeColumn && requestedCustomerType) {
      customerRecord[customerTypeColumn] = requestedCustomerType;
    }

    const insertedCustomer = await this.runInsert(executor, 'tblcustomer', customerRecord);
    if (insertedCustomer.rowCount === 0) {
      throw new Error('Failed to create customer');
    }

    return this.normalizeText(insertedCustomer.rows[0]?.id);
  }

  private async upsertProjectFromPayload(
    executor: { query: PoolClient['query'] },
    payload: Pick<CreateSalesOrderDto, 'projectId' | 'projectDetails' | 'projectCode' | 'projectName'>,
    userId?: number,
    branchId?: number,
  ): Promise<number | null> {
    // If projectId is provided, use it directly
    if (payload.projectId) {
      return payload.projectId;
    }

    // If no project details, return null
    if (!payload.projectDetails && !payload.projectCode && !payload.projectName) {
      return null;
    }

    const projectCode = this.normalizeText(payload.projectCode || payload.projectDetails?.projectCode);
    const projectName = this.normalizeText(
      payload.projectName || payload.projectDetails?.projectName || projectCode,
    );

    if (!projectCode || !projectName) {
      throw new Error('Project code and name are required');
    }

    // Look up existing project by code
    const existingProject = await executor.query<{ id: number }>(
      `SELECT id FROM tblprojects WHERE project_code = $1 LIMIT 1`,
      [projectCode],
    );

    if (existingProject.rowCount > 0) {
      return existingProject.rows[0].id;
    }

    // Create new project if not found
    const projectColumns = await this.getTableColumns(executor, 'tblprojects');
    const projectCodeColumn = this.pickColumn(projectColumns, ['project_code']);
    const projectNameColumn = this.pickColumn(projectColumns, ['project_name']);
    const projectTypeColumn = this.pickColumn(projectColumns, ['project_type']);
    const projectOwnerColumn = this.pickColumn(projectColumns, ['project_owner']);
    const projectLocationColumn = this.pickColumn(projectColumns, ['project_location']);
    const projectStartDateColumn = this.pickColumn(projectColumns, ['project_start_date']);
    const projectEndDateColumn = this.pickColumn(projectColumns, ['project_end_date']);
    const projectManagerColumn = this.pickColumn(projectColumns, ['project_manager']);
    const projectStatusColumn = this.pickColumn(projectColumns, ['project_status']);
    const projectNotesColumn = this.pickColumn(projectColumns, ['project_notes']);
    const branchIdColumn = this.pickColumn(projectColumns, ['branch_id']);
    const createdByColumn = this.pickColumn(projectColumns, ['created_by']);

    if (!projectCodeColumn || !projectNameColumn) {
      throw new Error('tblprojects columns are not properly configured');
    }

    const projectRecord: Record<string, unknown> = {
      [projectCodeColumn]: projectCode,
      [projectNameColumn]: projectName,
    };

    if (projectTypeColumn && payload.projectDetails?.projectType) {
      projectRecord[projectTypeColumn] = this.normalizeText(
        payload.projectDetails.projectType,
      );
    }
    if (projectOwnerColumn && payload.projectDetails?.projectOwner) {
      projectRecord[projectOwnerColumn] = this.normalizeText(payload.projectDetails.projectOwner);
    }
    if (projectLocationColumn && payload.projectDetails?.projectLocation) {
      projectRecord[projectLocationColumn] = this.normalizeText(
        payload.projectDetails.projectLocation,
      );
    }
    if (projectStartDateColumn && payload.projectDetails?.projectStartDate) {
      projectRecord[projectStartDateColumn] = this.toIsoDateOrNull(
        payload.projectDetails.projectStartDate,
      );
    }
    if (projectEndDateColumn && payload.projectDetails?.projectEndDate) {
      projectRecord[projectEndDateColumn] = this.toIsoDateOrNull(
        payload.projectDetails.projectEndDate,
      );
    }
    if (projectManagerColumn && payload.projectDetails?.projectManager) {
      projectRecord[projectManagerColumn] = this.normalizeText(
        payload.projectDetails.projectManager,
      );
    }
    if (projectStatusColumn) {
      const status = this.normalizeText(
        payload.projectDetails?.projectStatus || 'planning',
      ).toLowerCase();
      const validStatuses = ['planning', 'ongoing', 'completed', 'cancelled'];
      projectRecord[projectStatusColumn] = validStatuses.includes(status) ? status : 'planning';
    }
    if (projectNotesColumn && payload.projectDetails?.projectNotes) {
      projectRecord[projectNotesColumn] = this.normalizeText(payload.projectDetails.projectNotes);
    }
    if (branchIdColumn && branchId) {
      projectRecord[branchIdColumn] = branchId;
    }
    if (createdByColumn && userId) {
      projectRecord[createdByColumn] = userId;
    }

    const insertedProject = await this.runInsert(executor, 'tblprojects', projectRecord);
    if (insertedProject.rowCount === 0) {
      throw new Error('Failed to create project');
    }

    return Number(insertedProject.rows[0]?.id);
  }

  private toIsoDateOrNull(value: unknown): string | null {
    if (!value) {
      return null;
    }

    const raw = String(value).trim();
    const ddMmYyyyMatch = raw.match(/^(\d{2})[\/-](\d{2})[\/-](\d{4})$/);
    if (ddMmYyyyMatch) {
      const day = Number(ddMmYyyyMatch[1]);
      const month = Number(ddMmYyyyMatch[2]);
      const year = Number(ddMmYyyyMatch[3]);
      const parsed = new Date(Date.UTC(year, month - 1, day));
      if (!Number.isNaN(parsed.getTime())) {
        return parsed.toISOString();
      }
    }

    const date = new Date(raw);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  private normalizeSerialNumber(value: unknown): string {
    return String(value ?? '')
      .trim()
      .replace(/\s+/g, ' ');
  }

  private isMigrationSerialPlaceholder(value: unknown): boolean {
    const raw = this.normalizeSerialNumber(value).toLowerCase();
    if (!raw) {
      return true;
    }

    const compact = raw.replace(/[^a-z0-9]/g, '');
    const placeholders = new Set([
      'na',
      'none',
      'null',
      'nil',
      'noserial',
      'unknown',
      'tbd',
      'return',
      'indooronly',
      'outdooronly',
      '-',
    ]);

    return placeholders.has(compact);
  }

  private splitMigrationSerialValues(value: unknown): { valid: string[]; ignored: string[] } {
    const tokens = String(value ?? '')
      .split(/[,;]/)
      .map((entry) => this.normalizeSerialNumber(entry))
      .filter((entry) => entry.length > 0);

    const valid: string[] = [];
    const ignored: string[] = [];

    for (const token of tokens) {
      if (this.isMigrationSerialPlaceholder(token)) {
        ignored.push(token);
      } else {
        valid.push(token);
      }
    }

    return { valid, ignored };
  }

  private sanitizeMigrationPayloadSerials(payload: CreateSalesOrderDto): CreateSalesOrderDto {
    const cloned = {
      ...payload,
      productItems: Array.isArray(payload.productItems)
        ? payload.productItems.map((item) => {
            const serialPayload =
              item?.serialNumbers && typeof item.serialNumbers === 'object'
                ? (item.serialNumbers as Record<string, unknown>)
                : {};

            const nextSerialPayload: Record<string, unknown> = {};
            for (const [key, value] of Object.entries(serialPayload)) {
              if (key.toLowerCase() === 'status') {
                nextSerialPayload[key] = value;
                continue;
              }

              const values = Array.isArray(value) ? value : [];
              const sanitized = values
                .map((entry) => this.normalizeSerialNumber(entry))
                .filter((entry) => entry.length > 0 && !this.isMigrationSerialPlaceholder(entry));

              if (sanitized.length > 0) {
                nextSerialPayload[key] = sanitized;
              }
            }

            return {
              ...item,
              serialNumbers: nextSerialPayload,
            };
          })
        : [],
    };

    return cloned as CreateSalesOrderDto;
  }

  private toSalesPaymentMethod(value: unknown): SalesPaymentMethod {
    const normalized = String(value ?? '')
      .trim()
      .toLowerCase();

    if (normalized === 'cash') return 'Cash';
    if (normalized === 'bank transfer' || normalized === 'bank_transfer') return 'Bank Transfer';
    if (normalized === 'terms') return 'Terms';
    if (normalized === 'terms with dp' || normalized === 'terms_with_dp') return 'Terms with DP';
    if (normalized === 'cheque' || normalized === 'check') return 'Cheque';
    if (normalized === 'credit card' || normalized === 'credit_card') return 'Credit Card';
    if (normalized === 'installment') return 'Installment';

    throw new BadRequestException(`Invalid payment method: ${String(value ?? '')}`);
  }

  private hasPaymentValue(value: unknown): boolean {
    if (value === null || value === undefined) {
      return false;
    }

    if (typeof value === 'number') {
      if (!Number.isFinite(value)) {
        return false;
      }

      return value !== 0;
    }

    if (typeof value === 'string') {
      return value.trim().length > 0;
    }

    return true;
  }

  private getAutoPaymentStatus(method: SalesPaymentMethod): string {
    if (method === 'Cash' || method === 'Bank Transfer') {
      return 'paid';
    }

    return 'unpaid';
  }

  private normalizeHeaderKey(value: unknown): string {
    return String(value ?? '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
  }

  private pickRowField(row: Record<string, unknown>, aliases: string[]): string {
    const normalizedAliases = new Set(aliases.map((alias) => this.normalizeHeaderKey(alias)));
    for (const [key, value] of Object.entries(row)) {
      if (normalizedAliases.has(this.normalizeHeaderKey(key))) {
        return String(value ?? '').trim();
      }
    }

    return '';
  }

  private normalizeMigrationSourceRow(raw: Record<string, unknown>, rowNumber: number): DailyReleaseSourceRow {
    return {
      rowNumber,
      sourceRowNumbers: [rowNumber],
      date: this.pickRowField(raw, ['date', 'release_date']),
      dailySalesTeam: this.pickRowField(raw, ['daily sales/team', 'daily_sales_team', 'team']),
      customerName: this.pickRowField(raw, ['customer name', 'customer_name', 'customer']),
      unitHp: this.pickRowField(raw, ['unit/hp', 'unit_hp', 'unit']),
      salesName: this.pickRowField(raw, ['sales name', 'sales_name', 'sales']),
      indoorSerial: this.pickRowField(raw, ['indoor serial', 'indoor_serial', 'indoor']),
      outdoorSerial: this.pickRowField(raw, ['outdoor serial', 'outdoor_serial', 'outdoor']),
      remarks: this.pickRowField(raw, ['remarks', 'note', 'notes']),
    };
  }

  private aggregateMigrationSourceRows(rows: Array<Record<string, unknown>>): DailyReleaseSourceRow[] {
    const groups = new Map<
      string,
      {
        source: DailyReleaseSourceRow;
        indoorSerials: string[];
        outdoorSerials: string[];
      }
    >();

    const splitSerialRaw = (value: string): string[] =>
      String(value ?? '')
        .split(/[,;]/)
        .map((entry) => this.normalizeSerialNumber(entry))
        .filter((entry) => entry.length > 0);

    const keyFor = (source: DailyReleaseSourceRow): string =>
      [
        source.date,
        source.dailySalesTeam,
        source.customerName,
        source.unitHp,
        source.salesName,
        source.remarks,
      ]
        .map((value) => String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' '))
        .join('|');

    for (let index = 0; index < rows.length; index++) {
      const source = this.normalizeMigrationSourceRow(rows[index] ?? {}, index + 1);
      const key = keyFor(source);
      const indoorSerials = splitSerialRaw(source.indoorSerial);
      const outdoorSerials = splitSerialRaw(source.outdoorSerial);

      const existing = groups.get(key);
      if (!existing) {
        groups.set(key, {
          source: {
            ...source,
            sourceRowNumbers: [source.rowNumber],
          },
          indoorSerials,
          outdoorSerials,
        });
        continue;
      }

      existing.source.sourceRowNumbers.push(source.rowNumber);
      existing.indoorSerials.push(...indoorSerials);
      existing.outdoorSerials.push(...outdoorSerials);
    }

    return [...groups.values()].map((entry) => {
      const uniqueIndoor = [...new Set(entry.indoorSerials)];
      const uniqueOutdoor = [...new Set(entry.outdoorSerials)];

      return {
        ...entry.source,
        rowNumber: entry.source.sourceRowNumbers[0],
        sourceRowNumbers: [...entry.source.sourceRowNumbers],
        indoorSerial: uniqueIndoor.join(', '),
        outdoorSerial: uniqueOutdoor.join(', '),
      };
    });
  }

  private normalizeCapacityKey(raw: string): string {
    const source = String(raw ?? '').trim().toUpperCase().replace(/\s+/g, ' ');
    const capacityMatch = source.match(/^(\d+(?:\.\d+)?)\s*(HP|TR)\b$/);
    if (!capacityMatch) {
      return '';
    }

    const numericValue = Number(capacityMatch[1]);
    if (!Number.isFinite(numericValue)) {
      return '';
    }

    const normalizedNumber = Number.isInteger(numericValue)
      ? numericValue.toFixed(1)
      : `${numericValue}`;

    return `${normalizedNumber}${capacityMatch[2]}`;
  }

  private parseUnitHp(raw: string): { capacityKey: string; productHint: string } {
    const normalized = String(raw ?? '').trim();
    if (!normalized) {
      return { capacityKey: '', productHint: '' };
    }

    const leadingCapacityMatch = normalized.match(/^(\d+(?:\.\d+)?)\s*(HP|TR)\b\s*(.*)$/i);
    if (leadingCapacityMatch) {
      const trailingHint = String(leadingCapacityMatch[3] ?? '').trim().toLowerCase();
      return {
        capacityKey: this.normalizeCapacityKey(`${leadingCapacityMatch[1]}${leadingCapacityMatch[2]}`),
        productHint: trailingHint,
      };
    }

    const trailingCapacityMatch = normalized.match(/^(.*?)\s*(\d+(?:\.\d+)?)\s*(HP|TR)\b$/i);
    if (trailingCapacityMatch) {
      const leadingHint = String(trailingCapacityMatch[1] ?? '').trim().toLowerCase();
      return {
        capacityKey: this.normalizeCapacityKey(`${trailingCapacityMatch[2]}${trailingCapacityMatch[3]}`),
        productHint: leadingHint,
      };
    }

    const parts = normalized.split('/');
    const left = String(parts[0] ?? '').trim();
    const right = String(parts.slice(1).join('/') ?? '').trim();

    return {
      capacityKey: this.normalizeCapacityKey(left),
      productHint: right.toLowerCase(),
    };
  }

  private parseMultipleUnitHp(raw: string): Array<{ capacityKey: string; productHint: string }> {
    const normalized = String(raw ?? '').trim();
    if (!normalized) return [{ capacityKey: '', productHint: '' }];

    // No slash — allow both capacity-first and capacity-last patterns.
    if (!normalized.includes('/')) {
      return [this.parseUnitHp(normalized)];
    }

    // Walk slash-separated parts; each HP/TR token starts a new spec
    const parts = normalized.split('/');
    const specs: Array<{ capacityKey: string; productHint: string }> = [];
    let currentCapacityRaw = '';
    let currentHintParts: string[] = [];

    const flushSpec = (): void => {
      if (currentCapacityRaw) {
        specs.push({
          capacityKey: this.normalizeCapacityKey(currentCapacityRaw),
          productHint: currentHintParts.join(' ').trim().toLowerCase(),
        });
      }
    };

    for (const part of parts) {
      const trimmed = part.trim();
      if (/^\d+(\.\d+)?\s*(HP|TR)/i.test(trimmed)) {
        flushSpec();
        currentCapacityRaw = trimmed;
        currentHintParts = [];
      } else {
        currentHintParts.push(trimmed);
      }
    }
    flushSpec();

    return specs.length > 0 ? specs : [{ capacityKey: this.normalizeCapacityKey(normalized), productHint: '' }];
  }

  private normalizeMigrationUnitType(value: unknown): string {
    const raw = String(value ?? '').trim().toLowerCase();
    if (!raw) return '';
    if (raw.includes('indoor')) return 'indoor';
    if (raw.includes('outdoor')) return 'outdoor';
    if (raw.includes('window')) return 'window';
    if (raw.includes('set')) return 'set';
    return raw;
  }

  private async loadSerialUnitTypeMap(serials: string[]): Promise<Map<string, string>> {
    const normalizedSerials = [...new Set(
      (serials ?? [])
        .map((serial) => this.normalizeSerialNumber(serial).toLowerCase())
        .filter((serial) => serial.length > 0),
    )];

    const map = new Map<string, string>();
    if (normalizedSerials.length === 0) {
      return map;
    }

    const serialColumns = await this.getTableColumns(this.databaseService, 'tblserial_numbers');
    const serialNumberColumn = this.pickColumn(serialColumns, ['serialNumber', 'serial_number']);
    const serialUnitTypeColumn = this.pickColumn(serialColumns, ['unitType', 'unit_type']);

    if (!serialNumberColumn || !serialUnitTypeColumn) {
      return map;
    }

    const result = await this.databaseService.query<{ serial: string; unit_type: string | null }>(
      `SELECT
         LOWER(regexp_replace(BTRIM(COALESCE("${serialNumberColumn}"::text, '')), '\\s+', ' ', 'g')) AS serial,
         COALESCE("${serialUnitTypeColumn}"::text, '') AS unit_type
       FROM tblserial_numbers
       WHERE LOWER(regexp_replace(BTRIM(COALESCE("${serialNumberColumn}"::text, '')), '\\s+', ' ', 'g')) = ANY($1::text[])`,
      [normalizedSerials],
    );

    for (const row of result.rows) {
      const serial = this.normalizeSerialNumber(row.serial).toLowerCase();
      const unitType = this.normalizeMigrationUnitType(row.unit_type);
      if (serial && unitType) {
        map.set(serial, unitType);
      }
    }

    return map;
  }

  private async loadSerialInventoryDetails(serials: string[]): Promise<Map<string, { serial: string; status: string; salesId: string | null }>> {
    const normalizedSerials = [...new Set(
      (serials ?? [])
        .map((serial) => this.normalizeSerialNumber(serial).toLowerCase())
        .filter((serial) => serial.length > 0),
    )];

    const map = new Map<string, { serial: string; status: string; salesId: string | null }>();
    if (normalizedSerials.length === 0) {
      return map;
    }

    const serialColumns = await this.getTableColumns(this.databaseService, 'tblserial_numbers');
    const serialNumberColumn = this.pickColumn(serialColumns, ['serialNumber', 'serial_number']);
    const serialStatusColumn = this.pickColumn(serialColumns, ['status']);
    const serialSalesIdColumn = this.pickColumn(serialColumns, ['salesId', 'sales_id']);

    if (!serialNumberColumn) {
      return map;
    }

    const statusSelect = serialStatusColumn ? `COALESCE("${serialStatusColumn}"::text, '')` : `''`;
    const salesIdSelect = serialSalesIdColumn ? `"${serialSalesIdColumn}"::text` : `NULL`;

    const result = await this.databaseService.query<{ serial: string; status: string; sales_id: string | null }>(
      `SELECT
         LOWER(regexp_replace(BTRIM(COALESCE("${serialNumberColumn}"::text, '')), '\\s+', ' ', 'g')) AS serial,
         ${statusSelect} AS status,
         ${salesIdSelect} AS sales_id
       FROM tblserial_numbers
       WHERE LOWER(regexp_replace(BTRIM(COALESCE("${serialNumberColumn}"::text, '')), '\\s+', ' ', 'g')) = ANY($1::text[])`,
      [normalizedSerials],
    );

    for (const row of result.rows) {
      const normalizedSerial = this.normalizeSerialNumber(row.serial).toLowerCase();
      if (!normalizedSerial) {
        continue;
      }

      map.set(normalizedSerial, {
        serial: row.serial,
        status: String(row.status ?? '').trim().toLowerCase(),
        salesId: row.sales_id,
      });
    }

    return map;
  }

  private inferPaymentMethodFromRemarks(remarks: string): SalesPaymentMethod | undefined {
    const text = String(remarks ?? '').trim().toLowerCase();
    if (!text) return undefined;

    if (text.includes('cash')) return 'Cash';
    if (text.includes('bank transfer') || text.includes('online') || text.includes('gcash')) return 'Bank Transfer';
    if (text.includes('terms with dp') || text.includes(' dp')) return 'Terms with DP';
    if (text.includes('terms')) return 'Terms';
    if (text.includes('cheque') || text.includes('check')) return 'Cheque';
    if (text.includes('credit card') || text.includes('credit')) return 'Credit Card';
    if (text.includes('installment')) return 'Installment';

    return undefined;
  }

  private getMigrationOnlyModeFromRemarks(remarks: string): 'indoor' | 'outdoor' | null {
    const text = String(remarks ?? '').trim().toLowerCase();
    if (!text) return null;

    if (text.includes('indoor only')) return 'indoor';
    if (text.includes('outdoor only')) return 'outdoor';

    return null;
  }

  private inferSalesTypeFromTeam(team: string): string {
    const normalized = String(team ?? '').trim().toLowerCase();
    if (normalized.includes('sub dealer') || normalized.includes('sub-dealer')) {
      return 'sub-dealer';
    }
    return 'sales';
  }

  private async loadProductCapacityCatalog(): Promise<ProductCapacityCatalogItem[]> {
    const result = await this.databaseService.query<{
      productId: string;
      capacityId: string;
      brandName: string | null;
      productName: string | null;
      capacity: string | null;
    }>(
      `SELECT
         p.id::text AS "productId",
         c.id::text AS "capacityId",
         COALESCE(to_jsonb(b)->>'name', to_jsonb(b)->>'brandName', to_jsonb(b)->>'brand_name', '') AS "brandName",
         COALESCE(to_jsonb(p)->>'productName', to_jsonb(p)->>'product_name', '') AS "productName",
         COALESCE(to_jsonb(c)->>'capacity', '') AS "capacity"
       FROM tblcapacity c
       JOIN tblproducts p
         ON p.id::text = COALESCE(
           to_jsonb(c)->>'prodId',
           to_jsonb(c)->>'prod_id',
           to_jsonb(c)->>'productId',
           to_jsonb(c)->>'product_id'
         )
       LEFT JOIN tblbrands b
         ON b.id::text = COALESCE(to_jsonb(p)->>'brandId', to_jsonb(p)->>'brand_id')`,
    );

    return result.rows
      .map((row) => ({
        productId: Number(row.productId),
        capacityId: Number(row.capacityId),
        brandName: String(row.brandName ?? '').trim(),
        productName: String(row.productName ?? '').trim(),
        capacity: String(row.capacity ?? '').trim(),
      }))
      .filter((row) => Number.isFinite(row.productId) && Number.isFinite(row.capacityId));
  }

  private async loadCustomerNameMap(): Promise<Map<string, string>> {
    const result = await this.databaseService.query<{ id: string; name: string | null }>(
      `SELECT
         c.id::text AS id,
         COALESCE(to_jsonb(c)->>'name', to_jsonb(c)->>'customer_name', '') AS name
       FROM tblcustomer c`,
    );

    const map = new Map<string, string>();
    for (const row of result.rows) {
      const key = String(row.name ?? '').trim().toLowerCase();
      if (key) {
        map.set(key, row.id);
      }
    }

    return map;
  }

  private async loadBranchNameMap(): Promise<Map<string, { id: number; branchName: string }>> {
    const result = await this.databaseService.query<{ id: number; branchName: string | null }>(
      `SELECT
         id,
         COALESCE("branchName", '') AS "branchName"
       FROM tblbranches`,
    );

    const map = new Map<string, { id: number; branchName: string }>();
    for (const row of result.rows) {
      const key = String(row.branchName ?? '').trim().toLowerCase();
      if (!key) {
        continue;
      }

      map.set(key, {
        id: Number(row.id),
        branchName: String(row.branchName ?? '').trim(),
      });
    }

    return map;
  }

  private findBestCatalogMatch(
    catalog: ProductCapacityCatalogItem[],
    capacityKey: string,
    productHint: string,
  ): { match: ProductCapacityCatalogItem | null; ambiguous: boolean } {
    const sameCapacity = catalog.filter((item) => this.normalizeCapacityKey(item.capacity) === capacityKey);
    if (sameCapacity.length === 0) {
      return { match: null, ambiguous: false };
    }

    if (!productHint) {
      return { match: null, ambiguous: sameCapacity.length > 1 };
    }

    const normalizeMatcherText = (value: string): string =>
      String(value ?? '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
        .replace(/\s+/g, ' ');
    const canonicalToken = (token: string): string => {
      const normalized = String(token ?? '').toLowerCase().trim();
      if (normalized.length > 4 && normalized.endsWith('es')) {
        return normalized.slice(0, -2);
      }
      if (normalized.length > 3 && normalized.endsWith('s')) {
        return normalized.slice(0, -1);
      }
      return normalized;
    };
    const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    const normalizedHint = normalizeMatcherText(productHint);
    const hintTokensRaw = normalizedHint
      .split(' ')
      .filter((token) => token.length > 0);
    const hintTokens = [...new Set(hintTokensRaw.map(canonicalToken).filter((token) => token.length > 0))];
    const hintTokenSet = new Set(hintTokens);
    const hintNumericTokens = hintTokens.filter((token) => /^\d+$/.test(token));

    const hintedBrandCandidates = [...new Set(
      sameCapacity
        .map((item) => normalizeMatcherText(item.brandName))
        .filter((brand) => brand.length > 0)
        .filter((brand) => {
          const brandTokens = brand
            .split(' ')
            .map(canonicalToken)
            .filter((token) => token.length > 0);
          return brandTokens.some((token) => hintTokenSet.has(token));
        }),
    )];

    const ranked = sameCapacity
      .map((item) => {
        const haystack = normalizeMatcherText(`${item.brandName} ${item.productName}`);
        const candidateTokens = haystack
          .split(' ')
          .map(canonicalToken)
          .filter((token) => token.length > 0);
        const candidateTokenSet = new Set(candidateTokens);
        const normalizedBrand = normalizeMatcherText(item.brandName);
        const candidateBrandTokens = normalizedBrand
          .split(' ')
          .map(canonicalToken)
          .filter((token) => token.length > 0);
        let score = 0;

        for (const token of hintTokens) {
          const tokenRegex = new RegExp(`\\b${escapeRegex(token)}\\b`, 'i');
          if (tokenRegex.test(haystack)) {
            score += /^\d+$/.test(token) ? 8 : 6;
          } else if (haystack.includes(token)) {
            score += 2;
          }
        }

        if (haystack === normalizedHint) {
          score += 100;
        } else if (haystack.startsWith(`${normalizedHint} `)) {
          score += 40;
        } else if (haystack.includes(` ${normalizedHint} `) || haystack.endsWith(` ${normalizedHint}`)) {
          score += 30;
        }

        for (const numericToken of hintNumericTokens) {
          if (!candidateTokenSet.has(numericToken)) {
            score -= 15;
          }
        }

        const extraNumericTokenCount = candidateTokens.filter(
          (token) => /^\d+$/.test(token) && !hintTokenSet.has(token),
        ).length;
        if (extraNumericTokenCount > 0) {
          score -= extraNumericTokenCount * 5;
        }

        if (hintedBrandCandidates.length > 0) {
          const brandMatchedHint = hintedBrandCandidates.some((brand) => {
            const hintedBrandTokens = brand
              .split(' ')
              .map(canonicalToken)
              .filter((token) => token.length > 0);
            return hintedBrandTokens.some((token) => candidateBrandTokens.includes(token));
          });

          if (brandMatchedHint) {
            score += 30;
          } else {
            score -= 30;
          }
        }

        return { item, score };
      })
      .sort((a, b) => b.score - a.score);

    if (ranked.length === 0 || ranked[0].score <= 0) {
      return { match: null, ambiguous: false };
    }

    if (ranked.length > 1 && ranked[0].score === ranked[1].score) {
      return { match: null, ambiguous: true };
    }

    return { match: ranked[0].item, ambiguous: false };
  }

  async previewDailyReleaseMigration(rows: Array<Record<string, unknown>>) {
    if (!Array.isArray(rows) || rows.length === 0) {
      return {
        success: false,
        message: 'No migration rows provided.',
        summary: null,
        items: [],
      };
    }

    const aggregatedSources = this.aggregateMigrationSourceRows(rows);

    const migrationSerials = aggregatedSources.flatMap((source) => {
      const indoorParsed = this.splitMigrationSerialValues(source.indoorSerial);
      const outdoorParsed = this.splitMigrationSerialValues(source.outdoorSerial);
      return [
        ...indoorParsed.valid,
        ...outdoorParsed.valid,
      ];
    });

    const serialToSourceRows = new Map<string, number[]>();
    for (let index = 0; index < rows.length; index++) {
      const source = this.normalizeMigrationSourceRow(rows[index] ?? {}, index + 1);
      const indoorParsed = this.splitMigrationSerialValues(source.indoorSerial);
      const outdoorParsed = this.splitMigrationSerialValues(source.outdoorSerial);
      const rowSerials = [...new Set([...indoorParsed.valid, ...outdoorParsed.valid])];

      for (const serial of rowSerials) {
        const normalized = this.normalizeSerialNumber(serial).toLowerCase();
        if (!normalized) {
          continue;
        }

        if (!serialToSourceRows.has(normalized)) {
          serialToSourceRows.set(normalized, []);
        }

        serialToSourceRows.get(normalized)!.push(source.rowNumber);
      }
    }

    const [catalog, customerMap, branchMap, serialUnitTypeMap, serialInventoryDetails] = await Promise.all([
      this.loadProductCapacityCatalog(),
      this.loadCustomerNameMap(),
      this.loadBranchNameMap(),
      this.loadSerialUnitTypeMap(migrationSerials),
      this.loadSerialInventoryDetails(migrationSerials),
    ]);

    const items: Array<Record<string, unknown>> = [];
    let highConfidence = 0;
    let reviewNeeded = 0;
    let rejected = 0;
    let matchedCustomers = 0;
    let matchedBranches = 0;

    for (const source of aggregatedSources) {
      const issues: string[] = [];

      if (!source.customerName) issues.push('Missing customer name.');
      if (!source.unitHp) issues.push('Missing UNIT/HP value.');

      const scheduleDateIso = this.toIsoDateOrNull(source.date);
      if (!scheduleDateIso) {
        issues.push('Invalid date value.');
      }

      // Parse potentially multiple product specs from UNIT/HP
      const specs = this.parseMultipleUnitHp(source.unitHp);

      // Split serials by comma/semicolon to support multi-product rows
      const indoorParsed = this.splitMigrationSerialValues(source.indoorSerial);
      const outdoorParsed = this.splitMigrationSerialValues(source.outdoorSerial);
      const onlyMode = this.getMigrationOnlyModeFromRemarks(source.remarks);
      let indoorSerials = [...indoorParsed.valid];
      let outdoorSerials = [...outdoorParsed.valid];

      if (onlyMode === 'indoor') {
        if (indoorSerials.length === 0 && outdoorSerials.length > 0) {
          indoorSerials = [...outdoorSerials];
        }
        outdoorSerials = [];
      }

      if (onlyMode === 'outdoor') {
        if (outdoorSerials.length === 0 && indoorSerials.length > 0) {
          outdoorSerials = [...indoorSerials];
        }
        indoorSerials = [];
      }

      if (indoorParsed.ignored.length > 0 && onlyMode === null) {
        issues.push(`Ignored indoor placeholder value(s): ${indoorParsed.ignored.join(', ')}`);
      }
      if (outdoorParsed.ignored.length > 0 && onlyMode === null) {
        issues.push(`Ignored outdoor placeholder value(s): ${outdoorParsed.ignored.join(', ')}`);
      }

      if (indoorSerials.length === 0 && outdoorSerials.length === 0) {
        issues.push('At least one serial (indoor/outdoor) is required.');
      }

      const serialsByLabel: Array<{ label: string; values: string[] }> = [
        { label: 'Indoor', values: indoorSerials },
        { label: 'Outdoor', values: outdoorSerials },
      ];

      for (const entry of serialsByLabel) {
        for (const serial of [...new Set(entry.values)]) {
          const normalized = this.normalizeSerialNumber(serial).toLowerCase();
          if (!normalized) {
            continue;
          }

          const duplicateRows = [...new Set(serialToSourceRows.get(normalized) ?? [])].sort((a, b) => a - b);
          if (duplicateRows.length > 1) {
            issues.push(
              `${entry.label} serial ${serial} appears multiple times in migration rows ${duplicateRows.join(', ')}. Only one SO can own a serial.`,
            );
            continue;
          }

          const existingSerial = serialInventoryDetails.get(normalized);
          if (!existingSerial) {
            continue;
          }

          const statusLabel = existingSerial.status || 'unknown';
          if (existingSerial.salesId) {
            issues.push(
              `${entry.label} serial ${serial} already exists in inventory with status '${statusLabel}' and is linked to SO ${existingSerial.salesId}.`,
            );
            continue;
          }

          if (statusLabel && statusLabel !== 'in-stock') {
            issues.push(
              `${entry.label} serial ${serial} already exists in inventory with status '${statusLabel}'. Review before import.`,
            );
          }
        }
      }

      // Match each spec against the product catalog
      const specMatches = specs.map((spec) => {
        if (!spec.capacityKey) {
          issues.push('Could not parse capacity from UNIT/HP.');
          return { spec, match: null as ProductCapacityCatalogItem | null, ambiguous: false };
        }
        const { match, ambiguous } = this.findBestCatalogMatch(catalog, spec.capacityKey, spec.productHint);
        if (!match) {
          issues.push(
            ambiguous
              ? `Multiple candidates matched for ${spec.capacityKey}; review required.`
              : `No product-capacity match found for ${spec.capacityKey}.`,
          );
        }
        return { spec, match, ambiguous };
      });

      // Warn when serial count lags behind product count on multi-product rows
      if (specs.length > 1) {
        if (indoorSerials.length > 0 && indoorSerials.length < specs.length) {
          issues.push(`${specs.length} products detected but only ${indoorSerials.length} indoor serial(s) provided.`);
        }
        if (outdoorSerials.length > 0 && outdoorSerials.length < specs.length) {
          issues.push(`${specs.length} products detected but only ${outdoorSerials.length} outdoor serial(s) provided.`);
        }
      }

      const matchedBranch = branchMap.get(source.customerName.toLowerCase()) ?? null;
      const customerId = matchedBranch
        ? null
        : (customerMap.get(source.customerName.toLowerCase()) ?? null);
      if (matchedBranch) {
        matchedBranches += 1;
      } else if (customerId) {
        matchedCustomers += 1;
      }

      const inferredPaymentMethod = this.inferPaymentMethodFromRemarks(source.remarks) ?? 'Cash';
      const inferredPaymentStatus = this.getAutoPaymentStatus(inferredPaymentMethod);
      const salesType = this.inferSalesTypeFromTeam(source.dailySalesTeam);

      let confidence: 'high' | 'medium' | 'rejected' = 'high';
      if (issues.length > 0) {
        confidence = issues.some(
          (issue) =>
            issue.includes('required') ||
            issue.includes('Invalid date') ||
            issue.includes('No product-capacity match') ||
            issue.includes('Only one SO can own a serial') ||
            issue.includes('is linked to SO'),
        )
          ? 'rejected'
          : 'medium';
      }

      if (confidence === 'high') highConfidence += 1;
      if (confidence === 'medium') reviewNeeded += 1;
      if (confidence === 'rejected') rejected += 1;

      const assignAllSerialsToSingleProduct = specs.length === 1;

      // Build one productItem per matched spec. For grouped duplicate rows that still map
      // to a single product spec, preserve the full merged serial list on that one item.
      const builtProductItems = specMatches
        .filter((sm) => sm.match !== null)
        .map((sm, i) => {
          const serialNumbers: Record<string, unknown> = { status: 'installed' };
          const unitTypeCounts = new Map<string, number>();

          const pushSerial = (unitType: string, serialValue: string): void => {
            if (!unitType || !serialValue) return;
            const key = unitType.toLowerCase();
            if (!Array.isArray(serialNumbers[key])) {
              serialNumbers[key] = [];
            }
            (serialNumbers[key] as string[]).push(serialValue);
            unitTypeCounts.set(key, (unitTypeCounts.get(key) ?? 0) + 1);
          };

          const indoorSerialsForItem = assignAllSerialsToSingleProduct
            ? indoorSerials
            : [indoorSerials[i] ?? ''];
          const outdoorSerialsForItem = assignAllSerialsToSingleProduct
            ? outdoorSerials
            : [outdoorSerials[i] ?? ''];

          for (const indoor of indoorSerialsForItem) {
            const indoorKey = this.normalizeSerialNumber(indoor).toLowerCase();
            const fallbackIndoorType = onlyMode === 'indoor' ? 'indoor' : (outdoorSerialsForItem.length > 0 ? 'indoor' : 'window');
            const indoorUnitType = indoor
              ? (serialUnitTypeMap.get(indoorKey) ?? fallbackIndoorType)
              : '';
            pushSerial(indoorUnitType, indoor);
          }

          for (const outdoor of outdoorSerialsForItem) {
            const outdoorKey = this.normalizeSerialNumber(outdoor).toLowerCase();
            const outdoorUnitType = outdoor
              ? (serialUnitTypeMap.get(outdoorKey) ?? 'outdoor')
              : '';
            pushSerial(outdoorUnitType, outdoor);
          }

          const unitTypesQty = [...unitTypeCounts.entries()].map(([label, value]) => ({ label, value }));
          const totalSetQty = Math.max(...unitTypesQty.map((entry) => entry.value), 1);

          return {
            transType: 'sales',
            productId: sm.match!.productId,
            capacityId: sm.match!.capacityId,
            unitPrice: 0,
            sellPrice: 0,
            discountPrice: 0,
            unitTypesQty,
            totalSetQty,
            purchaseId: null,
            salesId: null,
            serialNumbers,
          };
        });

      const mappedPayload =
        builtProductItems.length > 0 && confidence !== 'rejected'
          ? matchedBranch
            ? {
                migrationMode: 'branch-assignment',
                branchId: matchedBranch.id,
                branchName: matchedBranch.branchName,
                scheduleDate: scheduleDateIso,
                installer: source.dailySalesTeam || undefined,
                salesName: source.salesName || undefined,
                remarks: source.remarks || undefined,
                productItems: builtProductItems.map((item) => ({
                  ...item,
                  serialNumbers: {
                    ...(item.serialNumbers as Record<string, unknown>),
                    status: 'in-stock',
                  },
                })),
              }
            : {
                customer_id: customerId,
                customer: {
                  name: source.customerName,
                  customer_type: salesType === 'sub-dealer' ? 'sub_dealer' : 'regular',
                },
                scheduleDate: scheduleDateIso,
                salesType,
                installer: source.dailySalesTeam || undefined,
                remarks: source.remarks || undefined,
                status: 'remitted',
                paymentDetails: [
                  {
                    method: inferredPaymentMethod,
                    amount: 0,
                    status: inferredPaymentStatus,
                  },
                ],
                productItems: builtProductItems,
              }
          : null;

      const firstMatch = specMatches.find((sm) => sm.match !== null)?.match ?? null;
      const allMatchedCatalogs = specMatches
        .filter((sm) => sm.match !== null)
        .map((sm) => ({
          productId: sm.match!.productId,
          capacityId: sm.match!.capacityId,
          brandName: sm.match!.brandName,
          productName: sm.match!.productName,
          capacity: sm.match!.capacity,
        }));

      items.push({
        rowNumber: source.rowNumber,
        mergedRowNumbers: source.sourceRowNumbers,
        raw: source,
        extracted: {
          specs: specs.map((s) => s.capacityKey).join(', '),
          customerId,
          branchId: matchedBranch?.id ?? null,
          importMode: matchedBranch ? 'branch-assignment' : 'sales-order',
          salesType,
          inferredPaymentMethod,
          productCount: specs.length,
        },
        matchedCatalog: firstMatch
          ? {
              productId: firstMatch.productId,
              capacityId: firstMatch.capacityId,
              brandName: firstMatch.brandName,
              productName: firstMatch.productName,
              capacity: firstMatch.capacity,
            }
          : null,
        matchedCatalogs: allMatchedCatalogs,
        confidence,
        issues,
        mappedPayload,
      });
    }

    return {
      success: true,
      summary: {
        total: aggregatedSources.length,
        highConfidence,
        reviewNeeded,
        rejected,
        matchedCustomers,
        matchedBranches,
        newCustomers: aggregatedSources.length - matchedCustomers - matchedBranches,
      },
      items,
    };
  }

  private toPositiveIntegerOrNull(value: unknown): number | null {
    const raw = String(value ?? '').trim();
    if (!raw) {
      return null;
    }

    const parsed = Number(raw.match(/\d+/)?.[0] ?? Number.NaN);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return null;
    }

    return Math.floor(parsed);
  }

  private deriveTermsDueDate(
    paymentDetails: Record<string, unknown>,
    method: SalesPaymentMethod,
  ): string | null {
    const explicitDueDate = this.toIsoDateOrNull(paymentDetails.termsDueDate);
    if (explicitDueDate) {
      return explicitDueDate;
    }

    if (method !== 'Terms' && method !== 'Terms with DP') {
      return null;
    }

    const termDays = this.toPositiveIntegerOrNull(paymentDetails.terms);
    if (!termDays) {
      return null;
    }

    const baseDateIso = this.toIsoDateOrNull(paymentDetails.paymentDate) ?? new Date().toISOString();
    const baseDate = new Date(baseDateIso);
    if (Number.isNaN(baseDate.getTime())) {
      return null;
    }

    baseDate.setUTCHours(0, 0, 0, 0);
    baseDate.setUTCDate(baseDate.getUTCDate() + termDays);

    return baseDate.toISOString();
  }

  private resolvePaymentStatusForDisplay(
    methodValue: unknown,
    statusValue: unknown,
    termsDueDateValue: unknown,
    postDatedValue: unknown,
  ): string {
    const normalizedStatus = String(statusValue ?? '').trim().toLowerCase();
    if (normalizedStatus === 'paid') {
      return 'paid';
    }

    let method: SalesPaymentMethod | null = null;
    try {
      method = this.toSalesPaymentMethod(methodValue);
    } catch {
      method = null;
    }

    if (method === 'Terms' || method === 'Terms with DP' || method === 'Cheque') {
      const dueSource = method === 'Cheque' ? postDatedValue : termsDueDateValue;
      const dueDateIso = this.toIsoDateOrNull(dueSource);
      if (dueDateIso) {
        const dueDate = new Date(dueDateIso);
        const today = new Date();
        today.setUTCHours(0, 0, 0, 0);
        if (!Number.isNaN(dueDate.getTime()) && dueDate < today) {
          return 'overdue';
        }
      }
    }

    return 'unpaid';
  }

  private validateSalesPaymentDetails(
    paymentDetails: Record<string, unknown>,
    index: number,
  ): SalesPaymentMethod {
    const method = this.toSalesPaymentMethod(paymentDetails.method);

    const allowedFieldsByMethod: Record<SalesPaymentMethod, Set<string>> = {
      Cash: new Set(['amount', 'paymentDate']),
      'Bank Transfer': new Set(['amount', 'bankName', 'referenceNo']),
      Terms: new Set(['amount', 'terms', 'termsDueDate']),
      'Terms with DP': new Set(['amount', 'terms', 'termsDueDate', 'downPayment']),
      Cheque: new Set(['amount', 'checkNo', 'issuedBy', 'bankName', 'bankAccount', 'postDated']),
      'Credit Card': new Set(['amount', 'ccCharge', 'referenceNo', 'paymentDate']),
      Installment: new Set(['amount', 'terms', 'termsDueDate', 'downPayment']),
    };

    const optionalFields = [
      'terms',
      'termsDueDate',
      'referenceNo',
      'paymentDate',
      'issuedBy',
      'ccCharge',
      'checkNo',
      'bankName',
      'bankAccount',
      'postDated',
      'downPayment',
    ] as const;

    const disallowedFields = optionalFields.filter(
      (field) =>
        this.hasPaymentValue(paymentDetails[field]) && !allowedFieldsByMethod[method].has(field),
    );

    if (disallowedFields.length > 0) {
      throw new BadRequestException(
        `paymentDetails[${index}] has invalid field(s) for method ${method}: ${disallowedFields.join(', ')}`,
      );
    }

    return method;
  }

  private parseDateOnly(value: unknown): Date | null {
    const raw = String(value ?? '').trim();
    if (!raw) {
      return null;
    }

    const parsed = new Date(`${raw}T00:00:00Z`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  private formatDateOnlyForSql(value: Date): string {
    return value.toISOString().slice(0, 10);
  }

  private addDays(date: Date, days: number): Date {
    const copy = new Date(date.getTime());
    copy.setUTCDate(copy.getUTCDate() + days);
    return copy;
  }

  private async buildStatementOfAccountSnapshot(
    customerId: string,
    dto: CreateStatementOfAccountDto,
  ): Promise<{
    effectivePeriodFrom: string;
    effectivePeriodTo: string;
    openingBalance: number;
    totalCharges: number;
    totalPayments: number;
    closingBalance: number;
  }> {
    const normalizedCustomerId = String(customerId ?? '').trim();
    if (!normalizedCustomerId) {
      throw new Error('Invalid customer id');
    }

    const requestedPeriodFrom = this.parseDateOnly(dto.periodFrom);
    const requestedPeriodTo = this.parseDateOnly(dto.periodTo);
    if (!requestedPeriodFrom || !requestedPeriodTo) {
      throw new Error('Statement period is required');
    }
    if (requestedPeriodFrom.getTime() > requestedPeriodTo.getTime()) {
      throw new Error('Period From cannot be later than Period To');
    }

    const lastStatementResult = await this.databaseService.query<{
      closing_balance: string | null;
      period_to: string | null;
    }>(
      `SELECT closing_balance::text AS closing_balance,
              period_to::text AS period_to
         FROM tblstatement_of_account
        WHERE customer_id::text = $1
        ORDER BY period_to DESC, generated_at DESC
        LIMIT 1`,
      [normalizedCustomerId],
    );

    const openingBalance = this.toOptionalNumber(lastStatementResult.rows[0]?.closing_balance) ?? 0;
    const lastPeriodTo = this.parseDateOnly(lastStatementResult.rows[0]?.period_to);
    const minimumPeriodFrom = lastPeriodTo ? this.addDays(lastPeriodTo, 1) : requestedPeriodFrom;
    const effectiveFromDate =
      requestedPeriodFrom.getTime() < minimumPeriodFrom.getTime() ? minimumPeriodFrom : requestedPeriodFrom;

    if (effectiveFromDate.getTime() > requestedPeriodTo.getTime()) {
      return {
        effectivePeriodFrom: this.formatDateOnlyForSql(effectiveFromDate),
        effectivePeriodTo: this.formatDateOnlyForSql(requestedPeriodTo),
        openingBalance,
        totalCharges: 0,
        totalPayments: 0,
        closingBalance: openingBalance,
      };
    }

    const effectivePeriodFrom = this.formatDateOnlyForSql(effectiveFromDate);
    const effectivePeriodTo = this.formatDateOnlyForSql(requestedPeriodTo);

    const chargeResult = await this.databaseService.query<{ total_charges: string | null }>(
      `SELECT COALESCE(SUM(COALESCE(so.total_amount, 0)::numeric), 0)::text AS total_charges
         FROM tblsales_order so
        WHERE so.customer_id::text = $1
          AND COALESCE(so.created_at, NOW())::date BETWEEN $2::date AND $3::date
          AND REPLACE(REPLACE(LOWER(TRIM(COALESCE(so.status, 'pending'))), '_', '-'), ' ', '-')
              NOT IN ('pending', 'for-delivery', 'in-progress', 'scheduled', 'cancelled', 'rejected')`,
      [normalizedCustomerId, effectivePeriodFrom, effectivePeriodTo],
    );

    // Total payments = manual settlements + down payments on unpaid SOs + fully paid SO amounts
    const paymentsResult = await this.databaseService.query<{
      total_manual: string | null;
      total_down: string | null;
      total_so_paid: string | null;
    }>(
      `SELECT
         -- Manual settlements in period
         (
           SELECT COALESCE(SUM(payment_amount), 0)::text
           FROM tblcustomer_payments
           WHERE customer_id::text = $1
             AND payment_date BETWEEN $2::date AND $3::date
         ) AS total_manual,
         -- Down payments on UNPAID SOs in period
         (
           SELECT COALESCE(SUM(
             COALESCE(NULLIF(COALESCE(to_jsonb(sp)->>'downPayment', to_jsonb(sp)->>'down_payment', ''), '')::numeric, 0)
           ), 0)::text
           FROM tblso_payments sp
           JOIN tblsales_order so2 ON so2.id = sp.so_id
           WHERE so2.customer_id::text = $1
             AND COALESCE(so2.created_at, NOW())::date BETWEEN $2::date AND $3::date
             AND LOWER(COALESCE(to_jsonb(sp)->>'status', '')) != 'paid'
             AND COALESCE(NULLIF(COALESCE(to_jsonb(sp)->>'downPayment', to_jsonb(sp)->>'down_payment', ''), '')::numeric, 0) > 0
         ) AS total_down,
         -- Fully paid SO payment amounts in period
         (
           SELECT COALESCE(SUM(
             COALESCE(NULLIF(to_jsonb(sp)->>'amount', '')::numeric, 0)
           ), 0)::text
           FROM tblso_payments sp
           JOIN tblsales_order so2 ON so2.id = sp.so_id
           WHERE so2.customer_id::text = $1
             AND COALESCE(so2.created_at, NOW())::date BETWEEN $2::date AND $3::date
             AND LOWER(COALESCE(to_jsonb(sp)->>'status', '')) = 'paid'
         ) AS total_so_paid`,
      [normalizedCustomerId, effectivePeriodFrom, effectivePeriodTo],
    );

    const totalCharges = this.toOptionalNumber(chargeResult.rows[0]?.total_charges) ?? 0;
    const totalManual = this.toOptionalNumber(paymentsResult.rows[0]?.total_manual) ?? 0;
    const totalDown = this.toOptionalNumber(paymentsResult.rows[0]?.total_down) ?? 0;
    const totalSoPaid = this.toOptionalNumber(paymentsResult.rows[0]?.total_so_paid) ?? 0;
    const totalPayments = totalManual + totalDown + totalSoPaid;
    const closingBalance = openingBalance + totalCharges - totalPayments;

    return {
      effectivePeriodFrom,
      effectivePeriodTo,
      openingBalance,
      totalCharges,
      totalPayments,
      closingBalance,
    };
  }

  private async insertStatementOfAccountRecord(
    customerId: string,
    dto: CreateStatementOfAccountDto,
    userId?: number,
  ) {
    const snapshot = await this.buildStatementOfAccountSnapshot(customerId, dto);

    const soaColumns = await this.getTableColumns(this.databaseService, 'tblstatement_of_account');
    const customerIdColumn = this.pickColumn(soaColumns, ['customer_id', 'customerId']);
    const periodFromColumn = this.pickColumn(soaColumns, ['period_from', 'periodFrom']);
    const periodToColumn = this.pickColumn(soaColumns, ['period_to', 'periodTo']);
    const openingBalanceColumn = this.pickColumn(soaColumns, ['opening_balance', 'openingBalance']);
    const totalChargesColumn = this.pickColumn(soaColumns, ['total_charges', 'totalCharges']);
    const totalPaymentsColumn = this.pickColumn(soaColumns, ['total_payments', 'totalPayments']);
    const closingBalanceColumn = this.pickColumn(soaColumns, ['closing_balance', 'closingBalance']);
    const statusColumn = this.pickColumn(soaColumns, ['soa_status', 'soaStatus']);
    const generatedByColumn = this.pickColumn(soaColumns, ['generated_by', 'generatedBy']);
    const dueDateColumn = this.pickColumn(soaColumns, ['due_date', 'dueDate']);
    const notesColumn = this.pickColumn(soaColumns, ['notes']);

    const record: Record<string, unknown> = {};
    if (customerIdColumn) record[customerIdColumn] = customerId;
    if (periodFromColumn) record[periodFromColumn] = this.toIsoDateOrNull(snapshot.effectivePeriodFrom);
    if (periodToColumn) record[periodToColumn] = this.toIsoDateOrNull(snapshot.effectivePeriodTo);
    if (openingBalanceColumn) record[openingBalanceColumn] = snapshot.openingBalance;
    if (totalChargesColumn) record[totalChargesColumn] = snapshot.totalCharges;
    if (totalPaymentsColumn) record[totalPaymentsColumn] = snapshot.totalPayments;
    if (closingBalanceColumn) record[closingBalanceColumn] = snapshot.closingBalance;
    if (statusColumn) record[statusColumn] = 'draft';
    if (generatedByColumn && userId !== undefined) record[generatedByColumn] = userId;
    if (dueDateColumn) record[dueDateColumn] = this.toIsoDateOrNull(dto.dueDate);
    if (notesColumn && dto.notes !== undefined) record[notesColumn] = String(dto.notes ?? '').trim();

    const inserted = await this.runInsert(this.databaseService, 'tblstatement_of_account', record);
    return { inserted, snapshot };
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

  private async findAlreadyLinkedSerials(productItems: Array<{ serialNumbers?: unknown }>): Promise<string[]> {
    const serialColumns = await this.getTableColumns(this.databaseService, 'tblserial_numbers');
    const serialNumberColumn = this.pickColumn(serialColumns, ['serialNumber', 'serial_number']);
    const salesIdColumn = this.pickColumn(serialColumns, ['salesId', 'sales_id']);

    if (!serialNumberColumn || !salesIdColumn) {
      return [];
    }

    const normalizedSerials = [...new Set(
      productItems
        .flatMap((item) => {
          const serialMap = item?.serialNumbers;
          if (!serialMap || typeof serialMap !== 'object') return [];

          return Object.entries(serialMap as Record<string, unknown>)
            .filter(([key]) => key.toLowerCase() !== 'status')
            .flatMap(([, value]) => (Array.isArray(value) ? value : []));
        })
        .map((value) => this.normalizeSerialNumber(value).toLowerCase())
        .filter((value) => value.length > 0),
    )];

    if (normalizedSerials.length === 0) {
      return [];
    }

    const result = await this.databaseService.query<{ serial: string }>(
      `SELECT "${serialNumberColumn}"::text AS serial
       FROM tblserial_numbers
       WHERE LOWER(regexp_replace(BTRIM(COALESCE("${serialNumberColumn}"::text, '')), '\\s+', ' ', 'g')) = ANY($1::text[])
         AND BTRIM(COALESCE("${salesIdColumn}"::text, '')) <> ''`,
      [normalizedSerials],
    );

    const linkedSerials: string[] = result.rows
      .map((row) => this.normalizeSerialNumber(row.serial))
      .filter((serial) => serial.length > 0);

    return [...new Set(linkedSerials)];
  }

  private async importMigrationBranchAssignment(
    payload: CreateSalesOrderDto,
    userId?: number,
    fallbackBranchId?: number,
  ): Promise<{ success: boolean; message: string; branchId?: number | null; processedSerials?: number }> {
    const payloadRecord = payload as unknown as Record<string, unknown>;
    const targetBranchId =
      this.toOptionalNumber(payloadRecord['branchId']) ??
      (Number.isFinite(Number(fallbackBranchId)) && Number(fallbackBranchId) > 0
        ? Number(fallbackBranchId)
        : this.defaultMigrationBranchId);

    if (targetBranchId === null) {
      return {
        success: false,
        message: 'Branch-assignment migration row is missing a valid branchId.',
      };
    }

    const productItems = Array.isArray(payload?.productItems) ? payload.productItems : [];
    if (productItems.length === 0) {
      return {
        success: false,
        message: 'Branch-assignment migration row has no product items.',
      };
    }

    try {
      const processedSerials = await this.databaseService.withTransaction(async (client) => {
        const serialColumns = await this.getTableColumns(client, 'tblserial_numbers');
        const serialCustomerIdColumn = this.pickColumn(serialColumns, ['customerId', 'customer_id']);
        const serialNumberColumn = this.pickColumn(serialColumns, ['serialNumber', 'serial_number']);
        const serialSalesIdColumn = this.pickColumn(serialColumns, ['salesId', 'sales_id']);
        const serialProductIdColumn = this.pickColumn(serialColumns, ['productId', 'product_id']);
        const serialCapacityIdColumn = this.pickColumn(serialColumns, ['capacityId', 'capacity_id']);
        const serialUnitTypeColumn = this.pickColumn(serialColumns, ['unitType', 'unit_type']);
        const serialStatusColumn = this.pickColumn(serialColumns, ['status']);
        const serialBranchIdColumn = this.pickColumn(serialColumns, ['branchId', 'branch_id']);
        const serialCreatedByColumn = this.pickColumn(serialColumns, ['created_by', 'createdBy']);
        const serialDealerIdColumn = this.pickColumn(serialColumns, ['dealerId', 'dealer_id']);
        const serialPoIdColumn = this.pickColumn(serialColumns, ['purchaseOrderId', 'purchase_order_id', 'po_id']);
        const serialPoNoColumn = this.pickColumn(serialColumns, ['purchaseOrderNo', 'purchase_order_no', 'po_no']);

        if (!serialNumberColumn) {
          throw new Error('Serial number column is not configured in tblserial_numbers');
        }

        let count = 0;

        for (const item of productItems) {
          const productId = this.toOptionalNumber(item.productId);
          const capacityId = this.toOptionalNumber(item.capacityId);

          if (productId === null || capacityId === null) {
            throw new Error('productId and capacityId are required for branch-assignment migration items');
          }

          const serialPayload =
            item.serialNumbers && typeof item.serialNumbers === 'object'
              ? (item.serialNumbers as Record<string, unknown>)
              : {};

          for (const [unitTypeKey, values] of Object.entries(serialPayload)) {
            if (unitTypeKey.toLowerCase() === 'status') {
              continue;
            }

            const serialList = Array.isArray(values) ? values : [];
            for (const serialRaw of serialList) {
              const normalizedSerial = this.normalizeSerialNumber(serialRaw);
              if (!normalizedSerial) {
                continue;
              }

              const existingSerialResult = await client.query<{
                id: number;
                sales_id: string | null;
                purchase_id: string | null;
              }>(
                `SELECT
                   sn.id,
                   COALESCE(to_jsonb(sn)->>'salesId', to_jsonb(sn)->>'sales_id') AS sales_id,
                   COALESCE(
                     to_jsonb(sn)->>'purchaseId',
                     to_jsonb(sn)->>'purchase_id',
                     to_jsonb(sn)->>'po_id'
                   ) AS purchase_id
                 FROM tblserial_numbers sn
                 WHERE LOWER(
                   regexp_replace(BTRIM(COALESCE(sn."serialNumber", '')), '\\s+', ' ', 'g')
                 ) = LOWER($1)
                 LIMIT 1`,
                [normalizedSerial],
              );

              if (existingSerialResult.rowCount === 0) {
                const insertRecord: Record<string, unknown> = {
                  [serialNumberColumn]: normalizedSerial,
                };

                if (serialBranchIdColumn) insertRecord[serialBranchIdColumn] = targetBranchId;
                if (serialSalesIdColumn) insertRecord[serialSalesIdColumn] = null;
                if (serialProductIdColumn) insertRecord[serialProductIdColumn] = productId;
                if (serialCapacityIdColumn) insertRecord[serialCapacityIdColumn] = capacityId;
                if (serialUnitTypeColumn) insertRecord[serialUnitTypeColumn] = unitTypeKey;
                if (serialStatusColumn) insertRecord[serialStatusColumn] = 'in-stock';
                if (serialCustomerIdColumn) insertRecord[serialCustomerIdColumn] = null;
                if (serialCreatedByColumn) insertRecord[serialCreatedByColumn] = userId ?? null;
                if (serialDealerIdColumn) insertRecord[serialDealerIdColumn] = null;
                if (serialPoIdColumn) insertRecord[serialPoIdColumn] = null;
                if (serialPoNoColumn) insertRecord[serialPoNoColumn] = null;

                await this.runInsert(client, 'tblserial_numbers', insertRecord);
                count += 1;
                continue;
              }

              const existingSerial = existingSerialResult.rows[0];
              if (existingSerial.sales_id) {
                throw new Error(
                  `Serial number ${normalizedSerial} is already linked to sales order ${existingSerial.sales_id}`,
                );
              }

              const preservePurchaseLinkedMapping =
                String(existingSerial.purchase_id ?? '').trim().length > 0;

              if (serialCustomerIdColumn) {
                await client.query(
                  `UPDATE tblserial_numbers
                   SET
                     "branchId" = $1,
                     "salesId" = NULL,
                     "productId" = CASE WHEN $8 THEN "productId" ELSE $2 END,
                     "capacityId" = CASE WHEN $8 THEN "capacityId" ELSE $3 END,
                     "unitType" = $4,
                     status = $5,
                     "${serialCustomerIdColumn}" = NULL,
                     created_by = COALESCE($6, created_by)
                   WHERE id = $7`,
                  [
                    targetBranchId,
                    productId,
                    capacityId,
                    unitTypeKey,
                    'in-stock',
                    userId ?? null,
                    existingSerial.id,
                    preservePurchaseLinkedMapping,
                  ],
                );
              } else {
                await client.query(
                  `UPDATE tblserial_numbers
                   SET
                     "branchId" = $1,
                     "salesId" = NULL,
                     "productId" = CASE WHEN $8 THEN "productId" ELSE $2 END,
                     "capacityId" = CASE WHEN $8 THEN "capacityId" ELSE $3 END,
                     "unitType" = $4,
                     status = $5,
                     created_by = COALESCE($6, created_by)
                   WHERE id = $7`,
                  [
                    targetBranchId,
                    productId,
                    capacityId,
                    unitTypeKey,
                    'in-stock',
                    userId ?? null,
                    existingSerial.id,
                    preservePurchaseLinkedMapping,
                  ],
                );
              }

              count += 1;
            }
          }
        }

        return count;
      });

      return {
        success: true,
        message: `Assigned ${processedSerials} serial(s) to branch ${targetBranchId} without creating a sales order.`,
        branchId: targetBranchId,
        processedSerials,
      };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to import branch-assignment migration row.',
      };
    }
  }

  async importDailyReleaseMigration(
    rows: Array<Record<string, unknown>>,
    userId?: number,
    branchId?: number,
    selectedMediumRowNumbers: number[] = [],
    editedPayloads: Array<{ rowNumber: number; payload: Record<string, unknown> }> = [],
  ) {
    const preview = await this.previewDailyReleaseMigration(rows);
    if (!preview.success || !preview.summary) {
      return {
        success: false,
        batchFailed: true,
        message: preview.message ?? 'Failed to prepare migration import.',
        summary: null,
        items: [],
      };
    }

    const importItems = Array.isArray(preview.items) ? preview.items : [];

    const selectedMediumSet = new Set(
      (selectedMediumRowNumbers ?? [])
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value > 0),
    );

    const editedPayloadMap = new Map<number, CreateSalesOrderDto>();
    for (const entry of editedPayloads ?? []) {
      const rowNumber = Number(entry?.rowNumber ?? 0);
      if (!Number.isFinite(rowNumber) || rowNumber <= 0) {
        continue;
      }

      const payload = (entry?.payload ?? null) as unknown as CreateSalesOrderDto | null;
      if (!payload || typeof payload !== 'object') {
        continue;
      }

      editedPayloadMap.set(rowNumber, payload);
    }

    // Separate accepted vs skipped-review items
    const skippedDetails: Array<Record<string, unknown>> = [];
    const toImport: typeof importItems = [];

    for (const item of importItems) {
      const rowNumber = Number(item.rowNumber ?? 0);
      const confidence = String(item.confidence ?? '').toLowerCase();
      const previewPayload = item.mappedPayload as CreateSalesOrderDto | null;
      const editedPayload = editedPayloadMap.get(rowNumber) ?? null;
      const mappedPayloadRaw = editedPayload ?? previewPayload;
      const mappedPayload = mappedPayloadRaw
        ? this.sanitizeMigrationPayloadSerials(mappedPayloadRaw)
        : null;
      const canImportMedium = confidence === 'medium' && selectedMediumSet.has(rowNumber);
      const canImportEdited = editedPayload !== null;

      if ((!canImportEdited && confidence !== 'high' && !canImportMedium) || !mappedPayload) {
        skippedDetails.push({
          rowNumber,
          status: 'skipped-review',
          message:
            canImportEdited
              ? 'Edited payload is missing required data.'
              : confidence === 'medium'
              ? 'Medium-confidence row not selected for import.'
              : 'Row is not importable from preview.',
        });
      } else {
        toImport.push({
          ...item,
          mappedPayload,
        });
      }
    }

    // ── Phase 1: Pre-validate ALL accepted rows before creating any ───────────
    // Build serial → row mapping so we can attribute duplicates back to source rows
    const serialToRows = new Map<string, number[]>();
    for (const item of toImport) {
      const rowNumber = Number(item.rowNumber ?? 0);
      const payload = item.mappedPayload as CreateSalesOrderDto;
      const productItems = Array.isArray(payload?.productItems) ? payload.productItems : [];
      for (const pi of productItems) {
        const serialMap = pi?.serialNumbers;
        if (!serialMap || typeof serialMap !== 'object') continue;
        for (const [key, value] of Object.entries(serialMap as Record<string, unknown>)) {
          if (key.toLowerCase() === 'status') continue;
          if (!Array.isArray(value)) continue;
          for (const serial of value) {
            const normalized = this.normalizeSerialNumber(String(serial ?? '')).toLowerCase();
            if (!normalized) continue;
            if (!serialToRows.has(normalized)) serialToRows.set(normalized, []);
            serialToRows.get(normalized)!.push(rowNumber);
          }
        }
      }
    }

    // Batch-check all serials in one query
    const allProductItems = toImport.flatMap((item) => {
      const payload = item.mappedPayload as CreateSalesOrderDto;
      return Array.isArray(payload?.productItems) ? payload.productItems : [];
    });
    const duplicateSerials = await this.findAlreadyLinkedSerials(allProductItems);

    // Map duplicates back to their rows
    const rowValidationErrors = new Map<number, string[]>();

    for (const [normalizedSerial, rawRows] of serialToRows.entries()) {
      const uniqueRows = [...new Set(rawRows)].sort((a, b) => a - b);
      if (uniqueRows.length <= 1) {
        continue;
      }

      for (const rowNum of uniqueRows) {
        if (!rowValidationErrors.has(rowNum)) rowValidationErrors.set(rowNum, []);
        rowValidationErrors.get(rowNum)!.push(
          `Serial ${normalizedSerial.toUpperCase()} is used multiple times in this migration batch (rows ${uniqueRows.join(', ')}). Only one SO can own a serial.`,
        );
      }
    }

    for (const dupSerial of duplicateSerials) {
      const normalized = this.normalizeSerialNumber(dupSerial).toLowerCase();
      const affectedRows = serialToRows.get(normalized) ?? [];
      for (const rowNum of affectedRows) {
        if (!rowValidationErrors.has(rowNum)) rowValidationErrors.set(rowNum, []);
        rowValidationErrors.get(rowNum)!.push(`Serial ${dupSerial} already exists in inventory and is linked to another sales order.`);
      }
    }

    if (rowValidationErrors.size > 0) {
      // At least one row failed validation — abort entire batch, no rows created
      const failedDetails = toImport.map((item) => {
        const rowNum = Number(item.rowNumber ?? 0);
        const failures = rowValidationErrors.get(rowNum);
        if (failures) {
          return { rowNumber: rowNum, status: 'failed', message: failures.join('; ') };
        }
        return {
          rowNumber: rowNum,
          status: 'blocked',
          message: 'Import blocked: other rows in this batch have validation errors.',
        };
      });

      return {
        success: false,
        batchFailed: true,
        message: `Batch aborted: ${rowValidationErrors.size} row(s) failed validation. No rows were created.`,
        summary: {
          total: toImport.length,
          created: 0,
          failed: rowValidationErrors.size,
          blocked: toImport.length - rowValidationErrors.size,
          aborted: 0,
          skippedReview: skippedDetails.length,
        },
        items: [...skippedDetails, ...failedDetails],
      };
    }

    // ── Phase 2: All validated — create rows; abort remaining on first failure ──
    const creationDetails: Array<Record<string, unknown>> = [];
    let batchFailed = false;
    let batchFailedRowNumber: number | null = null;
    const effectiveBranchId =
      Number.isFinite(Number(branchId)) && Number(branchId) > 0
        ? Number(branchId)
        : this.defaultMigrationBranchId;

    for (const item of toImport) {
      const rowNum = Number(item.rowNumber ?? 0);

      if (batchFailed) {
        creationDetails.push({
          rowNumber: rowNum,
          status: 'aborted',
          message: `Import aborted: row ${batchFailedRowNumber} failed before this row could be processed.`,
        });
        continue;
      }

      try {
        const mappedPayload = item.mappedPayload as CreateSalesOrderDto;
        const migrationMode = String(
          ((mappedPayload as unknown as Record<string, unknown>)['migrationMode'] ?? ''),
        )
          .trim()
          .toLowerCase();

        const createdResult =
          migrationMode === 'branch-assignment'
            ? await this.importMigrationBranchAssignment(mappedPayload, userId, effectiveBranchId)
            : await (() => {
                (mappedPayload as unknown as Record<string, unknown>)['allowCreateMissingSerials'] = true;
                return this.create(mappedPayload, userId, effectiveBranchId);
              })();

        if (createdResult?.success) {
          creationDetails.push({
            rowNumber: rowNum,
            status: 'created',
            salesOrderId:
              'data' in createdResult ? createdResult.data?.salesOrderId ?? null : null,
            message: createdResult?.message ?? 'Sales order created.',
          });
        } else {
          batchFailed = true;
          batchFailedRowNumber = rowNum;
          creationDetails.push({
            rowNumber: rowNum,
            status: 'failed',
            message: createdResult?.message ?? 'Failed to create sales order.',
          });
        }
      } catch (error) {
        batchFailed = true;
        batchFailedRowNumber = rowNum;
        creationDetails.push({
          rowNumber: rowNum,
          status: 'failed',
          message: error instanceof Error ? error.message : 'Unexpected migration import error.',
        });
      }
    }

    if (batchFailed) {
      const alreadyCreated = creationDetails.filter((d) => d.status === 'created').length;
      const failedCount = creationDetails.filter((d) => d.status === 'failed').length;
      const abortedCount = creationDetails.filter((d) => d.status === 'aborted').length;
      const warningNote = alreadyCreated > 0
        ? ` Warning: ${alreadyCreated} row(s) were already committed to the database before the failure and cannot be auto-rolled back.`
        : ' No rows were created.';

      return {
        success: false,
        batchFailed: true,
        message: `Batch failed.${warningNote}`,
        summary: {
          total: toImport.length,
          created: alreadyCreated,
          failed: failedCount,
          blocked: 0,
          aborted: abortedCount,
          skippedReview: skippedDetails.length,
        },
        items: [...skippedDetails, ...creationDetails],
      };
    }

    return {
      success: true,
      batchFailed: false,
      message: 'Migration import completed successfully.',
      summary: {
        total: toImport.length,
        created: toImport.length,
        failed: 0,
        blocked: 0,
        aborted: 0,
        skippedReview: skippedDetails.length,
      },
      items: [...skippedDetails, ...creationDetails],
    };
  }

  private normalizeUnitTypesQty(value: unknown): Array<{ label: string; value: number }> {
    if (Array.isArray(value)) {
      return value
        .map((entry) => {
          if (typeof entry === 'string') {
            const [labelRaw, valueRaw] = entry.split(':');
            const label = String(labelRaw ?? '').trim().toLowerCase();
            const parsedValue = Number(valueRaw);
            return {
              label: label || 'set',
              value: Number.isFinite(parsedValue) ? parsedValue : 0,
            };
          }

          if (entry && typeof entry === 'object') {
            const payload = entry as Record<string, unknown>;
            const label = String(payload.label ?? payload.unitType ?? 'set').trim().toLowerCase();
            const parsedValue = Number(payload.value ?? payload.qty ?? 0);
            return {
              label: label || 'set',
              value: Number.isFinite(parsedValue) ? parsedValue : 0,
            };
          }

          return null;
        })
        .filter((entry): entry is { label: string; value: number } => !!entry);
    }

    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        return this.normalizeUnitTypesQty(parsed);
      } catch {
        return [];
      }
    }

    return [];
  }

  private normalizeWorkflowStatus(value: unknown): string {
    return String(value ?? '')
      .trim()
      .toLowerCase()
      .replace(/[\s_]+/g, '-');
  }

  private async updateLinkedSalesSerialStatuses(
    executor: { query: PoolClient['query'] },
    salesOrderId: number,
    nextStatus: string,
    fromStatuses?: string[],
  ): Promise<number> {
    const serialColumns = await this.getTableColumns(executor, 'tblserial_numbers');
    const serialSalesIdColumn = this.pickColumn(serialColumns, ['salesId', 'sales_id']);
    const serialStatusColumn = this.pickColumn(serialColumns, ['status']);

    if (!serialSalesIdColumn || !serialStatusColumn) {
      throw new Error('Sales/status columns are not configured in tblserial_numbers');
    }

    const normalizedFromStatuses = (fromStatuses ?? [])
      .map((status) => this.normalizeWorkflowStatus(status))
      .filter((status) => status.length > 0);

    const params: unknown[] = [nextStatus, String(salesOrderId)];
    const whereParts = [`"${serialSalesIdColumn}"::text = $2`];

    if (normalizedFromStatuses.length > 0) {
      params.push(normalizedFromStatuses);
      whereParts.push(
        `REPLACE(REPLACE(LOWER(COALESCE("${serialStatusColumn}"::text, '')), '_', '-'), ' ', '-') = ANY($3::text[])`,
      );
    }

    const result = await executor.query(
      `UPDATE tblserial_numbers
       SET "${serialStatusColumn}" = $1
       WHERE ${whereParts.join(' AND ')}`,
      params,
    );

    return result.rowCount ?? 0;
  }

  // private async fetchByMode(mode: SalesMode, query: ListSalesOrderQueryDto) {
  //   const page = this.normalizePage(query.page);
  //   const limit = this.normalizeLimit(query.limit);
  //   const offset = (page - 1) * limit;
  //   const search = String(query.search ?? '').trim().toLowerCase();
  //   const branchId = Number(query.branchId);

  //   const params: unknown[] = [];
  //   const whereParts: string[] = [];

  //   if (mode === 'deliveries') {
  //     whereParts.push(`LOWER(COALESCE(base.original_status, '')) NOT IN (
  //       'for_approval', 'for approval', 'approval', 'approved', 'complete', 'completed', 'cancelled', 'rejected'
  //     )`);
  //   } else if (mode === 'approvals') {
  //     whereParts.push(`LOWER(COALESCE(base.original_status, '')) IN (
  //       'for_approval', 'for approval', 'approval', 'pending_approval', 'pending approval'
  //     )`);
  //   } else if (mode === 'schedules') {
  //     whereParts.push(`REPLACE(REPLACE(LOWER(BTRIM(COALESCE(base.original_status, ''))), '_', '-'), ' ', '-') IN (
  //       'pending',
  //       'for-delivery',
  //       'to-remit'
  //     )`);
  //     whereParts.push(`LOWER(COALESCE(base.sales_type, '')) IN (
  //       'sales',
  //       'sub-dealer',
  //       'sales and service',
  //       'sales & service',
  //       'sales-and-service',
  //       'sales_and_service'
  //     )`);
  //   } else if (mode === 'services') {
  //     whereParts.push(`(
  //       LOWER(COALESCE(base.sales_type, '')) IN (
  //         'service', 'services', 'concern', 'concerns',
  //         'sales and service', 'sales & service', 'sales-and-service', 'sales_and_service'
  //       )
  //       OR EXISTS (SELECT 1 FROM tblservice_details sd WHERE sd.sales_id = base.id)
  //       OR EXISTS (SELECT 1 FROM tblconcern_details cd WHERE cd.sales_id = base.id)
  //     )`);
  //   } else if (mode === 'projects') {
  //     whereParts.push(`(
  //       LOWER(COALESCE(base.sales_type, '')) IN ('project', 'projects')
  //       OR EXISTS (SELECT 1 FROM tblproject_details pd WHERE pd.sales_id = base.id)
  //     )`);
  //   } else if (mode === 'distribution') {
  //     whereParts.push(`(
  //       LOWER(COALESCE(base.sales_type, '')) IN (
  //         'distribution',
  //         'transfer',
  //         'transfers'
  //       )
  //       OR EXISTS (SELECT 1 FROM tbltransfer_details td WHERE td.sales_id = base.id)
  //     )`);
  //   } else if (mode === 'sales-receivable') {
  //     whereParts.push(`LOWER(COALESCE(base.original_status, '')) = 'remitted'`);
  //   } else if (mode === 'remitted-sales') {
  //     whereParts.push(`LOWER(COALESCE(base.original_status, '')) IN ('complete', 'completed')`);
  //   }

  //   if (Number.isFinite(branchId) && branchId > 0) {
  //     params.push(String(branchId));
  //     const branchIndex = params.length;
  //     // Include NULL branch_id (legacy records without branch assignment)
  //     whereParts.push(`(base.branch_id = $${branchIndex} OR base.branch_id IS NULL)`);
  //   }

  //   if (search) {
  //     params.push(`%${search}%`);
  //     const searchIndex = params.length;
  //     whereParts.push(`(
  //       LOWER(COALESCE(base.so_number, '')) LIKE $${searchIndex}
  //       OR LOWER(COALESCE(base.customer_name, '')) LIKE $${searchIndex}
  //       OR LOWER(COALESCE(base.computed_status, '')) LIKE $${searchIndex}
  //       OR LOWER(COALESCE(base.sales_type, '')) LIKE $${searchIndex}
  //       OR LOWER(COALESCE(base.payment_method, '')) LIKE $${searchIndex}
  //     )`);
  //   }

  //   const whereSql = whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : '';

  //   const computedStatusExpression =
  //     mode === 'deliveries'
  //       ? `CASE
  //            WHEN COALESCE(sc.serial_count, 0) > 0 THEN 'in-progress'
  //            ELSE 'pending'
  //          END`
  //       : `COALESCE(so.status, 'pending')`;

  //   const baseCte = `
  //     WITH serial_counts AS (
  //       SELECT
  //         COALESCE(
  //           to_jsonb(sn)->>'salesId',
  //           to_jsonb(sn)->>'sales_id'
  //         ) AS so_id,
  //         COUNT(*)::int AS serial_count
  //       FROM tblserial_numbers sn
  //       WHERE COALESCE(
  //         to_jsonb(sn)->>'salesId',
  //         to_jsonb(sn)->>'sales_id'
  //       ) IS NOT NULL
  //       GROUP BY COALESCE(
  //         to_jsonb(sn)->>'salesId',
  //         to_jsonb(sn)->>'sales_id'
  //       )
  //     ),
  //     payment_totals AS (
  //       SELECT
  //         COALESCE(
  //           to_jsonb(sp)->>'so_id',
  //           to_jsonb(sp)->>'soId'
  //         ) AS so_id,
  //         COALESCE(
  //           STRING_AGG(
  //             DISTINCT NULLIF(COALESCE(to_jsonb(sp)->>'method', ''), ''),
  //             ', ' ORDER BY NULLIF(COALESCE(to_jsonb(sp)->>'method', ''), '')
  //           ),
  //           '-'
  //         ) AS payment_method,
  //         COALESCE(
  //           SUM(
  //             COALESCE(
  //               NULLIF(to_jsonb(sp)->>'amount', '')::numeric,
  //               0
  //             )
  //           ),
  //           0
  //         ) AS paid_amount
  //       FROM tblso_payments sp
  //       GROUP BY COALESCE(
  //         to_jsonb(sp)->>'so_id',
  //         to_jsonb(sp)->>'soId'
  //       )
  //     ),
  //     base AS (
  //       SELECT
  //         so.id,
  //         COALESCE(
  //           to_jsonb(so)->>'so_number',
  //           to_jsonb(so)->>'soNumber',
  //           ''
  //         ) AS so_number,
  //         COALESCE(
  //           to_jsonb(so)->>'customer_id',
  //           to_jsonb(so)->>'customerId',
  //           ''
  //         ) AS customer_id,
  //         COALESCE(
  //           to_jsonb(c)->>'name',
  //           to_jsonb(c)->>'customer_name',
  //           ''
  //         ) AS customer_name,
  //         COALESCE(
  //           to_jsonb(so)->>'total_amount',
  //           to_jsonb(so)->>'totalAmount',
  //           '0'
  //         ) AS total_amount,
  //         COALESCE(so.status, 'pending') AS original_status,
  //         COALESCE(
  //           to_jsonb(so)->>'scheduleDate',
  //           to_jsonb(so)->>'schedule_date',
  //           null
  //         ) AS schedule_date,
  //         COALESCE(
  //           to_jsonb(so)->>'created_at',
  //           to_jsonb(so)->>'createdAt',
  //           null
  //         ) AS created_at,
  //         COALESCE(
  //           to_jsonb(so)->>'salesType',
  //           to_jsonb(so)->>'sales_type',
  //           ''
  //         ) AS sales_type,
  //         COALESCE(
  //           to_jsonb(so)->>'branchId',
  //           to_jsonb(so)->>'branch_id',
  //           ''
  //         ) AS branch_id,
  //         COALESCE(
  //           to_jsonb(so)->>'projectName',
  //           to_jsonb(so)->>'project_name',
  //           ''
  //         ) AS project_name,
  //         COALESCE(
  //           to_jsonb(so)->>'projectCode',
  //           to_jsonb(so)->>'project_code',
  //           ''
  //         ) AS project_code,
  //         COALESCE(sc.serial_count, 0)::int AS serial_count,
  //         COALESCE(pt.payment_method, '-') AS payment_method,
  //         COALESCE(pt.paid_amount, 0) AS paid_amount,
  //         COALESCE(cd.concern_status, '') AS concern_status,
  //         GREATEST(
  //           COALESCE(
  //             NULLIF(
  //               COALESCE(
  //                 to_jsonb(so)->>'total_amount',
  //                 to_jsonb(so)->>'totalAmount',
  //                 '0'
  //               ),
  //               ''
  //             )::numeric,
  //             0
  //           ) - COALESCE(pt.paid_amount, 0),
  //           0
  //         ) AS remaining_amount,
  //         ${computedStatusExpression} AS computed_status
  //       FROM tblsales_order so
  //       LEFT JOIN tblcustomer c
  //         ON c.id::text = COALESCE(
  //           to_jsonb(so)->>'customer_id',
  //           to_jsonb(so)->>'customerId',
  //           ''
  //         )
  //       LEFT JOIN serial_counts sc
  //         ON sc.so_id = so.id::text
  //       LEFT JOIN payment_totals pt
  //         ON pt.so_id = so.id::text
  //       LEFT JOIN tblconcern_details cd
  //         ON cd.sales_id = so.id
  //     )
  //   `;

  //   const countSql = `
  //     ${baseCte}
  //     SELECT COUNT(*)::text AS total
  //     FROM base
  //     ${whereSql}
  //   `;

  //   const countResult = await this.databaseService.query<{ total: string }>(countSql, params);
  //   const total = Number(countResult.rows[0]?.total ?? 0);

  //   params.push(limit);
  //   params.push(offset);
  //   const limitIndex = params.length - 1;
  //   const offsetIndex = params.length;

  //   const listSql = `
  //     ${baseCte}
  //     SELECT
  //       base.id,
  //       base.so_number AS "soNumber",
  //       base.customer_id AS "customerId",
  //       base.customer_name AS "customerName",
  //       COALESCE(base.total_amount, '0')::numeric AS "totalAmount",
  //       base.computed_status AS status,
  //       base.sales_type AS "salesType",
  //       base.project_name AS "projectName",
  //       base.project_code AS "projectCode",
  //       base.payment_method AS "paymentMethod",
  //       base.schedule_date AS "scheduleDate",
  //       base.created_at AS "createdAt",
  //       base.serial_count AS "serialCount",
  //       base.concern_status AS "concernStatus"
  //     FROM base
  //     ${whereSql}
  //     ORDER BY base.id DESC
  //     LIMIT $${limitIndex}
  //     OFFSET $${offsetIndex}
  //   `;

  //   const listResult = await this.databaseService.query<{
  //     id: number;
  //     soNumber: string;
  //     customerId: string | null;
  //     customerName: string;
  //     totalAmount: string | number | null;
  //     status: string | null;
  //     salesType: string | null;
  //     projectName: string | null;
  //     projectCode: string | null;
  //     paymentMethod: string | null;
  //     scheduleDate: string | null;
  //     createdAt: string | null;
  //     serialCount: number;
  //     concernStatus: string | null;
  //   }>(listSql, params);

  //   return {
  //     success: true,
  //     items: listResult.rows.map((row) => ({
  //       id: row.id,
  //       soNumber: row.soNumber,
  //       customerId: row.customerId,
  //       customerName: row.customerName,
  //       totalAmount: Number(row.totalAmount ?? 0),
  //       status: row.status ?? 'pending',
  //       salesType: row.salesType ?? '',
  //       projectName: row.projectName ?? '',
  //       projectCode: row.projectCode ?? '',
  //       paymentMethod: row.paymentMethod ?? '-',
  //       scheduleDate: row.scheduleDate,
  //       createdAt: row.createdAt,
  //       serialCount: Number(row.serialCount ?? 0),
  //       concernStatus: row.concernStatus ?? '',
  //     })),
  //     meta: {
  //       page,
  //       limit,
  //       total,
  //       totalPages: Math.max(1, Math.ceil(total / limit)),
  //     },
  //   };
  // }
  private async fetchByMode(mode: SalesMode, query: ListSalesOrderQueryDto) {
    const page = this.normalizePage(query.page);
    const limit = this.normalizeLimit(query.limit);
    const offset = (page - 1) * limit;
    const search = String(query.search ?? '').trim().toLowerCase();
    const branchId = Number(query.branchId);

    try {
      const params: unknown[] = [];
      const whereParts: string[] = [];

    // --- 1. Mode Specific Filtering ---
    if (mode === 'deliveries') {
      whereParts.push(`LOWER(COALESCE(base.original_status, '')) NOT IN (
        'for_approval', 'for approval', 'approval', 'approved', 'complete', 'completed', 'cancelled', 'rejected'
      )`);
    } else if (mode === 'approvals') {
      whereParts.push(`LOWER(COALESCE(base.original_status, '')) IN (
        'for_approval', 'for approval', 'approval', 'pending_approval', 'pending approval'
      )`);
    } else if (mode === 'schedules') {
      whereParts.push(`REPLACE(REPLACE(LOWER(BTRIM(COALESCE(base.original_status, ''))), '_', '-'), ' ', '-') IN (
        'pending', 'for-delivery', 'to-remit'
      )`);
      whereParts.push(`LOWER(COALESCE(base.sales_type, '')) IN (
        'sales', 'sales and service', 'sales & service', 'sales-and-service', 'sales_and_service'
      )`);
    } else if (mode === 'sub-dealers') {
      whereParts.push(`REPLACE(REPLACE(LOWER(BTRIM(COALESCE(base.original_status, ''))), '_', '-'), ' ', '-') IN (
        'pending', 'for-delivery', 'to-remit'
      )`);
      whereParts.push(`LOWER(COALESCE(base.sales_type, '')) IN ('sub-dealer', 'sub dealer', 'sub_dealer')`);
    } else if (mode === 'services') {
      whereParts.push(`(
        LOWER(COALESCE(base.sales_type, '')) IN (
          'service', 'services', 'concern', 'concerns',
          'sales and service', 'sales & service', 'sales-and-service', 'sales_and_service'
        )
        OR EXISTS (SELECT 1 FROM tblservice_details sd WHERE sd.sales_id = base.id)
        OR EXISTS (SELECT 1 FROM tblconcern_details cd WHERE cd.sales_id = base.id)
      )`);
    } else if (mode === 'projects') {
      whereParts.push(`(
        LOWER(COALESCE(base.sales_type, '')) IN ('project', 'projects')
        OR EXISTS (SELECT 1 FROM tblproject_details pd WHERE pd.sales_id = base.id)
      )`);
    } else if (mode === 'distribution') {
      whereParts.push(`(
        LOWER(COALESCE(base.sales_type, '')) IN ('distribution', 'transfer', 'transfers')
        OR EXISTS (SELECT 1 FROM tbltransfer_details td WHERE td.sales_id = base.id)
      )`);
    } else if (mode === 'sales-receivable') {
      whereParts.push(`LOWER(COALESCE(base.original_status, '')) = 'remitted'`);
    } else if (mode === 'remitted-sales') {
      whereParts.push(`LOWER(COALESCE(base.original_status, '')) IN ('complete', 'completed')`);
    }

    // --- 2. Branch Security (Critical for Warehouseman) ---
    // if (Number.isFinite(branchId) && branchId > 0) {
    //   params.push(branchId);
    //   const branchIndex = params.length;
    //   // STRICTOR FILTER: Only show the specific branch. 
    //   // Removed "OR IS NULL" to prevent warehousemen from seeing unassigned global records.
    //   whereParts.push(`base.branch_id_numeric = $${branchIndex}`);
    // }

    // --- 3. Search Logic ---
    if (search) {
      params.push(`%${search}%`);
      const searchIndex = params.length;
      whereParts.push(`(
        LOWER(COALESCE(base.so_number, '')) LIKE $${searchIndex}
        OR LOWER(COALESCE(base.customer_name, '')) LIKE $${searchIndex}
        OR LOWER(COALESCE(base.computed_status, '')) LIKE $${searchIndex}
        OR LOWER(COALESCE(base.sales_type, '')) LIKE $${searchIndex}
        OR LOWER(COALESCE(base.payment_method, '')) LIKE $${searchIndex}
      )`);
    }

    const whereSql = whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : '';

    const computedStatusExpression =
      mode === 'deliveries'
        ? `CASE WHEN COALESCE(sc.serial_count, 0) > 0 THEN 'in-progress' ELSE 'pending' END`
        : `COALESCE(so.status, 'pending')`;

    const baseCte = `
      WITH serial_counts AS (
        SELECT 
          COALESCE(to_jsonb(sn)->>'salesId', to_jsonb(sn)->>'sales_id') AS so_id,
          COUNT(*)::int AS serial_count
        FROM tblserial_numbers sn
        WHERE COALESCE(to_jsonb(sn)->>'salesId', to_jsonb(sn)->>'sales_id') IS NOT NULL
        GROUP BY 1
      ),
      payment_totals AS (
        SELECT 
          COALESCE(to_jsonb(sp)->>'so_id', to_jsonb(sp)->>'soId') AS so_id,
          COUNT(*)::int AS payment_count,
          COALESCE(STRING_AGG(DISTINCT NULLIF(COALESCE(to_jsonb(sp)->>'method', ''), ''), ', '), '-') AS payment_method,
          SUM(COALESCE(NULLIF(to_jsonb(sp)->>'amount', '')::numeric, 0)) AS paid_amount
        FROM tblso_payments sp
        GROUP BY 1
      ),
      base AS (
        SELECT
          so.id,
          COALESCE(to_jsonb(so)->>'so_number', to_jsonb(so)->>'soNumber', '') AS so_number,
          COALESCE(to_jsonb(so)->>'customer_id', to_jsonb(so)->>'customerId', '') AS customer_id,
          COALESCE(to_jsonb(c)->>'name', to_jsonb(c)->>'customer_name', '') AS customer_name,
          COALESCE(to_jsonb(so)->>'total_amount', to_jsonb(so)->>'totalAmount', '0') AS total_amount,
          COALESCE(so.status, 'pending') AS original_status,
          COALESCE(to_jsonb(so)->>'scheduleDate', to_jsonb(so)->>'schedule_date') AS schedule_date,
          COALESCE(to_jsonb(so)->>'created_at', to_jsonb(so)->>'createdAt') AS created_at,
          COALESCE(to_jsonb(so)->>'salesType', to_jsonb(so)->>'sales_type', '') AS sales_type,
          -- Helper column for numeric filtering
          NULLIF(COALESCE(to_jsonb(so)->>'branchId', to_jsonb(so)->>'branch_id', ''), '')::numeric AS branch_id_numeric,
          COALESCE(to_jsonb(so)->>'projectName', to_jsonb(so)->>'project_name', '') AS project_name,
          COALESCE(to_jsonb(so)->>'projectCode', to_jsonb(so)->>'project_code', '') AS project_code,
          COALESCE(to_jsonb(so)->>'installer', '') AS installer,
          COALESCE(sc.serial_count, 0)::int AS serial_count,
          COALESCE(pt.payment_method, '-') AS payment_method,
          COALESCE(pt.paid_amount, 0) AS paid_amount,
          COALESCE(pt.payment_count, 0)::int AS payment_count,
          COALESCE(cd.concern_status, '') AS concern_status,
          ${computedStatusExpression} AS computed_status
        FROM tblsales_order so
        LEFT JOIN tblcustomer c ON c.id::text = COALESCE(to_jsonb(so)->>'customer_id', to_jsonb(so)->>'customerId', '')
        LEFT JOIN serial_counts sc ON sc.so_id = so.id::text
        LEFT JOIN payment_totals pt ON pt.so_id = so.id::text
        LEFT JOIN tblconcern_details cd ON cd.sales_id = so.id
      )
    `;

    // --- 4. Execution ---
    const countSql = `${baseCte} SELECT COUNT(*)::text AS total FROM base ${whereSql}`;
    const countResult = await this.databaseService.query<{ total: string }>(countSql, params);
    const total = Number(countResult.rows[0]?.total ?? 0);

    params.push(limit);
    params.push(offset);
    const limitIndex = params.length - 1;
    const offsetIndex = params.length;

    const listSql = `
      ${baseCte}
      SELECT
        id, so_number AS "soNumber", customer_id AS "customerId", customer_name AS "customerName",
        total_amount::numeric AS "totalAmount", paid_amount::numeric AS "paidAmount",
        payment_count AS "paymentCount", computed_status AS status, sales_type AS "salesType",
        project_name AS "projectName", project_code AS "projectCode", payment_method AS "paymentMethod",
        schedule_date AS "scheduleDate", created_at AS "createdAt", serial_count AS "serialCount",
        concern_status AS "concernStatus", installer
      FROM base
      ${whereSql}
      ORDER BY id DESC
      LIMIT $${limitIndex}
      OFFSET $${offsetIndex}
    `;

    const listResult = await this.databaseService.query<any>(listSql, params);

    return {
      success: true,
      items: listResult.rows.map((row) => ({
        ...row,
        totalAmount: Number(row.totalAmount ?? 0),
        paidAmount: Number(row.paidAmount ?? 0),
        paymentCount: Number(row.paymentCount ?? 0),
        serialCount: Number(row.serialCount ?? 0),
      })),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
    } catch (error) {
      return {
        success: false,
        message: `Failed to load sales orders: ${error instanceof Error ? error.message : String(error)}`,
        items: [],
        meta: {
          page,
          limit,
          total: 0,
          totalPages: 1,
        },
      };
    }
  }


  async create(
    createSalesOrderDto: CreateSalesOrderDto,
    userId?: number,
    branchId?: number,
    auditActor?: AuditActorContext,
  ) {
    // --- Defer PO creation for transfer SOs until after transaction ---
    let transferPOPayload: any = null;
    let transferPOBranchId: number | undefined = undefined;
    const payload = createSalesOrderDto;
    const allowCreateMissingSerials = Boolean((payload as unknown as Record<string, unknown>)['allowCreateMissingSerials']);
    const status = String(payload.status ?? 'pending').trim() || (
      ['service', 'concern', 'sales and service'].includes(String(payload.salesType ?? '').toLowerCase())
        ? 'after_sales'
        : 'pending'
    );
    const productItems = Array.isArray(payload.productItems) ? payload.productItems : [];
    const serviceItems = Array.isArray(payload.serviceItems) ? payload.serviceItems : [];

    const hasProductItems = productItems.length > 0;
    const hasServiceItems = serviceItems.length > 0;
    const hasProjectInfo = Boolean(
      payload.projectDetails || payload.projectName || payload.projectCode,
    );
    const hasTransferInfo = Boolean(payload.transferDetails);
    const hasConcernInfo = Boolean(payload.concernDetails);

    // For transfer SOs, require only transferDetails and productItems
    if (String(payload.salesType).toLowerCase() === 'transfer') {
      if (!hasTransferInfo) {
        return {
          success: false,
          message: 'Transfer Details are required for transfer sales orders.',
        };
      }
      if (!hasProductItems) {
        return {
          success: false,
          message: 'At least one Product Item is required for transfer sales orders.',
        };
      }
      // Only enforce serials if status is not 'pending' or 'scheduled'
      if (!['pending', 'scheduled', 'schedule today', 'schedule_today'].includes(status.toLowerCase())) {
        for (const [idx, item] of productItems.entries()) {
          if (!item.serialNumbers || typeof item.serialNumbers !== 'object' || Object.keys(item.serialNumbers).length === 0) {
            return {
              success: false,
              message: `Serial numbers are required for all product items in transfer sales orders (missing at index ${idx})`,
            };
          }
          // Check that at least one serial exists for each unit type
          const hasAnySerial = Object.entries(item.serialNumbers)
            .filter(([key]) => key.toLowerCase() !== 'status')
            .some(([, arr]) => Array.isArray(arr) && arr.length > 0);
          if (!hasAnySerial) {
            return {
              success: false,
              message: `At least one serial number must be provided for each product item in transfer sales orders (index ${idx})`,
            };
          }
        }
      }
    } else {
      if (!hasProductItems && !hasServiceItems && !hasProjectInfo && !hasTransferInfo && !hasConcernInfo) {
        return {
          success: false,
          message:
            'At least one sales product item, service item, project detail, transfer detail, or concern detail is required',
        };
      }
    }

    let result: any;
    try {
      result = await this.databaseService.withTransaction(async (client) => {
        // For transfer SOs, do not require or upsert customer
        let customerId: string | null = null;
        if (String(payload.salesType).toLowerCase() !== 'transfer') {
          customerId = await this.upsertCustomerFromPayload(client, payload);
        }

        // Upsert project if project details provided
        let projectId: number | null = null;
        if (String(payload.salesType).toLowerCase() === 'project') {
          projectId = await this.upsertProjectFromPayload(client, payload, userId, branchId);
        }

        let computedProductTotal = 0;
        for (const item of productItems) {
          const unitPrice = this.toOptionalNumber(item.unitPrice) ?? 0;
          const sellPrice = this.toOptionalNumber(item.sellPrice) ?? 0;
          const discountPrice = this.toOptionalNumber(item.discountPrice) ?? 0;
          const qty = this.toOptionalNumber(item.totalSetQty) ?? 0;
          const priceToUse = discountPrice > 0 ? discountPrice : sellPrice > 0 ? sellPrice : unitPrice;
          computedProductTotal += priceToUse * qty;
        }

        let computedServiceTotal = 0;
        for (const item of serviceItems) {
          const unitPrice = this.toOptionalNumber(item.serviceCost) ?? 0;
          const qty = this.toOptionalNumber(item.serviceDurationHours) ?? 0;
          const total = this.toOptionalNumber(item.serviceCost) ?? 0;

          // Prefer explicit total if provided, otherwise derive from unit price and quantity
          computedServiceTotal += total > 0 ? total : unitPrice * qty;
        }

        const computedTotalAmount = computedProductTotal + computedServiceTotal;
        const fallbackTotal = this.toOptionalNumber(payload.totalAmount) ?? 0;
        const totalAmount = computedTotalAmount > 0 ? computedTotalAmount : fallbackTotal;

        const salesColumns = await this.getTableColumns(client, 'tblsales_order');
        const soNumberColumn = this.pickColumn(salesColumns, ['so_number', 'soNumber']);
        const salesCustomerIdColumn = this.pickColumn(salesColumns, ['customer_id', 'customerId']);
        const totalAmountColumn = this.pickColumn(salesColumns, ['total_amount', 'totalAmount']);
        const scheduleDateColumn = this.pickColumn(salesColumns, ['scheduleDate', 'schedule_date']);
        const salesTypeColumn = this.pickColumn(salesColumns, ['salesType', 'sales_type']);
        const projectIdColumn = this.pickColumn(salesColumns, ['project_id', 'projectId']);
        const projectNameColumn = this.pickColumn(salesColumns, ['projectName', 'project_name']);
        const projectCodeColumn = this.pickColumn(salesColumns, ['projectCode', 'project_code']);
        const installerColumn = this.pickColumn(salesColumns, ['installer']);
        const remarksColumn = this.pickColumn(salesColumns, ['remarks']);
        const statusColumn = this.pickColumn(salesColumns, ['status']);
        const createdByColumn = this.pickColumn(salesColumns, ['created_by', 'createdBy']);
        const branchColumn = this.pickColumn(salesColumns, ['branchId', 'branch_id']);

        if (!salesCustomerIdColumn || !totalAmountColumn || !statusColumn) {
          throw new Error('tblsales_order columns are not aligned with expected fields');
        }

        const salesRecord: Record<string, unknown> = {
          [salesCustomerIdColumn]: customerId,
          [totalAmountColumn]: totalAmount,
          [statusColumn]: status,
        };

        if (createdByColumn && userId) {
          salesRecord[createdByColumn] = userId;
        }
        if (branchColumn && branchId) {
          salesRecord[branchColumn] = branchId;
        }
        if (soNumberColumn) {
          const generatedSoNumber = await this.soNumberService.generateNext(client);
          salesRecord[soNumberColumn] = generatedSoNumber;
        }
        if (scheduleDateColumn && payload.scheduleDate !== undefined) {
          salesRecord[scheduleDateColumn] = this.toIsoDateOrNull(payload.scheduleDate);
        }
        if (salesTypeColumn && payload.salesType !== undefined) {
          salesRecord[salesTypeColumn] = String(payload.salesType ?? '').trim();
        }
        if (projectIdColumn && projectId) {
          salesRecord[projectIdColumn] = projectId;
        }
        if (projectNameColumn && payload['projectName'] !== undefined) {
          salesRecord[projectNameColumn] = String(payload['projectName'] ?? '').trim();
        }
        if (projectCodeColumn && payload['projectCode'] !== undefined) {
          salesRecord[projectCodeColumn] = String(payload['projectCode'] ?? '').trim();
        }
        if (installerColumn && payload.installer !== undefined) {
          salesRecord[installerColumn] = String(payload.installer ?? '').trim();
        }
        if (remarksColumn && payload.remarks !== undefined) {
          salesRecord[remarksColumn] = String(payload.remarks ?? '');
        }

        const insertedSales = await this.runInsert(client, 'tblsales_order', salesRecord);
        if (insertedSales.rowCount === 0) {
          throw new Error('Failed to create sales order');
        }

        const salesOrderId = Number(insertedSales.rows[0].id);

        const paymentDetailsInput = payload.paymentDetails;
        const paymentDetailsList = Array.isArray(paymentDetailsInput)
          ? paymentDetailsInput
          : paymentDetailsInput
            ? [paymentDetailsInput]
            : [];

        if (paymentDetailsList.length > 0) {
          const paymentColumns = await this.getTableColumns(client, 'tblso_payments');
          const soIdColumn = this.pickColumn(paymentColumns, ['so_id', 'soId']);
          const methodColumn = this.pickColumn(paymentColumns, ['method']);
          const amountColumn = this.pickColumn(paymentColumns, ['amount']);
          const termsColumn = this.pickColumn(paymentColumns, ['terms']);
          const termsDueDateColumn = this.pickColumn(paymentColumns, ['termsDueDate', 'terms_due_date']);
          const paymentStatusColumn = this.pickColumn(paymentColumns, ['status']);
          const referenceNoColumn = this.pickColumn(paymentColumns, ['referenceNo', 'reference_no']);
          const paymentDateColumn = this.pickColumn(paymentColumns, ['paymentDate', 'payment_date']);
          const issuedByColumn = this.pickColumn(paymentColumns, ['issuedBy', 'issued_by']);
          const ccChargeColumn = this.pickColumn(paymentColumns, ['ccCharge', 'cc_charge']);
          const checkNoColumn = this.pickColumn(paymentColumns, ['checkNo', 'check_no']);
          const bankNameColumn = this.pickColumn(paymentColumns, ['bankName', 'bank_name']);
          const bankAccountColumn = this.pickColumn(paymentColumns, ['bankAccount', 'bank_account']);
          const postDatedColumn = this.pickColumn(paymentColumns, ['postDated', 'post_dated']);
          const downPaymentColumn = this.pickColumn(paymentColumns, ['downPayment', 'down_payment']);

          if (soIdColumn) {
            for (const [paymentIndex, paymentDetails] of paymentDetailsList.entries()) {
              if (!paymentDetails || typeof paymentDetails !== 'object') {
                throw new BadRequestException(`paymentDetails[${paymentIndex}] must be an object`);
              }

              const paymentPayload = paymentDetails as Record<string, unknown>;
              const method = this.validateSalesPaymentDetails(paymentPayload, paymentIndex);

              const paymentRecord: Record<string, unknown> = {
                [soIdColumn]: salesOrderId,
              };

              const amount = this.toOptionalNumber(paymentPayload.amount) ?? totalAmount;

              if (methodColumn) {
                paymentRecord[methodColumn] = method;
              }
              if (amountColumn) {
                paymentRecord[amountColumn] = amount;
              }
              if (termsColumn && paymentPayload.terms) {
                paymentRecord[termsColumn] = String(paymentPayload.terms).trim();
              }
              if (termsDueDateColumn) {
                paymentRecord[termsDueDateColumn] =
                  this.deriveTermsDueDate(paymentPayload, method) ?? null;
              }
              if (paymentStatusColumn) {
                const explicitStatus = String(paymentPayload.status ?? '').trim().toLowerCase();
                const normalizedStatus = ['paid', 'unpaid', 'overdue'].includes(explicitStatus)
                  ? explicitStatus
                  : this.getAutoPaymentStatus(method);
                paymentRecord[paymentStatusColumn] = normalizedStatus;
              }
              if (referenceNoColumn && paymentPayload.referenceNo) {
                paymentRecord[referenceNoColumn] = String(paymentPayload.referenceNo).trim();
              }
              if (paymentDateColumn) {
                paymentRecord[paymentDateColumn] =
                  this.toIsoDateOrNull(paymentPayload.paymentDate) ?? null;
              }
              if (issuedByColumn && paymentPayload.issuedBy) {
                paymentRecord[issuedByColumn] = String(paymentPayload.issuedBy).trim();
              }
              if (ccChargeColumn && paymentPayload.ccCharge) {
                paymentRecord[ccChargeColumn] = String(paymentPayload.ccCharge).trim();
              }
              if (checkNoColumn && paymentPayload.checkNo) {
                paymentRecord[checkNoColumn] = String(paymentPayload.checkNo).trim();
              }
              if (bankNameColumn && paymentPayload.bankName) {
                paymentRecord[bankNameColumn] = String(paymentPayload.bankName).trim();
              }
              if (bankAccountColumn && paymentPayload.bankAccount) {
                paymentRecord[bankAccountColumn] = String(paymentPayload.bankAccount).trim();
              }
              if (postDatedColumn && paymentPayload.postDated) {
                paymentRecord[postDatedColumn] = String(paymentPayload.postDated).trim();
              }

              const downPayment = this.toOptionalNumber(paymentPayload.downPayment);
              if (downPaymentColumn && downPayment !== null) {
                paymentRecord[downPaymentColumn] = downPayment;
              }

              await this.runInsert(client, 'tblso_payments', paymentRecord);
            }
          }
        }

        const serialColumns = await this.getTableColumns(client, 'tblserial_numbers');
        const serialCustomerIdColumn = this.pickColumn(serialColumns, ['customerId', 'customer_id']);
        const serialNumberColumn = this.pickColumn(serialColumns, ['serialNumber', 'serial_number']);
        const serialSalesIdColumn = this.pickColumn(serialColumns, ['salesId', 'sales_id']);
        const serialProductIdColumn = this.pickColumn(serialColumns, ['productId', 'product_id']);
        const serialCapacityIdColumn = this.pickColumn(serialColumns, ['capacityId', 'capacity_id']);
        const serialUnitTypeColumn = this.pickColumn(serialColumns, ['unitType', 'unit_type']);
        const serialStatusColumn = this.pickColumn(serialColumns, ['status']);
        const serialBranchIdColumn = this.pickColumn(serialColumns, ['branchId', 'branch_id']);
        const serialCreatedByColumn = this.pickColumn(serialColumns, ['created_by', 'createdBy']);
        const serialDealerIdColumn = this.pickColumn(serialColumns, ['dealerId', 'dealer_id']);
        const serialPoIdColumn = this.pickColumn(serialColumns, ['purchaseOrderId', 'purchase_order_id', 'po_id']);
        const serialPoNoColumn = this.pickColumn(serialColumns, ['purchaseOrderNo', 'purchase_order_no', 'po_no']);

        const transactionItemColumns = await this.getTableColumns(client, 'tbltransaction_product_items');
        if (transactionItemColumns.length > 0) {
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

          for (const item of productItems) {
            const transType = String(item.transType ?? 'sales').trim().toLowerCase();
            const productId = this.toOptionalNumber(item.productId);
            const capacityId = this.toOptionalNumber(item.capacityId);

            if (productId === null || capacityId === null) {
              throw new Error('productId and capacityId are required for sales items');
            }

            const itemRecord: Record<string, unknown> = {};
            if (transTypeColumn) itemRecord[transTypeColumn] = transType;
            if (productIdColumn) itemRecord[productIdColumn] = productId;
            if (capacityIdColumn) itemRecord[capacityIdColumn] = capacityId;
            if (unitPriceColumn) itemRecord[unitPriceColumn] = this.toOptionalNumber(item.unitPrice) ?? 0;
            if (sellPriceColumn) itemRecord[sellPriceColumn] = this.toOptionalNumber(item.sellPrice) ?? 0;
            if (discountPriceColumn) itemRecord[discountPriceColumn] = this.toOptionalNumber(item.discountPrice) ?? 0;
            if (unitTypesQtyColumn) {
              itemRecord[unitTypesQtyColumn] = JSON.stringify(item.unitTypesQty ?? []);
            }
            if (totalSetQtyColumn) itemRecord[totalSetQtyColumn] = this.toOptionalNumber(item.totalSetQty) ?? 0;
            if (purchaseIdColumn) itemRecord[purchaseIdColumn] = this.toOptionalNumber(item.purchaseId);
            if (salesIdColumn) itemRecord[salesIdColumn] = salesOrderId;
            if (itemStatusColumn) itemRecord[itemStatusColumn] = status;

            await this.runInsert(client, 'tbltransaction_product_items', itemRecord);

            const serialPayload =
              item.serialNumbers && typeof item.serialNumbers === 'object'
                ? (item.serialNumbers as Record<string, unknown>)
                : {};
            const serialStatus =
              String((serialPayload.status as string | undefined) ?? 'reserved')
                .trim()
                .toLowerCase() || 'reserved';

            for (const [unitTypeKey, values] of Object.entries(serialPayload)) {
              if (unitTypeKey.toLowerCase() === 'status') {
                continue;
              }

              const serialList = Array.isArray(values) ? values : [];
              for (const serialRaw of serialList) {
                const normalizedSerial = this.normalizeSerialNumber(serialRaw);
                if (!normalizedSerial) {
                  continue;
                }

                const existingSerialResult = await client.query<{
                  id: number;
                  sales_id: string | null;
                  purchase_id: string | null;
                }>(
                  `SELECT
                     sn.id,
                     COALESCE(to_jsonb(sn)->>'salesId', to_jsonb(sn)->>'sales_id') AS sales_id,
                     COALESCE(
                       to_jsonb(sn)->>'purchaseId',
                       to_jsonb(sn)->>'purchase_id',
                       to_jsonb(sn)->>'po_id'
                     ) AS purchase_id
                   FROM tblserial_numbers sn
                   WHERE LOWER(
                     regexp_replace(BTRIM(COALESCE(sn."serialNumber", '')), '\\s+', ' ', 'g')
                   ) = LOWER($1)
                   LIMIT 1`,
                  [normalizedSerial],
                );

                if (existingSerialResult.rowCount === 0) {
                  if (!allowCreateMissingSerials) {
                    throw new Error(`Serial number ${normalizedSerial} was not found in inventory`);
                  }

                  if (!serialNumberColumn) {
                    throw new Error('Serial number column is not configured in tblserial_numbers');
                  }

                  const insertRecord: Record<string, unknown> = {
                    [serialNumberColumn]: normalizedSerial,
                  };

                  if (serialBranchIdColumn) insertRecord[serialBranchIdColumn] = branchId ?? null;
                  if (serialSalesIdColumn) insertRecord[serialSalesIdColumn] = salesOrderId;
                  if (serialProductIdColumn) insertRecord[serialProductIdColumn] = productId;
                  if (serialCapacityIdColumn) insertRecord[serialCapacityIdColumn] = capacityId;
                  if (serialUnitTypeColumn) insertRecord[serialUnitTypeColumn] = unitTypeKey;
                  if (serialStatusColumn) insertRecord[serialStatusColumn] = serialStatus;
                  if (serialCustomerIdColumn) insertRecord[serialCustomerIdColumn] = customerId;
                  if (serialCreatedByColumn) insertRecord[serialCreatedByColumn] = userId ?? null;

                  // Migration-created serials are intentionally unlinked to PO/dealer sources.
                  if (serialDealerIdColumn) insertRecord[serialDealerIdColumn] = null;
                  if (serialPoIdColumn) insertRecord[serialPoIdColumn] = null;
                  if (serialPoNoColumn) insertRecord[serialPoNoColumn] = null;

                  await this.runInsert(client, 'tblserial_numbers', insertRecord);
                  continue;
                }

                const existingSerial = existingSerialResult.rows[0];
                if (
                  existingSerial.sales_id &&
                  Number(existingSerial.sales_id) !== salesOrderId
                ) {
                  throw new Error(
                    `Serial number ${normalizedSerial} is already linked to sales order ${existingSerial.sales_id}`,
                  );
                }

                const preservePurchaseLinkedMapping =
                  String(existingSerial.purchase_id ?? '').trim().length > 0;

                if (serialCustomerIdColumn) {
                  await client.query(
                    `UPDATE tblserial_numbers
                     SET
                       "branchId" = COALESCE($1, "branchId"),
                       "salesId" = $2,
                       "productId" = CASE WHEN $10 THEN "productId" ELSE $3 END,
                       "capacityId" = CASE WHEN $10 THEN "capacityId" ELSE $4 END,
                       "unitType" = $5,
                       status = $6,
                       "${serialCustomerIdColumn}" = $7,
                       created_by = COALESCE($8, created_by)
                     WHERE id = $9`,
                    [
                      branchId ?? null,
                      salesOrderId,
                      productId,
                      capacityId,
                      unitTypeKey,
                      serialStatus,
                      customerId,
                      userId ?? null,
                      existingSerial.id,
                      preservePurchaseLinkedMapping,
                    ],
                  );
                } else {
                  await client.query(
                    `UPDATE tblserial_numbers
                     SET
                       "branchId" = COALESCE($1, "branchId"),
                       "salesId" = $2,
                       "productId" = CASE WHEN $9 THEN "productId" ELSE $3 END,
                       "capacityId" = CASE WHEN $9 THEN "capacityId" ELSE $4 END,
                       "unitType" = $5,
                       status = $6,
                       created_by = COALESCE($7, created_by)
                     WHERE id = $8`,
                    [
                      branchId ?? null,
                      salesOrderId,
                      productId,
                      capacityId,
                      unitTypeKey,
                      serialStatus,
                      userId ?? null,
                      existingSerial.id,
                      preservePurchaseLinkedMapping,
                    ],
                  );
                }
              }
            }
          }
        }

        // Persist service details (if any)
        if (hasServiceItems) {
          const serviceColumns = await this.getTableColumns(client, 'tblservice_details');
          const serviceSalesIdColumn = this.pickColumn(serviceColumns, ['sales_id', 'salesId']);
          const serviceNameColumn = this.pickColumn(serviceColumns, ['service_name', 'serviceName']);
          const serviceDescriptionColumn = this.pickColumn(serviceColumns, ['service_description', 'serviceDescription']);
          const serviceTypeColumn = this.pickColumn(serviceColumns, ['service_type', 'serviceType']);
          const technicianAssignedColumn = this.pickColumn(serviceColumns, ['technician_assigned', 'technicianAssigned']);
          const serviceDateColumn = this.pickColumn(serviceColumns, ['service_date', 'serviceDate']);
          const serviceDurationHoursColumn = this.pickColumn(serviceColumns, ['service_duration_hours', 'serviceDurationHours']);
          const serviceCostColumn = this.pickColumn(serviceColumns, ['service_cost', 'serviceCost']);
          const partsCostColumn = this.pickColumn(serviceColumns, ['parts_cost', 'partsCost']);
          const laborCostColumn = this.pickColumn(serviceColumns, ['labor_cost', 'laborCost']);
          const serviceStatusColumn = this.pickColumn(serviceColumns, ['service_status', 'serviceStatus']);
          const serviceNotesColumn = this.pickColumn(serviceColumns, ['service_notes', 'serviceNotes']);

          if (serviceSalesIdColumn) {
            for (const item of serviceItems) {
              const record: Record<string, unknown> = {
                [serviceSalesIdColumn]: salesOrderId,
              };

              if (serviceNameColumn && item.serviceName !== undefined) {
                record[serviceNameColumn] = String(item.serviceName ?? '').trim();
              }
              if (serviceDescriptionColumn && item.serviceDescription !== undefined) {
                record[serviceDescriptionColumn] = String(item.serviceDescription ?? '').trim();
              }
              if (serviceTypeColumn && item.serviceType !== undefined) {
                record[serviceTypeColumn] = String(item.serviceType ?? '').trim();
              }
              if (technicianAssignedColumn && item.technicianAssigned !== undefined) {
                record[technicianAssignedColumn] = String(item.technicianAssigned ?? '').trim();
              }
              if (serviceDateColumn && item.serviceDate !== undefined) {
                record[serviceDateColumn] = this.toIsoDateOrNull(item.serviceDate);
              }
              if (serviceDurationHoursColumn && item.serviceDurationHours !== undefined) {
                record[serviceDurationHoursColumn] = this.toOptionalNumber(item.serviceDurationHours);
              }
              if (serviceCostColumn && item.serviceCost !== undefined) {
                record[serviceCostColumn] = this.toOptionalNumber(item.serviceCost) ?? 0;
              }
              if (partsCostColumn && item.partsCost !== undefined) {
                record[partsCostColumn] = this.toOptionalNumber(item.partsCost) ?? 0;
              }
              if (laborCostColumn && item.laborCost !== undefined) {
                record[laborCostColumn] = this.toOptionalNumber(item.laborCost) ?? 0;
              }
              if (serviceStatusColumn) {
                const status = String(item.serviceStatus ?? '').trim().toLowerCase();
                const validStatuses = ['scheduled', 'in_progress', 'completed', 'cancelled'];
                record[serviceStatusColumn] = validStatuses.includes(status) ? status : 'scheduled';
              }
              if (serviceNotesColumn && item.serviceNotes !== undefined) {
                record[serviceNotesColumn] = String(item.serviceNotes ?? '').trim();
              }

              await this.runInsert(client, 'tblservice_details', record);
            }
          }
        }

        // Persist project details (if provided)
        const projectDetails = payload.projectDetails;
        if (projectDetails || payload.projectName || payload.projectCode) {
          const projectColumns = await this.getTableColumns(client, 'tblproject_details');
          const projectSalesIdColumn = this.pickColumn(projectColumns, ['sales_id', 'salesId']);
          const projectNameColumn = this.pickColumn(projectColumns, ['project_name', 'projectName']);
          const projectCodeColumn = this.pickColumn(projectColumns, ['project_code', 'projectCode']);
          const projectLocationColumn = this.pickColumn(projectColumns, ['project_location', 'projectLocation']);
          const projectStartDateColumn = this.pickColumn(projectColumns, ['project_start_date', 'projectStartDate']);
          const projectEndDateColumn = this.pickColumn(projectColumns, ['project_end_date', 'projectEndDate']);
          const projectManagerColumn = this.pickColumn(projectColumns, ['project_manager', 'projectManager']);
          const projectStatusColumn = this.pickColumn(projectColumns, ['project_status', 'projectStatus']);
          const projectNotesColumn = this.pickColumn(projectColumns, ['project_notes', 'projectNotes']);

          if (projectSalesIdColumn) {
            // Upsert behavior: remove any existing project details for this sales order
            await client.query(
              `DELETE FROM tblproject_details WHERE "${projectSalesIdColumn}" = $1`,
              [salesOrderId],
            );

            const record: Record<string, unknown> = {
              [projectSalesIdColumn]: salesOrderId,
            };

            const details = projectDetails ?? {
              projectName: payload.projectName,
              projectCode: payload.projectCode,
            };

            if (projectNameColumn && details?.projectName !== undefined) {
              record[projectNameColumn] = String(details.projectName ?? '').trim();
            }
            if (projectCodeColumn && details?.projectCode !== undefined) {
              record[projectCodeColumn] = String(details.projectCode ?? '').trim();
            }
            if (projectLocationColumn && details?.projectLocation !== undefined) {
              record[projectLocationColumn] = String(details.projectLocation ?? '').trim();
            }
            if (projectStartDateColumn && details?.projectStartDate !== undefined) {
              record[projectStartDateColumn] = this.toIsoDateOrNull(details.projectStartDate);
            }
            if (projectEndDateColumn && details?.projectEndDate !== undefined) {
              record[projectEndDateColumn] = this.toIsoDateOrNull(details.projectEndDate);
            }
            if (projectManagerColumn && details?.projectManager !== undefined) {
              record[projectManagerColumn] = String(details.projectManager ?? '').trim();
            }
            if (projectStatusColumn && details?.projectStatus !== undefined) {
              record[projectStatusColumn] = String(details.projectStatus ?? '').trim();
            }
            if (projectNotesColumn && details?.projectNotes !== undefined) {
              record[projectNotesColumn] = String(details.projectNotes ?? '').trim();
            }

            await this.runInsert(client, 'tblproject_details', record);
          }
        }

        // Persist transfer details (if provided)
        let transferDetailsId: number | null = null;
        if (payload.transferDetails) {
          const transferColumns = await this.getTableColumns(client, 'tbltransfer_details');
          const transferSalesIdColumn = this.pickColumn(transferColumns, ['sales_id', 'salesId']);
          const fromBranchIdColumn = this.pickColumn(transferColumns, ['from_branch_id', 'fromBranchId']);
          const toBranchIdColumn = this.pickColumn(transferColumns, ['to_branch_id', 'toBranchId']);
          const transferDateColumn = this.pickColumn(transferColumns, ['transfer_date', 'transferDate']);
          const expectedDeliveryDateColumn = this.pickColumn(transferColumns, ['expected_delivery_date', 'expectedDeliveryDate']);
          const actualDeliveryDateColumn = this.pickColumn(transferColumns, ['actual_delivery_date', 'actualDeliveryDate']);
          const transferStatusColumn = this.pickColumn(transferColumns, ['transfer_status', 'transferStatus']);
          const transferNotesColumn = this.pickColumn(transferColumns, ['transfer_notes', 'transferNotes']);
          const sentByColumn = this.pickColumn(transferColumns, ['sent_by', 'sentBy']);
          const receivedByColumn = this.pickColumn(transferColumns, ['received_by', 'receivedBy']);
          const acknowledgedByColumn = this.pickColumn(transferColumns, ['acknowledged_by', 'acknowledgedBy']);
          const acknowledgedAtColumn = this.pickColumn(transferColumns, ['acknowledged_at', 'acknowledgedAt']);

          if (transferSalesIdColumn) {
            await client.query(
              `DELETE FROM tbltransfer_details WHERE "${transferSalesIdColumn}" = $1`,
              [salesOrderId],
            );

            const record: Record<string, unknown> = {
              [transferSalesIdColumn]: salesOrderId,
            };

            const details = payload.transferDetails;
            if (fromBranchIdColumn && details.fromBranchId !== undefined) {
              record[fromBranchIdColumn] = this.toOptionalNumber(details.fromBranchId);
            }
            if (toBranchIdColumn && details.toBranchId !== undefined) {
              record[toBranchIdColumn] = this.toOptionalNumber(details.toBranchId);
            }
            if (transferDateColumn && details.transferDate !== undefined) {
              record[transferDateColumn] = this.toIsoDateOrNull(details.transferDate);
            }
            if (expectedDeliveryDateColumn && details.expectedDeliveryDate !== undefined) {
              record[expectedDeliveryDateColumn] = this.toIsoDateOrNull(details.expectedDeliveryDate);
            }
            if (actualDeliveryDateColumn && details.actualDeliveryDate !== undefined) {
              record[actualDeliveryDateColumn] = this.toIsoDateOrNull(details.actualDeliveryDate);
            }
            if (transferStatusColumn && details.transferStatus !== undefined) {
              record[transferStatusColumn] = String(details.transferStatus ?? '').trim();
            }
            if (transferNotesColumn && details.transferNotes !== undefined) {
              record[transferNotesColumn] = String(details.transferNotes ?? '').trim();
            }
            if (sentByColumn && details.sentBy !== undefined) {
              record[sentByColumn] = this.toOptionalNumber(details.sentBy);
            }
            if (receivedByColumn && details.receivedBy !== undefined) {
              record[receivedByColumn] = this.toOptionalNumber(details.receivedBy);
            }
            if (acknowledgedByColumn && details.acknowledgedBy !== undefined) {
              record[acknowledgedByColumn] = this.toOptionalNumber(details.acknowledgedBy);
            }
            if (acknowledgedAtColumn && details.acknowledgedAt !== undefined) {
              record[acknowledgedAtColumn] = this.toIsoDateOrNull(details.acknowledgedAt);
            }

            const insertedTransfer = await this.runInsert(client, 'tbltransfer_details', record);
            transferDetailsId = Number(insertedTransfer.rows[0]?.id ?? null);
          }

          // --- Hybrid SO/PO Transfer Logic ---
          // Only trigger for transfer sales type
          if (String(payload.salesType).toLowerCase() === 'transfer') {
            // Prepare PO payload for receiving branch, but DO NOT create PO here!
            transferPOPayload = {
              productItems: productItems.map((item) => ({ ...item, transType: 'purchase' })),
              branchId: this.toOptionalNumber(payload.transferDetails?.toBranchId) ?? undefined,
              linkedSalesOrderId: null, // will set after commit
              status: 'AWAITING_RECEIPT',
            };
            transferPOPayload.totalAmount = productItems.reduce((sum, item) => {
              const price = typeof item.unitPrice === 'number' ? item.unitPrice : Number(item.unitPrice) || 0;
              const qty = typeof item.totalSetQty === 'number' ? item.totalSetQty : Number(item.totalSetQty) || 0;
              return sum + price * qty;
            }, 0);
            // Find or create 'System Transfer' vendor and use its UUID
            let systemVendorId: string | null = null;
            try {
              const vendorResult = await this.databaseService.query(
                `SELECT id FROM tblvendors WHERE LOWER(name) = 'system transfer' LIMIT 1`
              );
              if (vendorResult.rowCount > 0) {
                systemVendorId = String(vendorResult.rows[0].id);
              } else {
                const insertResult = await this.databaseService.query(
                  `INSERT INTO tblvendors (name) VALUES ('System Transfer') RETURNING id`
                );
                systemVendorId = String(insertResult.rows[0].id);
              }
            } catch (err) {
              console.error('[Transfer SO] Failed to find or create System Transfer vendor:', err);
            }
            transferPOPayload.vendorId = systemVendorId;
            transferPOPayload.vendor = { name: 'System Transfer' };
            transferPOBranchId = this.toOptionalNumber(payload.transferDetails?.toBranchId) ?? undefined;
          }
        }

        // Persist expense details (if provided)
        if (payload.expenseDetails && transferDetailsId) {
          const expenseColumns = await this.getTableColumns(client, 'tblexpense_details');
          const expenseSalesIdColumn = this.pickColumn(expenseColumns, ['sales_id', 'salesId']);
          const expenseTransferIdColumn = this.pickColumn(expenseColumns, ['transfer_id', 'transferId']);
          const expenseTypeColumn = this.pickColumn(expenseColumns, ['expense_type', 'expenseType']);
          const expenseDescriptionColumn = this.pickColumn(expenseColumns, ['expense_description', 'expenseDescription']);
          const amountColumn = this.pickColumn(expenseColumns, ['amount']);
          const expenseDateColumn = this.pickColumn(expenseColumns, ['expense_date', 'expenseDate']);
          const paidToColumn = this.pickColumn(expenseColumns, ['paid_to', 'paidTo']);
          const paymentMethodColumn = this.pickColumn(expenseColumns, ['payment_method', 'paymentMethod']);
          const referenceNoColumn = this.pickColumn(expenseColumns, ['reference_no', 'referenceNo']);
          const createdByColumn = this.pickColumn(expenseColumns, ['created_by', 'createdBy']);

          if (expenseSalesIdColumn) {
            await client.query(
              `DELETE FROM tblexpense_details WHERE "${expenseSalesIdColumn}" = $1`,
              [salesOrderId],
            );

            for (const expense of payload.expenseDetails) {
              const record: Record<string, unknown> = {};

              record[expenseSalesIdColumn] = salesOrderId;
              record[expenseTransferIdColumn ?? 'transfer_id'] = transferDetailsId;
              if (expenseTypeColumn && expense.expenseType !== undefined) {
                record[expenseTypeColumn] = String(expense.expenseType ?? '').trim();
              }
              if (expenseDescriptionColumn && expense.expenseDescription !== undefined) {
                record[expenseDescriptionColumn] = String(expense.expenseDescription ?? '').trim();
              }
              if (amountColumn) {
                record[amountColumn] = this.toOptionalNumber(expense.amount) ?? 0;
              }
              if (expenseDateColumn && expense.expenseDate !== undefined) {
                record[expenseDateColumn] = this.toIsoDateOrNull(expense.expenseDate);
              }
              if (paidToColumn && expense.paidTo !== undefined) {
                record[paidToColumn] = String(expense.paidTo ?? '').trim();
              }
              if (paymentMethodColumn && expense.paymentMethod !== undefined) {
                record[paymentMethodColumn] = String(expense.paymentMethod ?? '').trim();
              }
              if (referenceNoColumn && expense.referenceNo !== undefined) {
                record[referenceNoColumn] = String(expense.referenceNo ?? '').trim();
              }
              if (createdByColumn && userId !== undefined) {
                record[createdByColumn] = userId;
              }

              await this.runInsert(client, 'tblexpense_details', record);
            }
          }
        }

        // Persist concern details (if provided)
        if (payload.concernDetails) {
          const concernColumns = await this.getTableColumns(client, 'tblconcern_details');
          const concernSalesIdColumn = this.pickColumn(concernColumns, ['sales_id', 'salesId']);
          const concernCustomerIdColumn = this.pickColumn(concernColumns, ['customer_id', 'customerId']);
          const concernTypeColumn = this.pickColumn(concernColumns, ['concern_type', 'concernType']);
          const concernSubjectColumn = this.pickColumn(concernColumns, ['concern_subject', 'concernSubject']);
          const concernDescriptionColumn = this.pickColumn(concernColumns, ['concern_description', 'concernDescription']);
          const concernStatusColumn = this.pickColumn(concernColumns, ['concern_status', 'concernStatus']);
          const priorityColumn = this.pickColumn(concernColumns, ['priority']);
          const assignedToColumn = this.pickColumn(concernColumns, ['assigned_to', 'assignedTo']);
          const resolutionNotesColumn = this.pickColumn(concernColumns, ['resolution_notes', 'resolutionNotes']);
          const resolvedAtColumn = this.pickColumn(concernColumns, ['resolved_at', 'resolvedAt']);

          if (concernSalesIdColumn) {
            await client.query(
              `DELETE FROM tblconcern_details WHERE "${concernSalesIdColumn}" = $1`,
              [salesOrderId],
            );

            const record: Record<string, unknown> = {
              [concernSalesIdColumn]: salesOrderId,
            };

            const details = payload.concernDetails;
            if (concernCustomerIdColumn && details.customerId !== undefined) {
              record[concernCustomerIdColumn] = String(details.customerId ?? '').trim();
            }
            if (concernTypeColumn) record[concernTypeColumn] = String(details.concernType ?? '').trim();
            if (concernSubjectColumn) record[concernSubjectColumn] = String(details.concernSubject ?? '').trim();
            if (concernDescriptionColumn) record[concernDescriptionColumn] = String(details.concernDescription ?? '').trim();
            if (concernStatusColumn) {
              const concernStatus = String(details.concernStatus ?? '').trim().toLowerCase();
              const validConcernStatuses = ['open', 'in_progress', 'resolved', 'closed', 'in-progress', 'reschedule', 'pulled-out', 'warranty', 'void-warranty', 'complete'];
              record[concernStatusColumn] = validConcernStatuses.includes(concernStatus) ? concernStatus : concernStatus || 'open';
            }
            if (priorityColumn) {
              const priority = String(details.priority ?? '').trim().toLowerCase();
              const validPriorities = ['low', 'medium', 'high', 'urgent'];
              record[priorityColumn] = validPriorities.includes(priority) ? priority : null;
            }
            if (assignedToColumn && details.assignedTo !== undefined) record[assignedToColumn] = this.toOptionalNumber(details.assignedTo);
            if (resolutionNotesColumn) record[resolutionNotesColumn] = String(details.resolutionNotes ?? '').trim();
            if (resolvedAtColumn) record[resolvedAtColumn] = this.toIsoDateOrNull(details.resolvedAt);

            await this.runInsert(client, 'tblconcern_details', record);
          }
        }

        return {
          salesOrderId,
          customerId,
          totalAmount,
          status,
        };
      });

      // --- After transaction: if transfer SO, create PO and update linkage ---
      if (transferPOPayload && result?.salesOrderId) {
        const poPayload = {
          ...transferPOPayload,
          productItems: (transferPOPayload.productItems || []).map((item: any) => ({
            ...item,
            salesId: result.salesOrderId,
          })),
          linkedSalesOrderId: result.salesOrderId,
        };
        try {
          const poResult = await this.purchaseService.create(poPayload, userId, transferPOBranchId);
          if (poResult && poResult.success !== false && poResult.data?.purchaseOrderId) {
            const linkedPurchaseOrderId = poResult.data.purchaseOrderId;
            // Update SO with linked PO
            await this.databaseService.query(
              `UPDATE tblsales_order SET linked_purchase_order_id = $1 WHERE id = $2`,
              [linkedPurchaseOrderId, result.salesOrderId],
            );
            // Update PO with linked SO (if not already set)
            await this.databaseService.query(
              `UPDATE tblpurchase_orders SET linked_sales_order_id = $1 WHERE id = $2`,
              [result.salesOrderId, linkedPurchaseOrderId],
            );
          } else {
            console.error('[Transfer SO] PO creation failed (post-commit):', poResult?.message, { poPayload });
          }
        } catch (err) {
          console.error('[Transfer SO] PO creation threw error (post-commit):', err);
        }
      }
      const afterSnapshot = await this.getSalesOrderAuditSnapshot(result.salesOrderId);
      await this.auditLogService.logMutation({
        action: 'SALES_ORDER_CREATE',
        entityType: 'sales-order',
        entityId: result.salesOrderId,
        actor: auditActor ?? { userId, branchId },
        description: `Created sales order ${String((afterSnapshot?.soNumber as string | undefined) ?? '').trim() || `#${result.salesOrderId}`}`,
        requestBody: createSalesOrderDto as unknown as Record<string, unknown>,
        after: afterSnapshot,
      });

      return {
        success: true,
        message: 'Sales order created successfully',
        data: result,
      };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to create sales order',
      };
    }
  }

  findAll(query: ListSalesOrderQueryDto) {
    return this.getMasterData(query);
  }

  getDeliveries(query: ListSalesOrderQueryDto) {
    return this.fetchByMode('deliveries', query);
  }

  getApprovals(query: ListSalesOrderQueryDto) {
    return this.fetchByMode('approvals', query);
  }

  getMasterData(query: ListSalesOrderQueryDto) {
    return this.fetchByMode('master-data', query);
  }

  getSchedules(query: ListSalesOrderQueryDto) {
    return this.fetchByMode('schedules', query);
  }

  getServices(query: ListSalesOrderQueryDto) {
    return this.fetchByMode('services', query);
  }

  getProjects(query: ListSalesOrderQueryDto) {
    return this.fetchByMode('projects', query);
  }

  getSubDealers(query: ListSalesOrderQueryDto) {
    return this.fetchByMode('sub-dealers', query);
  }

  getDistribution(query: ListSalesOrderQueryDto) {
    return this.fetchByMode('distribution', query);
  }

  getSalesReceivable(query: ListSalesOrderQueryDto) {
    return this.fetchByMode('sales-receivable', query);
  }

  getRemittedSales(query: ListSalesOrderQueryDto) {
    return this.fetchByMode('remitted-sales', query);
  }

  async getCustomers(search?: string) {
    const normalizedSearch = String(search ?? '').trim();

    try {
      const params: unknown[] = [];
      let whereClause = '';

      if (normalizedSearch) {
        params.push(`%${normalizedSearch}%`);
        whereClause = `WHERE LOWER(COALESCE(to_jsonb(c)->>'name', to_jsonb(c)->>'customer_name', '')) LIKE LOWER($1)`;
      }

      const result = await this.databaseService.query<{
        id: string;
        name: string | null;
        address: string | null;
        contactPerson: string | null;
        contactNumber: string | null;
        email: string | null;
        tinNumber: string | null;
      }>(
        `SELECT
           c.id::text AS id,
           COALESCE(to_jsonb(c)->>'name', to_jsonb(c)->>'customer_name') AS name,
           COALESCE(to_jsonb(c)->>'address', '') AS address,
           COALESCE(to_jsonb(c)->>'contact_person', to_jsonb(c)->>'contactPerson', '') AS "contactPerson",
           COALESCE(to_jsonb(c)->>'contact_number', to_jsonb(c)->>'contactNumber', '') AS "contactNumber",
           COALESCE(to_jsonb(c)->>'email', '') AS email,
           COALESCE(to_jsonb(c)->>'tin_number', to_jsonb(c)->>'tinNumber', '') AS "tinNumber"
         FROM tblcustomer c
         ${whereClause}
         ORDER BY COALESCE(to_jsonb(c)->>'name', to_jsonb(c)->>'customer_name') ASC
         LIMIT 50`,
        params,
      );

      return {
        success: true,
        items: result.rows.map((row) => ({
          id: row.id,
          name: row.name ?? row.id,
          address: row.address ?? '',
          contact_person: row.contactPerson ?? '',
          contact_number: row.contactNumber ?? '',
          email: row.email ?? '',
          tin_number: row.tinNumber ?? '',
        })),
      };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to load customers',
        items: [],
      };
    }
  }

  async listCustomers(options: { search?: string; type?: string; page?: number; limit?: number }) {
    const page = Math.max(1, Number(options.page ?? 1));
    const limit = Math.max(1, Math.min(200, Number(options.limit ?? 50)));
    const offset = (page - 1) * limit;

    const search = String(options.search ?? '').trim();
    const type = String(options.type ?? '').trim();

    try {
      const params: unknown[] = [];
      const whereParts: string[] = [];

      if (search) {
        params.push(`%${search}%`);
        whereParts.push(
          `LOWER(COALESCE(to_jsonb(c)->>'name', to_jsonb(c)->>'customer_name', '')) LIKE LOWER($${
            params.length
          })`,
        );
      }

      if (type) {
        params.push(type);
        whereParts.push(
          `LOWER(COALESCE(to_jsonb(c)->>'customer_type', to_jsonb(c)->>'customerType', 'regular')) = LOWER($${
            params.length
          })`,
        );
      }

      const whereSql = whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : '';

      const countResult = await this.databaseService.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM tblcustomer c ${whereSql}`,
        params,
      );
      const total = Number(countResult.rows[0]?.count ?? 0);
      const totalPages = Math.max(1, Math.ceil(total / limit));

      const listParams = [...params, limit, offset];
      const listResult = await this.databaseService.query<{
        id: string;
        name: string | null;
        customerType: string | null;
        creditLimit: string | null;
        currentBalance: string | null;
        paymentTerms: string | null;
        address: string | null;
        contactPerson: string | null;
        contactNumber: string | null;
        email: string | null;
        tinNumber: string | null;
        createdAt: string | null;
        updatedAt: string | null;
      }>(
        `SELECT
           c.id::text AS id,
           COALESCE(to_jsonb(c)->>'name', to_jsonb(c)->>'customer_name') AS name,
           COALESCE(to_jsonb(c)->>'customer_type', to_jsonb(c)->>'customerType', 'regular') AS "customerType",
           COALESCE(to_jsonb(c)->>'credit_limit', '') AS "creditLimit",
           -- Compute real outstanding balance: totalCharges - totalSettled
           (
             COALESCE((
               SELECT SUM(so.total_amount)
               FROM tblsales_order so
               WHERE so.customer_id = c.id
             ), 0)
             -
             COALESCE((
               SELECT SUM(cp.payment_amount)
               FROM tblcustomer_payments cp
               WHERE cp.customer_id = c.id
             ), 0)
             -
             COALESCE((
               SELECT SUM(COALESCE(NULLIF(COALESCE(to_jsonb(sp)->>'downPayment', to_jsonb(sp)->>'down_payment', ''), '')::numeric, 0))
               FROM tblso_payments sp
               JOIN tblsales_order so2 ON so2.id = sp.so_id
               WHERE so2.customer_id = c.id
                 AND LOWER(COALESCE(to_jsonb(sp)->>'status', '')) != 'paid'
                 AND COALESCE(NULLIF(COALESCE(to_jsonb(sp)->>'downPayment', to_jsonb(sp)->>'down_payment', ''), '')::numeric, 0) > 0
             ), 0)
             -
             COALESCE((
               SELECT SUM(COALESCE(NULLIF(to_jsonb(sp)->>'amount', '')::numeric, 0))
               FROM tblso_payments sp
               JOIN tblsales_order so2 ON so2.id = sp.so_id
               WHERE so2.customer_id = c.id
                 AND LOWER(COALESCE(to_jsonb(sp)->>'status', '')) = 'paid'
             ), 0)
           )::text AS "currentBalance",
           COALESCE(to_jsonb(c)->>'payment_terms', '') AS "paymentTerms",
           COALESCE(to_jsonb(c)->>'address', '') AS address,
           COALESCE(to_jsonb(c)->>'contact_person', to_jsonb(c)->>'contactPerson', '') AS "contactPerson",
           COALESCE(to_jsonb(c)->>'contact_number', to_jsonb(c)->>'contactNumber', '') AS "contactNumber",
           COALESCE(to_jsonb(c)->>'email', '') AS email,
           COALESCE(to_jsonb(c)->>'tin_number', to_jsonb(c)->>'tinNumber', '') AS "tinNumber",
           COALESCE(to_jsonb(c)->>'created_at', to_jsonb(c)->>'createdAt', null) AS "createdAt",
           COALESCE(to_jsonb(c)->>'updated_at', to_jsonb(c)->>'updatedAt', null) AS "updatedAt"
         FROM tblcustomer c
         ${whereSql}
         ORDER BY COALESCE(to_jsonb(c)->>'name', to_jsonb(c)->>'customer_name', '') ASC
         LIMIT $${listParams.length - 1}
         OFFSET $${listParams.length}`,
        listParams,
      );

      return {
        success: true,
        items: listResult.rows.map((row) => ({
          id: row.id,
          name: row.name ?? row.id,
          customer_type: row.customerType ?? 'regular',
          credit_limit: this.toOptionalNumber(row.creditLimit) ?? 0,
          current_balance: this.toOptionalNumber(row.currentBalance) ?? 0,
          payment_terms: this.toOptionalNumber(row.paymentTerms) ?? 0,
          address: row.address ?? '',
          contact_person: row.contactPerson ?? '',
          contact_number: row.contactNumber ?? '',
          email: row.email ?? '',
          tin_number: row.tinNumber ?? '',
          created_at: row.createdAt ?? null,
          updated_at: row.updatedAt ?? null,
        })),
        meta: {
          page,
          limit,
          total,
          totalPages,
        },
      };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to list customers',
        items: [],
        meta: {
          page,
          limit,
          total: 0,
          totalPages: 1,
        },
      };
    }
  }

  async getCustomer(customerId: string) {
    const id = String(customerId ?? '').trim();
    if (!id) {
      return { success: false, message: 'Invalid customer id' };
    }

    try {
      const result = await this.databaseService.query<{
        id: string;
        name: string | null;
        customerType: string | null;
        creditLimit: string | null;
        currentBalance: string | null;
        paymentTerms: string | null;
        address: string | null;
        contactPerson: string | null;
        contactNumber: string | null;
        email: string | null;
        tinNumber: string | null;
        createdAt: string | null;
        updatedAt: string | null;
      }>(
        `SELECT
           c.id::text AS id,
           COALESCE(to_jsonb(c)->>'name', to_jsonb(c)->>'customer_name') AS name,
           COALESCE(to_jsonb(c)->>'customer_type', to_jsonb(c)->>'customerType', 'regular') AS "customerType",
           COALESCE(to_jsonb(c)->>'credit_limit', '') AS "creditLimit",
           COALESCE(to_jsonb(c)->>'current_balance', '') AS "currentBalance",
           COALESCE(to_jsonb(c)->>'payment_terms', '') AS "paymentTerms",
           COALESCE(to_jsonb(c)->>'address', '') AS address,
           COALESCE(to_jsonb(c)->>'contact_person', to_jsonb(c)->>'contactPerson', '') AS "contactPerson",
           COALESCE(to_jsonb(c)->>'contact_number', to_jsonb(c)->>'contactNumber', '') AS "contactNumber",
           COALESCE(to_jsonb(c)->>'email', '') AS email,
           COALESCE(to_jsonb(c)->>'tin_number', to_jsonb(c)->>'tinNumber', '') AS "tinNumber",
           COALESCE(to_jsonb(c)->>'created_at', to_jsonb(c)->>'createdAt', null) AS "createdAt",
           COALESCE(to_jsonb(c)->>'updated_at', to_jsonb(c)->>'updatedAt', null) AS "updatedAt"
         FROM tblcustomer c
         WHERE c.id::text = $1
         LIMIT 1`,
        [id],
      );

      if (result.rowCount === 0) {
        return { success: false, message: `Customer ${id} not found` };
      }

      const row = result.rows[0];
      return {
        success: true,
        data: {
          id: row.id,
          name: row.name ?? row.id,
          customer_type: row.customerType ?? 'regular',
          credit_limit: this.toOptionalNumber(row.creditLimit) ?? 0,
          current_balance: this.toOptionalNumber(row.currentBalance) ?? 0,
          payment_terms: this.toOptionalNumber(row.paymentTerms) ?? 0,
          address: row.address ?? '',
          contact_person: row.contactPerson ?? '',
          contact_number: row.contactNumber ?? '',
          email: row.email ?? '',
          tin_number: row.tinNumber ?? '',
          created_at: row.createdAt ?? null,
          updated_at: row.updatedAt ?? null,
        },
      };
    } catch (error) {
      return { success: false, message: error instanceof Error ? error.message : 'Failed to get customer' };
    }
  }

  async createCustomer(dto: CreateCustomerDto, userId?: number) {
    try {
      const customerColumns = await this.getTableColumns(this.databaseService, 'tblcustomer');
      const customerIdColumn = this.pickColumn(customerColumns, ['id']);
      const customerNameColumn = this.pickColumn(customerColumns, ['name', 'customer_name']);
      const customerAddressColumn = this.pickColumn(customerColumns, ['address']);
      const customerContactPersonColumn = this.pickColumn(customerColumns, [
        'contact_person',
        'contactPerson',
      ]);
      const customerContactNumberColumn = this.pickColumn(customerColumns, [
        'contact_number',
        'contactNumber',
      ]);
      const customerEmailColumn = this.pickColumn(customerColumns, ['email']);
      const customerTinColumn = this.pickColumn(customerColumns, ['tin_number', 'tinNumber']);
      const customerTypeColumn = this.pickColumn(customerColumns, ['customer_type', 'customerType']);
      const creditLimitColumn = this.pickColumn(customerColumns, ['credit_limit', 'creditLimit']);
      const paymentTermsColumn = this.pickColumn(customerColumns, ['payment_terms', 'paymentTerms']);
      const createdAtColumn = this.pickColumn(customerColumns, ['created_at', 'createdAt']);

      const name = String(dto.name ?? '').trim();
      if (!name) {
        return { success: false, message: 'Customer name is required' };
      }

      const record: Record<string, unknown> = {};
      if (customerNameColumn) record[customerNameColumn] = name;
      if (customerIdColumn) record[customerIdColumn] = randomUUID();
      if (customerAddressColumn && dto.address) record[customerAddressColumn] = String(dto.address).trim();
      if (customerContactPersonColumn && dto.contactPerson)
        record[customerContactPersonColumn] = String(dto.contactPerson).trim();
      if (customerContactNumberColumn && dto.contactNumber)
        record[customerContactNumberColumn] = String(dto.contactNumber).trim();
      if (customerEmailColumn && dto.email) record[customerEmailColumn] = String(dto.email).trim();
      if (customerTinColumn && dto.tinNumber) record[customerTinColumn] = String(dto.tinNumber).trim();
      if (customerTypeColumn && dto.customerType)
        record[customerTypeColumn] = String(dto.customerType).trim();
      if (creditLimitColumn && dto.creditLimit !== undefined)
        record[creditLimitColumn] = this.toOptionalNumber(dto.creditLimit) ?? 0;
      if (paymentTermsColumn && dto.paymentTerms !== undefined)
        record[paymentTermsColumn] = this.toOptionalNumber(dto.paymentTerms) ?? 0;
      if (createdAtColumn) record[createdAtColumn] = new Date().toISOString();

      const inserted = await this.runInsert(this.databaseService, 'tblcustomer', record);
      return {
        success: true,
        data: { id: String(inserted.rows[0]?.id ?? '') },
      };
    } catch (error) {
      return { success: false, message: error instanceof Error ? error.message : 'Failed to create customer' };
    }
  }

  async updateCustomer(customerId: string, dto: UpdateCustomerDto) {
    const id = String(customerId ?? '').trim();
    if (!id) {
      return { success: false, message: 'Invalid customer id' };
    }

    try {
      const customerColumns = await this.getTableColumns(this.databaseService, 'tblcustomer');
      const customerNameColumn = this.pickColumn(customerColumns, ['name', 'customer_name']);
      const customerAddressColumn = this.pickColumn(customerColumns, ['address']);
      const customerContactPersonColumn = this.pickColumn(customerColumns, [
        'contact_person',
        'contactPerson',
      ]);
      const customerContactNumberColumn = this.pickColumn(customerColumns, [
        'contact_number',
        'contactNumber',
      ]);
      const customerEmailColumn = this.pickColumn(customerColumns, ['email']);
      const customerTinColumn = this.pickColumn(customerColumns, ['tin_number', 'tinNumber']);
      const customerTypeColumn = this.pickColumn(customerColumns, ['customer_type', 'customerType']);
      const creditLimitColumn = this.pickColumn(customerColumns, ['credit_limit', 'creditLimit']);
      const paymentTermsColumn = this.pickColumn(customerColumns, ['payment_terms', 'paymentTerms']);
      const updatedAtColumn = this.pickColumn(customerColumns, ['updated_at', 'updatedAt']);

      const record: Record<string, unknown> = {};
      if (customerNameColumn && dto.name !== undefined) record[customerNameColumn] = String(dto.name ?? '').trim();
      if (customerAddressColumn && dto.address !== undefined)
        record[customerAddressColumn] = String(dto.address ?? '').trim();
      if (customerContactPersonColumn && dto.contactPerson !== undefined)
        record[customerContactPersonColumn] = String(dto.contactPerson ?? '').trim();
      if (customerContactNumberColumn && dto.contactNumber !== undefined)
        record[customerContactNumberColumn] = String(dto.contactNumber ?? '').trim();
      if (customerEmailColumn && dto.email !== undefined)
        record[customerEmailColumn] = String(dto.email ?? '').trim();
      if (customerTinColumn && dto.tinNumber !== undefined)
        record[customerTinColumn] = String(dto.tinNumber ?? '').trim();
      if (customerTypeColumn && dto.customerType !== undefined)
        record[customerTypeColumn] = String(dto.customerType ?? '').trim();
      if (creditLimitColumn && dto.creditLimit !== undefined)
        record[creditLimitColumn] = this.toOptionalNumber(dto.creditLimit) ?? 0;
      if (paymentTermsColumn && dto.paymentTerms !== undefined)
        record[paymentTermsColumn] = this.toOptionalNumber(dto.paymentTerms) ?? 0;
      if (updatedAtColumn) record[updatedAtColumn] = new Date().toISOString();

      const columns = Object.keys(record);
      if (columns.length === 0) {
        return { success: true, message: 'No changes provided' };
      }

      const setClauses = columns.map((col, idx) => `"${col}" = $${idx + 1}`);
      const values = Object.values(record);
      const result = await this.databaseService.query(
        `UPDATE tblcustomer SET ${setClauses.join(', ')} WHERE id::text = $${values.length + 1}`,
        [...values, id],
      );

      return {
        success: true,
        data: { updated: result.rowCount },
      };
    } catch (error) {
      return { success: false, message: error instanceof Error ? error.message : 'Failed to update customer' };
    }
  }

  async deleteCustomer(customerId: string) {
    const id = String(customerId ?? '').trim();
    if (!id) {
      return { success: false, message: 'Invalid customer id' };
    }

    try {
      const result = await this.databaseService.query(
        `DELETE FROM tblcustomer WHERE id::text = $1`,
        [id],
      );
      return { success: true, data: { deleted: result.rowCount } };
    } catch (error) {
      return { success: false, message: error instanceof Error ? error.message : 'Failed to delete customer' };
    }
  }

  async getCustomerOrders(
    customerId: string,
    query: { page?: number; limit?: number },
  ) {
    const id = String(customerId ?? '').trim();
    if (!id) {
      return { success: false, message: 'Invalid customer id', items: [], meta: { page: 1, limit: 0, total: 0, totalPages: 1 } };
    }

    const page = Math.max(1, Number(query.page ?? 1));
    const limit = Math.max(1, Math.min(200, Number(query.limit ?? 50)));
    const offset = (page - 1) * limit;

    try {
      const countResult = await this.databaseService.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM tblsales_order so
         WHERE so.customer_id::text = $1
           AND REPLACE(REPLACE(LOWER(TRIM(COALESCE(so.status, 'pending'))), '_', '-'), ' ', '-')
               NOT IN ('pending', 'for-delivery', 'in-progress', 'scheduled', 'cancelled', 'rejected')`,
        [id],
      );
      const total = Number(countResult.rows[0]?.count ?? 0);
      const totalPages = Math.max(1, Math.ceil(total / limit));

      const result = await this.databaseService.query<{
        id: number;
        so_number: string | null;
        total_amount: string | null;
        status: string | null;
        salesType: string | null;
        scheduleDate: string | null;
        created_at: string | null;
        payments: unknown;
        product_items: unknown;
      }>(
        `SELECT
           so.id,
           so.so_number,
           so.total_amount::text,
           COALESCE(so.status, 'pending') AS status,
           so."salesType",
           COALESCE(to_jsonb(so)->>'scheduleDate', to_jsonb(so)->>'schedule_date', null) AS "scheduleDate",
           so.created_at::text,
           -- Payment details
           COALESCE(
             (
               SELECT json_agg(
                 json_build_object(
                   'method', COALESCE(to_jsonb(sp)->>'method', ''),
                   'amount', COALESCE(NULLIF(to_jsonb(sp)->>'amount', '')::numeric, 0),
                   'status', COALESCE(to_jsonb(sp)->>'status', 'unpaid'),
                   'terms', COALESCE(to_jsonb(sp)->>'terms', null),
                   'termsDueDate', COALESCE(to_jsonb(sp)->>'termsDueDate', to_jsonb(sp)->>'terms_due_date', null),
                   'downPayment', COALESCE(NULLIF(COALESCE(to_jsonb(sp)->>'downPayment', to_jsonb(sp)->>'down_payment', ''), '')::numeric, 0),
                   'checkNo', COALESCE(to_jsonb(sp)->>'checkNo', to_jsonb(sp)->>'check_no', null),
                   'postDated', COALESCE(to_jsonb(sp)->>'postDated', to_jsonb(sp)->>'post_dated', null),
                   'paymentDate', COALESCE(to_jsonb(sp)->>'paymentDate', to_jsonb(sp)->>'payment_date', null),
                   'bankName', COALESCE(to_jsonb(sp)->>'bankName', to_jsonb(sp)->>'bank_name', null),
                   'referenceNo', COALESCE(to_jsonb(sp)->>'referenceNo', to_jsonb(sp)->>'reference_no', null)
                 ) ORDER BY sp.id ASC
               )
               FROM tblso_payments sp
               WHERE COALESCE(to_jsonb(sp)->>'so_id', to_jsonb(sp)->>'soId') = so.id::text
             ),
             '[]'::json
           ) AS payments,
           -- Product items with product/capacity names
           COALESCE(
             (
               SELECT json_agg(
                 json_build_object(
                   'productName', COALESCE(
                     to_jsonb(p)->>'productName',
                     to_jsonb(p)->>'product_name',
                     to_jsonb(p)->>'name',
                     'Unknown Product'
                   ),
                   'capacity', COALESCE(to_jsonb(c)->>'capacity', ''),
                   'qty', COALESCE(NULLIF(COALESCE(to_jsonb(tpi)->>'totalSetQty', to_jsonb(tpi)->>'total_set_qty', ''), '')::int, 0),
                   'unitPrice', COALESCE(NULLIF(COALESCE(to_jsonb(tpi)->>'sellPrice', to_jsonb(tpi)->>'sell_price', to_jsonb(tpi)->>'unitPrice', to_jsonb(tpi)->>'unit_price', ''), '')::numeric, 0),
                   'discountPrice', COALESCE(NULLIF(COALESCE(to_jsonb(tpi)->>'discountPrice', to_jsonb(tpi)->>'discount_price', ''), '')::numeric, 0)
                 ) ORDER BY tpi.id ASC
               )
               FROM tbltransaction_product_items tpi
               LEFT JOIN tblproducts p ON p.id::text = COALESCE(to_jsonb(tpi)->>'productId', to_jsonb(tpi)->>'product_id')
               LEFT JOIN tblcapacity c ON c.id::text = COALESCE(to_jsonb(tpi)->>'capacityId', to_jsonb(tpi)->>'capacity_id')
               WHERE COALESCE(to_jsonb(tpi)->>'salesId', to_jsonb(tpi)->>'sales_id') = so.id::text
                 AND LOWER(COALESCE(to_jsonb(tpi)->>'transType', to_jsonb(tpi)->>'trans_type', 'sales')) = 'sales'
             ),
             '[]'::json
           ) AS product_items
         FROM tblsales_order so
         WHERE so.customer_id::text = $1
           AND REPLACE(REPLACE(LOWER(TRIM(COALESCE(so.status, 'pending'))), '_', '-'), ' ', '-')
               NOT IN ('pending', 'for-delivery', 'in-progress', 'scheduled', 'cancelled', 'rejected')
         ORDER BY so.created_at DESC NULLS LAST
         LIMIT $2 OFFSET $3`,
        [id, limit, offset],
      );

      return {
        success: true,
        items: result.rows.map((row) => ({
          id: row.id,
          soNumber: row.so_number ?? '',
          totalAmount: this.toOptionalNumber(row.total_amount) ?? 0,
          status: row.status ?? 'pending',
          salesType: row.salesType ?? '',
          scheduleDate: row.scheduleDate ?? null,
          createdAt: row.created_at ?? null,
          payments: Array.isArray(row.payments) ? row.payments.map((p: any) => ({
            method: String(p.method ?? ''),
            amount: Number(p.amount ?? 0),
            status: String(p.status ?? 'unpaid'),
            terms: p.terms ? String(p.terms) : null,
            termsDueDate: p.termsDueDate ?? null,
            downPayment: Number(p.downPayment ?? 0),
            checkNo: p.checkNo ?? null,
            postDated: p.postDated ?? null,
            paymentDate: p.paymentDate ?? null,
            bankName: p.bankName ?? null,
            referenceNo: p.referenceNo ?? null,
          })) : [],
          productItems: Array.isArray(row.product_items) ? row.product_items.map((p: any) => ({
            productName: String(p.productName ?? ''),
            capacity: String(p.capacity ?? ''),
            qty: Number(p.qty ?? 0),
            unitPrice: Number(p.unitPrice ?? 0),
            discountPrice: Number(p.discountPrice ?? 0),
          })) : [],
        })),
        meta: { page, limit, total, totalPages },
      };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to load customer orders',
        items: [],
        meta: { page, limit, total: 0, totalPages: 1 },
      };
    }
  }

  async getCustomerPayments(customerId: string) {
    const id = String(customerId ?? '').trim();
    if (!id) {
      return { success: false, message: 'Invalid customer id', items: [] };
    }

    try {
      // 1. SO-level payments from tblso_payments (per transaction)
      const soPaymentsResult = await this.databaseService.query<{
        soId: string;
        soNumber: string | null;
        method: string | null;
        amount: string | null;
        downPayment: string | null;
        status: string | null;
        termsDueDate: string | null;
        postDated: string | null;
        paymentDate: string | null;
        referenceNo: string | null;
        checkNo: string | null;
        bankName: string | null;
        createdAt: string | null;
      }>(
        `SELECT
           sp.so_id::text AS "soId",
           so.so_number AS "soNumber",
           COALESCE(to_jsonb(sp)->>'method', '') AS method,
           COALESCE(NULLIF(to_jsonb(sp)->>'amount', '')::numeric, 0)::text AS amount,
           COALESCE(NULLIF(COALESCE(to_jsonb(sp)->>'downPayment', to_jsonb(sp)->>'down_payment', ''), '')::numeric, 0)::text AS "downPayment",
           COALESCE(to_jsonb(sp)->>'status', 'unpaid') AS status,
           COALESCE(to_jsonb(sp)->>'termsDueDate', to_jsonb(sp)->>'terms_due_date', null) AS "termsDueDate",
           COALESCE(to_jsonb(sp)->>'postDated', to_jsonb(sp)->>'post_dated', null) AS "postDated",
           COALESCE(to_jsonb(sp)->>'paymentDate', to_jsonb(sp)->>'payment_date', null) AS "paymentDate",
           COALESCE(to_jsonb(sp)->>'referenceNo', to_jsonb(sp)->>'reference_no', null) AS "referenceNo",
           COALESCE(to_jsonb(sp)->>'checkNo', to_jsonb(sp)->>'check_no', null) AS "checkNo",
           COALESCE(to_jsonb(sp)->>'bankName', to_jsonb(sp)->>'bank_name', null) AS "bankName",
           so.created_at::text AS "createdAt"
         FROM tblso_payments sp
         JOIN tblsales_order so ON so.id = sp.so_id
         WHERE so.customer_id::text = $1
           AND REPLACE(REPLACE(LOWER(TRIM(COALESCE(so.status, 'pending'))), '_', '-'), ' ', '-')
               NOT IN ('pending', 'for-delivery', 'in-progress', 'scheduled', 'cancelled', 'rejected')
         ORDER BY COALESCE(NULLIF(COALESCE(to_jsonb(sp)->>'paymentDate', to_jsonb(sp)->>'payment_date', ''), ''), so.created_at::text) ASC, sp.id ASC`,
        [id],
      );

      // 2. Dashboard/manual settlements from tblcustomer_payments
      const manualPaymentsResult = await this.databaseService.query<{
        id: string;
        salesId: string | null;
        soNumber: string | null;
        paymentAmount: string | null;
        paymentDate: string | null;
        paymentMethod: string | null;
        referenceNo: string | null;
        paymentNotes: string | null;
        appliedToBalance: string | null;
        createdAt: string | null;
      }>(
        `SELECT
           cp.id::text AS id,
           cp.sales_id::text AS "salesId",
           so.so_number AS "soNumber",
           COALESCE(cp.payment_amount::text, '0') AS "paymentAmount",
           COALESCE(cp.payment_date::text, '') AS "paymentDate",
           COALESCE(cp.payment_method, '') AS "paymentMethod",
           COALESCE(cp.reference_no, '') AS "referenceNo",
           COALESCE(cp.payment_notes, '') AS "paymentNotes",
           COALESCE(cp.applied_to_balance::text, '0') AS "appliedToBalance",
           COALESCE(cp.created_at::text, '') AS "createdAt"
         FROM tblcustomer_payments cp
         LEFT JOIN tblsales_order so ON so.id = cp.sales_id
         WHERE cp.customer_id::text = $1
         ORDER BY cp.payment_date DESC, cp.created_at DESC`,
        [id],
      );

      // 3. Calculate balance: totalCharges vs all payments (SO-level paid + down payments + manual settlements)
      const balanceResult = await this.databaseService.query<{
        totalCharges: string | null;
        totalManualPayments: string | null;
        totalDownPayments: string | null;
        totalSoPaid: string | null;
      }>(
        `SELECT
           -- Total SO charges for this customer (exclude pending/in-progress/cancelled)
           COALESCE(SUM(so.total_amount), 0)::text AS "totalCharges",
           -- Manual settlements from dashboard
           (
             SELECT COALESCE(SUM(cp.payment_amount), 0)::text
             FROM tblcustomer_payments cp
             WHERE cp.customer_id::text = $1
           ) AS "totalManualPayments",
           -- Down payments from UNPAID SO payment terms only (to avoid double-counting with paid SOs)
           (
             SELECT COALESCE(SUM(
               COALESCE(NULLIF(COALESCE(to_jsonb(sp)->>'downPayment', to_jsonb(sp)->>'down_payment', ''), '')::numeric, 0)
             ), 0)::text
             FROM tblso_payments sp
             JOIN tblsales_order so2 ON so2.id = sp.so_id
             WHERE so2.customer_id::text = $1
               AND REPLACE(REPLACE(LOWER(TRIM(COALESCE(so2.status, 'pending'))), '_', '-'), ' ', '-')
                   NOT IN ('pending', 'for-delivery', 'in-progress', 'scheduled', 'cancelled', 'rejected')
               AND LOWER(COALESCE(to_jsonb(sp)->>'status', '')) != 'paid'
               AND COALESCE(NULLIF(COALESCE(to_jsonb(sp)->>'downPayment', to_jsonb(sp)->>'down_payment', ''), '')::numeric, 0) > 0
           ) AS "totalDownPayments",
           -- Fully paid SO payment amounts
           (
             SELECT COALESCE(SUM(
               COALESCE(NULLIF(to_jsonb(sp)->>'amount', '')::numeric, 0)
             ), 0)::text
             FROM tblso_payments sp
             JOIN tblsales_order so2 ON so2.id = sp.so_id
             WHERE so2.customer_id::text = $1
               AND REPLACE(REPLACE(LOWER(TRIM(COALESCE(so2.status, 'pending'))), '_', '-'), ' ', '-')
                   NOT IN ('pending', 'for-delivery', 'in-progress', 'scheduled', 'cancelled', 'rejected')
               AND LOWER(COALESCE(to_jsonb(sp)->>'status', '')) = 'paid'
           ) AS "totalSoPaid"
         FROM tblsales_order so
         WHERE so.customer_id::text = $1
           AND REPLACE(REPLACE(LOWER(TRIM(COALESCE(so.status, 'pending'))), '_', '-'), ' ', '-')
               NOT IN ('pending', 'for-delivery', 'in-progress', 'scheduled', 'cancelled', 'rejected')`,
        [id],
      );

      const totalCharges = this.toOptionalNumber(balanceResult.rows[0]?.totalCharges) ?? 0;
      const totalManualPayments = this.toOptionalNumber(balanceResult.rows[0]?.totalManualPayments) ?? 0;
      const totalDownPayments = this.toOptionalNumber(balanceResult.rows[0]?.totalDownPayments) ?? 0;
      const totalSoPaid = this.toOptionalNumber(balanceResult.rows[0]?.totalSoPaid) ?? 0;
      // Total settled = manual settlements + down payments on unpaid SOs + fully paid SO amounts
      // No double-counting: totalDownPayments only covers unpaid SOs, totalSoPaid covers paid SOs
      const totalSettled = totalManualPayments + totalDownPayments + totalSoPaid;

      // Build unified payment timeline
      const soPayments = soPaymentsResult.rows.map((row) => ({
        id: `so-${row.soId}-${row.method}`,
        type: 'so_payment' as const,
        soId: row.soId,
        soNumber: row.soNumber ?? '',
        method: row.method ?? '',
        amount: this.toOptionalNumber(row.amount) ?? 0,
        downPayment: this.toOptionalNumber(row.downPayment) ?? 0,
        status: row.status ?? 'unpaid',
        termsDueDate: row.termsDueDate ?? null,
        postDated: row.postDated ?? null,
        paymentDate: row.paymentDate ?? null,
        referenceNo: row.referenceNo ?? null,
        checkNo: row.checkNo ?? null,
        bankName: row.bankName ?? null,
        notes: null as string | null,
        appliedToBalance: 0,
        date: row.paymentDate || row.createdAt || null,
      }));

      const manualPayments = manualPaymentsResult.rows.map((row) => ({
        id: row.id,
        type: 'settlement' as const,
        soId: row.salesId ?? null,
        soNumber: row.soNumber ?? null,
        method: row.paymentMethod ?? '',
        amount: this.toOptionalNumber(row.paymentAmount) ?? 0,
        downPayment: 0,
        status: 'paid' as const,
        termsDueDate: null as string | null,
        postDated: null as string | null,
        paymentDate: row.paymentDate ?? null,
        referenceNo: row.referenceNo ?? null,
        checkNo: null as string | null,
        bankName: null as string | null,
        notes: row.paymentNotes ?? null,
        appliedToBalance: this.toOptionalNumber(row.appliedToBalance) ?? 0,
        date: row.paymentDate || row.createdAt || null,
      }));

      return {
        success: true,
        summary: {
          totalCharges,
          totalManualPayments: totalSettled,
          outstandingBalance: Math.max(0, totalCharges - totalSettled),
        },
        soPayments,
        settlements: manualPayments,
      };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to load customer payments',
        summary: { totalCharges: 0, totalManualPayments: 0, outstandingBalance: 0 },
        soPayments: [],
        settlements: [],
      };
    }
  }

  async getCustomerConcerns(customerId: string) {
    const id = String(customerId ?? '').trim();
    if (!id) {
      return { success: false, message: 'Invalid customer id', items: [] };
    }

    try {
      // Pull service/concern SOs linked to this customer (service, concern, sales and service types)
      const result = await this.databaseService.query<{
        id: number;
        so_number: string | null;
        sales_type: string | null;
        status: string | null;
        schedule_date: string | null;
        created_at: string | null;
        concern_type: string | null;
        concern_subject: string | null;
        concern_description: string | null;
        concern_status: string | null;
        priority: string | null;
        resolution_notes: string | null;
        resolved_at: string | null;
        service_name: string | null;
        service_type: string | null;
        service_status: string | null;
        service_date: string | null;
        service_cost: string | null;
      }>(
        `SELECT
           so.id,
           so.so_number,
           COALESCE(to_jsonb(so)->>'salesType', to_jsonb(so)->>'sales_type', '') AS sales_type,
           COALESCE(so.status, 'pending') AS status,
           COALESCE(to_jsonb(so)->>'scheduleDate', to_jsonb(so)->>'schedule_date', null) AS schedule_date,
           so.created_at::text,
           -- concern details
           cd.concern_type,
           cd.concern_subject,
           cd.concern_description,
           cd.concern_status,
           cd.priority,
           cd.resolution_notes,
           cd.resolved_at::text,
           -- service details
           sd.service_name,
           sd.service_type,
           sd.service_status,
           sd.service_date::text,
           sd.service_cost::text
         FROM tblsales_order so
         LEFT JOIN tblconcern_details cd ON cd.sales_id = so.id
         LEFT JOIN tblservice_details sd ON sd.sales_id = so.id
         WHERE so.customer_id::text = $1
           AND (
             LOWER(COALESCE(to_jsonb(so)->>'salesType', to_jsonb(so)->>'sales_type', '')) IN (
               'service', 'services', 'concern', 'concerns',
               'sales and service', 'sales & service', 'sales-and-service', 'sales_and_service'
             )
             OR cd.id IS NOT NULL
             OR sd.id IS NOT NULL
           )
         ORDER BY so.created_at DESC NULLS LAST`,
        [id],
      );

      return {
        success: true,
        items: result.rows.map((row) => ({
          id: row.id,
          salesId: row.id,
          soNumber: row.so_number ?? '',
          salesType: row.sales_type ?? '',
          status: row.status ?? '',
          scheduleDate: row.schedule_date ?? null,
          createdAt: row.created_at ?? null,
          // concern fields
          concernType: row.concern_type ?? '',
          concernSubject: row.concern_subject ?? '',
          concernDescription: row.concern_description ?? '',
          concernStatus: row.concern_status ?? '',
          priority: row.priority ?? '',
          resolutionNotes: row.resolution_notes ?? '',
          resolvedAt: row.resolved_at ?? null,
          // service fields
          serviceName: row.service_name ?? '',
          serviceType: row.service_type ?? '',
          serviceStatus: row.service_status ?? '',
          serviceDate: row.service_date ?? null,
          serviceCost: this.toOptionalNumber(row.service_cost) ?? 0,
        })),
      };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to load customer concerns',
        items: [],
      };
    }
  }

  async getCustomerStatementOfAccounts(
    customerId: string,
    query: { page?: number; limit?: number },
  ) {
    const id = String(customerId ?? '').trim();
    if (!id) {
      return { success: false, message: 'Invalid customer id', items: [], meta: { page: 1, limit: 0, total: 0, totalPages: 1 } };
    }

    const page = Math.max(1, Number(query.page ?? 1));
    const limit = Math.max(1, Math.min(200, Number(query.limit ?? 50)));
    const offset = (page - 1) * limit;

    try {
      const countResult = await this.databaseService.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM tblstatement_of_account soa WHERE customer_id::text = $1`,
        [id],
      );
      const total = Number(countResult.rows[0]?.count ?? 0);
      const totalPages = Math.max(1, Math.ceil(total / limit));

      const result = await this.databaseService.query<{
        id: number;
        soaNumber: string | null;
        periodFrom: string | null;
        periodTo: string | null;
        openingBalance: string | null;
        totalCharges: string | null;
        totalPayments: string | null;
        closingBalance: string | null;
        status: string | null;
        dueDate: string | null;
        notes: string | null;
        generatedAt: string | null;
      }>(
        `SELECT
           id,
           COALESCE(soa_number, '') AS "soaNumber",
           COALESCE(period_from::text, '') AS "periodFrom",
           COALESCE(period_to::text, '') AS "periodTo",
           COALESCE(opening_balance::text, '') AS "openingBalance",
           COALESCE(total_charges::text, '') AS "totalCharges",
           COALESCE(total_payments::text, '') AS "totalPayments",
           COALESCE(closing_balance::text, '') AS "closingBalance",
           COALESCE(soa_status, '') AS status,
           COALESCE(due_date::text, '') AS "dueDate",
           COALESCE(notes, '') AS notes,
           COALESCE(generated_at::text, '') AS "generatedAt"
         FROM tblstatement_of_account soa
         WHERE customer_id::text = $1
         ORDER BY generated_at DESC
         LIMIT $2
         OFFSET $3`,
        [id, limit, offset],
      );

      return {
        success: true,
        items: result.rows.map((row) => ({
          id: row.id,
          soaNumber: row.soaNumber ?? '',
          periodFrom: row.periodFrom ?? null,
          periodTo: row.periodTo ?? null,
          openingBalance: this.toOptionalNumber(row.openingBalance) ?? 0,
          totalCharges: this.toOptionalNumber(row.totalCharges) ?? 0,
          totalPayments: this.toOptionalNumber(row.totalPayments) ?? 0,
          closingBalance: this.toOptionalNumber(row.closingBalance) ?? 0,
          status: row.status ?? '',
          dueDate: row.dueDate ?? null,
          notes: row.notes ?? '',
          generatedAt: row.generatedAt ?? null,
        })),
        meta: { page, limit, total, totalPages },
      };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to load statement of accounts',
        items: [],
        meta: { page, limit, total: 0, totalPages: 1 },
      };
    }
  }

  async createStatementOfAccountForCustomer(
    customerId: string,
    dto: CreateStatementOfAccountDto,
    userId?: number,
    auditActor?: AuditActorContext,
  ) {
    const id = String(customerId ?? '').trim();
    if (!id) {
      return { success: false, message: 'Invalid customer id' };
    }

    try {
      const { inserted, snapshot } = await this.insertStatementOfAccountRecord(id, dto, userId);
      await this.auditLogService.logMutation({
        action: 'STATEMENT_OF_ACCOUNT_CREATE',
        entityType: 'statement-of-account',
        entityId: Number(inserted.rows[0]?.id ?? 0),
        actor: auditActor ?? { userId },
        description: `Created statement of account for customer ${id}`,
        requestBody: dto as unknown as Record<string, unknown>,
        after: {
          statementOfAccountId: Number(inserted.rows[0]?.id ?? 0),
          customerId: id,
          periodFrom: snapshot.effectivePeriodFrom,
          periodTo: snapshot.effectivePeriodTo,
        },
      });

      return {
        success: true,
        data: {
          statementOfAccountId: Number(inserted.rows[0]?.id ?? 0),
          periodFrom: snapshot.effectivePeriodFrom,
          periodTo: snapshot.effectivePeriodTo,
        },
      };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to create statement of account',
      };
    }
  }

  async getBranches() {
    try {
      const result = await this.databaseService.query<{
        id: number;
        branchName: string | null;
        branchAddress: string | null;
      }>(
        `SELECT
           id,
           COALESCE("branchName", '') AS "branchName",
           COALESCE("branchAddress", '') AS "branchAddress"
         FROM tblbranches
         ORDER BY COALESCE("branchName", '') ASC`,
      );

      return {
        success: true,
        items: result.rows.map((row) => ({
          id: row.id,
          branchName: row.branchName ?? '',
          branchAddress: row.branchAddress ?? '',
        })),
      };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to load branches',
        items: [],
      };
    }
  }

  async createBranch(branchNameInput?: string, branchAddressInput?: string | null) {
    const branchName = String(branchNameInput ?? '').trim();
    const branchAddress = String(branchAddressInput ?? '').trim();
    if (!branchName) {
      return {
        success: false,
        message: 'Branch name is required',
      };
    }

    try {
      const existingResult = await this.databaseService.query<{ id: number }>(
        `SELECT id
         FROM tblbranches
         WHERE lower(COALESCE("branchName", '')) = lower($1)
         LIMIT 1`,
        [branchName],
      );

      if (existingResult.rowCount > 0) {
        return {
          success: false,
          message: 'Branch name already exists',
        };
      }

      await this.databaseService.query(
        `INSERT INTO tblbranches ("branchName", "branchAddress")
         VALUES ($1, $2)`,
        [branchName, branchAddress || null],
      );

      return this.getBranches();
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to create branch',
      };
    }
  }

  async updateBranch(
    branchId: number,
    branchNameInput?: string,
    branchAddressInput?: string | null,
  ) {
    if (!Number.isFinite(branchId) || branchId <= 0) {
      return {
        success: false,
        message: 'Invalid branch id',
      };
    }

    const branchName = String(branchNameInput ?? '').trim();
    const branchAddress = String(branchAddressInput ?? '').trim();

    if (!branchName) {
      return {
        success: false,
        message: 'Branch name is required',
      };
    }

    try {
      const existingBranch = await this.databaseService.query<{ id: number }>(
        `SELECT id
         FROM tblbranches
         WHERE id = $1
         LIMIT 1`,
        [branchId],
      );

      if (existingBranch.rowCount === 0) {
        return {
          success: false,
          message: 'Branch not found',
        };
      }

      const duplicateBranch = await this.databaseService.query<{ id: number }>(
        `SELECT id
         FROM tblbranches
         WHERE lower(COALESCE("branchName", '')) = lower($1)
           AND id <> $2
         LIMIT 1`,
        [branchName, branchId],
      );

      if (duplicateBranch.rowCount > 0) {
        return {
          success: false,
          message: 'Branch name already exists',
        };
      }

      await this.databaseService.query(
        `UPDATE tblbranches
         SET "branchName" = $1,
             "branchAddress" = $2
         WHERE id = $3`,
        [branchName, branchAddress || null, branchId],
      );

      return this.getBranches();
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to update branch',
      };
    }
  }

  async deleteBranch(branchId: number) {
    if (!Number.isFinite(branchId) || branchId <= 0) {
      return {
        success: false,
        message: 'Invalid branch id',
      };
    }

    try {
      const existingBranch = await this.databaseService.query<{ id: number }>(
        `SELECT id
         FROM tblbranches
         WHERE id = $1
         LIMIT 1`,
        [branchId],
      );

      if (existingBranch.rowCount === 0) {
        return {
          success: false,
          message: 'Branch not found',
        };
      }

      const referenceCounts = await this.databaseService.query<{
        usersCount: string;
        purchaseOrdersCount: string;
        salesOrdersCount: string;
        serialsCount: string;
        transferDetailsCount: string;
      }>(
        `SELECT
           (SELECT COUNT(*)::text FROM tblusers u WHERE COALESCE(to_jsonb(u)->>'branchId', to_jsonb(u)->>'branch_id', '') = $1) AS "usersCount",
           (SELECT COUNT(*)::text FROM tblpurchase_orders po WHERE COALESCE(to_jsonb(po)->>'branchId', to_jsonb(po)->>'branch_id', '') = $1) AS "purchaseOrdersCount",
           (SELECT COUNT(*)::text FROM tblsales_order so WHERE COALESCE(to_jsonb(so)->>'branchId', to_jsonb(so)->>'branch_id', '') = $1) AS "salesOrdersCount",
           (SELECT COUNT(*)::text FROM tblserial_numbers sn WHERE COALESCE(to_jsonb(sn)->>'branchId', to_jsonb(sn)->>'branch_id', '') = $1) AS "serialsCount",
           (
             CASE
               WHEN to_regclass('public.tbltransfer_details') IS NULL THEN '0'
               ELSE (
                 SELECT COUNT(*)::text
                 FROM public.tbltransfer_details td
                 WHERE td.from_branch_id = $2 OR td.to_branch_id = $2
               )
             END
           ) AS "transferDetailsCount"`,
        [String(branchId), branchId],
      );

      const counts = referenceCounts.rows[0];
      const blockers = [
        { label: 'users', count: Number(counts?.usersCount ?? 0) },
        { label: 'purchase orders', count: Number(counts?.purchaseOrdersCount ?? 0) },
        { label: 'sales orders', count: Number(counts?.salesOrdersCount ?? 0) },
        { label: 'serial records', count: Number(counts?.serialsCount ?? 0) },
        { label: 'transfer details', count: Number(counts?.transferDetailsCount ?? 0) },
      ].filter((item) => Number.isFinite(item.count) && item.count > 0);

      if (blockers.length > 0) {
        return {
          success: false,
          message: `Cannot delete branch because it is used by: ${blockers
            .map((item) => `${item.count} ${item.label}`)
            .join(', ')}`,
        };
      }

      await this.databaseService.query(
        `DELETE FROM tblbranches
         WHERE id = $1`,
        [branchId],
      );

      return this.getBranches();
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to delete branch',
      };
    }
  }

  async createStatementOfAccount(
    salesOrderId: number,
    dto: CreateStatementOfAccountDto,
    userId?: number,
    auditActor?: AuditActorContext,
  ) {
    try {
      const salesResult = await this.databaseService.query<{ customer_id: string | null }>(
        `SELECT COALESCE(to_jsonb(so)->>'customer_id', to_jsonb(so)->>'customerId', '') AS customer_id
         FROM tblsales_order so
         WHERE so.id = $1
         LIMIT 1`,
        [salesOrderId],
      );

      if (salesResult.rowCount === 0) {
        return { success: false, message: `Sales order ${salesOrderId} not found` };
      }

      const customerId = String(salesResult.rows[0].customer_id ?? '').trim();
      if (!customerId) {
        return { success: false, message: 'Sales order does not have an associated customer' };
      }

      const { inserted, snapshot } = await this.insertStatementOfAccountRecord(customerId, dto, userId);
      await this.auditLogService.logMutation({
        action: 'STATEMENT_OF_ACCOUNT_CREATE',
        entityType: 'statement-of-account',
        entityId: Number(inserted.rows[0]?.id ?? 0),
        actor: auditActor ?? { userId },
        description: `Created statement of account for sales order #${salesOrderId}`,
        requestBody: dto as unknown as Record<string, unknown>,
        after: {
          statementOfAccountId: Number(inserted.rows[0]?.id ?? 0),
          salesOrderId,
          customerId,
          periodFrom: snapshot.effectivePeriodFrom,
          periodTo: snapshot.effectivePeriodTo,
        },
      });

      return {
        success: true,
        data: {
          statementOfAccountId: Number(inserted.rows[0]?.id ?? 0),
          periodFrom: snapshot.effectivePeriodFrom,
          periodTo: snapshot.effectivePeriodTo,
        },
      };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to create statement of account',
      };
    }
  }

  async searchProjects(query: any) {
    const search = String(query?.search ?? '').trim().toLowerCase();
    const status = String(query?.status ?? '').trim().toLowerCase();
    const page = this.normalizePage(query?.page ?? 1);
    const limit = this.normalizeLimit(query?.limit ?? 10);
    const offset = (page - 1) * limit;
    const branchId = Number(query?.branchId);

    try {
      const params: unknown[] = [];
      const whereParts: string[] = [];

      if (search) {
        params.push(`%${search}%`);
        const index = params.length;
        whereParts.push(`(
          LOWER(COALESCE(p.project_code, '')) LIKE LOWER($${index})
          OR LOWER(COALESCE(p.project_name, '')) LIKE LOWER($${index})
        )`);
      }

      if (status) {
        params.push(status);
        whereParts.push(`LOWER(COALESCE(p.project_status, '')) = $${params.length}`);
      }

      if (Number.isFinite(branchId) && branchId > 0) {
        params.push(branchId);
        whereParts.push(`(p.branch_id = $${params.length} OR p.branch_id IS NULL)`);
      }

      const whereSql = whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : '';

      // Count total
      const countResult = await this.databaseService.query<{ total: string }>(
        `SELECT COUNT(*)::text AS total FROM tblprojects p ${whereSql}`,
        params,
      );
      const total = Number(countResult.rows[0]?.total ?? 0);
      const totalPages = Math.max(1, Math.ceil(total / limit));

      // Get paginated results with related SO count
      params.push(limit);
      params.push(offset);
      const listResult = await this.databaseService.query<{
        id: number;
        projectCode: string;
        projectName: string;
        projectType: string | null;
        projectOwner: string | null;
        projectLocation: string | null;
        projectStartDate: string | null;
        projectEndDate: string | null;
        projectManager: string | null;
        projectStatus: string;
        projectNotes: string | null;
        relatedSOCount: string;
        createdBy: string | null;
        createdAt: string | null;
        updatedAt: string | null;
      }>(
        `SELECT
           p.id,
           p.project_code AS "projectCode",
           p.project_name AS "projectName",
           COALESCE(p.project_type, '') AS "projectType",
           COALESCE(p.project_owner, '') AS "projectOwner",
           COALESCE(p.project_location, '') AS "projectLocation",
           p.project_start_date::text AS "projectStartDate",
           p.project_end_date::text AS "projectEndDate",
           COALESCE(p.project_manager, '') AS "projectManager",
           COALESCE(p.project_status, 'planning') AS "projectStatus",
           COALESCE(p.project_notes, '') AS "projectNotes",
           COALESCE((SELECT COUNT(*)::text FROM tblsales_order so WHERE so.project_id = p.id), '0') AS "relatedSOCount",
           COALESCE(p.created_by::text, '') AS "createdBy",
           p.created_at::text AS "createdAt",
           p.updated_at::text AS "updatedAt"
         FROM tblprojects p
         ${whereSql}
         ORDER BY p.project_code ASC
         LIMIT $${params.length - 1}
         OFFSET $${params.length}`,
        params,
      );

      return {
        success: true,
        items: listResult.rows.map((row) => ({
          id: row.id,
          projectCode: row.projectCode,
          projectName: row.projectName,
          projectType: row.projectType || '',
          projectOwner: row.projectOwner || '',
          projectLocation: row.projectLocation || '',
          projectStartDate: row.projectStartDate,
          projectEndDate: row.projectEndDate,
          projectManager: row.projectManager || '',
          projectStatus: row.projectStatus,
          projectNotes: row.projectNotes || '',
          relatedSOCount: Number(row.relatedSOCount ?? 0),
          createdBy: row.createdBy || '',
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        })),
        meta: {
          page,
          limit,
          total,
          totalPages,
        },
      };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to search projects',
        items: [],
        meta: { page, limit: 0, total: 0, totalPages: 1 },
      };
    }
  }

  async getProjectWithRelatedSOs(projectId: number) {
    if (!Number.isFinite(projectId) || projectId <= 0) {
      return {
        success: false,
        message: 'Invalid project id',
      };
    }

    try {
      // Get project details
      const projectResult = await this.databaseService.query<{
        id: number;
        projectCode: string;
        projectName: string;
        projectType: string | null;
        projectOwner: string | null;
        projectOwnerIdField: string | null;
        projectLocation: string | null;
        projectStartDate: string | null;
        projectEndDate: string | null;
        projectManager: string | null;
        projectManagerIdField: string | null;
        projectStatus: string;
        projectNotes: string | null;
        branchId: string | null;
        createdBy: string | null;
        createdAt: string | null;
        updatedAt: string | null;
      }>(
        `SELECT
           p.id,
           p.project_code AS "projectCode",
           p.project_name AS "projectName",
           COALESCE(p.project_type, '') AS "projectType",
           COALESCE(p.project_owner, '') AS "projectOwner",
           COALESCE(p.project_owner_id::text, '') AS "projectOwnerIdField",
           COALESCE(p.project_location, '') AS "projectLocation",
           p.project_start_date::text AS "projectStartDate",
           p.project_end_date::text AS "projectEndDate",
           COALESCE(p.project_manager, '') AS "projectManager",
           COALESCE(p.project_manager_id::text, '') AS "projectManagerIdField",
           COALESCE(p.project_status, 'planning') AS "projectStatus",
           COALESCE(p.project_notes, '') AS "projectNotes",
           COALESCE(p.branch_id::text, '') AS "branchId",
           COALESCE(p.created_by::text, '') AS "createdBy",
           p.created_at::text AS "createdAt",
           p.updated_at::text AS "updatedAt"
         FROM tblprojects p
         WHERE p.id = $1
         LIMIT 1`,
        [projectId],
      );

      if (projectResult.rowCount === 0) {
        return {
          success: false,
          message: `Project ${projectId} not found`,
        };
      }

      const projectRow = projectResult.rows[0];

      // Get related sales orders
      const sosResult = await this.databaseService.query<{
        id: number;
        soNumber: string | null;
        customerId: string | null;
        customerName: string | null;
        totalAmount: string | null;
        status: string | null;
        scheduleDate: string | null;
        createdAt: string | null;
      }>(
        `SELECT
           so.id,
           COALESCE(to_jsonb(so)->>'so_number', to_jsonb(so)->>'soNumber') AS "soNumber",
           COALESCE(to_jsonb(so)->>'customer_id', to_jsonb(so)->>'customerId') AS "customerId",
           COALESCE(to_jsonb(c)->>'name', to_jsonb(c)->>'customer_name', '') AS "customerName",
           COALESCE(to_jsonb(so)->>'total_amount', to_jsonb(so)->>'totalAmount', '0') AS "totalAmount",
           COALESCE(so.status, 'pending') AS status,
           COALESCE(to_jsonb(so)->>'scheduleDate', to_jsonb(so)->>'schedule_date', null) AS "scheduleDate",
           COALESCE(to_jsonb(so)->>'created_at', to_jsonb(so)->>'createdAt', null) AS "createdAt"
         FROM tblsales_order so
         LEFT JOIN tblcustomer c
           ON c.id::text = COALESCE(to_jsonb(so)->>'customer_id', to_jsonb(so)->>'customerId')
         WHERE so.project_id = $1
         ORDER BY so.created_at DESC NULLS LAST`,
        [projectId],
      );

      return {
        success: true,
        data: {
          id: projectRow.id,
          projectCode: projectRow.projectCode,
          projectName: projectRow.projectName,
          projectType: projectRow.projectType || '',
          projectOwner: projectRow.projectOwner || '',
          projectOwnerIdField: projectRow.projectOwnerIdField || '',
          projectLocation: projectRow.projectLocation || '',
          projectStartDate: projectRow.projectStartDate,
          projectEndDate: projectRow.projectEndDate,
          projectManager: projectRow.projectManager || '',
          projectManagerIdField: projectRow.projectManagerIdField || '',
          projectStatus: projectRow.projectStatus,
          projectNotes: projectRow.projectNotes || '',
          branchId: projectRow.branchId || '',
          createdBy: projectRow.createdBy || '',
          createdAt: projectRow.createdAt,
          updatedAt: projectRow.updatedAt,
          relatedSalesOrders: sosResult.rows.map((row) => ({
            id: row.id,
            soNumber: row.soNumber || '',
            customerId: row.customerId || '',
            customerName: row.customerName || '',
            totalAmount: this.toOptionalNumber(row.totalAmount) ?? 0,
            status: row.status || 'pending',
            scheduleDate: row.scheduleDate,
            createdAt: row.createdAt,
          })),
        },
      };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to get project',
      };
    }
  }

  async findOne(id: number) {
    if (!Number.isFinite(id) || id <= 0) {
      return {
        success: false,
        message: 'Invalid sales order id',
      };
    }

    try {
      const salesResult = await this.databaseService.query<{
        id: number;
        soNumber: string | null;
        customerId: string | null;
        customerName: string | null;
        customerAddress: string | null;
        customerContactPerson: string | null;
        customerContactNumber: string | null;
        customerEmail: string | null;
        customerTinNumber: string | null;
        totalAmount: string | null;
        status: string | null;
        scheduleDate: string | null;
        salesType: string | null;
        projectId: string | null;
        installer: string | null;
        remarks: string | null;
        createdAt: string | null;
      }>(
        `SELECT
           so.id,
           COALESCE(to_jsonb(so)->>'so_number', to_jsonb(so)->>'soNumber') AS "soNumber",
           COALESCE(to_jsonb(so)->>'customer_id', to_jsonb(so)->>'customerId') AS "customerId",
           COALESCE(to_jsonb(c)->>'name', to_jsonb(c)->>'customer_name', '') AS "customerName",
           COALESCE(to_jsonb(c)->>'address', '') AS "customerAddress",
           COALESCE(to_jsonb(c)->>'contact_person', to_jsonb(c)->>'contactPerson', '') AS "customerContactPerson",
           COALESCE(to_jsonb(c)->>'contact_number', to_jsonb(c)->>'contactNumber', '') AS "customerContactNumber",
           COALESCE(to_jsonb(c)->>'email', '') AS "customerEmail",
           COALESCE(to_jsonb(c)->>'tin_number', to_jsonb(c)->>'tinNumber', '') AS "customerTinNumber",
           COALESCE(to_jsonb(so)->>'total_amount', to_jsonb(so)->>'totalAmount', '0') AS "totalAmount",
           COALESCE(so.status, 'pending') AS status,
           COALESCE(to_jsonb(so)->>'scheduleDate', to_jsonb(so)->>'schedule_date', null) AS "scheduleDate",
           COALESCE(to_jsonb(so)->>'salesType', to_jsonb(so)->>'sales_type', '') AS "salesType",
           COALESCE(so.project_id::text, to_jsonb(so)->>'projectId', to_jsonb(so)->>'project_id', null) AS "projectId",
           COALESCE(to_jsonb(so)->>'projectName', to_jsonb(so)->>'project_name', '') AS "projectName",
           COALESCE(to_jsonb(so)->>'projectCode', to_jsonb(so)->>'project_code', '') AS "projectCode",
           COALESCE(to_jsonb(so)->>'installer', '') AS installer,
           COALESCE(to_jsonb(so)->>'remarks', '') AS remarks,
           COALESCE(to_jsonb(so)->>'created_at', to_jsonb(so)->>'createdAt', null) AS "createdAt"
         FROM tblsales_order so
         LEFT JOIN tblcustomer c
           ON c.id::text = COALESCE(to_jsonb(so)->>'customer_id', to_jsonb(so)->>'customerId')
         WHERE so.id = $1
         LIMIT 1`,
        [id],
      );

      if (salesResult.rowCount === 0) {
        return {
          success: false,
          message: `Sales order ${id} not found`,
        };
      }

      const paymentResult = await this.databaseService.query<{
        method: string | null;
        amount: string | null;
        terms: string | null;
        termsDueDate: string | null;
        status: string | null;
        referenceNo: string | null;
        paymentDate: string | null;
        issuedBy: string | null;
        ccCharge: string | null;
        checkNo: string | null;
        bankName: string | null;
        bankAccount: string | null;
        postDated: string | null;
        downPayment: string | null;
      }>(
        `SELECT
           COALESCE(to_jsonb(sp)->>'method', null) AS method,
           COALESCE(NULLIF(to_jsonb(sp)->>'amount', '')::numeric, 0)::text AS amount,
           COALESCE(to_jsonb(sp)->>'terms', null) AS terms,
           COALESCE(to_jsonb(sp)->>'terms_due_date', to_jsonb(sp)->>'termsDueDate', null) AS "termsDueDate",
           COALESCE(to_jsonb(sp)->>'status', null) AS status,
           COALESCE(to_jsonb(sp)->>'reference_no', to_jsonb(sp)->>'referenceNo', null) AS "referenceNo",
           COALESCE(to_jsonb(sp)->>'payment_date', to_jsonb(sp)->>'paymentDate', null) AS "paymentDate",
           COALESCE(to_jsonb(sp)->>'issued_by', to_jsonb(sp)->>'issuedBy', null) AS "issuedBy",
           COALESCE(to_jsonb(sp)->>'cc_charge', to_jsonb(sp)->>'ccCharge', null) AS "ccCharge",
           COALESCE(to_jsonb(sp)->>'check_no', to_jsonb(sp)->>'checkNo', null) AS "checkNo",
           COALESCE(to_jsonb(sp)->>'bank_name', to_jsonb(sp)->>'bankName', null) AS "bankName",
           COALESCE(to_jsonb(sp)->>'bank_account', to_jsonb(sp)->>'bankAccount', null) AS "bankAccount",
           COALESCE(to_jsonb(sp)->>'post_dated', to_jsonb(sp)->>'postDated', null) AS "postDated",
           COALESCE(NULLIF(COALESCE(to_jsonb(sp)->>'down_payment', to_jsonb(sp)->>'downPayment', ''), '')::numeric, 0)::text AS "downPayment"
         FROM tblso_payments sp
         WHERE COALESCE(to_jsonb(sp)->>'so_id', to_jsonb(sp)->>'soId') = $1
         ORDER BY sp.id ASC`,
        [String(id)],
      );

      const productResult = await this.databaseService.query<{
        id: number;
        transType: string | null;
        productId: string | null;
        capacityId: string | null;
        unitPrice: string | null;
        sellPrice: string | null;
        discountPrice: string | null;
        unitTypesQty: unknown;
        totalSetQty: string | null;
        purchaseId: string | null;
        salesId: string | null;
        status: string | null;
      }>(
        `SELECT
           tpi.id,
           COALESCE(to_jsonb(tpi)->>'transType', to_jsonb(tpi)->>'trans_type', 'sales') AS "transType",
           COALESCE(to_jsonb(tpi)->>'productId', to_jsonb(tpi)->>'product_id') AS "productId",
           COALESCE(to_jsonb(tpi)->>'capacityId', to_jsonb(tpi)->>'capacity_id') AS "capacityId",
           COALESCE(NULLIF(COALESCE(to_jsonb(tpi)->>'unitPrice', to_jsonb(tpi)->>'unit_price', ''), '')::numeric, 0)::text AS "unitPrice",
           COALESCE(NULLIF(COALESCE(to_jsonb(tpi)->>'sellPrice', to_jsonb(tpi)->>'sell_price', ''), '')::numeric, 0)::text AS "sellPrice",
           COALESCE(NULLIF(COALESCE(to_jsonb(tpi)->>'discountPrice', to_jsonb(tpi)->>'discount_price', ''), '')::numeric, 0)::text AS "discountPrice",
           COALESCE(to_jsonb(tpi)->'unitTypesQty', to_jsonb(tpi)->'unit_types_qty', '[]'::jsonb) AS "unitTypesQty",
           COALESCE(NULLIF(COALESCE(to_jsonb(tpi)->>'totalSetQty', to_jsonb(tpi)->>'total_set_qty', ''), '')::int, 0)::text AS "totalSetQty",
           COALESCE(to_jsonb(tpi)->>'purchaseId', to_jsonb(tpi)->>'purchase_id', to_jsonb(tpi)->>'po_id') AS "purchaseId",
           COALESCE(to_jsonb(tpi)->>'salesId', to_jsonb(tpi)->>'sales_id') AS "salesId",
           COALESCE(to_jsonb(tpi)->>'status', null) AS status
         FROM tbltransaction_product_items tpi
         WHERE COALESCE(to_jsonb(tpi)->>'salesId', to_jsonb(tpi)->>'sales_id') = $1
           AND LOWER(COALESCE(to_jsonb(tpi)->>'transType', to_jsonb(tpi)->>'trans_type', 'sales')) = 'sales'
         ORDER BY tpi.id ASC`,
        [String(id)],
      );

      const serialResult = await this.databaseService.query<{
        serialNumber: string | null;
        productId: string | null;
        capacityId: string | null;
        unitType: string | null;
      }>(
        `SELECT
           COALESCE(to_jsonb(sn)->>'serialNumber', to_jsonb(sn)->>'serial_number') AS "serialNumber",
           COALESCE(to_jsonb(sn)->>'productId', to_jsonb(sn)->>'product_id') AS "productId",
           COALESCE(to_jsonb(sn)->>'capacityId', to_jsonb(sn)->>'capacity_id') AS "capacityId",
           COALESCE(to_jsonb(sn)->>'unitType', to_jsonb(sn)->>'unit_type') AS "unitType"
         FROM tblserial_numbers sn
         WHERE COALESCE(to_jsonb(sn)->>'salesId', to_jsonb(sn)->>'sales_id') = $1`,
        [String(id)],
      );

      const serialMap = new Map<string, Record<string, string[]>>();
      for (const serialRow of serialResult.rows) {
        const productId = String(serialRow.productId ?? '').trim();
        const capacityId = String(serialRow.capacityId ?? '').trim();
        const serialNumber = this.normalizeSerialNumber(serialRow.serialNumber);

        if (!productId || !capacityId || !serialNumber) {
          continue;
        }

        const unitType = String(serialRow.unitType ?? 'set').trim() || 'set';
        const key = `${productId}::${capacityId}`;
        const existing = serialMap.get(key) ?? {};

        if (!Array.isArray(existing[unitType])) {
          existing[unitType] = [];
        }

        if (!existing[unitType].includes(serialNumber)) {
          existing[unitType].push(serialNumber);
        }

        serialMap.set(key, existing);
      }

      const serviceDetailResult = await this.databaseService.query<{
        id: number;
        serviceName: string | null;
        serviceCost: string | null;
        serviceDurationHours: string | null;
        serviceStatus: string | null;
        serviceNotes: string | null;
      }>(
        `SELECT
           sd.id,
           COALESCE(sd.service_name, '') AS "serviceName",
           COALESCE(sd.service_cost, 0)::text AS "serviceCost",
           COALESCE(sd.service_duration_hours, 0)::text AS "serviceDurationHours",
           COALESCE(sd.service_status, '') AS "serviceStatus",
           COALESCE(sd.service_notes, '') AS "serviceNotes"
         FROM tblservice_details sd
         WHERE sd.sales_id = $1
         ORDER BY sd.id ASC`,
        [String(id)],
      );

      const transferDetailResult = await this.databaseService.query<{
        id: number;
        fromBranchId: string | null;
        toBranchId: string | null;
        transferDate: string | null;
        expectedDeliveryDate: string | null;
        actualDeliveryDate: string | null;
        transferStatus: string | null;
        transferNotes: string | null;
      }>(
        `SELECT
           td.id,
           COALESCE(to_jsonb(td)->>'from_branch_id', to_jsonb(td)->>'fromBranchId') AS "fromBranchId",
           COALESCE(to_jsonb(td)->>'to_branch_id', to_jsonb(td)->>'toBranchId') AS "toBranchId",
           COALESCE(to_jsonb(td)->>'transfer_date', to_jsonb(td)->>'transferDate') AS "transferDate",
           COALESCE(to_jsonb(td)->>'expected_delivery_date', to_jsonb(td)->>'expectedDeliveryDate') AS "expectedDeliveryDate",
           COALESCE(to_jsonb(td)->>'actual_delivery_date', to_jsonb(td)->>'actualDeliveryDate') AS "actualDeliveryDate",
           COALESCE(to_jsonb(td)->>'transfer_status', to_jsonb(td)->>'transferStatus', '') AS "transferStatus",
           COALESCE(to_jsonb(td)->>'transfer_notes', to_jsonb(td)->>'transferNotes', '') AS "transferNotes"
         FROM tbltransfer_details td
         WHERE td.sales_id = $1
         LIMIT 1`,
        [String(id)],
      );

      const concernDetailResult = await this.databaseService.query<{
        id: number;
        concernType: string | null;
        concernSubject: string | null;
        concernDescription: string | null;
        concernStatus: string | null;
        priority: string | null;
        resolutionNotes: string | null;
        resolvedAt: string | null;
      }>(
        `SELECT
           cd.id,
           COALESCE(cd.concern_type, '') AS "concernType",
           COALESCE(cd.concern_subject, '') AS "concernSubject",
           COALESCE(cd.concern_description, '') AS "concernDescription",
           COALESCE(cd.concern_status, '') AS "concernStatus",
           COALESCE(cd.priority, '') AS "priority",
           COALESCE(cd.resolution_notes, '') AS "resolutionNotes",
           COALESCE(cd.resolved_at, NULL) AS "resolvedAt"
         FROM tblconcern_details cd
         WHERE cd.sales_id = $1
         LIMIT 1`,
        [String(id)],
      );

      const expenseDetailResult = await this.databaseService.query<{
        id: string;
        expenseType: string | null;
        expenseDescription: string | null;
        amount: string | null;
        expenseDate: string | null;
        paidTo: string | null;
        paymentMethod: string | null;
        referenceNo: string | null;
      }>(
        `SELECT
           ed.id::text AS id,
           COALESCE(ed.expense_type, '') AS "expenseType",
           COALESCE(ed.expense_description, '') AS "expenseDescription",
           COALESCE(ed.amount, 0)::text AS amount,
           COALESCE(to_jsonb(ed)->>'expense_date', to_jsonb(ed)->>'expenseDate', null) AS "expenseDate",
           COALESCE(ed.paid_to, '') AS "paidTo",
           COALESCE(ed.payment_method, '') AS "paymentMethod",
           COALESCE(ed.reference_no, '') AS "referenceNo"
         FROM tblexpense_details ed
         WHERE ed.sales_id = $1
         ORDER BY ed.created_at ASC`,
        [String(id)],
      );

      let materialItems: any[] = [];
      try {
        materialItems = await this.materialTransactionsService.findBySalesId(id);
      } catch {
        materialItems = [];
      }

      // Also fetch misc items (material/excess category) that don't have a material_id
      // These are custom items added from Sales Remittance that aren't in inventory
      let miscMaterialItems: any[] = [];
      try {
        const miscResult = await this.databaseService.query<{
          id: number;
          category: string;
          item_name: string;
          quantity: string;
          unit: string;
          unit_price: string;
          total_price: string;
          is_inclusion: boolean;
          material_id: number | null;
          created_at: string;
        }>(
          `SELECT id, category, item_name, quantity::text, unit, unit_price::text, total_price::text, is_inclusion, material_id, created_at::text
           FROM tblso_miscellaneous_items
           WHERE sales_id = $1
             AND category IN ('material', 'excess')
             AND material_id IS NULL`,
          [id],
        );
        miscMaterialItems = miscResult.rows.map((row) => ({
          id: row.id,
          trans_type: 'sales',
          material_id: null,
          material_name: row.item_name,
          material_code: null,
          quantity: Number(row.quantity) || 0,
          unit: row.unit,
          unit_price: Number(row.unit_price) || 0,
          sell_price: Number(row.unit_price) || 0,
          discount_price: 0,
          sales_id: id,
          purchase_id: null,
          is_inclusion: row.is_inclusion,
          category: row.category,
          created_at: row.created_at,
        }));
      } catch {
        miscMaterialItems = [];
      }

      const allMaterialItems = [...materialItems, ...miscMaterialItems];

      const sales = salesResult.rows[0];

      return {
        success: true,
        item: {
          id: sales.id,
          soNumber: sales.soNumber,
          customerId: sales.customerId,
          customerName: sales.customerName,
          customerAddress: sales.customerAddress,
          customerContactPerson: sales.customerContactPerson,
          customerContactNumber: sales.customerContactNumber,
          customerEmail: sales.customerEmail,
          customerTinNumber: sales.customerTinNumber,
          totalAmount: this.toOptionalNumber(sales.totalAmount) ?? 0,
          status: sales.status ?? 'pending',
          scheduleDate: sales.scheduleDate,
          salesType: sales.salesType ?? '',
          projectId: this.toOptionalNumber(sales.projectId),
          projectName: sales.projectName ?? '',
          projectCode: sales.projectCode ?? '',
          installer: sales.installer ?? '',
          remarks: sales.remarks ?? '',
          paymentDetails: paymentResult.rows.map((payment) => ({
            method: payment.method ?? '',
            amount: this.toOptionalNumber(payment.amount) ?? 0,
            terms: payment.terms ?? '',
            termsDueDate: payment.termsDueDate,
            status: this.resolvePaymentStatusForDisplay(
              payment.method,
              payment.status,
              payment.termsDueDate,
              payment.postDated,
            ),
            referenceNo: payment.referenceNo ?? '',
            paymentDate: payment.paymentDate,
            issuedBy: payment.issuedBy ?? '',
            ccCharge: payment.ccCharge ?? '',
            checkNo: payment.checkNo ?? '',
            bankName: payment.bankName ?? '',
            bankAccount: payment.bankAccount ?? '',
            postDated: payment.postDated ?? '',
            downPayment: this.toOptionalNumber(payment.downPayment) ?? 0,
          })),
          productItems: productResult.rows.map((product) => {
            const normalizedProductId = String(product.productId ?? '').trim();
            const normalizedCapacityId = String(product.capacityId ?? '').trim();
            const serialKey = `${normalizedProductId}::${normalizedCapacityId}`;

            return {
              id: product.id,
              transType: product.transType ?? 'sales',
              productId: normalizedProductId,
              capacityId: normalizedCapacityId,
              unitPrice: this.toOptionalNumber(product.unitPrice) ?? 0,
              sellPrice: this.toOptionalNumber(product.sellPrice) ?? 0,
              discountPrice: this.toOptionalNumber(product.discountPrice) ?? 0,
              unitTypesQty: this.normalizeUnitTypesQty(product.unitTypesQty),
              totalSetQty: this.toOptionalNumber(product.totalSetQty) ?? 0,
              purchaseId: this.toOptionalNumber(product.purchaseId),
              salesId: this.toOptionalNumber(product.salesId) ?? id,
              status: product.status ?? 'pending',
              serialNumbers: serialMap.get(serialKey) ?? {},
            };
          }),
          serviceItems: serviceDetailResult.rows.map((service) => ({
            id: service.id,
            serviceName: service.serviceName ?? '',
            unitPrice: this.toOptionalNumber(service.serviceCost) ?? 0,
            qty: this.toOptionalNumber(service.serviceDurationHours) ?? 0,
            total: this.toOptionalNumber(service.serviceCost) ?? 0,
          })),
          transferDetails: transferDetailResult.rows[0]
            ? {
                id: transferDetailResult.rows[0].id,
                fromBranchId: this.toOptionalNumber(transferDetailResult.rows[0].fromBranchId),
                toBranchId: this.toOptionalNumber(transferDetailResult.rows[0].toBranchId),
                transferDate: transferDetailResult.rows[0].transferDate,
                expectedDeliveryDate: transferDetailResult.rows[0].expectedDeliveryDate,
                actualDeliveryDate: transferDetailResult.rows[0].actualDeliveryDate,
                transferStatus: transferDetailResult.rows[0].transferStatus ?? '',
                transferNotes: transferDetailResult.rows[0].transferNotes ?? '',
              }
            : null,
          concernDetails: concernDetailResult.rows[0]
            ? {
                id: concernDetailResult.rows[0].id,
                concernType: concernDetailResult.rows[0].concernType ?? '',
                concernSubject: concernDetailResult.rows[0].concernSubject ?? '',
                concernDescription: concernDetailResult.rows[0].concernDescription ?? '',
                concernStatus: concernDetailResult.rows[0].concernStatus ?? '',
                priority: concernDetailResult.rows[0].priority ?? '',
                resolutionNotes: concernDetailResult.rows[0].resolutionNotes ?? '',
                resolvedAt: concernDetailResult.rows[0].resolvedAt,
              }
            : null,
          expenseDetails: expenseDetailResult.rows.map((expense) => ({
            id: expense.id,
            expenseType: expense.expenseType ?? '',
            expenseDescription: expense.expenseDescription ?? '',
            amount: this.toOptionalNumber(expense.amount) ?? 0,
            expenseDate: expense.expenseDate,
            paidTo: expense.paidTo ?? '',
            paymentMethod: expense.paymentMethod ?? '',
            referenceNo: expense.referenceNo ?? '',
          })),
          materialItems: allMaterialItems,
          createdAt: sales.createdAt,
        },
      };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to load sales order detail',
      };
    }
  }

  async update(
    id: number,
    updateSalesOrderDto: UpdateSalesOrderDto,
    userId?: number,
    branchId?: number,
    auditActor?: AuditActorContext,
  ) {
    if (!Number.isFinite(id) || id <= 0) {
      return { success: false, message: 'Invalid sales order id' };
    }

    if (!updateSalesOrderDto || typeof updateSalesOrderDto !== 'object') {
      return {
        success: false,
        message:
          'Invalid request body. Ensure JSON object payload is provided to PATCH /sales-order/:id.',
      };
    }

    const payload = updateSalesOrderDto as UpdateSalesOrderDto;
    const beforeSnapshot = await this.getSalesOrderAuditSnapshot(id);

    try {
      const result = await this.databaseService.withTransaction(async (client) => {
        const existingSalesResult = await client.query<{
          id: number;
          customer_id: string | null;
          total_amount: string | null;
          status: string | null;
          installer: string | null;
          sales_type: string | null;
        }>(
          `SELECT
             so.id,
             so.customer_id::text AS customer_id,
             so.total_amount::text AS total_amount,
             so.status::text AS status,
             COALESCE(to_jsonb(so)->>'installer', '') AS installer,
             COALESCE(to_jsonb(so)->>'salesType', to_jsonb(so)->>'sales_type', '') AS sales_type
           FROM tblsales_order so
           WHERE so.id = $1
           LIMIT 1`,
          [id],
        );

        if (existingSalesResult.rowCount === 0) {
          throw new Error(`Sales order ${id} not found`);
        }

        const existingSales = existingSalesResult.rows[0];
        const isTransferSO = String(payload.salesType ?? existingSales.sales_type ?? '').toLowerCase() === 'transfer';

        let customerId: string | null = null;
        if (!isTransferSO) {
          const customerColumns = await this.getTableColumns(client, 'tblcustomer');
          const customerNameColumn = this.pickColumn(customerColumns, ['name', 'customer_name']);
          const customerAddressColumn = this.pickColumn(customerColumns, ['address']);
          const customerContactPersonColumn = this.pickColumn(customerColumns, [
            'contact_person',
            'contactPerson',
          ]);
          const customerContactNumberColumn = this.pickColumn(customerColumns, [
            'contact_number',
            'contactNumber',
          ]);
          const customerEmailColumn = this.pickColumn(customerColumns, ['email']);
          const customerTinColumn = this.pickColumn(customerColumns, ['tin_number', 'tinNumber']);

          customerId = await this.upsertCustomerFromPayload(client, {
            customer_id: payload.customer_id ?? existingSales.customer_id ?? null,
            customer: payload.customer,
          });

          if (customerId && payload.customer) {
            const updates: string[] = [];
            const params: unknown[] = [];

            const customerName = this.normalizeText(payload.customer.name);
            const customerAddress = this.normalizeText(payload.customer.address);
            const customerContactPerson = this.normalizeText(payload.customer.contact_person);
            const customerContactNumber = this.normalizeText(payload.customer.contact_number);
            const customerEmail = this.normalizeText(payload.customer.email);
            const customerTin = this.normalizeText(payload.customer.tin_number);

            if (customerNameColumn && customerName) {
              params.push(customerName);
              updates.push(`"${customerNameColumn}" = $${params.length}`);
            }
            if (customerAddressColumn && customerAddress) {
              params.push(customerAddress);
              updates.push(`"${customerAddressColumn}" = $${params.length}`);
            }
            if (customerContactPersonColumn && customerContactPerson) {
              params.push(customerContactPerson);
              updates.push(`"${customerContactPersonColumn}" = $${params.length}`);
            }
            if (customerContactNumberColumn && customerContactNumber) {
              params.push(customerContactNumber);
              updates.push(`"${customerContactNumberColumn}" = $${params.length}`);
            }
            if (customerEmailColumn && customerEmail) {
              params.push(customerEmail);
              updates.push(`"${customerEmailColumn}" = $${params.length}`);
            }
            if (customerTinColumn && customerTin) {
              params.push(customerTin);
              updates.push(`"${customerTinColumn}" = $${params.length}`);
            }

            if (updates.length > 0) {
              params.push(customerId);
              await client.query(
                `UPDATE tblcustomer
                 SET ${updates.join(', ')}
                 WHERE id::text = $${params.length}`,
                params,
              );
            }
          }

          if (!customerId) {
            throw new Error('Unable to resolve customer for sales order update');
          }
        }

        const productItems = Array.isArray(payload.productItems) ? payload.productItems : [];
        const serviceItems = Array.isArray(payload.serviceItems) ? payload.serviceItems : [];

        let computedProductTotal = 0;
        for (const item of productItems) {
          const unitPrice = this.toOptionalNumber(item.unitPrice) ?? 0;
          const sellPrice = this.toOptionalNumber(item.sellPrice) ?? 0;
          const discountPrice = this.toOptionalNumber(item.discountPrice) ?? 0;
          const qty = this.toOptionalNumber(item.totalSetQty) ?? 0;
          const priceToUse = discountPrice > 0 ? discountPrice : sellPrice > 0 ? sellPrice : unitPrice;
          computedProductTotal += priceToUse * qty;
        }

        let computedServiceTotal = 0;
        for (const item of serviceItems) {
          const unitPrice = this.toOptionalNumber(item.serviceCost) ?? 0;
          const qty = this.toOptionalNumber(item.serviceDurationHours) ?? 0;
          const total = this.toOptionalNumber(item.serviceCost) ?? 0;
          computedServiceTotal += total > 0 ? total : unitPrice * qty;
        }

        const computedTotalAmount = computedProductTotal + computedServiceTotal;

        const fallbackTotal =
          this.toOptionalNumber(payload.totalAmount) ??
          this.toOptionalNumber(existingSales.total_amount) ??
          0;
        const totalAmount = computedTotalAmount > 0 ? computedTotalAmount : fallbackTotal;
        const status = String(payload.status ?? existingSales.status ?? 'pending').trim() || 'pending';

        const salesColumns = await this.getTableColumns(client, 'tblsales_order');
        const salesCustomerIdColumn = this.pickColumn(salesColumns, ['customer_id', 'customerId']);
        const totalAmountColumn = this.pickColumn(salesColumns, ['total_amount', 'totalAmount']);
        const scheduleDateColumn = this.pickColumn(salesColumns, ['scheduleDate', 'schedule_date']);
        const salesTypeColumn = this.pickColumn(salesColumns, ['salesType', 'sales_type']);
        const projectNameColumn = this.pickColumn(salesColumns, ['projectName', 'project_name']);
        const projectCodeColumn = this.pickColumn(salesColumns, ['projectCode', 'project_code']);
        const installerColumn = this.pickColumn(salesColumns, ['installer']);
        const remarksColumn = this.pickColumn(salesColumns, ['remarks']);
        const statusColumn = this.pickColumn(salesColumns, ['status']);
        const branchColumn = this.pickColumn(salesColumns, ['branchId', 'branch_id']);

        if (!salesCustomerIdColumn || !totalAmountColumn || !statusColumn) {
          throw new Error('tblsales_order columns are not aligned with expected fields');
        }

        const soParams: unknown[] = [customerId, totalAmount, status];
        const soUpdates: string[] = [
          `"${salesCustomerIdColumn}" = $1`,
          `"${totalAmountColumn}" = $2`,
          `"${statusColumn}" = $3`,
        ];

        if (scheduleDateColumn && Object.prototype.hasOwnProperty.call(payload, 'scheduleDate')) {
          soParams.push(this.toIsoDateOrNull(payload.scheduleDate));
          soUpdates.push(`"${scheduleDateColumn}" = $${soParams.length}`);
        }
        if (salesTypeColumn && Object.prototype.hasOwnProperty.call(payload, 'salesType')) {
          soParams.push(String(payload.salesType ?? '').trim());
          soUpdates.push(`"${salesTypeColumn}" = $${soParams.length}`);
        }
        if (projectNameColumn && Object.prototype.hasOwnProperty.call(payload, 'projectName')) {
          soParams.push(String(payload.projectName ?? '').trim());
          soUpdates.push(`"${projectNameColumn}" = $${soParams.length}`);
        }
        if (projectCodeColumn && Object.prototype.hasOwnProperty.call(payload, 'projectCode')) {
          soParams.push(String(payload.projectCode ?? '').trim());
          soUpdates.push(`"${projectCodeColumn}" = $${soParams.length}`);
        }
        if (installerColumn && Object.prototype.hasOwnProperty.call(payload, 'installer')) {
          soParams.push(String(payload.installer ?? '').trim());
          soUpdates.push(`"${installerColumn}" = $${soParams.length}`);
        }
        if (remarksColumn && Object.prototype.hasOwnProperty.call(payload, 'remarks')) {
          soParams.push(String(payload.remarks ?? ''));
          soUpdates.push(`"${remarksColumn}" = $${soParams.length}`);
        }

        if (branchColumn && branchId) {
          soParams.push(branchId);
          soUpdates.push(`"${branchColumn}" = $${soParams.length}`);
        }

        soParams.push(id);
        await client.query(
          `UPDATE tblsales_order
           SET ${soUpdates.join(', ')}
           WHERE id = $${soParams.length}`,
          soParams,
        );

        if (payload.paymentDetails) {
          const paymentDetailsInput = payload.paymentDetails;
          const paymentDetailsList = Array.isArray(paymentDetailsInput)
            ? paymentDetailsInput
            : paymentDetailsInput
              ? [paymentDetailsInput]
              : [];

          const paymentColumns = await this.getTableColumns(client, 'tblso_payments');
          const soIdColumn = this.pickColumn(paymentColumns, ['so_id', 'soId']);
          const methodColumn = this.pickColumn(paymentColumns, ['method']);
          const amountColumn = this.pickColumn(paymentColumns, ['amount']);
          const termsColumn = this.pickColumn(paymentColumns, ['terms']);
          const termsDueDateColumn = this.pickColumn(paymentColumns, ['termsDueDate', 'terms_due_date']);
          const paymentStatusColumn = this.pickColumn(paymentColumns, ['status']);
          const referenceNoColumn = this.pickColumn(paymentColumns, ['referenceNo', 'reference_no']);
          const paymentDateColumn = this.pickColumn(paymentColumns, ['paymentDate', 'payment_date']);
          const issuedByColumn = this.pickColumn(paymentColumns, ['issuedBy', 'issued_by']);
          const ccChargeColumn = this.pickColumn(paymentColumns, ['ccCharge', 'cc_charge']);
          const checkNoColumn = this.pickColumn(paymentColumns, ['checkNo', 'check_no']);
          const bankNameColumn = this.pickColumn(paymentColumns, ['bankName', 'bank_name']);
          const bankAccountColumn = this.pickColumn(paymentColumns, ['bankAccount', 'bank_account']);
          const postDatedColumn = this.pickColumn(paymentColumns, ['postDated', 'post_dated']);
          const downPaymentColumn = this.pickColumn(paymentColumns, ['downPayment', 'down_payment']);

          if (soIdColumn) {
            await client.query(
              `DELETE FROM tblso_payments p
               WHERE COALESCE(to_jsonb(p)->>'so_id', to_jsonb(p)->>'soId') = $1`,
              [String(id)],
            );

            for (const [paymentIndex, paymentDetails] of paymentDetailsList.entries()) {
              if (!paymentDetails || typeof paymentDetails !== 'object') {
                throw new BadRequestException(`paymentDetails[${paymentIndex}] must be an object`);
              }

              const paymentPayload = paymentDetails as Record<string, unknown>;
              const method = this.validateSalesPaymentDetails(paymentPayload, paymentIndex);

              const paymentRecord: Record<string, unknown> = {
                [soIdColumn]: id,
              };

              const amount = this.toOptionalNumber(paymentPayload.amount) ?? totalAmount;
              if (methodColumn) paymentRecord[methodColumn] = method;
              if (amountColumn) paymentRecord[amountColumn] = amount;
              if (termsColumn && paymentPayload.terms) paymentRecord[termsColumn] = String(paymentPayload.terms).trim();
              if (termsDueDateColumn) {
                paymentRecord[termsDueDateColumn] = this.deriveTermsDueDate(paymentPayload, method);
              }
              if (paymentStatusColumn) {
                const explicitStatus = String(paymentPayload.status ?? '').trim().toLowerCase();
                const normalizedStatus = ['paid', 'unpaid', 'overdue'].includes(explicitStatus)
                  ? explicitStatus
                  : this.getAutoPaymentStatus(method);
                paymentRecord[paymentStatusColumn] = normalizedStatus;
              }
              if (referenceNoColumn && paymentPayload.referenceNo) paymentRecord[referenceNoColumn] = String(paymentPayload.referenceNo).trim();
              if (paymentDateColumn) paymentRecord[paymentDateColumn] = this.toIsoDateOrNull(paymentPayload.paymentDate);
              if (issuedByColumn && paymentPayload.issuedBy) paymentRecord[issuedByColumn] = String(paymentPayload.issuedBy).trim();
              if (ccChargeColumn && paymentPayload.ccCharge) paymentRecord[ccChargeColumn] = String(paymentPayload.ccCharge).trim();
              if (checkNoColumn && paymentPayload.checkNo) paymentRecord[checkNoColumn] = String(paymentPayload.checkNo).trim();
              if (bankNameColumn && paymentPayload.bankName) paymentRecord[bankNameColumn] = String(paymentPayload.bankName).trim();
              if (bankAccountColumn && paymentPayload.bankAccount) paymentRecord[bankAccountColumn] = String(paymentPayload.bankAccount).trim();
              if (postDatedColumn && paymentPayload.postDated) paymentRecord[postDatedColumn] = String(paymentPayload.postDated).trim();
              if (downPaymentColumn) paymentRecord[downPaymentColumn] = this.toOptionalNumber(paymentPayload.downPayment) ?? 0;

              await this.runInsert(client, 'tblso_payments', paymentRecord);
            }
          }
        }

        if (productItems.length > 0) {
          const serialColumns = await this.getTableColumns(client, 'tblserial_numbers');
          const serialCustomerIdColumn = this.pickColumn(serialColumns, ['customerId', 'customer_id']);

          await client.query(
            `DELETE FROM tbltransaction_product_items
             WHERE COALESCE(
               to_jsonb(tbltransaction_product_items)->>'salesId',
               to_jsonb(tbltransaction_product_items)->>'sales_id'
             ) = $1
             AND LOWER(COALESCE(
               to_jsonb(tbltransaction_product_items)->>'transType',
               to_jsonb(tbltransaction_product_items)->>'trans_type',
               'sales'
             )) = 'sales'`,
            [String(id)],
          );

          const transactionItemColumns = await this.getTableColumns(client, 'tbltransaction_product_items');
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

          for (const item of productItems) {
            const transType = String(item.transType ?? 'sales').trim().toLowerCase();
            if (transType !== 'sales') {
              continue;
            }

            const productId = this.toOptionalNumber(item.productId);
            const capacityId = this.toOptionalNumber(item.capacityId);
            if (productId === null || capacityId === null) {
              throw new Error('productId and capacityId are required for sales items');
            }

            const itemRecord: Record<string, unknown> = {};
            if (transTypeColumn) itemRecord[transTypeColumn] = transType;
            if (productIdColumn) itemRecord[productIdColumn] = productId;
            if (capacityIdColumn) itemRecord[capacityIdColumn] = capacityId;
            if (unitPriceColumn) itemRecord[unitPriceColumn] = this.toOptionalNumber(item.unitPrice) ?? 0;
            if (sellPriceColumn) itemRecord[sellPriceColumn] = this.toOptionalNumber(item.sellPrice) ?? 0;
            if (discountPriceColumn) itemRecord[discountPriceColumn] = this.toOptionalNumber(item.discountPrice) ?? 0;
            if (unitTypesQtyColumn) itemRecord[unitTypesQtyColumn] = JSON.stringify(item.unitTypesQty ?? []);
            if (totalSetQtyColumn) itemRecord[totalSetQtyColumn] = this.toOptionalNumber(item.totalSetQty) ?? 0;
            if (purchaseIdColumn) itemRecord[purchaseIdColumn] = this.toOptionalNumber(item.purchaseId);
            if (salesIdColumn) itemRecord[salesIdColumn] = id;
            if (itemStatusColumn) itemRecord[itemStatusColumn] = status;

            await this.runInsert(client, 'tbltransaction_product_items', itemRecord);

            const serialPayload =
              item.serialNumbers && typeof item.serialNumbers === 'object'
                ? (item.serialNumbers as Record<string, unknown>)
                : {};
            const serialStatus =
              String((serialPayload.status as string | undefined) ?? 'reserved').trim().toLowerCase() || 'reserved';

            for (const [unitTypeKey, values] of Object.entries(serialPayload)) {
              if (unitTypeKey.toLowerCase() === 'status') {
                continue;
              }

              const serialList = Array.isArray(values) ? values : [];
              for (const serialRaw of serialList) {
                const normalizedSerial = this.normalizeSerialNumber(serialRaw);
                if (!normalizedSerial) {
                  continue;
                }

                const existingSerialResult = await client.query<{ id: number; sales_id: string | null }>(
                  `SELECT
                     sn.id,
                     sn."salesId"::text AS sales_id
                   FROM tblserial_numbers sn
                   WHERE LOWER(
                     regexp_replace(BTRIM(COALESCE(sn."serialNumber", '')), '\\s+', ' ', 'g')
                   ) = LOWER($1)
                   LIMIT 1`,
                  [normalizedSerial],
                );

                if (existingSerialResult.rowCount === 0) {
                  throw new Error(`Serial number ${normalizedSerial} was not found in inventory`);
                }

                const existingSerial = existingSerialResult.rows[0];
                if (
                  existingSerial.sales_id &&
                  Number(existingSerial.sales_id) !== id
                ) {
                  throw new Error(
                    `Serial number ${normalizedSerial} is already linked to sales order ${existingSerial.sales_id}`,
                  );
                }

                if (serialCustomerIdColumn) {
                  await client.query(
                    `UPDATE tblserial_numbers
                     SET
                       "branchId" = COALESCE($1, "branchId"),
                       "salesId" = $2,
                       "productId" = $3,
                       "capacityId" = $4,
                       "unitType" = $5,
                       status = $6,
                       "${serialCustomerIdColumn}" = $7,
                       created_by = COALESCE($8, created_by)
                     WHERE id = $9`,
                    [
                      branchId ?? null,
                      id,
                      productId,
                      capacityId,
                      unitTypeKey,
                      serialStatus,
                      customerId,
                      userId ?? null,
                      existingSerial.id,
                    ],
                  );
                } else {
                  await client.query(
                    `UPDATE tblserial_numbers
                     SET
                       "branchId" = COALESCE($1, "branchId"),
                       "salesId" = $2,
                       "productId" = $3,
                       "capacityId" = $4,
                       "unitType" = $5,
                       status = $6,
                       created_by = COALESCE($7, created_by)
                     WHERE id = $8`,
                    [
                      branchId ?? null,
                      id,
                      productId,
                      capacityId,
                      unitTypeKey,
                      serialStatus,
                      userId ?? null,
                      existingSerial.id,
                    ],
                  );
                }
              }
            }
          }
        }

        // Update service details
        if (Array.isArray(payload.serviceItems)) {
          const serviceColumns = await this.getTableColumns(client, 'tblservice_details');
          const serviceSalesIdColumn = this.pickColumn(serviceColumns, ['sales_id', 'salesId']);
          const serviceNameColumn = this.pickColumn(serviceColumns, ['service_name', 'serviceName']);
          const serviceDescriptionColumn = this.pickColumn(serviceColumns, ['service_description', 'serviceDescription']);
          const serviceTypeColumn = this.pickColumn(serviceColumns, ['service_type', 'serviceType']);
          const technicianAssignedColumn = this.pickColumn(serviceColumns, ['technician_assigned', 'technicianAssigned']);
          const serviceDateColumn = this.pickColumn(serviceColumns, ['service_date', 'serviceDate']);
          const serviceDurationHoursColumn = this.pickColumn(serviceColumns, ['service_duration_hours', 'serviceDurationHours']);
          const serviceCostColumn = this.pickColumn(serviceColumns, ['service_cost', 'serviceCost']);
          const partsCostColumn = this.pickColumn(serviceColumns, ['parts_cost', 'partsCost']);
          const laborCostColumn = this.pickColumn(serviceColumns, ['labor_cost', 'laborCost']);
          const serviceStatusColumn = this.pickColumn(serviceColumns, ['service_status', 'serviceStatus']);
          const serviceNotesColumn = this.pickColumn(serviceColumns, ['service_notes', 'serviceNotes']);

          if (serviceSalesIdColumn) {
            await client.query(
              `DELETE FROM tblservice_details WHERE "${serviceSalesIdColumn}" = $1`,
              [id],
            );

            for (const item of payload.serviceItems) {
              const record: Record<string, unknown> = {
                [serviceSalesIdColumn]: id,
              };

              if (serviceNameColumn && item.serviceName !== undefined) {
                record[serviceNameColumn] = String(item.serviceName ?? '').trim();
              }
              if (serviceDescriptionColumn && item.serviceDescription !== undefined) {
                record[serviceDescriptionColumn] = String(item.serviceDescription ?? '').trim();
              }
              if (serviceTypeColumn && item.serviceType !== undefined) {
                record[serviceTypeColumn] = String(item.serviceType ?? '').trim();
              }
              if (technicianAssignedColumn && item.technicianAssigned !== undefined) {
                record[technicianAssignedColumn] = String(item.technicianAssigned ?? '').trim();
              }
              if (serviceDateColumn && item.serviceDate !== undefined) {
                record[serviceDateColumn] = this.toIsoDateOrNull(item.serviceDate);
              }
              if (serviceDurationHoursColumn && item.serviceDurationHours !== undefined) {
                record[serviceDurationHoursColumn] = this.toOptionalNumber(item.serviceDurationHours);
              }
              if (serviceCostColumn && item.serviceCost !== undefined) {
                record[serviceCostColumn] = this.toOptionalNumber(item.serviceCost) ?? 0;
              }
              if (partsCostColumn && item.partsCost !== undefined) {
                record[partsCostColumn] = this.toOptionalNumber(item.partsCost) ?? 0;
              }
              if (laborCostColumn && item.laborCost !== undefined) {
                record[laborCostColumn] = this.toOptionalNumber(item.laborCost) ?? 0;
              }
              if (serviceStatusColumn && item.serviceStatus !== undefined) {
                const svcStatus = String(item.serviceStatus ?? '').trim().toLowerCase();
                const validSvcStatuses = ['scheduled', 'in_progress', 'completed', 'cancelled'];
                record[serviceStatusColumn] = validSvcStatuses.includes(svcStatus) ? svcStatus : 'scheduled';
              }
              if (serviceNotesColumn && item.serviceNotes !== undefined) {
                record[serviceNotesColumn] = String(item.serviceNotes ?? '').trim();
              }

              await this.runInsert(client, 'tblservice_details', record);
            }
          }
        }

        // Update project details
        if (payload.projectDetails ||
          Object.prototype.hasOwnProperty.call(payload, 'projectName') ||
          Object.prototype.hasOwnProperty.call(payload, 'projectCode')) {
          const projectColumns = await this.getTableColumns(client, 'tblproject_details');
          const projectSalesIdColumn = this.pickColumn(projectColumns, ['sales_id', 'salesId']);
          const projectNameColumn = this.pickColumn(projectColumns, ['project_name', 'projectName']);
          const projectCodeColumn = this.pickColumn(projectColumns, ['project_code', 'projectCode']);
          const projectLocationColumn = this.pickColumn(projectColumns, ['project_location', 'projectLocation']);
          const projectStartDateColumn = this.pickColumn(projectColumns, ['project_start_date', 'projectStartDate']);
          const projectEndDateColumn = this.pickColumn(projectColumns, ['project_end_date', 'projectEndDate']);
          const projectManagerColumn = this.pickColumn(projectColumns, ['project_manager', 'projectManager']);
          const projectStatusColumn = this.pickColumn(projectColumns, ['project_status', 'projectStatus']);
          const projectNotesColumn = this.pickColumn(projectColumns, ['project_notes', 'projectNotes']);

          if (projectSalesIdColumn) {
            await client.query(
              `DELETE FROM tblproject_details WHERE "${projectSalesIdColumn}" = $1`,
              [id],
            );

            const details = payload.projectDetails ?? {
              projectName: payload.projectName,
              projectCode: payload.projectCode,
            };

            const record: Record<string, unknown> = {
              [projectSalesIdColumn]: id,
            };

            if (projectNameColumn && details?.projectName !== undefined) {
              record[projectNameColumn] = String(details.projectName ?? '').trim();
            }
            if (projectCodeColumn && details?.projectCode !== undefined) {
              record[projectCodeColumn] = String(details.projectCode ?? '').trim();
            }
            if (projectLocationColumn && details?.projectLocation !== undefined) {
              record[projectLocationColumn] = String(details.projectLocation ?? '').trim();
            }
            if (projectStartDateColumn && details?.projectStartDate !== undefined) {
              record[projectStartDateColumn] = this.toIsoDateOrNull(details.projectStartDate);
            }
            if (projectEndDateColumn && details?.projectEndDate !== undefined) {
              record[projectEndDateColumn] = this.toIsoDateOrNull(details.projectEndDate);
            }
            if (projectManagerColumn && details?.projectManager !== undefined) {
              record[projectManagerColumn] = String(details.projectManager ?? '').trim();
            }
            if (projectStatusColumn && details?.projectStatus !== undefined) {
              record[projectStatusColumn] = String(details.projectStatus ?? '').trim();
            }
            if (projectNotesColumn && details?.projectNotes !== undefined) {
              record[projectNotesColumn] = String(details.projectNotes ?? '').trim();
            }

            await this.runInsert(client, 'tblproject_details', record);
          }
        }

        // Update transfer details
        let transferDetailsId: number | null = null;
        if (payload.transferDetails) {
          const transferColumns = await this.getTableColumns(client, 'tbltransfer_details');
          const transferSalesIdColumn = this.pickColumn(transferColumns, ['sales_id', 'salesId']);
          const fromBranchIdColumn = this.pickColumn(transferColumns, ['from_branch_id', 'fromBranchId']);
          const toBranchIdColumn = this.pickColumn(transferColumns, ['to_branch_id', 'toBranchId']);
          const transferDateColumn = this.pickColumn(transferColumns, ['transfer_date', 'transferDate']);
          const expectedDeliveryDateColumn = this.pickColumn(transferColumns, ['expected_delivery_date', 'expectedDeliveryDate']);
          const actualDeliveryDateColumn = this.pickColumn(transferColumns, ['actual_delivery_date', 'actualDeliveryDate']);
          const transferStatusColumn = this.pickColumn(transferColumns, ['transfer_status', 'transferStatus']);
          const transferNotesColumn = this.pickColumn(transferColumns, ['transfer_notes', 'transferNotes']);
          const sentByColumn = this.pickColumn(transferColumns, ['sent_by', 'sentBy']);
          const receivedByColumn = this.pickColumn(transferColumns, ['received_by', 'receivedBy']);
          const acknowledgedByColumn = this.pickColumn(transferColumns, ['acknowledged_by', 'acknowledgedBy']);
          const acknowledgedAtColumn = this.pickColumn(transferColumns, ['acknowledged_at', 'acknowledgedAt']);

          if (transferSalesIdColumn) {
            await client.query(
              `DELETE FROM tbltransfer_details WHERE "${transferSalesIdColumn}" = $1`,
              [id],
            );

            const details = payload.transferDetails;
            const record: Record<string, unknown> = {
              [transferSalesIdColumn]: id,
            };

            if (fromBranchIdColumn && details.fromBranchId !== undefined) {
              record[fromBranchIdColumn] = this.toOptionalNumber(details.fromBranchId);
            }
            if (toBranchIdColumn && details.toBranchId !== undefined) {
              record[toBranchIdColumn] = this.toOptionalNumber(details.toBranchId);
            }
            if (transferDateColumn && details.transferDate !== undefined) {
              record[transferDateColumn] = this.toIsoDateOrNull(details.transferDate);
            }
            if (expectedDeliveryDateColumn && details.expectedDeliveryDate !== undefined) {
              record[expectedDeliveryDateColumn] = this.toIsoDateOrNull(details.expectedDeliveryDate);
            }
            if (actualDeliveryDateColumn && details.actualDeliveryDate !== undefined) {
              record[actualDeliveryDateColumn] = this.toIsoDateOrNull(details.actualDeliveryDate);
            }
            if (transferStatusColumn && details.transferStatus !== undefined) {
              record[transferStatusColumn] = String(details.transferStatus ?? '').trim();
            }
            if (transferNotesColumn && details.transferNotes !== undefined) {
              record[transferNotesColumn] = String(details.transferNotes ?? '').trim();
            }
            if (sentByColumn && details.sentBy !== undefined) {
              record[sentByColumn] = this.toOptionalNumber(details.sentBy);
            }
            if (receivedByColumn && details.receivedBy !== undefined) {
              record[receivedByColumn] = this.toOptionalNumber(details.receivedBy);
            }
            if (acknowledgedByColumn && details.acknowledgedBy !== undefined) {
              record[acknowledgedByColumn] = this.toOptionalNumber(details.acknowledgedBy);
            }
            if (acknowledgedAtColumn && details.acknowledgedAt !== undefined) {
              record[acknowledgedAtColumn] = this.toIsoDateOrNull(details.acknowledgedAt);
            }

            const insertedTransfer = await this.runInsert(client, 'tbltransfer_details', record);
            transferDetailsId = Number(insertedTransfer.rows[0]?.id ?? null);
          }
        }

        // Update expense details (if provided)
        if (payload.expenseDetails && transferDetailsId) {
          const expenseColumns = await this.getTableColumns(client, 'tblexpense_details');
          const expenseSalesIdColumn = this.pickColumn(expenseColumns, ['sales_id', 'salesId']);
          const expenseTransferIdColumn = this.pickColumn(expenseColumns, ['transfer_id', 'transferId']);
          const expenseTypeColumn = this.pickColumn(expenseColumns, ['expense_type', 'expenseType']);
          const expenseDescriptionColumn = this.pickColumn(expenseColumns, ['expense_description', 'expenseDescription']);
          const amountColumn = this.pickColumn(expenseColumns, ['amount']);
          const expenseDateColumn = this.pickColumn(expenseColumns, ['expense_date', 'expenseDate']);
          const paidToColumn = this.pickColumn(expenseColumns, ['paid_to', 'paidTo']);
          const paymentMethodColumn = this.pickColumn(expenseColumns, ['payment_method', 'paymentMethod']);
          const referenceNoColumn = this.pickColumn(expenseColumns, ['reference_no', 'referenceNo']);
          const createdByColumn = this.pickColumn(expenseColumns, ['created_by', 'createdBy']);

          if (expenseSalesIdColumn) {
            await client.query(
              `DELETE FROM tblexpense_details WHERE "${expenseSalesIdColumn}" = $1`,
              [id],
            );

            for (const expense of payload.expenseDetails) {
              const record: Record<string, unknown> = {};
              record[expenseSalesIdColumn] = id;
              record[expenseTransferIdColumn ?? 'transfer_id'] = transferDetailsId;

              if (expenseTypeColumn && expense.expenseType !== undefined) {
                record[expenseTypeColumn] = String(expense.expenseType ?? '').trim();
              }
              if (expenseDescriptionColumn && expense.expenseDescription !== undefined) {
                record[expenseDescriptionColumn] = String(expense.expenseDescription ?? '').trim();
              }
              if (amountColumn) {
                record[amountColumn] = this.toOptionalNumber(expense.amount) ?? 0;
              }
              if (expenseDateColumn && expense.expenseDate !== undefined) {
                record[expenseDateColumn] = this.toIsoDateOrNull(expense.expenseDate);
              }
              if (paidToColumn && expense.paidTo !== undefined) {
                record[paidToColumn] = String(expense.paidTo ?? '').trim();
              }
              if (paymentMethodColumn && expense.paymentMethod !== undefined) {
                record[paymentMethodColumn] = String(expense.paymentMethod ?? '').trim();
              }
              if (referenceNoColumn && expense.referenceNo !== undefined) {
                record[referenceNoColumn] = String(expense.referenceNo ?? '').trim();
              }
              if (createdByColumn && userId !== undefined) {
                record[createdByColumn] = userId;
              }

              await this.runInsert(client, 'tblexpense_details', record);
            }
          }
        }

        // Update concern details
        if (payload.concernDetails) {
          const concernColumns = await this.getTableColumns(client, 'tblconcern_details');
          const concernSalesIdColumn = this.pickColumn(concernColumns, ['sales_id', 'salesId']);
          const concernCustomerIdColumn = this.pickColumn(concernColumns, ['customer_id', 'customerId']);
          const concernTypeColumn = this.pickColumn(concernColumns, ['concern_type', 'concernType']);
          const concernSubjectColumn = this.pickColumn(concernColumns, ['concern_subject', 'concernSubject']);
          const concernDescriptionColumn = this.pickColumn(concernColumns, ['concern_description', 'concernDescription']);
          const concernStatusColumn = this.pickColumn(concernColumns, ['concern_status', 'concernStatus']);
          const priorityColumn = this.pickColumn(concernColumns, ['priority']);
          const assignedToColumn = this.pickColumn(concernColumns, ['assigned_to', 'assignedTo']);
          const resolutionNotesColumn = this.pickColumn(concernColumns, ['resolution_notes', 'resolutionNotes']);
          const resolvedAtColumn = this.pickColumn(concernColumns, ['resolved_at', 'resolvedAt']);

          if (concernSalesIdColumn) {
            await client.query(
              `DELETE FROM tblconcern_details WHERE "${concernSalesIdColumn}" = $1`,
              [id],
            );

            const details = payload.concernDetails;
            const record: Record<string, unknown> = {
              [concernSalesIdColumn]: id,
            };

            if (concernCustomerIdColumn && details.customerId !== undefined) {
              record[concernCustomerIdColumn] = String(details.customerId ?? '').trim();
            }
            if (concernTypeColumn) record[concernTypeColumn] = String(details.concernType ?? '').trim();
            if (concernSubjectColumn) record[concernSubjectColumn] = String(details.concernSubject ?? '').trim();
            if (concernDescriptionColumn) record[concernDescriptionColumn] = String(details.concernDescription ?? '').trim();
            if (concernStatusColumn) record[concernStatusColumn] = String(details.concernStatus ?? '').trim();
            if (priorityColumn) record[priorityColumn] = String(details.priority ?? '').trim();
            if (assignedToColumn && details.assignedTo !== undefined) record[assignedToColumn] = this.toOptionalNumber(details.assignedTo);
            if (resolutionNotesColumn) record[resolutionNotesColumn] = String(details.resolutionNotes ?? '').trim();
            if (resolvedAtColumn) record[resolvedAtColumn] = this.toIsoDateOrNull(details.resolvedAt);

            await this.runInsert(client, 'tblconcern_details', record);
          }
        }

        const normalizedStatus = this.normalizeWorkflowStatus(status);
        const normalizedPreviousStatus = this.normalizeWorkflowStatus(existingSales.status);
        const normalizedRemarks = String(payload.remarks ?? '').trim().toLowerCase();
        const returnedSerialDetails = payload.returnedSerialDetails;
        const shouldMarkReturnedSerialsDefective = Boolean(returnedSerialDetails?.isDefective);
        const selectedReturnedDefectiveSerials = [...new Set(
          (Array.isArray(returnedSerialDetails?.serialNumbers)
            ? returnedSerialDetails.serialNumbers
            : []
          )
            .map((serial) => this.normalizeSerialNumber(serial))
            .filter((serial) => serial.length > 0),
        )];
        const isReturnedToPendingFlow =
          normalizedStatus === 'pending' &&
          normalizedPreviousStatus === 'for-delivery' &&
          normalizedRemarks.startsWith('returned units:');
        const shouldReleaseCancelledSerials = normalizedStatus === 'cancelled';
        const shouldReleaseReturnedSerials =
          normalizedStatus === 'returned' ||
          normalizedStatus === 'return' ||
          isReturnedToPendingFlow ||
          shouldReleaseCancelledSerials;

        if (shouldReleaseReturnedSerials) {
          const serialColumns = await this.getTableColumns(client, 'tblserial_numbers');
          const serialSalesIdColumn = this.pickColumn(serialColumns, ['salesId', 'sales_id']);
          const serialStatusColumn = this.pickColumn(serialColumns, ['status']);
          const serialCustomerIdColumn = this.pickColumn(serialColumns, ['customerId', 'customer_id']);
          const serialNumberColumn = this.pickColumn(serialColumns, ['serialNumber', 'serial_number']);
          const serialIsReturnedColumn = this.pickColumn(serialColumns, ['isReturned', 'is_returned']);
          const serialIsDefectiveColumn = this.pickColumn(serialColumns, ['isDefective', 'is_defective']);
          const serialDefectReasonColumn = this.pickColumn(serialColumns, ['defectReason', 'defect_reason']);
          const serialDefectDateColumn = this.pickColumn(serialColumns, ['defectDate', 'defect_date']);

          if (!serialSalesIdColumn) {
            throw new Error('Sales reference column is not configured in tblserial_numbers');
          }

          if (
            shouldMarkReturnedSerialsDefective &&
            selectedReturnedDefectiveSerials.length === 0
          ) {
            throw new Error('Select at least one serial number for defective return.');
          }

          if (
            shouldMarkReturnedSerialsDefective &&
            selectedReturnedDefectiveSerials.length > 0 &&
            serialNumberColumn
          ) {
            const linkedSerialResult = await client.query<{ serial_number: string | null }>(
              `SELECT COALESCE(to_jsonb(sn)->>'serialNumber', to_jsonb(sn)->>'serial_number') AS serial_number
               FROM tblserial_numbers sn
               WHERE "${serialSalesIdColumn}" = $1`,
              [id],
            );

            const linkedSerialSet = new Set(
              linkedSerialResult.rows
                .map((row) => this.normalizeSerialNumber(row.serial_number).toLowerCase())
                .filter((serial) => serial.length > 0),
            );

            const invalidSelectedSerials = selectedReturnedDefectiveSerials.filter(
              (serial) => !linkedSerialSet.has(serial.toLowerCase()),
            );
            if (invalidSelectedSerials.length > 0) {
              throw new Error(
                `Selected defective serials are not linked to this sales order: ${invalidSelectedSerials.join(', ')}`,
              );
            }
          }

          const serialResetParams: unknown[] = [null];
          const serialResetSet: string[] = [`"${serialSalesIdColumn}" = $1`];

          if (serialStatusColumn) {
            serialResetParams.push('in-stock');
            serialResetSet.push(`"${serialStatusColumn}" = $${serialResetParams.length}`);
          }

          if (serialCustomerIdColumn) {
            serialResetParams.push(null);
            serialResetSet.push(`"${serialCustomerIdColumn}" = $${serialResetParams.length}`);
          }

          if (serialIsReturnedColumn) {
            serialResetParams.push(shouldReleaseCancelledSerials ? false : true);
            serialResetSet.push(`"${serialIsReturnedColumn}" = $${serialResetParams.length}`);
          }

          if (serialIsDefectiveColumn) {
            serialResetParams.push(false);
            serialResetSet.push(`"${serialIsDefectiveColumn}" = $${serialResetParams.length}`);
          }

          if (serialDefectReasonColumn) {
            serialResetParams.push(null);
            serialResetSet.push(`"${serialDefectReasonColumn}" = $${serialResetParams.length}`);
          }

          if (serialDefectDateColumn) {
            serialResetParams.push(null);
            serialResetSet.push(`"${serialDefectDateColumn}" = $${serialResetParams.length}`);
          }

          serialResetParams.push(id);

          await client.query(
            `UPDATE tblserial_numbers
             SET ${serialResetSet.join(', ')}
             WHERE "${serialSalesIdColumn}" = $${serialResetParams.length}`,
            serialResetParams,
          );

          if (
            shouldMarkReturnedSerialsDefective &&
            selectedReturnedDefectiveSerials.length > 0 &&
            serialNumberColumn
          ) {
            const serialDefectParams: unknown[] = [];
            const serialDefectSet: string[] = [];

            if (serialStatusColumn) {
              serialDefectParams.push('defective');
              serialDefectSet.push(`"${serialStatusColumn}" = $${serialDefectParams.length}`);
            }
            if (serialIsDefectiveColumn) {
              serialDefectParams.push(true);
              serialDefectSet.push(`"${serialIsDefectiveColumn}" = $${serialDefectParams.length}`);
            }
            if (serialDefectReasonColumn) {
              serialDefectParams.push(
                String(returnedSerialDetails?.defectReason ?? payload.remarks ?? '').trim() || null,
              );
              serialDefectSet.push(`"${serialDefectReasonColumn}" = $${serialDefectParams.length}`);
            }
            if (serialDefectDateColumn) {
              serialDefectParams.push(
                this.toIsoDateOrNull(returnedSerialDetails?.defectDate) ?? new Date().toISOString(),
              );
              serialDefectSet.push(`"${serialDefectDateColumn}" = $${serialDefectParams.length}`);
            }

            if (serialDefectSet.length > 0) {
              serialDefectParams.push(selectedReturnedDefectiveSerials);
              await client.query(
                `UPDATE tblserial_numbers
                 SET ${serialDefectSet.join(', ')}
                 WHERE LOWER(
                   regexp_replace(BTRIM(COALESCE("${serialNumberColumn}"::text, '')), '\\s+', ' ', 'g')
                 ) = ANY($${serialDefectParams.length}::text[])`,
                serialDefectParams.map((value, index) =>
                  index === serialDefectParams.length - 1 && Array.isArray(value)
                    ? value.map((serial) => String(serial).toLowerCase())
                    : value,
                ),
              );
            }
          }

          // Restore stock for returned material items (reverse the earlier deduction)
          await this.releaseReturnedMaterials(client, id, userId);
        }

        if (normalizedStatus === 'for-delivery') {
          await this.updateLinkedSalesSerialStatuses(client, id, 'for-delivery', [
            'reserved',
            'pending',
            'scanned',
          ]);
        }

        if (['remitted', 'complete', 'completed'].includes(normalizedStatus)) {
          await this.updateLinkedSalesSerialStatuses(client, id, 'installed');
        }

        // const materialSync = await this.materialStockService.applyFromSalesStatusChange(client, {
        //   salesOrderId: id,
        //   previousStatus: existingSales.status,
        //   nextStatus: status,
        //   remarks: String(payload.remarks ?? ''),
        //   userId,
        // });

        return {
          salesOrderId: id,
          customerId,
          totalAmount,
          status,
          // materialSync,
        };
      });

      const afterSnapshot = await this.getSalesOrderAuditSnapshot(id);
      const auditInfo = this.resolveSalesOrderUpdateAuditAction(beforeSnapshot, afterSnapshot, updateSalesOrderDto);
      await this.auditLogService.logMutation({
        action: auditInfo.action,
        entityType: 'sales-order',
        entityId: id,
        actor: auditActor ?? { userId, branchId },
        description: auditInfo.description,
        requestBody: updateSalesOrderDto as Record<string, unknown>,
        before: beforeSnapshot,
        after: afterSnapshot,
      });

      return {
        success: true,
        message: 'Sales order updated successfully',
        data: result,
      };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to update sales order',
      };
    }
  }

  remove(id: number) {
    return `This action removes a #${id} salesOrder`;
  }

  async getDrEligibleGroup(orderId: string, branchId?: string) {
    const id = String(orderId ?? '').trim();
    if (!id || !Number.isFinite(Number(id)) || Number(id) <= 0) {
      return { success: false, message: 'Invalid order id', items: [] };
    }

    try {
      // Step 1: Look up the given order to get its installer and scheduleDate
      const sourceResult = await this.databaseService.query<{
        installer: string | null;
        scheduleDate: string | null;
      }>(
        `SELECT
           COALESCE(to_jsonb(so)->>'installer', '') AS installer,
           COALESCE(to_jsonb(so)->>'scheduleDate', to_jsonb(so)->>'schedule_date', null) AS "scheduleDate"
         FROM tblsales_order so
         WHERE so.id = $1`,
        [id],
      );

      if (sourceResult.rowCount === 0) {
        return { success: false, message: 'Order not found', items: [] };
      }

      const sourceOrder = sourceResult.rows[0];
      const installer = (sourceOrder.installer ?? '').trim();
      const scheduleDate = (sourceOrder.scheduleDate ?? '').trim();

      if (!installer) {
        return { success: false, message: 'Order has no installer assigned. Cannot group for DR.', items: [] };
      }
      if (!scheduleDate) {
        return { success: false, message: 'Order has no delivery date (scheduleDate). Cannot group for DR.', items: [] };
      }

      // Step 2: Find all DR-eligible orders with same installer + same scheduleDate
      const params: unknown[] = [installer, scheduleDate];
      const whereParts: string[] = [
        `COALESCE(to_jsonb(so)->>'installer', '') = $1`,
        `COALESCE(to_jsonb(so)->>'scheduleDate', to_jsonb(so)->>'schedule_date', '') = $2`,
        `REPLACE(REPLACE(LOWER(TRIM(COALESCE(so.status, ''))), '_', '-'), ' ', '-') IN ('for-delivery', 'remitted', 'complete', 'released')`,
      ];

      if (branchId && Number.isFinite(Number(branchId)) && Number(branchId) > 0) {
        params.push(branchId);
        whereParts.push(
          `COALESCE(to_jsonb(so)->>'branchId', to_jsonb(so)->>'branch_id', '') = $${params.length}`,
        );
      }

      const whereSql = whereParts.join(' AND ');

      const ordersResult = await this.databaseService.query<{
        id: number;
        soNumber: string | null;
        customerName: string | null;
        customerAddress: string | null;
        customerType: string | null;
        installer: string | null;
        scheduleDate: string | null;
      }>(
        `SELECT
           so.id,
           COALESCE(to_jsonb(so)->>'so_number', to_jsonb(so)->>'soNumber', '') AS "soNumber",
           COALESCE(to_jsonb(c)->>'name', to_jsonb(c)->>'customer_name', '') AS "customerName",
           COALESCE(to_jsonb(c)->>'address', '') AS "customerAddress",
           COALESCE(to_jsonb(c)->>'customer_type', to_jsonb(c)->>'customerType', 'regular') AS "customerType",
           COALESCE(to_jsonb(so)->>'installer', '') AS installer,
           COALESCE(to_jsonb(so)->>'scheduleDate', to_jsonb(so)->>'schedule_date', null) AS "scheduleDate"
         FROM tblsales_order so
         LEFT JOIN tblcustomer c
           ON c.id::text = COALESCE(to_jsonb(so)->>'customer_id', to_jsonb(so)->>'customerId')
         WHERE ${whereSql}
         ORDER BY so.id ASC`,
        params,
      );

      if (ordersResult.rowCount === 0) {
        return { success: true, items: [] };
      }

      const orderIds = ordersResult.rows.map((row) => row.id);

      // Fetch serial numbers with product and capacity info for all eligible orders
      // JOIN with tbltransaction_product_items to get the actual sellPrice
      const serialsResult = await this.databaseService.query<{
        salesId: string;
        serialNumber: string | null;
        unitType: string | null;
        productId: string | null;
        capacityId: string | null;
        productName: string | null;
        capacityName: string | null;
        sellPrice: string | null;
      }>(
        `SELECT
           COALESCE(to_jsonb(sn)->>'salesId', to_jsonb(sn)->>'sales_id') AS "salesId",
           COALESCE(to_jsonb(sn)->>'serialNumber', to_jsonb(sn)->>'serial_number', '') AS "serialNumber",
           COALESCE(to_jsonb(sn)->>'unitType', to_jsonb(sn)->>'unit_type', 'set') AS "unitType",
           COALESCE(to_jsonb(sn)->>'productId', to_jsonb(sn)->>'product_id', '') AS "productId",
           COALESCE(to_jsonb(sn)->>'capacityId', to_jsonb(sn)->>'capacity_id', '') AS "capacityId",
           COALESCE(to_jsonb(p)->>'productName', to_jsonb(p)->>'name', to_jsonb(p)->>'product_name', '') AS "productName",
           COALESCE(to_jsonb(cap)->>'name', to_jsonb(cap)->>'capacity_name', to_jsonb(cap)->>'capacity', '') AS "capacityName",
           COALESCE(tpi."sellPrice"::text, '0') AS "sellPrice"
         FROM tblserial_numbers sn
         LEFT JOIN tblproducts p
           ON p.id::text = COALESCE(to_jsonb(sn)->>'productId', to_jsonb(sn)->>'product_id')
         LEFT JOIN tblcapacity cap
           ON cap.id::text = COALESCE(to_jsonb(sn)->>'capacityId', to_jsonb(sn)->>'capacity_id')
         LEFT JOIN tbltransaction_product_items tpi
           ON tpi."salesId"::text = COALESCE(to_jsonb(sn)->>'salesId', to_jsonb(sn)->>'sales_id')
           AND tpi."productId"::text = COALESCE(to_jsonb(sn)->>'productId', to_jsonb(sn)->>'product_id')
           AND tpi."capacityId"::text = COALESCE(to_jsonb(sn)->>'capacityId', to_jsonb(sn)->>'capacity_id')
         WHERE COALESCE(to_jsonb(sn)->>'salesId', to_jsonb(sn)->>'sales_id') = ANY($1::text[])`,
        [orderIds.map(String)],
      );

      // Fetch payment methods for all eligible orders
      const paymentsResult = await this.databaseService.query<{
        salesId: string;
        method: string;
      }>(
        `SELECT
           so_id::text AS "salesId",
           method
         FROM tblso_payments
         WHERE so_id = ANY($1::integer[])
           AND LOWER(COALESCE(status, 'paid')) = 'paid'
           AND payment_type = 'sales'
         ORDER BY so_id`,
        [orderIds],
      );

      // Build a map of salesId → payment method (first match)
      const paymentsByOrder = new Map<string, string>();
      for (const row of paymentsResult.rows) {
        const salesId = String(row.salesId ?? '');
        if (!paymentsByOrder.has(salesId)) {
          paymentsByOrder.set(salesId, row.method ?? '');
        }
      }

      // Group serials by salesId → productId+capacityId
      const serialsBySalesId = new Map<string, typeof serialsResult.rows>();
      for (const row of serialsResult.rows) {
        const salesId = String(row.salesId ?? '');
        if (!serialsBySalesId.has(salesId)) {
          serialsBySalesId.set(salesId, []);
        }
        serialsBySalesId.get(salesId)!.push(row);
      }

      const items = ordersResult.rows.map((order) => {
        const serials = serialsBySalesId.get(String(order.id)) ?? [];

        // Group serials by product+capacity to form product items
        const productItemMap = new Map<
          string,
          {
            productName: string;
            capacityName: string;
            sellPrice: number;
            serialNumbers: { serialNumber: string; unitType: string }[];
          }
        >();

        for (const serial of serials) {
          const key = `${serial.productId ?? ''}_${serial.capacityId ?? ''}`;
          if (!productItemMap.has(key)) {
            productItemMap.set(key, {
              productName: serial.productName ?? '',
              capacityName: serial.capacityName ?? '',
              sellPrice: Number(serial.sellPrice ?? 0),
              serialNumbers: [],
            });
          }
          productItemMap.get(key)!.serialNumbers.push({
            serialNumber: serial.serialNumber ?? '',
            unitType: (serial.unitType ?? 'set') as string,
          });
        }

        return {
          id: order.id,
          soNumber: order.soNumber ?? '',
          customerName: order.customerName ?? '',
          customerAddress: order.customerAddress ?? '',
          customerType: (order.customerType ?? 'regular') as 'regular' | 'sub_dealer',
          installer: order.installer || null,
          scheduleDate: order.scheduleDate || null,
          paymentMethod: paymentsByOrder.get(String(order.id)) ?? null,
          productItems: [...productItemMap.values()],
        };
      });

      return { success: true, items };
    } catch (error) {
      return {
        success: false,
        message: `Failed to fetch DR-eligible orders: ${error instanceof Error ? error.message : String(error)}`,
        items: [],
      };
    }
  }

  private async releaseReturnedMaterials(client: PoolClient, salesId: number, userId?: number) {
    const materialItems = await this.materialTransactionsService.findBySalesId(salesId);

    for (const item of materialItems) {
      const qty = Number(item.quantity ?? 0);
      if (!Number.isFinite(qty) || qty <= 0) {
        continue;
      }

      // Return stock to inventory
      await this.materialsService.updateStock(item.material_id, qty, userId ?? null, { client });

      // Record a ledger movement for audit/traceability
      await this.materialStockService.recordMovement(
        {
          materialId: item.material_id,
          movementType: 'IN',
          qty,
          sourceType: 'SO',
          sourceId: salesId,
          sourceLineKey: `return-${item.id}`,
          statusSnapshot: JSON.stringify(item),
        },
        { client },
      );
    }
  }

  // ─── Miscellaneous Items (Materials, Excess, Services) ──────────────────────

  async addMiscellaneousItem(
    salesId: number,
    body: {
      category: string;
      itemName: string;
      description?: string;
      quantity?: number;
      unit?: string;
      unitPrice?: number;
      isInclusion?: boolean;
      remarks?: string;
    },
  ) {
    if (!Number.isFinite(salesId) || salesId <= 0) {
      return { success: false, message: 'Invalid sales order ID' };
    }

    const itemName = String(body.itemName ?? '').trim();
    if (!itemName) {
      return { success: false, message: 'Item name is required' };
    }

    const validCategories = ['excess', 'electrical', 'material', 'general'];
    const category = validCategories.includes(body.category) ? body.category : 'general';
    const quantity = Number(body.quantity) || 1;
    const unitPrice = Number(body.unitPrice) || 0;
    const totalPrice = quantity * unitPrice;

    try {
      const result = await this.databaseService.query<{ id: number }>(
        `INSERT INTO tblso_miscellaneous_items
           (sales_id, category, item_name, description, quantity, unit, unit_price, total_price, is_inclusion, remarks)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING id`,
        [
          salesId,
          category,
          itemName,
          body.description?.trim() || null,
          quantity,
          body.unit?.trim() || 'pcs',
          unitPrice,
          totalPrice,
          body.isInclusion ?? false,
          body.remarks?.trim() || null,
        ],
      );

      // If category is material/excess and a material_id was provided, also add to material_transactions
      const materialId = this.toOptionalNumber((body as any).materialId);
      if ((category === 'material' || category === 'excess') && materialId && materialId > 0) {
        try {
          await this.materialTransactionsService.create({
            trans_type: 'sales',
            sales_id: salesId,
            material_id: materialId,
            quantity: quantity,
            unit_price: unitPrice,
            sell_price: unitPrice,
            discount_price: 0,
            purchase_id: undefined,
          });
        } catch {
          // Non-critical: misc item is already saved, material transaction is supplementary
        }
      }

      // If adding a service (category = 'general'), update salesType and insert into tblservice_details
      if (category === 'general') {
        const salesColumns = await this.databaseService.query<{ column_name: string }>(
          `SELECT column_name FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'tblsales_order'
             AND column_name IN ('salesType', 'sales_type')`,
        );
        const salesTypeCol = salesColumns.rows[0]?.column_name ?? 'salesType';

        await this.databaseService.query(
          `UPDATE tblsales_order
           SET "${salesTypeCol}" = 'sales and service'
           WHERE id = $1
             AND LOWER(TRIM(COALESCE("${salesTypeCol}", ''))) NOT IN ('service', 'sales and service')`,
          [salesId],
        );

        // Also record in tblservice_details for cross-checking
        await this.databaseService.query(
          `INSERT INTO tblservice_details
             (sales_id, service_name, service_description, service_type, service_cost, service_duration_hours, service_status, service_notes)
           VALUES ($1, $2, $3, $4, $5, $6, 'scheduled', $7)`,
          [
            salesId,
            itemName,
            body.description?.trim() || null,
            'installation-service',
            totalPrice,
            quantity,
            body.remarks?.trim() || null,
          ],
        );
      }

      // Update the sales order total_amount to include this item (unless it's an inclusion)
      const skipTotalAmountUpdate = Boolean((body as { skipTotalAmountUpdate?: boolean }).skipTotalAmountUpdate);
      if (!skipTotalAmountUpdate && !body.isInclusion && totalPrice > 0) {
        await this.databaseService.query(
          `UPDATE tblsales_order
           SET total_amount = COALESCE(total_amount, 0) + $1
           WHERE id = $2`,
          [totalPrice, salesId],
        );
      }

      return { success: true, message: 'Item added successfully', id: result.rows[0]?.id };
    } catch (error) {
      return { success: false, message: `Failed to add item: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  async removeMiscellaneousItem(
    salesId: number,
    itemId: number,
    options?: { skipTotalAmountUpdate?: boolean },
  ) {
    if (!Number.isFinite(salesId) || salesId <= 0) {
      return { success: false, message: 'Invalid sales order ID' };
    }

    if (!Number.isFinite(itemId) || itemId <= 0) {
      return { success: false, message: 'Invalid miscellaneous item ID' };
    }

    try {
      const existing = await this.databaseService.query<{
        id: number;
        total_price: string;
        is_inclusion: boolean;
      }>(
        `SELECT id, total_price::text, is_inclusion
         FROM tblso_miscellaneous_items
         WHERE id = $1 AND sales_id = $2
         LIMIT 1`,
        [itemId, salesId],
      );

      if (existing.rowCount === 0) {
        return { success: false, message: 'Miscellaneous item not found' };
      }

      const row = existing.rows[0];
      const totalPrice = Number(row.total_price) || 0;

      await this.databaseService.query(
        `DELETE FROM tblso_miscellaneous_items WHERE id = $1 AND sales_id = $2`,
        [itemId, salesId],
      );

      if (!options?.skipTotalAmountUpdate && !row.is_inclusion && totalPrice > 0) {
        await this.databaseService.query(
          `UPDATE tblsales_order
           SET total_amount = GREATEST(COALESCE(total_amount, 0) - $1, 0)
           WHERE id = $2`,
          [totalPrice, salesId],
        );
      }

      return { success: true, message: 'Item removed successfully' };
    } catch (error) {
      return {
        success: false,
        message: `Failed to remove item: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  async getMiscellaneousItems(salesId: number) {
    if (!Number.isFinite(salesId) || salesId <= 0) {
      return [];
    }

    try {
      const result = await this.databaseService.query<{
      id: number;
      category: string;
      item_name: string;
      description: string | null;
      quantity: string;
      unit: string;
      unit_price: string;
      total_price: string;
      is_inclusion: boolean;
      remarks: string | null;
      created_at: string;
    }>(
      `SELECT id, category, item_name, description, quantity::text, unit,
              unit_price::text, total_price::text, is_inclusion, remarks, created_at::text
       FROM tblso_miscellaneous_items
       WHERE sales_id = $1
       ORDER BY created_at ASC`,
      [salesId],
    );

    return result.rows.map((row) => ({
      id: row.id,
      category: row.category,
      itemName: row.item_name,
      description: row.description,
      quantity: Number(row.quantity) || 0,
      unit: row.unit,
      unitPrice: Number(row.unit_price) || 0,
      totalPrice: Number(row.total_price) || 0,
      isInclusion: row.is_inclusion,
      remarks: row.remarks,
      createdAt: row.created_at,
    }));
    } catch {
      return [];
    }
  }
}
