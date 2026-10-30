import { Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuditActorContext } from 'src/audit-log/audit-log.service';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { buildAuditContext } from 'src/common/utils/build-audit-context';
import { BeginningStockService } from './beginning-stock.service';

@Controller('beginning-stock')
@UseGuards(JwtAuthGuard)
export class BeginningStockController {
  constructor(private readonly beginningStockService: BeginningStockService) {}

  @Get()
  list(@Query('date') date?: string) {
    return this.beginningStockService.list(date);
  }

  @Post('capture-today')
  captureToday(@Req() request: { user?: Record<string, unknown>; ip?: string }) {
    const actor: AuditActorContext = buildAuditContext(request);
    return this.beginningStockService.captureToday(actor);
  }
}
