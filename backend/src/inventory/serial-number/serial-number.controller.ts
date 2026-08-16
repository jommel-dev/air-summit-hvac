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
import { CheckSerialsDto } from './dto/check-serials.dto';
import { ScanFileLoggerService } from './scan-file-logger.service';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { AuditActorContext } from 'src/audit-log/audit-log.service';
import { buildAuditContext } from 'src/common/utils/build-audit-context';
import { resolveBranchId } from 'src/common/utils/resolve-branch-id';
import { GlobalSearchResponse, BulkSearchResponse, BulkTransferResponse, BulkAssignOrderResponse } from './interfaces/global-search.interfaces';
import { BulkTransferDto } from './dto/bulk-transfer.dto';
import { BulkAssignOrderDto } from './dto/bulk-assign-order.dto';
import { BulkSearchDto } from './dto/bulk-search.dto';

@Controller('serial-number')
@UseGuards(JwtAuthGuard)
export class SerialNumberController {
  constructor(
    private readonly serialNumberService: SerialNumberService,
    private readonly serialEventLogService: SerialEventLogService,
    private readonly scanFileLogger: ScanFileLoggerService,
  ) {}

  private resolveAuditActor(
    request: { user?: Record<string, unknown>; ip?: string },
  ): AuditActorContext {
    return buildAuditContext(request);
  }

  @Post('insert-bulk')
  @UseGuards(JwtAuthGuard)
  insertBulk(
    @Body() body: { serials: Array<{ serialNumber: string; unitType?: string; status?: string; productId?: number; capacityId?: number }> },
    @Req() request: { user?: Record<string, unknown>; ip?: string },
  ) {
    const role = String(request.user?.roleName ?? '').trim().toLowerCase();
    if (role !== 'superadmin' && role !== 'super admin' && role !== 'admin') {
      return { success: false, message: 'Access denied. Admin or Super Admin role required.' };
    }
    return this.serialNumberService.insertBulk(
      body.serials,
      this.resolveAuditActor(request),
    );
  }

  @Post('csv-preview')
  csvPreview(
    @Body() body: { rows: Array<{ serialNumber: string; unitType?: string; status: string }>; productId?: number; capacityId?: number },
    @Req() request: { user?: Record<string, unknown> },
  ) {
    const role = String(request.user?.roleName ?? '').trim().toLowerCase();
    if (role !== 'superadmin' && role !== 'super admin' && role !== 'admin') {
      return { success: false, message: 'Access denied. Admin or Super Admin role required.' };
    }
    return this.serialNumberService.csvPreview(body.rows, body.productId, body.capacityId);
  }

  @Post('bulk-update-status')
  bulkUpdateStatus(
    @Body() body: { serialNumbers: string[]; status: string },
    @Req() request: { user?: Record<string, unknown>; ip?: string },
  ) {
    const role = String(request.user?.roleName ?? '').trim().toLowerCase();
    if (role !== 'superadmin' && role !== 'super admin' && role !== 'admin') {
      return { success: false, message: 'Access denied. Admin or Super Admin role required.' };
    }
    const userId = Number(request.user?.sub);
    const normalizedUserId = Number.isFinite(userId) ? userId : undefined;
    return this.serialNumberService.bulkUpdateStatus(
      body.serialNumbers,
      body.status,
      normalizedUserId,
      this.resolveAuditActor(request),
    );
  }

  @Post('bulk-reassign-capacity')
  bulkReassignCapacity(
    @Body() body: { serialNumbers: string[]; productId: number; capacityId: number },
    @Req() request: { user?: Record<string, unknown>; ip?: string },
  ) {
    const role = String(request.user?.roleName ?? '').trim().toLowerCase();
    if (role !== 'superadmin' && role !== 'super admin' && role !== 'admin') {
      return { success: false, message: 'Access denied. Admin or Super Admin role required.' };
    }
    return this.serialNumberService.bulkReassignCapacity(
      body.serialNumbers,
      body.productId,
      body.capacityId,
      this.resolveAuditActor(request),
    );
  }

  @Post('bulk-install-with-validation')
  bulkInstallWithValidation(
    @Body() body: { serialNumbers: string[] },
    @Req() request: { user?: Record<string, unknown>; ip?: string },
  ) {
    const role = String(request.user?.roleName ?? '').trim().toLowerCase();
    if (role !== 'superadmin' && role !== 'super admin' && role !== 'admin') {
      return { success: false, message: 'Access denied. Admin or Super Admin role required.' };
    }
    const userId = Number(request.user?.sub);
    const normalizedUserId = Number.isFinite(userId) ? userId : undefined;
    return this.serialNumberService.validateAndBulkInstall(
      body.serialNumbers,
      normalizedUserId,
      this.resolveAuditActor(request),
    );
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

  @Post('purchase-import/reassign-capacity')
  reassignCapacityForPurchaseImport(
    @Body()
    body: {
      purchaseId: number;
      serialNumbers: string[];
      productId: number;
      capacityId: number;
      unitType?: string;
    },
  ) {
    return this.serialNumberService.reassignCapacityForPurchaseImport(body);
  }

  @Post('remove-purchase-order')
  removePurchaseOrderSerial(
    @Body() dto: RemovePurchaseOrderSerialDto,
    @Req() request: { user?: Record<string, unknown>; ip?: string },
  ) {
    return this.serialNumberService.removePurchaseOrderSerial(
      dto,
      this.resolveAuditActor(request),
    );
  }

  @Post('remove-sales-order')
  removeSalesOrderSerial(
    @Body() dto: RemoveSalesOrderSerialDto,
    @Req() request: { user?: Record<string, unknown>; ip?: string },
  ) {
    return this.serialNumberService.removeSalesOrderSerial(
      dto,
      this.resolveAuditActor(request),
    );
  }

  @Post('normalize-unit-types')
  normalizeStoredUnitTypes() {
    return this.serialNumberService.normalizeStoredUnitTypes();
  }

  @Post('adjust-purchase-unit-types')
  adjustPurchaseUnitTypes(@Body() dto: AdjustPurchaseUnitTypesDto) {
    return this.serialNumberService.adjustPurchaseUnitTypes(dto);
  }

  @Post('check-serials')
  checkSerials(@Body() dto: CheckSerialsDto) {
    return this.serialNumberService.checkSerials(dto);
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

  @Get('global-search')
  async globalSearch(
    @Query('search') search: string,
    @Query('page') page: string,
    @Query('pageSize') pageSize: string,
  ): Promise<GlobalSearchResponse> {
    const pageNum = parseInt(page, 10) || 1;
    const pageSizeNum = parseInt(pageSize, 10) || 20;
    return this.serialNumberService.globalSearch({
      search: search ?? '',
      page: pageNum,
      pageSize: pageSizeNum,
    });
  }

  @Post('bulk-search')
  async bulkSearch(@Body() body: BulkSearchDto): Promise<BulkSearchResponse> {
    return this.serialNumberService.bulkSearch({
      serialNumbers: body.serialNumbers ?? [],
    });
  }

  @Post('bulk-transfer')
  async bulkTransfer(
    @Body() body: BulkTransferDto,
    @Req() request: { user?: Record<string, unknown>; ip?: string },
  ): Promise<BulkTransferResponse> {
    const actor = this.resolveAuditActor(request);
    return this.serialNumberService.bulkTransfer({
      serialIds: body.serialIds,
      targetProductId: body.targetProductId,
      targetCapacityId: body.targetCapacityId,
      reason: body.reason,
      performedBy: actor.userId ?? null,
      performedByUsername: actor.username ?? null,
      ipAddress: actor.ipAddress ?? null,
      auditActor: actor,
    });
  }

  @Post('bulk-assign-order')
  async bulkAssignOrder(
    @Body() body: BulkAssignOrderDto,
    @Req() request: { user?: Record<string, unknown>; ip?: string },
  ): Promise<BulkAssignOrderResponse> {
    const actor = this.resolveAuditActor(request);
    return this.serialNumberService.bulkAssignOrder({
      serialIds: body.serialIds,
      purchaseId: body.purchaseId,
      salesId: body.salesId,
      reason: body.reason,
      performedBy: actor.userId ?? null,
      performedByUsername: actor.username ?? null,
      ipAddress: actor.ipAddress ?? null,
      auditActor: actor,
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
    @Req() request: { user?: Record<string, unknown>; ip?: string },
  ) {
    const role = String(request.user?.roleName ?? '').trim().toLowerCase();
    if (role !== 'superadmin' && role !== 'super admin' && role !== 'admin') {
      return { success: false, message: 'Access denied. Admin or Super Admin role required.' };
    }
    return this.serialNumberService.deleteInStockByScope(
      productId,
      capacityId,
      this.resolveAuditActor(request),
    );
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.serialNumberService.remove(+id);
  }

  // --- Admin: Scan Log Viewer ---

  @Get('scan-logs')
  listScanLogs(@Req() request: { user?: Record<string, unknown> }) {
    const role = String(request.user?.roleName ?? '').trim().toLowerCase();
    if (role !== 'superadmin' && role !== 'super admin' && role !== 'admin') {
      return { success: false, message: 'Access denied.' };
    }
    return { success: true, files: this.scanFileLogger.listLogFiles() };
  }

  @Get('scan-logs/:date')
  getScanLog(@Param('date') date: string, @Req() request: { user?: Record<string, unknown> }) {
    const role = String(request.user?.roleName ?? '').trim().toLowerCase();
    if (role !== 'superadmin' && role !== 'super admin' && role !== 'admin') {
      return { success: false, message: 'Access denied.' };
    }
    // Validate date format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return { success: false, message: 'Invalid date format. Use YYYY-MM-DD.' };
    }
    const entries = this.scanFileLogger.readLogFile(date);
    return { success: true, date, totalEntries: entries.length, entries };
  }
}
