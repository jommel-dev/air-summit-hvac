import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { AuditLogService } from './audit-log.service';
import type { AuditLogEntry } from './audit-log.service';

@Controller('audit-logs')
@UseGuards(JwtAuthGuard)
export class AuditLogController {
  constructor(private readonly auditLogService: AuditLogService) {}

  @Get()
  findAll(
    @Query()
    query: {
      page?: string;
      limit?: string;
      search?: string;
      action?: string;
      entityType?: string;
      entityId?: string;
    },
    @Req() request: { user?: Record<string, unknown> },
  ) {
    const branchId = Number(request.user?.branchId ?? request.user?.branch_id);
    return this.auditLogService.findAll(
      query,
      Number.isFinite(branchId) && branchId > 0 ? branchId : undefined,
    );
  }

  @Get(':id')
  findOne(
    @Param('id') id: string,
    @Req() request: { user?: Record<string, unknown> },
  ) {
    const branchId = Number(request.user?.branchId ?? request.user?.branch_id);
    return this.auditLogService.findOne(
      Number(id),
      Number.isFinite(branchId) && branchId > 0 ? branchId : undefined,
    );
  }

  @Post()
  create(
    @Body() entry: AuditLogEntry,
    @Req() request: { user?: Record<string, unknown>; ip?: string },
  ) {
    const userId = Number(request.user?.sub ?? request.user?.id ?? request.user?.userId);
    const normalizedUserId = Number.isFinite(userId) ? userId : null;
    const username = String(request.user?.username ?? request.user?.name ?? '').trim() || null;
    const roleName = String(request.user?.roleName ?? request.user?.role ?? '').trim() || null;
    const branchId = Number(request.user?.branchId ?? request.user?.branch_id ?? request.user?.branch);
    const normalizedBranchId = Number.isFinite(branchId) ? branchId : null;
    const ipAddress = String(request.ip ?? '').trim().split(',')[0]?.trim() || null;

    void this.auditLogService.log({
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      userId: entry.userId ?? normalizedUserId,
      username: entry.username ?? username,
      roleName: entry.roleName ?? roleName,
      branchId: entry.branchId ?? normalizedBranchId,
      ipAddress: entry.ipAddress ?? ipAddress,
      metadata: entry.metadata ?? null,
    });

    return { success: true };
  }
}