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
import { PermanentDeleteQuotationDto } from './dto/permanent-delete-quotation.dto';
import { UpdateQuotationDto } from './dto/update-quotation.dto';
import { QuotationService } from './quotation.service';
import { AuditActorContext } from 'src/audit-log/audit-log.service';

@Controller('quotation')
@UseGuards(JwtAuthGuard)
export class QuotationController {
  constructor(private readonly quotationService: QuotationService) {}

  private buildAuditContext(
    request: { user?: Record<string, unknown>; ip?: string },
  ): AuditActorContext {
    const userId = Number(request.user?.sub);
    const branchId = Number(
      request.user?.branchId ?? request.user?.branch_id ?? request.user?.branch,
    );

    return {
      userId: Number.isFinite(userId) ? userId : undefined,
      username: String(request.user?.username ?? '').trim() || undefined,
      roleName: String(request.user?.roleName ?? request.user?.role_name ?? '').trim() || undefined,
      branchId: Number.isFinite(branchId) ? branchId : undefined,
      ipAddress: String(request.ip ?? '').trim() || undefined,
    };
  }

  private withEffectiveBranchScope(
    query: ListQuotationQueryDto,
    request: { user?: Record<string, unknown> },
  ): ListQuotationQueryDto {
    const branchId = Number(
      request.user?.branchId ?? request.user?.branch_id ?? request.user?.branch,
    );

    return {
      ...query,
      branchId: Number.isFinite(branchId) && branchId > 0 ? branchId : undefined,
    };
  }

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
      this.buildAuditContext(request),
    );
  }

  @Get()
  findAll(
    @Query() query: ListQuotationQueryDto,
    @Req() request: { user?: Record<string, unknown> },
  ) {
    return this.quotationService.findAll(this.withEffectiveBranchScope(query, request));
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
      this.buildAuditContext(request),
    );
  }

  @Patch(':id/finalize')
  finalize(
    @Param('id') id: string,
    @Req() request: { user?: Record<string, unknown>; ip?: string },
  ) {
    return this.quotationService.finalize(+id, this.buildAuditContext(request));
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

  @Post(':id/permanent-delete')
  permanentDelete(
    @Param('id') id: string,
    @Body() body: PermanentDeleteQuotationDto,
    @Req() request: { user?: Record<string, unknown> },
  ) {
    const userId = Number(request.user?.sub);
    const roleName = String(request.user?.roleName ?? request.user?.role_name ?? '');

    return this.quotationService.permanentDelete(
      +id,
      String(body.password ?? ''),
      Number.isFinite(userId) ? userId : undefined,
      roleName,
    );
  }
}
