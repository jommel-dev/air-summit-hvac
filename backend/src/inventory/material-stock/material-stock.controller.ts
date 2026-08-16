import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { MaterialStockService } from './material-stock.service';
import { buildAuditContext } from 'src/common/utils/build-audit-context';

// @UseGuards(JwtAuthGuard) // add guard if you have auth
@Controller('material-stock')
export class MaterialStockController {
  constructor(private readonly service: MaterialStockService) {}

  @Get('balance/:materialId')
  async getBalance(@Param('materialId') materialId: string) {
    return this.service.getBalance(Number(materialId));
  }

  @Get('movements')
  async listMovements(
    @Query('materialId') materialId?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.listMovements({
      materialId: materialId ? Number(materialId) : undefined,
      limit: limit ? Number(limit) : 100,
    });
  }

  @Post('movement')
  async createMovement(
    @Body()
    dto: {
      materialId: number;
      movementType: 'IN' | 'OUT' | 'RESERVE' | 'RELEASE' | 'RETURN' | 'ADJUST';
      qty: number;
      sourceType: 'PO' | 'SO' | 'MANUAL';
      sourceId: number;
      sourceLineKey: string;
      statusSnapshot?: string;
      remarks?: string;
      createdBy?: number;
    },
    @Req() request: { user?: Record<string, unknown>; ip?: string },
  ) {
    return this.service.recordMovement(dto, {
      auditActor: buildAuditContext(request),
    });
  }
}
