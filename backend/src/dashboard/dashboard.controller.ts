import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { DashboardService } from './dashboard.service';
import { buildAuditContext } from 'src/common/utils/build-audit-context';

@Controller('dashboard')
@UseGuards(JwtAuthGuard)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  private buildAuditContext(
    request: { user?: Record<string, unknown>; ip?: string },
  ) {
    return buildAuditContext(request);
  }

  @Get('overview')
  getOverview(@Req() request: { user?: Record<string, unknown> }) {
    const effectiveBranchId = Number(
      request.user?.branchId ?? request.user?.branch_id ?? request.user?.branch,
    );

    return this.dashboardService.getOverview(
      Number.isFinite(effectiveBranchId) && effectiveBranchId > 0
        ? effectiveBranchId
        : undefined,
    );
  }

  @Get('sales-detail')
  async getSalesDetail(
    @Query('mode') mode: string,
    @Query('page') page: string,
    @Query('pageSize') pageSize: string,
    @Query('dateFrom') dateFrom: string,
    @Query('dateTo') dateTo: string,
    @Query('status') status: string,
    @Req() request: { user?: Record<string, unknown> },
  ) {
    const validModes = ['sales', 'unpaid', 'overdues', 'cheques'];
    const normalizedMode = validModes.includes(mode)
      ? (mode as 'sales' | 'unpaid' | 'overdues' | 'cheques')
      : 'sales';

    const effectiveBranchId = Number(
      request.user?.branchId ?? request.user?.branch_id ?? request.user?.branch,
    );

    return this.dashboardService.getSalesDetail(
      normalizedMode,
      Number.isFinite(effectiveBranchId) && effectiveBranchId > 0
        ? effectiveBranchId
        : undefined,
      { page: Number(page), pageSize: Number(pageSize), dateFrom, dateTo, status },
    );
  }

  @Get('operations-detail')
  async getOperationsDetail(
    @Query('mode') mode: string,
    @Req() request: { user?: Record<string, unknown> },
  ) {
    const validModes = ['receiving', 'dispatch', 'installation', 'stock-alerts'];
    const normalizedMode = validModes.includes(mode)
      ? (mode as 'receiving' | 'dispatch' | 'installation' | 'stock-alerts')
      : 'receiving';

    const effectiveBranchId = Number(
      request.user?.branchId ?? request.user?.branch_id ?? request.user?.branch,
    );

    return this.dashboardService.getOperationsDetail(
      normalizedMode,
      Number.isFinite(effectiveBranchId) && effectiveBranchId > 0
        ? effectiveBranchId
        : undefined,
    );
  }

  @Post('settle-sales-order')
  settleSalesOrder(
    @Body()
    body: {
      salesOrderId?: number;
      mode?: 'partial' | 'full' | 'cheque' | 'split';
      amount?: number;
      bankAmount?: number;
      chequeAmount?: number;
      bankName?: string | null;
      checkNo?: string | null;
      postDated?: string | null;
    },
    @Req() request: { user?: Record<string, unknown> },
  ) {
    const effectiveBranchId = Number(
      request.user?.branchId ?? request.user?.branch_id ?? request.user?.branch,
    );

    return this.dashboardService.settleSalesOrder(
      body,
      Number.isFinite(effectiveBranchId) && effectiveBranchId > 0
        ? effectiveBranchId
        : undefined,
      this.buildAuditContext(request),
    );
  }

  @Post('verify-receivable')
  verifyReceivable(
    @Body() body: { paymentId?: number; method?: 'bank-transfer' | 'cheque' | 'credit-card' },
    @Req() request: { user?: Record<string, unknown>; ip?: string },
  ) {
    const effectiveBranchId = Number(
      request.user?.branchId ?? request.user?.branch_id ?? request.user?.branch,
    );

    return this.dashboardService.verifySalesReceivable(
      body,
      Number.isFinite(effectiveBranchId) && effectiveBranchId > 0
        ? effectiveBranchId
        : undefined,
      this.buildAuditContext(request),
    );
  }

  @Post('adjust-receivable')
  adjustReceivable(
    @Body() body: {
      paymentId?: number;
      method?: 'bank-transfer' | 'cheque' | 'credit-card';
      password?: string;
      remarks?: string;
      authUsername?: string;
    },
    @Req() request: { user?: Record<string, unknown>; ip?: string },
  ) {
    const effectiveBranchId = Number(
      request.user?.branchId ?? request.user?.branch_id ?? request.user?.branch,
    );

    return this.dashboardService.adjustSalesReceivable(
      body,
      Number.isFinite(effectiveBranchId) && effectiveBranchId > 0
        ? effectiveBranchId
        : undefined,
      this.buildAuditContext(request),
    );
  }
}
