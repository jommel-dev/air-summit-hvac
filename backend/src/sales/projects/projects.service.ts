import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from 'src/database/database.service';
import { AuditActorContext, AuditLogService } from 'src/audit-log/audit-log.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { ListProjectsQueryDto } from './dto/list-projects-query.dto';
import { CreateProjectSoaDto } from './dto/create-project-soa.dto';
import { CreateProjectSettlementDto } from './dto/create-project-settlement.dto';

const VALID_STATUSES = ['planning', 'ongoing', 'completed', 'cancelled'] as const;

@Injectable()
export class ProjectsService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly auditLogService: AuditLogService,
  ) {}

  private normalizeText(value: unknown): string {
    return String(value ?? '').trim();
  }

  private toOptionalNumber(value: unknown): number | null {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private normalizePage(value: unknown): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 1) return 1;
    return Math.floor(parsed);
  }

  private normalizeLimit(value: unknown): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 1) return 20;
    return Math.min(100, Math.floor(parsed));
  }

  private toIsoDateOrNull(value: unknown): string | null {
    if (value === undefined || value === null || value === '') return null;
    const raw = String(value).trim();
    const ddMmYyyy = raw.match(/^(\d{2})[\/-](\d{2})[\/-](\d{4})$/);
    if (ddMmYyyy) {
      return `${ddMmYyyy[3]}-${ddMmYyyy[2]}-${ddMmYyyy[1]}`;
    }
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return null;
    return date.toISOString().slice(0, 10);
  }

  private parseDateOnly(value: unknown): Date | null {
    const iso = this.toIsoDateOrNull(value);
    if (!iso) return null;
    const date = new Date(`${iso}T00:00:00.000Z`);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private formatDateOnlyForSql(date: Date): string {
    return date.toISOString().slice(0, 10);
  }

  private addDays(date: Date, days: number): Date {
    const next = new Date(date.getTime());
    next.setUTCDate(next.getUTCDate() + days);
    return next;
  }

  private normalizeStatus(status?: string): string {
    const normalized = this.normalizeText(status).toLowerCase();
    return VALID_STATUSES.includes(normalized as (typeof VALID_STATUSES)[number])
      ? normalized
      : 'planning';
  }

  async search(query: ListProjectsQueryDto) {
    const search = this.normalizeText(query?.search).toLowerCase();
    const status = this.normalizeText(query?.status).toLowerCase();
    const page = this.normalizePage(query?.page ?? 1);
    const limit = this.normalizeLimit(query?.limit ?? 20);
    const offset = (page - 1) * limit;
    const branchId = Number(query?.branchId);

    const params: unknown[] = [];
    const whereParts: string[] = [];

    if (search) {
      params.push(`%${search}%`);
      const index = params.length;
      whereParts.push(`(
        LOWER(COALESCE(p.project_code, '')) LIKE LOWER($${index})
        OR LOWER(COALESCE(p.project_name, '')) LIKE LOWER($${index})
        OR LOWER(COALESCE(c.name, '')) LIKE LOWER($${index})
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

    const countResult = await this.databaseService.query<{ total: string }>(
      `SELECT COUNT(*)::text AS total
         FROM tblprojects p
         LEFT JOIN tblcustomer c ON c.id = p.customer_id
         ${whereSql}`,
      params,
    );
    const total = Number(countResult.rows[0]?.total ?? 0);
    const totalPages = Math.max(1, Math.ceil(total / limit));

    params.push(limit, offset);
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
      customerId: string | null;
      customerName: string | null;
      pocName: string | null;
      pocPhone: string | null;
      pocEmail: string | null;
      relatedSOCount: string;
      totalAmount: string;
      paidAmount: string;
      outstandingReceivableAmount: string;
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
         p.customer_id::text AS "customerId",
         COALESCE(c.name, '') AS "customerName",
         COALESCE(p.poc_name, '') AS "pocName",
         COALESCE(p.poc_phone, '') AS "pocPhone",
         COALESCE(p.poc_email, '') AS "pocEmail",
         COALESCE((SELECT COUNT(*)::text FROM tblsales_order so WHERE so.project_id = p.id), '0') AS "relatedSOCount",
         COALESCE((
           SELECT SUM(
             CASE
               WHEN line_totals.computed_total > 0 THEN line_totals.computed_total
               ELSE COALESCE(NULLIF(COALESCE(to_jsonb(so)->>'total_amount', to_jsonb(so)->>'totalAmount', ''), '')::numeric, 0)
             END
           )
           FROM tblsales_order so
           LEFT JOIN LATERAL (
             SELECT
               COALESCE((
                 SELECT SUM(
                   COALESCE(NULLIF(COALESCE(to_jsonb(tpi)->>'totalSetQty', to_jsonb(tpi)->>'total_set_qty', ''), '')::numeric, 0)
                   * CASE
                       WHEN COALESCE(NULLIF(COALESCE(to_jsonb(tpi)->>'discountPrice', to_jsonb(tpi)->>'discount_price', ''), '')::numeric, 0) > 0
                         THEN COALESCE(NULLIF(COALESCE(to_jsonb(tpi)->>'discountPrice', to_jsonb(tpi)->>'discount_price', ''), '')::numeric, 0)
                       WHEN COALESCE(NULLIF(COALESCE(to_jsonb(tpi)->>'sellPrice', to_jsonb(tpi)->>'sell_price', ''), '')::numeric, 0) > 0
                         THEN COALESCE(NULLIF(COALESCE(to_jsonb(tpi)->>'sellPrice', to_jsonb(tpi)->>'sell_price', ''), '')::numeric, 0)
                       ELSE COALESCE(NULLIF(COALESCE(to_jsonb(tpi)->>'unitPrice', to_jsonb(tpi)->>'unit_price', ''), '')::numeric, 0)
                     END
                 )
                 FROM tbltransaction_product_items tpi
                 WHERE COALESCE(to_jsonb(tpi)->>'salesId', to_jsonb(tpi)->>'sales_id') = so.id::text
               ), 0)
               + COALESCE((
                 SELECT SUM(
                   COALESCE(sd.service_cost, 0)
                   * COALESCE(NULLIF(sd.service_duration_hours, 0), 1)
                 )
                 FROM tblservice_details sd
                 WHERE sd.sales_id = so.id
               ), 0)
               + COALESCE((
                 SELECT SUM(COALESCE(mi.total_price, 0))
                 FROM tblso_miscellaneous_items mi
                 WHERE mi.sales_id = so.id
                   AND LOWER(TRIM(COALESCE(mi.category, ''))) = 'excess'
                   AND COALESCE(mi.is_inclusion, false) = false
               ), 0) AS computed_total
           ) line_totals ON TRUE
           WHERE so.project_id = p.id
         ), 0)::text AS "totalAmount",
         COALESCE((
           SELECT SUM(COALESCE(NULLIF(to_jsonb(sp)->>'amount', '')::numeric, 0))
           FROM tblso_payments sp
           INNER JOIN tblsales_order so ON so.id = sp.so_id
           WHERE so.project_id = p.id
             AND REPLACE(REPLACE(LOWER(TRIM(COALESCE(to_jsonb(sp)->>'status', ''))), '_', '-'), ' ', '-')
                 IN ('paid', 'posted', 'cleared', 'complete', 'completed', 'remitted')
         ), 0)::text AS "paidAmount",
         COALESCE((
           SELECT SUM(COALESCE(NULLIF(to_jsonb(sp)->>'amount', '')::numeric, 0))
           FROM tblso_payments sp
           INNER JOIN tblsales_order so ON so.id = sp.so_id
           WHERE so.project_id = p.id
             AND REPLACE(REPLACE(LOWER(TRIM(COALESCE(to_jsonb(sp)->>'method', ''))), '_', '-'), ' ', '-')
                 IN ('cheque', 'credit-card')
             AND REPLACE(REPLACE(LOWER(TRIM(COALESCE(to_jsonb(sp)->>'status', ''))), '_', '-'), ' ', '-')
                 NOT IN ('paid', 'posted', 'cleared', 'complete', 'completed', 'remitted')
         ), 0)::text AS "outstandingReceivableAmount",
         p.created_at::text AS "createdAt",
         p.updated_at::text AS "updatedAt"
       FROM tblprojects p
       LEFT JOIN tblcustomer c ON c.id = p.customer_id
       ${whereSql}
       ORDER BY p.updated_at DESC NULLS LAST, p.project_code ASC
       LIMIT $${params.length - 1}
       OFFSET $${params.length}`,
      params,
    );

    return {
      success: true,
      items: listResult.rows.map((row) => {
        const totalAmount = this.toOptionalNumber(row.totalAmount) ?? 0;
        const paidAmount = this.toOptionalNumber(row.paidAmount) ?? 0;
        const outstandingReceivableAmount =
          this.toOptionalNumber(row.outstandingReceivableAmount) ?? 0;
        return {
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
          customerId: row.customerId || '',
          customerName: row.customerName || '',
          pocName: row.pocName || '',
          pocPhone: row.pocPhone || '',
          pocEmail: row.pocEmail || '',
          relatedSOCount: Number(row.relatedSOCount ?? 0),
          totalAmount,
          paidAmount,
          balance: Math.max(totalAmount - paidAmount - outstandingReceivableAmount, 0),
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        };
      }),
      meta: { page, limit, total, totalPages },
    };
  }

  async findOne(projectId: number) {
    if (!Number.isFinite(projectId) || projectId <= 0) {
      throw new BadRequestException('Invalid project id');
    }

    const projectResult = await this.databaseService.query<{
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
      customerId: string | null;
      customerName: string | null;
      customerAddress: string | null;
      customerContact: string | null;
      customerPhone: string | null;
      customerEmail: string | null;
      pocName: string | null;
      pocPhone: string | null;
      pocEmail: string | null;
      branchId: string | null;
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
         p.customer_id::text AS "customerId",
         COALESCE(c.name, '') AS "customerName",
         COALESCE(c.address, '') AS "customerAddress",
         COALESCE(c.contact_person, '') AS "customerContact",
         COALESCE(c.contact_number, '') AS "customerPhone",
         COALESCE(c.email, '') AS "customerEmail",
         COALESCE(p.poc_name, '') AS "pocName",
         COALESCE(p.poc_phone, '') AS "pocPhone",
         COALESCE(p.poc_email, '') AS "pocEmail",
         COALESCE(p.branch_id::text, '') AS "branchId",
         p.created_at::text AS "createdAt",
         p.updated_at::text AS "updatedAt"
       FROM tblprojects p
       LEFT JOIN tblcustomer c ON c.id = p.customer_id
       WHERE p.id = $1
       LIMIT 1`,
      [projectId],
    );

    if (projectResult.rowCount === 0) {
      throw new NotFoundException(`Project ${projectId} not found`);
    }

    const projectRow = projectResult.rows[0];

    const sosResult = await this.databaseService.query<{
      id: number;
      soNumber: string | null;
      customerId: string | null;
      customerName: string | null;
      totalAmount: string | null;
      paidAmount: string | null;
      outstandingReceivableAmount: string | null;
      status: string | null;
      scheduleDate: string | null;
      createdAt: string | null;
    }>(
      `SELECT
         so.id,
         COALESCE(to_jsonb(so)->>'so_number', to_jsonb(so)->>'soNumber') AS "soNumber",
         COALESCE(to_jsonb(so)->>'customer_id', to_jsonb(so)->>'customerId') AS "customerId",
         COALESCE(to_jsonb(c)->>'name', to_jsonb(c)->>'customer_name', '') AS "customerName",
         CASE
           WHEN line_totals.computed_total > 0 THEN line_totals.computed_total::text
           ELSE COALESCE(to_jsonb(so)->>'total_amount', to_jsonb(so)->>'totalAmount', '0')
         END AS "totalAmount",
         COALESCE((
           SELECT SUM(COALESCE(NULLIF(to_jsonb(sp)->>'amount', '')::numeric, 0))
           FROM tblso_payments sp
           WHERE sp.so_id = so.id
             AND REPLACE(REPLACE(LOWER(TRIM(COALESCE(to_jsonb(sp)->>'status', ''))), '_', '-'), ' ', '-')
                 IN ('paid', 'posted', 'cleared', 'complete', 'completed', 'remitted')
         ), 0)::text AS "paidAmount",
         COALESCE((
           SELECT SUM(COALESCE(NULLIF(to_jsonb(sp)->>'amount', '')::numeric, 0))
           FROM tblso_payments sp
           WHERE sp.so_id = so.id
             AND REPLACE(REPLACE(LOWER(TRIM(COALESCE(to_jsonb(sp)->>'method', ''))), '_', '-'), ' ', '-')
                 IN ('cheque', 'credit-card')
             AND REPLACE(REPLACE(LOWER(TRIM(COALESCE(to_jsonb(sp)->>'status', ''))), '_', '-'), ' ', '-')
                 NOT IN ('paid', 'posted', 'cleared', 'complete', 'completed', 'remitted')
         ), 0)::text AS "outstandingReceivableAmount",
         COALESCE(so.status, 'pending') AS status,
         COALESCE(to_jsonb(so)->>'scheduleDate', to_jsonb(so)->>'schedule_date', null) AS "scheduleDate",
         COALESCE(to_jsonb(so)->>'created_at', to_jsonb(so)->>'createdAt', null) AS "createdAt"
       FROM tblsales_order so
       LEFT JOIN tblcustomer c
         ON c.id::text = COALESCE(to_jsonb(so)->>'customer_id', to_jsonb(so)->>'customerId')
       LEFT JOIN LATERAL (
         SELECT
           COALESCE((
             SELECT SUM(
               COALESCE(NULLIF(COALESCE(to_jsonb(tpi)->>'totalSetQty', to_jsonb(tpi)->>'total_set_qty', ''), '')::numeric, 0)
               * CASE
                   WHEN COALESCE(NULLIF(COALESCE(to_jsonb(tpi)->>'discountPrice', to_jsonb(tpi)->>'discount_price', ''), '')::numeric, 0) > 0
                     THEN COALESCE(NULLIF(COALESCE(to_jsonb(tpi)->>'discountPrice', to_jsonb(tpi)->>'discount_price', ''), '')::numeric, 0)
                   WHEN COALESCE(NULLIF(COALESCE(to_jsonb(tpi)->>'sellPrice', to_jsonb(tpi)->>'sell_price', ''), '')::numeric, 0) > 0
                     THEN COALESCE(NULLIF(COALESCE(to_jsonb(tpi)->>'sellPrice', to_jsonb(tpi)->>'sell_price', ''), '')::numeric, 0)
                   ELSE COALESCE(NULLIF(COALESCE(to_jsonb(tpi)->>'unitPrice', to_jsonb(tpi)->>'unit_price', ''), '')::numeric, 0)
                 END
             )
             FROM tbltransaction_product_items tpi
             WHERE COALESCE(to_jsonb(tpi)->>'salesId', to_jsonb(tpi)->>'sales_id') = so.id::text
           ), 0)
           + COALESCE((
             SELECT SUM(
               COALESCE(sd.service_cost, 0)
               * COALESCE(NULLIF(sd.service_duration_hours, 0), 1)
             )
             FROM tblservice_details sd
             WHERE sd.sales_id = so.id
           ), 0)
           + COALESCE((
             SELECT SUM(COALESCE(mi.total_price, 0))
             FROM tblso_miscellaneous_items mi
             WHERE mi.sales_id = so.id
               AND LOWER(TRIM(COALESCE(mi.category, ''))) = 'excess'
               AND COALESCE(mi.is_inclusion, false) = false
           ), 0) AS computed_total
       ) line_totals ON TRUE
       WHERE so.project_id = $1
       ORDER BY
         NULLIF(BTRIM(COALESCE(to_jsonb(so)->>'scheduleDate', to_jsonb(so)->>'schedule_date', '')), '')::date DESC NULLS LAST,
         so.created_at DESC NULLS LAST`,
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
        projectLocation: projectRow.projectLocation || '',
        projectStartDate: projectRow.projectStartDate,
        projectEndDate: projectRow.projectEndDate,
        projectManager: projectRow.projectManager || '',
        projectStatus: projectRow.projectStatus,
        projectNotes: projectRow.projectNotes || '',
        customerId: projectRow.customerId || '',
        customerName: projectRow.customerName || '',
        customerAddress: projectRow.customerAddress || '',
        customerContact: projectRow.customerContact || '',
        customerPhone: projectRow.customerPhone || '',
        customerEmail: projectRow.customerEmail || '',
        pocName: projectRow.pocName || '',
        pocPhone: projectRow.pocPhone || '',
        pocEmail: projectRow.pocEmail || '',
        branchId: projectRow.branchId || '',
        createdAt: projectRow.createdAt,
        updatedAt: projectRow.updatedAt,
        relatedSalesOrders: sosResult.rows.map((row) => {
          const totalAmount = this.toOptionalNumber(row.totalAmount) ?? 0;
          const paidAmount = this.toOptionalNumber(row.paidAmount) ?? 0;
          const outstandingReceivableAmount =
            this.toOptionalNumber(row.outstandingReceivableAmount) ?? 0;
          return {
            id: row.id,
            soNumber: row.soNumber || '',
            customerId: row.customerId || '',
            customerName: row.customerName || '',
            totalAmount,
            paidAmount,
            balance: Math.max(totalAmount - paidAmount - outstandingReceivableAmount, 0),
            status: row.status || 'pending',
            scheduleDate: row.scheduleDate,
            createdAt: row.createdAt,
          };
        }),
      },
    };
  }

  async create(
    dto: CreateProjectDto,
    userId?: number,
    branchId?: number,
    auditActor?: AuditActorContext,
  ) {
    const projectCode = this.normalizeText(dto.projectCode);
    const projectName = this.normalizeText(dto.projectName);
    const customerId = this.normalizeText(dto.customerId);

    if (!projectCode || !projectName) {
      throw new BadRequestException('Project code and name are required');
    }
    if (!customerId) {
      throw new BadRequestException('Customer is required');
    }

    const customerExists = await this.databaseService.query<{ id: string }>(
      `SELECT id::text AS id FROM tblcustomer WHERE id::text = $1 LIMIT 1`,
      [customerId],
    );
    if (customerExists.rowCount === 0) {
      throw new BadRequestException('Selected customer was not found');
    }

    const duplicate = await this.databaseService.query<{ id: number }>(
      `SELECT id FROM tblprojects WHERE LOWER(project_code) = LOWER($1) LIMIT 1`,
      [projectCode],
    );
    if ((duplicate.rowCount ?? 0) > 0) {
      throw new BadRequestException(`Project code ${projectCode} already exists`);
    }

    const effectiveBranchId =
      Number.isFinite(Number(dto.branchId)) && Number(dto.branchId) > 0
        ? Number(dto.branchId)
        : branchId;

    const inserted = await this.databaseService.query<{ id: number }>(
      `INSERT INTO tblprojects (
         project_code, project_name, project_type, project_owner, project_location,
         project_start_date, project_end_date, project_manager, project_status, project_notes,
         customer_id, poc_name, poc_phone, poc_email, branch_id, created_by
       ) VALUES (
         $1, $2, $3, $4, $5,
         $6::date, $7::date, $8, $9, $10,
         $11::uuid, $12, $13, $14, $15, $16
       )
       RETURNING id`,
      [
        projectCode,
        projectName,
        this.normalizeText(dto.projectType) || null,
        this.normalizeText(dto.projectOwner) || null,
        this.normalizeText(dto.projectLocation) || null,
        this.toIsoDateOrNull(dto.projectStartDate),
        this.toIsoDateOrNull(dto.projectEndDate),
        this.normalizeText(dto.projectManager) || null,
        this.normalizeStatus(dto.projectStatus),
        this.normalizeText(dto.projectNotes) || null,
        customerId,
        this.normalizeText(dto.pocName) || null,
        this.normalizeText(dto.pocPhone) || null,
        this.normalizeText(dto.pocEmail) || null,
        Number.isFinite(Number(effectiveBranchId)) && Number(effectiveBranchId) > 0
          ? Number(effectiveBranchId)
          : null,
        Number.isFinite(Number(userId)) && Number(userId) > 0 ? Number(userId) : null,
      ],
    );

    const id = Number(inserted.rows[0]?.id);
    const result = await this.findOne(id);
    await this.auditLogService.logMutation({
      action: 'PROJECT_CREATE',
      entityType: 'project',
      entityId: id,
      actor: auditActor ?? { userId, branchId },
      description: `Created project ${projectCode}`,
      requestBody: dto as unknown as Record<string, unknown>,
      after: result.data as unknown as Record<string, unknown>,
    });
    return result;
  }

  async update(
    projectId: number,
    dto: UpdateProjectDto,
    auditActor?: AuditActorContext,
  ) {
    if (!Number.isFinite(projectId) || projectId <= 0) {
      throw new BadRequestException('Invalid project id');
    }

    const before = await this.findOne(projectId).catch(() => null);
    if (!before) {
      throw new NotFoundException(`Project ${projectId} not found`);
    }

    const existing = await this.databaseService.query<{ id: number }>(
      `SELECT id FROM tblprojects WHERE id = $1 LIMIT 1`,
      [projectId],
    );
    if (existing.rowCount === 0) {
      throw new NotFoundException(`Project ${projectId} not found`);
    }

    if (dto.projectCode !== undefined) {
      const code = this.normalizeText(dto.projectCode);
      if (!code) throw new BadRequestException('Project code cannot be empty');
      const duplicate = await this.databaseService.query<{ id: number }>(
        `SELECT id FROM tblprojects WHERE LOWER(project_code) = LOWER($1) AND id <> $2 LIMIT 1`,
        [code, projectId],
      );
      if ((duplicate.rowCount ?? 0) > 0) {
        throw new BadRequestException(`Project code ${code} already exists`);
      }
    }

    if (dto.customerId !== undefined) {
      const customerId = this.normalizeText(dto.customerId);
      if (!customerId) throw new BadRequestException('Customer cannot be empty');
      const customerExists = await this.databaseService.query<{ id: string }>(
        `SELECT id::text AS id FROM tblcustomer WHERE id::text = $1 LIMIT 1`,
        [customerId],
      );
      if (customerExists.rowCount === 0) {
        throw new BadRequestException('Selected customer was not found');
      }
    }

    const sets: string[] = [];
    const params: unknown[] = [];

    const push = (column: string, value: unknown) => {
      params.push(value);
      sets.push(`${column} = $${params.length}`);
    };

    if (dto.projectCode !== undefined) push('project_code', this.normalizeText(dto.projectCode));
    if (dto.projectName !== undefined) {
      const name = this.normalizeText(dto.projectName);
      if (!name) throw new BadRequestException('Project name cannot be empty');
      push('project_name', name);
    }
    if (dto.projectType !== undefined) push('project_type', this.normalizeText(dto.projectType) || null);
    if (dto.projectOwner !== undefined) push('project_owner', this.normalizeText(dto.projectOwner) || null);
    if (dto.projectLocation !== undefined) {
      push('project_location', this.normalizeText(dto.projectLocation) || null);
    }
    if (dto.projectStartDate !== undefined) {
      push('project_start_date', this.toIsoDateOrNull(dto.projectStartDate));
    }
    if (dto.projectEndDate !== undefined) {
      push('project_end_date', this.toIsoDateOrNull(dto.projectEndDate));
    }
    if (dto.projectManager !== undefined) {
      push('project_manager', this.normalizeText(dto.projectManager) || null);
    }
    if (dto.projectStatus !== undefined) push('project_status', this.normalizeStatus(dto.projectStatus));
    if (dto.projectNotes !== undefined) push('project_notes', this.normalizeText(dto.projectNotes) || null);
    if (dto.customerId !== undefined) push('customer_id', this.normalizeText(dto.customerId));
    if (dto.pocName !== undefined) push('poc_name', this.normalizeText(dto.pocName) || null);
    if (dto.pocPhone !== undefined) push('poc_phone', this.normalizeText(dto.pocPhone) || null);
    if (dto.pocEmail !== undefined) push('poc_email', this.normalizeText(dto.pocEmail) || null);
    if (dto.branchId !== undefined) {
      const branchId = Number(dto.branchId);
      push('branch_id', Number.isFinite(branchId) && branchId > 0 ? branchId : null);
    }

    if (sets.length === 0) {
      return this.findOne(projectId);
    }

    sets.push('updated_at = NOW()');
    params.push(projectId);

    await this.databaseService.query(
      `UPDATE tblprojects SET ${sets.join(', ')} WHERE id = $${params.length}`,
      params,
    );

    const after = await this.findOne(projectId);
    await this.auditLogService.logMutation({
      action: 'PROJECT_UPDATE',
      entityType: 'project',
      entityId: projectId,
      actor: auditActor,
      description: `Updated project ${after.data.projectCode}`,
      requestBody: dto as unknown as Record<string, unknown>,
      before: before.data as unknown as Record<string, unknown>,
      after: after.data as unknown as Record<string, unknown>,
    });
    return after;
  }

  async remove(projectId: number, auditActor?: AuditActorContext) {
    if (!Number.isFinite(projectId) || projectId <= 0) {
      throw new BadRequestException('Invalid project id');
    }

    const before = await this.findOne(projectId).catch(() => null);

    const linked = await this.databaseService.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM tblsales_order WHERE project_id = $1`,
      [projectId],
    );
    const relatedCount = Number(linked.rows[0]?.count ?? 0);
    if (relatedCount > 0) {
      await this.databaseService.query(
        `UPDATE tblprojects
         SET project_status = 'cancelled', updated_at = NOW()
         WHERE id = $1`,
        [projectId],
      );
      const result = {
        success: true,
        message: `Project has ${relatedCount} linked sales order(s); status set to cancelled`,
        softCancelled: true,
      };
      await this.auditLogService.logMutation({
        action: 'PROJECT_SOFT_CANCEL',
        entityType: 'project',
        entityId: projectId,
        actor: auditActor,
        description: `Soft-cancelled project ${before?.data.projectCode ?? projectId} (${relatedCount} linked SO)`,
        before: before?.data as unknown as Record<string, unknown>,
        metadata: { relatedCount },
      });
      return result;
    }

    const deleted = await this.databaseService.query(
      `DELETE FROM tblprojects WHERE id = $1`,
      [projectId],
    );
    if (deleted.rowCount === 0) {
      throw new NotFoundException(`Project ${projectId} not found`);
    }

    const result = { success: true, message: 'Project deleted', softCancelled: false };
    await this.auditLogService.logMutation({
      action: 'PROJECT_DELETE',
      entityType: 'project',
      entityId: projectId,
      actor: auditActor,
      description: `Deleted project ${before?.data.projectCode ?? projectId}`,
      before: before?.data as unknown as Record<string, unknown>,
    });
    return result;
  }

  async getBilling(projectId: number) {
    const detail = await this.findOne(projectId);
    const orders = detail.data.relatedSalesOrders;
    const totalAmount = orders.reduce((sum, so) => sum + so.totalAmount, 0);
    const paidAmount = orders.reduce((sum, so) => sum + so.paidAmount, 0);
    const balance = Math.max(totalAmount - paidAmount, 0);

    return {
      success: true,
      data: {
        projectId,
        projectCode: detail.data.projectCode,
        projectName: detail.data.projectName,
        customerId: detail.data.customerId,
        customerName: detail.data.customerName,
        totalAmount,
        paidAmount,
        balance,
        salesOrders: orders,
      },
    };
  }

  async listStatements(projectId: number) {
    if (!Number.isFinite(projectId) || projectId <= 0) {
      throw new BadRequestException('Invalid project id');
    }

    const result = await this.databaseService.query<{
      id: number;
      soaNumber: string | null;
      periodFrom: string | null;
      periodTo: string | null;
      openingBalance: string | null;
      totalCharges: string | null;
      totalPayments: string | null;
      closingBalance: string | null;
      soaStatus: string | null;
      dueDate: string | null;
      notes: string | null;
      generatedAt: string | null;
    }>(
      `SELECT
         id,
         soa_number AS "soaNumber",
         period_from::text AS "periodFrom",
         period_to::text AS "periodTo",
         opening_balance::text AS "openingBalance",
         total_charges::text AS "totalCharges",
         total_payments::text AS "totalPayments",
         closing_balance::text AS "closingBalance",
         soa_status AS "soaStatus",
         due_date::text AS "dueDate",
         notes,
         generated_at::text AS "generatedAt"
       FROM tblstatement_of_account
       WHERE project_id = $1
       ORDER BY period_to DESC, generated_at DESC`,
      [projectId],
    );

    return {
      success: true,
      items: result.rows.map((row) => ({
        id: row.id,
        soaNumber: row.soaNumber || '',
        periodFrom: row.periodFrom,
        periodTo: row.periodTo,
        openingBalance: this.toOptionalNumber(row.openingBalance) ?? 0,
        totalCharges: this.toOptionalNumber(row.totalCharges) ?? 0,
        totalPayments: this.toOptionalNumber(row.totalPayments) ?? 0,
        closingBalance: this.toOptionalNumber(row.closingBalance) ?? 0,
        soaStatus: row.soaStatus || 'draft',
        dueDate: row.dueDate,
        notes: row.notes || '',
        generatedAt: row.generatedAt,
      })),
    };
  }

  async markStatementSent(
    projectId: number,
    soaId: number,
    auditActor?: AuditActorContext,
  ) {
    if (!Number.isFinite(projectId) || projectId <= 0) {
      throw new BadRequestException('Invalid project id');
    }
    if (!Number.isFinite(soaId) || soaId <= 0) {
      throw new BadRequestException('Invalid SOA id');
    }

    const existing = await this.databaseService.query<{
      id: number;
      soaNumber: string | null;
      soaStatus: string | null;
    }>(
      `SELECT id, soa_number AS "soaNumber", soa_status AS "soaStatus"
         FROM tblstatement_of_account
        WHERE id = $1 AND project_id = $2
        LIMIT 1`,
      [soaId, projectId],
    );
    if (existing.rowCount === 0) {
      throw new NotFoundException('Statement of account not found for this project');
    }

    await this.databaseService.query(
      `UPDATE tblstatement_of_account
          SET soa_status = 'sent',
              sent_at = COALESCE(sent_at, NOW())
        WHERE id = $1 AND project_id = $2`,
      [soaId, projectId],
    );

    await this.auditLogService.logMutation({
      action: 'PROJECT_SOA_SEND',
      entityType: 'project-soa',
      entityId: soaId,
      actor: auditActor,
      description: `Marked SOA ${existing.rows[0]?.soaNumber || soaId} as sent`,
      before: { soaStatus: existing.rows[0]?.soaStatus || 'draft' },
      after: { soaStatus: 'sent' },
      metadata: { projectId },
    });

    return {
      success: true,
      message: 'SOA marked as sent',
      data: {
        id: soaId,
        soaNumber: existing.rows[0]?.soaNumber || '',
        soaStatus: 'sent',
      },
    };
  }

  async createStatement(
    projectId: number,
    dto: CreateProjectSoaDto,
    userId?: number,
    auditActor?: AuditActorContext,
  ) {
    const detail = await this.findOne(projectId);
    const customerId = this.normalizeText(detail.data.customerId);
    if (!customerId) {
      throw new BadRequestException('Project has no customer; cannot generate SOA');
    }

    const requestedFrom = this.parseDateOnly(dto.periodFrom);
    const requestedTo = this.parseDateOnly(dto.periodTo);
    if (!requestedFrom || !requestedTo) {
      throw new BadRequestException('Statement period is required');
    }
    if (requestedFrom.getTime() > requestedTo.getTime()) {
      throw new BadRequestException('Period From cannot be later than Period To');
    }

    const lastStatement = await this.databaseService.query<{
      closing_balance: string | null;
      period_to: string | null;
    }>(
      `SELECT closing_balance::text AS closing_balance, period_to::text AS period_to
         FROM tblstatement_of_account
        WHERE project_id = $1
        ORDER BY period_to DESC, generated_at DESC
        LIMIT 1`,
      [projectId],
    );

    const openingBalance = this.toOptionalNumber(lastStatement.rows[0]?.closing_balance) ?? 0;
    const lastPeriodTo = this.parseDateOnly(lastStatement.rows[0]?.period_to);
    const minimumPeriodFrom = lastPeriodTo ? this.addDays(lastPeriodTo, 1) : requestedFrom;
    const effectiveFromDate =
      requestedFrom.getTime() < minimumPeriodFrom.getTime() ? minimumPeriodFrom : requestedFrom;

    const effectivePeriodFrom = this.formatDateOnlyForSql(effectiveFromDate);
    const effectivePeriodTo = this.formatDateOnlyForSql(requestedTo);

    let totalCharges = 0;
    let totalPayments = 0;

    if (effectiveFromDate.getTime() <= requestedTo.getTime()) {
      const chargeResult = await this.databaseService.query<{ total_charges: string | null }>(
        `SELECT COALESCE(SUM(COALESCE(so.total_amount, 0)::numeric), 0)::text AS total_charges
           FROM tblsales_order so
          WHERE so.project_id = $1
            AND COALESCE(so.created_at, NOW())::date BETWEEN $2::date AND $3::date
            AND REPLACE(REPLACE(LOWER(TRIM(COALESCE(so.status, 'pending'))), '_', '-'), ' ', '-')
                NOT IN ('pending', 'for-delivery', 'in-progress', 'scheduled', 'cancelled', 'rejected')`,
        [projectId, effectivePeriodFrom, effectivePeriodTo],
      );

      const paymentsResult = await this.databaseService.query<{ total_paid: string | null }>(
        `SELECT COALESCE(SUM(COALESCE(NULLIF(to_jsonb(sp)->>'amount', '')::numeric, 0)), 0)::text AS total_paid
           FROM tblso_payments sp
           JOIN tblsales_order so ON so.id = sp.so_id
          WHERE so.project_id = $1
            AND COALESCE(so.created_at, NOW())::date BETWEEN $2::date AND $3::date
            AND REPLACE(REPLACE(LOWER(TRIM(COALESCE(to_jsonb(sp)->>'status', ''))), '_', '-'), ' ', '-')
                IN ('paid', 'posted', 'cleared', 'complete', 'completed', 'remitted')`,
        [projectId, effectivePeriodFrom, effectivePeriodTo],
      );

      totalCharges = this.toOptionalNumber(chargeResult.rows[0]?.total_charges) ?? 0;
      totalPayments = this.toOptionalNumber(paymentsResult.rows[0]?.total_paid) ?? 0;
    }

    const closingBalance = openingBalance + totalCharges - totalPayments;

    const inserted = await this.databaseService.query<{
      id: number;
      soaNumber: string | null;
    }>(
      `INSERT INTO tblstatement_of_account (
         customer_id, project_id, period_from, period_to,
         opening_balance, total_charges, total_payments, closing_balance,
         soa_status, generated_by, due_date, notes
       ) VALUES (
         $1::uuid, $2, $3::date, $4::date,
         $5, $6, $7, $8,
         'draft', $9, $10::date, $11
       )
       RETURNING id, soa_number AS "soaNumber"`,
      [
        customerId,
        projectId,
        effectivePeriodFrom,
        effectivePeriodTo,
        openingBalance,
        totalCharges,
        totalPayments,
        closingBalance,
        Number.isFinite(Number(userId)) && Number(userId) > 0 ? Number(userId) : null,
        this.toIsoDateOrNull(dto.dueDate),
        this.normalizeText(dto.notes) || null,
      ],
    );

    const data = {
      id: inserted.rows[0]?.id,
      soaNumber: inserted.rows[0]?.soaNumber || '',
      periodFrom: effectivePeriodFrom,
      periodTo: effectivePeriodTo,
      openingBalance,
      totalCharges,
      totalPayments,
      closingBalance,
      soaStatus: 'draft',
    };

    await this.auditLogService.logMutation({
      action: 'PROJECT_SOA_CREATE',
      entityType: 'project-soa',
      entityId: data.id,
      actor: auditActor ?? { userId },
      description: `Generated SOA ${data.soaNumber || `#${data.id}`} for project #${projectId}`,
      requestBody: dto as unknown as Record<string, unknown>,
      after: data as unknown as Record<string, unknown>,
      metadata: { projectId },
    });

    return {
      success: true,
      data,
    };
  }

  private async insertProjectSettlementPayment(
    client: { query: DatabaseService['query'] },
    salesOrderId: number,
    payload: {
      method: string;
      amount: number;
      status: string;
      paymentDate?: string | null;
      checkNo?: string | null;
      bankName?: string | null;
      postDated?: string | null;
    },
  ): Promise<void> {
    await client.query(
      `INSERT INTO tblso_payments (
         so_id, method, amount, status, "paymentDate", "checkNo", "bankName", "postDated"
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        salesOrderId,
        payload.method,
        payload.amount,
        payload.status,
        payload.paymentDate ?? null,
        payload.checkNo ?? null,
        payload.bankName ?? null,
        payload.postDated ?? null,
      ],
    );
  }

  private async refreshSalesOrderStatusAfterSettlement(
    client: { query: DatabaseService['query'] },
    salesOrderId: number,
    orderTotal: number,
    currentStatus: string,
  ): Promise<void> {
    const totals = await client.query<{ paid: string; outstanding: string }>(
      `SELECT
         COALESCE(SUM(COALESCE(NULLIF(to_jsonb(sp)->>'amount', '')::numeric, 0)) FILTER (
           WHERE REPLACE(REPLACE(LOWER(TRIM(COALESCE(to_jsonb(sp)->>'status', ''))), '_', '-'), ' ', '-')
                 IN ('paid', 'posted', 'cleared', 'complete', 'completed', 'remitted')
         ), 0)::text AS paid,
         COALESCE(SUM(COALESCE(NULLIF(to_jsonb(sp)->>'amount', '')::numeric, 0)) FILTER (
           WHERE REPLACE(REPLACE(LOWER(TRIM(COALESCE(to_jsonb(sp)->>'method', ''))), '_', '-'), ' ', '-')
                 IN ('cheque', 'credit-card')
             AND REPLACE(REPLACE(LOWER(TRIM(COALESCE(to_jsonb(sp)->>'status', ''))), '_', '-'), ' ', '-')
                 NOT IN ('paid', 'posted', 'cleared', 'complete', 'completed', 'remitted')
         ), 0)::text AS outstanding
       FROM tblso_payments sp
       WHERE sp.so_id = $1`,
      [salesOrderId],
    );

    const paidAmount = this.toOptionalNumber(totals.rows[0]?.paid) ?? 0;
    const outstandingAmount = this.toOptionalNumber(totals.rows[0]?.outstanding) ?? 0;
    const remaining = Math.max(orderTotal - paidAmount - outstandingAmount, 0);
    const normalized = String(currentStatus ?? '')
      .trim()
      .toLowerCase()
      .replace(/_/g, '-')
      .replace(/\s+/g, '-');

    let nextStatus = currentStatus || 'pending';
    if (remaining <= 0.01 && outstandingAmount <= 0.01) {
      nextStatus = 'complete';
    } else if (remaining <= 0.01 && outstandingAmount > 0.01) {
      nextStatus = 'remitted';
    } else if (paidAmount > 0 || outstandingAmount > 0) {
      nextStatus = normalized === 'pending' || !normalized ? 'partial' : currentStatus;
      if (['pending', 'for-delivery', 'in-progress', 'scheduled'].includes(normalized)) {
        nextStatus = 'partial';
      }
    }

    if (nextStatus !== currentStatus) {
      await client.query(`UPDATE tblsales_order SET status = $1 WHERE id = $2`, [
        nextStatus,
        salesOrderId,
      ]);
    }
  }

  private async allocateAcrossOpenOrders(
    client: { query: DatabaseService['query'] },
    targetOrders: Array<{ id: number; balance: number; totalAmount: number; status: string }>,
    amountToAllocate: number,
    payment: {
      method: string;
      status: string;
      paymentDate?: string | null;
      checkNo?: string | null;
      bankName?: string | null;
      postDated?: string | null;
    },
  ): Promise<Array<{ salesOrderId: number; amount: number; method: string }>> {
    let remainingToAllocate = Math.round(amountToAllocate * 100) / 100;
    const allocations: Array<{ salesOrderId: number; amount: number; method: string }> = [];

    for (const order of targetOrders) {
      if (remainingToAllocate <= 0) break;
      const amount = Math.min(order.balance, remainingToAllocate);
      if (amount <= 0) continue;

      await this.insertProjectSettlementPayment(client, order.id, {
        ...payment,
        amount,
      });
      await this.refreshSalesOrderStatusAfterSettlement(
        client,
        order.id,
        order.totalAmount,
        order.status,
      );

      allocations.push({ salesOrderId: order.id, amount, method: payment.method });
      order.balance = Math.round((order.balance - amount) * 100) / 100;
      remainingToAllocate = Math.round((remainingToAllocate - amount) * 100) / 100;
    }

    return allocations;
  }

  async createSettlement(
    projectId: number,
    dto: CreateProjectSettlementDto,
    branchId?: number,
    auditActor?: AuditActorContext,
  ) {
    const billing = await this.getBilling(projectId);
    const openOrders = billing.data.salesOrders
      .filter((so) => so.balance > 0)
      .sort((a, b) => {
        const aDate = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const bDate = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return aDate - bDate;
      })
      .map((so) => ({ ...so }));

    if (openOrders.length === 0) {
      throw new BadRequestException('This project has no open sales-order balances');
    }

    const mode = String(dto.mode ?? 'partial').toLowerCase();
    if (!['partial', 'full', 'cheque', 'split'].includes(mode)) {
      throw new BadRequestException('A valid settlement mode is required');
    }

    const targetOrders = dto.salesOrderId
      ? openOrders.filter((so) => so.id === Number(dto.salesOrderId))
      : openOrders;

    if (targetOrders.length === 0) {
      throw new BadRequestException('Selected sales order is not an open balance on this project');
    }

    const targetBalance = Math.round(
      targetOrders.reduce((sum, so) => sum + so.balance, 0) * 100,
    ) / 100;

    if (targetBalance <= 0) {
      throw new BadRequestException('Settlement amount must be greater than zero');
    }

    const bankName = this.normalizeText(dto.bankName) || null;
    const checkNo = this.normalizeText(dto.checkNo) || null;
    const postDated = this.toIsoDateOrNull(dto.postDated);
    const allocations: Array<{ salesOrderId: number; amount: number; method: string }> = [];

    await this.databaseService.withTransaction(async (client) => {
      if (mode === 'partial' || mode === 'full') {
        const amount =
          mode === 'full'
            ? targetBalance
            : Math.min(Math.max(Number(dto.amount) || 0, 0), targetBalance);
        if (amount <= 0) {
          throw new BadRequestException('Settlement amount must be greater than zero');
        }

        allocations.push(
          ...(await this.allocateAcrossOpenOrders(client, targetOrders, amount, {
            method: this.normalizeText(dto.method) || 'Bank Transfer',
            status: 'paid',
            paymentDate: new Date().toISOString(),
          })),
        );
      }

      if (mode === 'cheque') {
        allocations.push(
          ...(await this.allocateAcrossOpenOrders(client, targetOrders, targetBalance, {
            method: 'Cheque',
            status: 'unpaid',
            checkNo,
            bankName,
            postDated,
          })),
        );
      }

      if (mode === 'split') {
        const bankAmount = Math.max(Number(dto.bankAmount) || 0, 0);
        const chequeAmount = Math.max(Number(dto.chequeAmount) || 0, 0);

        if (bankAmount <= 0 || chequeAmount <= 0) {
          throw new BadRequestException('Split settlement requires both bank and cheque amounts.');
        }
        if (Math.abs(bankAmount + chequeAmount - targetBalance) > 0.01) {
          throw new BadRequestException('Split settlement must match the full remaining balance.');
        }

        allocations.push(
          ...(await this.allocateAcrossOpenOrders(client, targetOrders, bankAmount, {
            method: 'Bank Transfer',
            status: 'paid',
            paymentDate: new Date().toISOString(),
          })),
        );
        allocations.push(
          ...(await this.allocateAcrossOpenOrders(client, targetOrders, chequeAmount, {
            method: 'Cheque',
            status: 'unpaid',
            checkNo,
            bankName,
            postDated,
          })),
        );
      }
    });

    if (allocations.length === 0) {
      throw new BadRequestException('Unable to allocate settlement');
    }

    const refreshed = await this.getBilling(projectId);
    const message =
      mode === 'cheque'
        ? 'Balance transferred to cheque receivables'
        : mode === 'split'
          ? 'Split settlement recorded successfully'
          : 'Settlement recorded successfully';

    await this.auditLogService.logMutation({
      action: 'PROJECT_SETTLEMENT',
      entityType: 'project',
      entityId: projectId,
      actor: auditActor ?? { branchId },
      description: `${message} for project #${projectId}`,
      requestBody: dto as unknown as Record<string, unknown>,
      after: refreshed.data as unknown as Record<string, unknown>,
      metadata: { mode, allocations },
    });

    return {
      success: true,
      message,
      allocations,
      billing: refreshed.data,
      branchId: branchId ?? null,
    };
  }
}
