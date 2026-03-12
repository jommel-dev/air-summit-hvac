import { Controller, Get, Post, Body, Param, Delete, ParseIntPipe } from '@nestjs/common';
import { MaterialTransactionsService } from './material-transactions.service';
import { CreateMaterialTransactionDto } from './dto/create-material-transaction.dto';

@Controller('inventory/material-transactions')
export class MaterialTransactionsController {
  constructor(private readonly service: MaterialTransactionsService) {}

  @Post()
  create(@Body() dto: CreateMaterialTransactionDto) {
    return this.service.create(dto);
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
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id);
  }
}
