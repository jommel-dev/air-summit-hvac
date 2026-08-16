import { Body, Controller, Get, Param, Patch, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { AccountingService } from './accounting.service';
import type {
  AccountingReportPrintSettingsPayload,
  CreateChequeVoucherPayload,
  CreateGeneralJournalPayload,
  UpdateGeneralJournalPayload,
  UpdateChequeVoucherPayload,
  UpsertAccountTitlePayload,
} from './accounting.service';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { buildAuditContext } from 'src/common/utils/build-audit-context';

@Controller('accounting')
export class AccountingController {
  constructor(private readonly accountingService: AccountingService) {}

  private toPositiveNumber(value: unknown): number | undefined {
    const normalized = Number(value);
    return Number.isFinite(normalized) && normalized > 0 ? normalized : undefined;
  }

  @Get('account-titles')
  async getAccountTitles(): Promise<{ success: boolean; data: unknown }> {
    const data = await this.accountingService.getAccountTitles();
    return {
      success: true,
      data,
    };
  }

  @Post('account-titles')
  async upsertAccountTitle(
    @Body() payload: UpsertAccountTitlePayload,
    @Req() request: { user?: Record<string, unknown>; ip?: string },
  ): Promise<{ success: boolean; data: unknown }> {
    const data = await this.accountingService.upsertAccountTitle(
      payload,
      buildAuditContext(request),
    );
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

  @UseGuards(JwtAuthGuard)
  @Get('report-print-settings/:reportKey')
  async getReportPrintSettings(
    @Param('reportKey') reportKey: string,
    @Req() request: { user?: Record<string, unknown> },
  ): Promise<{ success: boolean; data: unknown }> {
    const branchId = this.toPositiveNumber(request.user?.branchId ?? request.user?.branch_id);
    const data = await this.accountingService.getReportPrintSettings(reportKey, branchId);
    return {
      success: true,
      data,
    };
  }

  @UseGuards(JwtAuthGuard)
  @Put('report-print-settings/:reportKey')
  async upsertReportPrintSettings(
    @Param('reportKey') reportKey: string,
    @Body() payload: AccountingReportPrintSettingsPayload,
    @Req() request: { user?: Record<string, unknown>; ip?: string },
  ): Promise<{ success: boolean; data: unknown }> {
    const branchId = this.toPositiveNumber(request.user?.branchId ?? request.user?.branch_id);
    const userId = this.toPositiveNumber(request.user?.sub);
    const data = await this.accountingService.upsertReportPrintSettings(
      reportKey,
      payload,
      {
        branchId,
        userId,
      },
      buildAuditContext(request),
    );
    return {
      success: true,
      data,
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

  @Get('general-journals')
  async listGeneralJournals(
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ): Promise<{ success: boolean; data: unknown }> {
    const data = await this.accountingService.listGeneralJournals({ dateFrom, dateTo });
    return {
      success: true,
      data,
    };
  }

  @Get('general-journals/next-number')
  async getNextGeneralJournalNumber() {
    const journalNo = await this.accountingService.getNextGeneralJournalNumber();
    return {
      success: true,
      data: { journalNo },
    };
  }

  @UseGuards(JwtAuthGuard)
  @Post('general-journals/post')
  async postGeneralJournal(
    @Body() payload: CreateGeneralJournalPayload,
    @Req() request: { user?: Record<string, unknown>; ip?: string },
  ): Promise<{ success: boolean; data: unknown }> {
    const data = await this.accountingService.postGeneralJournal(
      payload,
      buildAuditContext(request),
    );
    return {
      success: true,
      data,
    };
  }

  @UseGuards(JwtAuthGuard)
  @Patch('general-journals/:journalNumber')
  async updateGeneralJournal(
    @Param('journalNumber') journalNumber: string,
    @Body() payload: UpdateGeneralJournalPayload,
    @Req() request: { user?: Record<string, unknown>; ip?: string },
  ): Promise<{ success: boolean; data: unknown }> {
    const data = await this.accountingService.updateGeneralJournal(
      journalNumber,
      payload,
      buildAuditContext(request),
    );
    return {
      success: true,
      data,
    };
  }

  @UseGuards(JwtAuthGuard)
  @Post('cheque-vouchers/release')
  async releaseChequeVoucher(
    @Body() payload: CreateChequeVoucherPayload,
    @Req() request: { user?: Record<string, unknown>; ip?: string },
  ): Promise<{ success: boolean; data: unknown }> {
    const preparedBy = String(request.user?.fullname ?? request.user?.username ?? '').trim() || undefined;
    const data = await this.accountingService.releaseChequeVoucher(
      { ...payload, preparedBy },
      buildAuditContext(request),
    );
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
    @Req() request: { user?: Record<string, unknown>; ip?: string },
  ): Promise<{ success: boolean; data: unknown }> {
    const preparedBy = String(request.user?.fullname ?? request.user?.username ?? '').trim() || undefined;
    const data = await this.accountingService.updateChequeVoucher(
      cvNo,
      { ...payload, preparedBy },
      buildAuditContext(request),
    );
    return {
      success: true,
      data,
    };
  }
}
