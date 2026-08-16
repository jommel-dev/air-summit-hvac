import { Controller, Get, Post, Body, Param, Delete, ParseIntPipe, Req } from '@nestjs/common';
import { MaterialTransactionsService } from './material-transactions.service';
import { CreateMaterialTransactionDto } from './dto/create-material-transaction.dto';
import { buildAuditContext } from 'src/common/utils/build-audit-context';

@Controller('inventory/material-transactions')
export class MaterialTransactionsController {
  constructor(private readonly service: MaterialTransactionsService) {}

  @Post()
  create(
    @Body() dto: CreateMaterialTransactionDto,
    @Req() request: { user?: Record<string, unknown>; ip?: string },
  ) {
    return this.service.create(dto, buildAuditContext(request));
  }

  @Get('purchase/:purchaseId')
  findByPurchaseId(@Param('purchaseId', ParseIntPipe) purchaseId: number) {
    return this.service.findByPurchaseId(purchaseId);
  }

  @Get('sales/:salesId')
  findBySalesId(@Param('salesId', ParseIntPipe) salesId: number) {
    return this.service.findBySalesId(salesId);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.service.findOne(id);
  }

  @Delete(':id')
  remove(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: { user?: Record<string, unknown>; ip?: string },
  ) {
    return this.service.remove(id, buildAuditContext(request));
  }
}
