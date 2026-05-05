import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Req,
  Query,
  UseGuards,
} from '@nestjs/common';
import { SerialNumberService } from './serial-number.service';
import { SerialEventLogService } from './serial-event-log.service';
import { CreateSerialNumberDto } from './dto/create-serial-number.dto';
import { UpdateSerialNumberDto } from './dto/update-serial-number.dto';
import { ScanSalesOrderDto } from './dto/scan-sales-order.dto';
import { ScanSalesOrderBatchDto } from './dto/scan-sales-order-batch.dto';
import { ScanPurchaseOrderDto } from './dto/scan-purchase-order.dto';
import { ScanPurchaseOrderBatchDto } from './dto/scan-purchase-order-batch.dto';
import { RemovePurchaseOrderSerialDto } from './dto/remove-purchase-order-serial.dto';
import { RemoveSalesOrderSerialDto } from './dto/remove-sales-order-serial.dto';
import { AdjustPurchaseUnitTypesDto } from './dto/adjust-purchase-unit-types.dto';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { AuditActorContext } from 'src/audit-log/audit-log.service';
import { resolveBranchId } from 'src/common/utils/resolve-branch-id';

@Controller('serial-number')
@UseGuards(JwtAuthGuard)
export class SerialNumberController {
  constructor(
    private readonly serialNumberService: SerialNumberService,
    private readonly serialEventLogService: SerialEventLogService,
  ) {}

  private resolveAuditActor(
    request: { user?: Record<string, unknown>; ip?: string },
  ): AuditActorContext {
    const userId = Number(request.user?.sub ?? request.user?.id ?? request.user?.userId);
    const normalizedUserId = Number.isFinite(userId) ? userId : null;
    const username = String(request.user?.username ?? request.user?.name ?? '').trim() || null;
    const roleName = String(request.user?.roleName ?? request.user?.role ?? '').trim() || null;
    const branchId = Number(request.user?.branchId ?? request.user?.branch_id ?? request.user?.branch);
    const normalizedBranchId = Number.isFinite(branchId) ? branchId : null;
    const ipAddress = String(request.ip ?? '').trim().split(',')[0]?.trim() || null;

    return {
      userId: normalizedUserId,
      username,
      roleName,
      branchId: normalizedBranchId,
      ipAddress,
    };
  }

  @Post('insert-bulk')
  @UseGuards(JwtAuthGuard)
  insertBulk(
    @Body() body: { serials: Array<{ serialNumber: string; unitType?: string; status?: string; productId?: number; capacityId?: number }> },
    @Req() request: { user?: Record<string, unknown> },
  ) {
    const role = String(request.user?.roleName ?? '').trim().toLowerCase();
    if (role !== 'superadmin' && role !== 'super admin' && role !== 'admin') {
      return { success: false, message: 'Access denied. Admin or Super Admin role required.' };
    }
    return this.serialNumberService.insertBulk(body.serials);
  }

  @Post('csv-preview')
  csvPreview(
    @Body() body: { rows: Array<{ serialNumber: string; unitType?: string; status: string }> },
    @Req() request: { user?: Record<string, unknown> },
  ) {
    const role = String(request.user?.roleName ?? '').trim().toLowerCase();
    if (role !== 'superadmin' && role !== 'super admin' && role !== 'admin') {
      return { success: false, message: 'Access denied. Admin or Super Admin role required.' };
    }
    return this.serialNumberService.csvPreview(body.rows);
  }

  @Post('bulk-update-status')
  bulkUpdateStatus(
    @Body() body: { serialNumbers: string[]; status: string },
    @Req() request: { user?: { sub?: unknown; roleName?: unknown } },
  ) {
    const role = String(request.user?.roleName ?? '').trim().toLowerCase();
    if (role !== 'superadmin' && role !== 'super admin' && role !== 'admin') {
      return { success: false, message: 'Access denied. Admin or Super Admin role required.' };
    }
    const userId = Number(request.user?.sub);
    const normalizedUserId = Number.isFinite(userId) ? userId : undefined;
    return this.serialNumberService.bulkUpdateStatus(body.serialNumbers, body.status, normalizedUserId);
  }

  @Post('scan-sales-order')
  scanSalesOrder(
    @Body() dto: ScanSalesOrderDto,
    @Req() request: { user?: Record<string, unknown>; ip?: string },
  ) {
    const actor = this.resolveAuditActor(request);
    return this.serialNumberService.scanSalesOrder(dto, actor);
  }

  @Post('scan-sales-order/batch')
  scanSalesOrderBatch(
    @Body() dto: ScanSalesOrderBatchDto,
    @Req() request: { user?: Record<string, unknown>; ip?: string },
  ) {
    const actor = this.resolveAuditActor(request);
    return this.serialNumberService.scanSalesOrderBatch(dto, actor);
  }

  @Post('scan-purchase-order')
  scanPurchaseOrder(
    @Body() dto: ScanPurchaseOrderDto,
    @Query('branchId') branchIdQuery: string | undefined,
    @Req() request: { user?: Record<string, unknown>; ip?: string },
  ) {
    const actor = this.resolveAuditActor(request);
    const branchId = resolveBranchId(request, branchIdQuery);

    return this.serialNumberService.scanPurchaseOrder(dto, actor, branchId);
  }

  @Post('scan-purchase-order/batch')
  scanPurchaseOrderBatch(
    @Body() dto: ScanPurchaseOrderBatchDto,
    @Query('branchId') branchIdQuery: string | undefined,
    @Req() request: { user?: Record<string, unknown>; ip?: string },
  ) {
    const actor = this.resolveAuditActor(request);
    const branchId = resolveBranchId(request, branchIdQuery);

    return this.serialNumberService.scanPurchaseOrderBatch(dto, actor, branchId);
  }

  @Post('remove-purchase-order')
  removePurchaseOrderSerial(@Body() dto: RemovePurchaseOrderSerialDto) {
    return this.serialNumberService.removePurchaseOrderSerial(dto);
  }

  @Post('remove-sales-order')
  removeSalesOrderSerial(
    @Body() dto: RemoveSalesOrderSerialDto,
    @Req() request: { user?: Record<string, unknown>; ip?: string },
  ) {
    const userId = Number(request.user?.id ?? request.user?.userId ?? request.user?.sub) || undefined;
    const username = String(request.user?.username ?? request.user?.name ?? '').trim() || undefined;
    const roleName = String(request.user?.roleName ?? request.user?.role ?? '').trim() || undefined;
    const branchId = Number(request.user?.branchId ?? request.user?.branch_id ?? request.user?.branch) || undefined;
    const ipAddress = String(request.ip ?? '').trim() || undefined;

    const actor: AuditActorContext = {
      userId: Number.isFinite(userId) ? userId : null,
      username,
      roleName,
      branchId: Number.isFinite(branchId) ? branchId : null,
      ipAddress: ipAddress ? ipAddress.split(',')[0].trim() : null,
    };

    return this.serialNumberService.removeSalesOrderSerial(dto, actor);
  }

  @Post('normalize-unit-types')
  normalizeStoredUnitTypes() {
    return this.serialNumberService.normalizeStoredUnitTypes();
  }

  @Post('adjust-purchase-unit-types')
  adjustPurchaseUnitTypes(@Body() dto: AdjustPurchaseUnitTypesDto) {
    return this.serialNumberService.adjustPurchaseUnitTypes(dto);
  }

  @Post()
  create(@Body() createSerialNumberDto: CreateSerialNumberDto) {
    return this.serialNumberService.create(createSerialNumberDto);
  }

  @Get()
  findAll() {
    return this.serialNumberService.findAll();
  }

  @Get('capacity-stock-summary')
  getCapacityStockSummary(
    @Query('productId') productId: string,
    @Query('capacityId') capacityId: string,
    @Query('branchId') branchIdQuery: string | undefined,
    @Req() request: { user?: Record<string, unknown> },
  ) {
    const branchId = resolveBranchId(request, branchIdQuery);

    return this.serialNumberService.getCapacityStockSummary(
      productId,
      capacityId,
      branchId,
    );
  }

  @Get('list-by-scope')
  getSerialNumbersByScope(
    @Query('productId') productId: string,
    @Query('capacityId') capacityId: string,
    @Query('branchId') branchIdQuery: string | undefined,
    @Req() request: { user?: Record<string, unknown> },
  ) {
    const branchId = resolveBranchId(request, branchIdQuery);
    return this.serialNumberService.getSerialNumbersByScope(
      productId,
      capacityId,
      branchId,
    );
  }

  @Get('reports/land-costing')
  getLandCostingReport(
    @Query('months') monthsInput: string | undefined,
    @Query('dateFrom') dateFromInput: string | undefined,
    @Query('dateTo') dateToInput: string | undefined,
    @Query('productId') productId: string | undefined,
    @Query('capacityId') capacityId: string | undefined,
    @Query('branchId') branchIdQuery: string | undefined,
    @Req() request: { user?: Record<string, unknown> },
  ) {
    const branchId = resolveBranchId(request, branchIdQuery);
    return this.serialNumberService.getLandCostingReport({
      monthsInput,
      dateFromInput,
      dateToInput,
      productIdInput: productId,
      capacityIdInput: capacityId,
      branchId,
    });
  }

  @Get('search-history')
  @UseGuards(JwtAuthGuard)
  async searchSerialHistory(@Query('serialNumber') serialNumber: string) {
    const sn = String(serialNumber ?? '').trim();
    if (!sn) {
      return { success: true, items: [] };
    }
    const items = await this.serialEventLogService.getHistoryBySerialNumber(sn);
    return { success: true, items };
  }

  @Get(':id/history')
  @UseGuards(JwtAuthGuard)
  async getSerialHistory(@Param('id') id: string) {
    const serialId = Number(id);
    if (!Number.isFinite(serialId) || serialId <= 0) {
      return { success: false, message: 'Invalid serial ID' };
    }
    const items = await this.serialEventLogService.getHistoryBySerialId(serialId);
    return { success: true, items };
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.serialNumberService.findOne(+id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateSerialNumberDto: UpdateSerialNumberDto) {
    return this.serialNumberService.update(+id, updateSerialNumberDto);
  }

  @Delete('in-stock')
  deleteInStockByScope(
    @Query('productId') productId: string,
    @Query('capacityId') capacityId: string,
    @Req() request: { user?: Record<string, unknown> },
  ) {
    const role = String(request.user?.roleName ?? '').trim().toLowerCase();
    if (role !== 'superadmin' && role !== 'super admin' && role !== 'admin') {
      return { success: false, message: 'Access denied. Admin or Super Admin role required.' };
    }
    return this.serialNumberService.deleteInStockByScope(productId, capacityId);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.serialNumberService.remove(+id);
  }
}
