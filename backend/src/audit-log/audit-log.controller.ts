import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { AuditLogService } from './audit-log.service';

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
}