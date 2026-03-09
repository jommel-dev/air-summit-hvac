import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { CreateQuotationDto } from './dto/create-quotation.dto';
import { ListQuotationQueryDto } from './dto/list-quotation-query.dto';
import { UpdateQuotationDto } from './dto/update-quotation.dto';
import { QuotationService } from './quotation.service';

@Controller('quotation')
@UseGuards(JwtAuthGuard)
export class QuotationController {
  constructor(private readonly quotationService: QuotationService) {}

  @Post()
  create(
    @Body() createQuotationDto: CreateQuotationDto,
    @Req() request: { user?: Record<string, unknown> },
  ) {
    const userId = Number(request.user?.sub);
    const branchId = Number(
      request.user?.branchId ?? request.user?.branch_id ?? request.user?.branch,
    );

    return this.quotationService.create(
      createQuotationDto,
      Number.isFinite(userId) ? userId : undefined,
      Number.isFinite(branchId) ? branchId : undefined,
    );
  }

  @Get()
  findAll(@Query() query: ListQuotationQueryDto) {
    return this.quotationService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.quotationService.findOne(+id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateQuotationDto: UpdateQuotationDto,
    @Req() request: { user?: Record<string, unknown> },
  ) {
    const userId = Number(request.user?.sub);
    const branchId = Number(
      request.user?.branchId ?? request.user?.branch_id ?? request.user?.branch,
    );

    return this.quotationService.update(
      +id,
      updateQuotationDto,
      Number.isFinite(userId) ? userId : undefined,
      Number.isFinite(branchId) ? branchId : undefined,
    );
  }

  @Patch(':id/finalize')
  finalize(@Param('id') id: string) {
    return this.quotationService.finalize(+id);
  }

  @Post(':id/convert-to-sales-order')
  convertToSalesOrder(
    @Param('id') id: string,
    @Req() request: { user?: Record<string, unknown> },
  ) {
    const userId = Number(request.user?.sub);
    const branchId = Number(
      request.user?.branchId ?? request.user?.branch_id ?? request.user?.branch,
    );

    return this.quotationService.convertToSalesOrder(
      +id,
      Number.isFinite(userId) ? userId : undefined,
      Number.isFinite(branchId) ? branchId : undefined,
    );
  }
}
