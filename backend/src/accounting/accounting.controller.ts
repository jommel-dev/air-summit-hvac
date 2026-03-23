import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AccountingService } from './accounting.service';
import type { CreateChequeVoucherPayload, UpdateChequeVoucherPayload, UpsertAccountTitlePayload } from './accounting.service';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';

@Controller('accounting')
export class AccountingController {
  constructor(private readonly accountingService: AccountingService) {}

  @Get('account-titles')
  async getAccountTitles(): Promise<{ success: boolean; data: unknown }> {
    const data = await this.accountingService.getAccountTitles();
    return {
      success: true,
      data,
    };
  }

  @Post('account-titles')
  async upsertAccountTitle(@Body() payload: UpsertAccountTitlePayload): Promise<{ success: boolean; data: unknown }> {
    const data = await this.accountingService.upsertAccountTitle(payload);
    return {
      success: true,
      data,
    };
  }

  @Get('cheque-vouchers/next-number')
  async getNextChequeVoucherNumber() {
    const cvNo = await this.accountingService.getNextChequeVoucherNumber();
    return {
      success: true,
      data: { cvNo },
    };
  }

  @Get('cheque-vouchers')
  async listChequeVouchers(
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ): Promise<{ success: boolean; data: unknown }> {
    const data = await this.accountingService.listChequeVouchers({ dateFrom, dateTo });
    return {
      success: true,
      data,
    };
  }

  @UseGuards(JwtAuthGuard)
  @Post('cheque-vouchers/release')
  async releaseChequeVoucher(
    @Body() payload: CreateChequeVoucherPayload,
    @Req() request: { user?: Record<string, unknown> },
  ): Promise<{ success: boolean; data: unknown }> {
    const preparedBy = String(request.user?.fullname ?? request.user?.username ?? '').trim() || undefined;
    const data = await this.accountingService.releaseChequeVoucher({ ...payload, preparedBy });
    return {
      success: true,
      data,
    };
  }

  @UseGuards(JwtAuthGuard)
  @Patch('cheque-vouchers/:cvNo')
  async updateChequeVoucher(
    @Param('cvNo') cvNo: string,
    @Body() payload: UpdateChequeVoucherPayload,
    @Req() request: { user?: Record<string, unknown> },
  ): Promise<{ success: boolean; data: unknown }> {
    const preparedBy = String(request.user?.fullname ?? request.user?.username ?? '').trim() || undefined;
    const data = await this.accountingService.updateChequeVoucher(cvNo, { ...payload, preparedBy });
    return {
      success: true,
      data,
    };
  }
}
