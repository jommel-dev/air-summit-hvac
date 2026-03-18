import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { DashboardService } from './dashboard.service';

@Controller('dashboard')
@UseGuards(JwtAuthGuard)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

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
}
