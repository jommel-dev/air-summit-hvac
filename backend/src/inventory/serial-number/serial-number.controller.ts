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

@Controller('serial-number')
@UseGuards(JwtAuthGuard)
export class SerialNumberController {
  constructor(private readonly serialNumberService: SerialNumberService) {}

  private resolveBranchId(
    request: { user?: Record<string, unknown> },
    branchIdQuery?: string,
  ): number | undefined {
    const branchIdFromToken = Number(
      request.user?.branchId ?? request.user?.branch_id ?? request.user?.branch,
    );
    const normalizedTokenBranchId =
      Number.isFinite(branchIdFromToken) && branchIdFromToken > 0
        ? branchIdFromToken
        : undefined;

    return normalizedTokenBranchId;
  }

  @Post('csv-preview')
  csvPreview(
    @Body() body: { rows: Array<{ serialNumber: string; status: string }> },
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
    @Req() request: { user?: { sub?: unknown } },
  ) {
    const userId = Number(request.user?.sub);
    const normalizedUserId = Number.isFinite(userId) ? userId : undefined;

    return this.serialNumberService.scanSalesOrder(dto, normalizedUserId);
  }

  @Post('scan-sales-order/batch')
  scanSalesOrderBatch(
    @Body() dto: ScanSalesOrderBatchDto,
    @Req() request: { user?: { sub?: unknown } },
  ) {
    const userId = Number(request.user?.sub);
    const normalizedUserId = Number.isFinite(userId) ? userId : undefined;

    return this.serialNumberService.scanSalesOrderBatch(dto, normalizedUserId);
  }

  @Post('scan-purchase-order')
  scanPurchaseOrder(
    @Body() dto: ScanPurchaseOrderDto,
    @Query('branchId') branchIdQuery: string | undefined,
    @Req() request: { user?: Record<string, unknown> },
  ) {
    const userId = Number(request.user?.sub);
    const normalizedUserId = Number.isFinite(userId) ? userId : undefined;
    const branchId = this.resolveBranchId(request, branchIdQuery);

    return this.serialNumberService.scanPurchaseOrder(dto, normalizedUserId, branchId);
  }

  @Post('scan-purchase-order/batch')
  scanPurchaseOrderBatch(
    @Body() dto: ScanPurchaseOrderBatchDto,
    @Query('branchId') branchIdQuery: string | undefined,
    @Req() request: { user?: Record<string, unknown> },
  ) {
    const userId = Number(request.user?.sub);
    const normalizedUserId = Number.isFinite(userId) ? userId : undefined;
    const branchId = this.resolveBranchId(request, branchIdQuery);

    return this.serialNumberService.scanPurchaseOrderBatch(dto, normalizedUserId, branchId);
  }

  @Post('remove-purchase-order')
  removePurchaseOrderSerial(@Body() dto: RemovePurchaseOrderSerialDto) {
    return this.serialNumberService.removePurchaseOrderSerial(dto);
  }

  @Post('remove-sales-order')
  removeSalesOrderSerial(@Body() dto: RemoveSalesOrderSerialDto) {
    return this.serialNumberService.removeSalesOrderSerial(dto);
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
    const branchId = this.resolveBranchId(request, branchIdQuery);

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
    const branchId = this.resolveBranchId(request, branchIdQuery);
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
    const branchId = this.resolveBranchId(request, branchIdQuery);
    return this.serialNumberService.getLandCostingReport({
      monthsInput,
      dateFromInput,
      dateToInput,
      productIdInput: productId,
      capacityIdInput: capacityId,
      branchId,
    });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.serialNumberService.findOne(+id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateSerialNumberDto: UpdateSerialNumberDto) {
    return this.serialNumberService.update(+id, updateSerialNumberDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.serialNumberService.remove(+id);
  }
}
