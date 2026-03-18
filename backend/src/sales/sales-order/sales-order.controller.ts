import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Patch,
  Param,
  Delete,
  Req,
  Query,
  UseGuards,
} from '@nestjs/common';
import { SalesOrderService } from './sales-order.service';
import { CreateSalesOrderDto } from './dto/create-sales-order.dto';
import { CreateStatementOfAccountDto } from './dto/create-statement-of-account.dto';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { UpdateSalesOrderDto } from './dto/update-sales-order.dto';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { ListSalesOrderQueryDto } from './dto/list-sales-order-query.dto';
import { AddMaterialItemDto } from './dto/add-material-item.dto';
import { MaterialTransactionsService } from 'src/inventory/material-transactions/material-transactions.service';

@Controller('sales-order')
@UseGuards(JwtAuthGuard)
export class SalesOrderController {
  constructor(
    private readonly salesOrderService: SalesOrderService,
    private readonly materialTransactionsService: MaterialTransactionsService,
  ) {}

  private withEffectiveBranchScope(
    query: ListSalesOrderQueryDto,
    request: { user?: Record<string, unknown> },
  ): ListSalesOrderQueryDto {
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
    @Body() createSalesOrderDto: CreateSalesOrderDto,
    @Req() request: { user?: Record<string, unknown> },
  ) {
    const userId = Number(request.user?.sub);
    const branchId = Number(
      request.user?.branchId ?? request.user?.branch_id ?? request.user?.branch,
    );

    return this.salesOrderService.create(
      createSalesOrderDto,
      Number.isFinite(userId) ? userId : undefined,
      Number.isFinite(branchId) ? branchId : undefined,
    );
  }

  @Get()
  findAll(
    @Query() query: ListSalesOrderQueryDto,
    @Req() request: { user?: Record<string, unknown> },
  ) {
    return this.salesOrderService.findAll(this.withEffectiveBranchScope(query, request));
  }

  @Get('deliveries')
  getDeliveries(
    @Query() query: ListSalesOrderQueryDto,
    @Req() request: { user?: Record<string, unknown> },
  ) {
    return this.salesOrderService.getDeliveries(this.withEffectiveBranchScope(query, request));
  }

  @Get('schedules')
  getSchedules(
    @Query() query: ListSalesOrderQueryDto,
    @Req() request: { user?: Record<string, unknown> },
  ) {
    return this.salesOrderService.getSchedules(this.withEffectiveBranchScope(query, request));
  }

  @Get('services')
  getServices(
    @Query() query: ListSalesOrderQueryDto,
    @Req() request: { user?: Record<string, unknown> },
  ) {
    return this.salesOrderService.getServices(this.withEffectiveBranchScope(query, request));
  }

  @Get('projects')
  getProjects(
    @Query() query: ListSalesOrderQueryDto,
    @Req() request: { user?: Record<string, unknown> },
  ) {
    return this.salesOrderService.getProjects(this.withEffectiveBranchScope(query, request));
  }

  @Get('distribution')
  getDistribution(
    @Query() query: ListSalesOrderQueryDto,
    @Req() request: { user?: Record<string, unknown> },
  ) {
    return this.salesOrderService.getDistribution(this.withEffectiveBranchScope(query, request));
  }

  @Get('sales-receivable')
  getSalesReceivable(
    @Query() query: ListSalesOrderQueryDto,
    @Req() request: { user?: Record<string, unknown> },
  ) {
    return this.salesOrderService.getSalesReceivable(this.withEffectiveBranchScope(query, request));
  }

  @Get('remitted-sales')
  getRemittedSales(
    @Query() query: ListSalesOrderQueryDto,
    @Req() request: { user?: Record<string, unknown> },
  ) {
    return this.salesOrderService.getRemittedSales(this.withEffectiveBranchScope(query, request));
  }

  @Get('approvals')
  getApprovals(
    @Query() query: ListSalesOrderQueryDto,
    @Req() request: { user?: Record<string, unknown> },
  ) {
    return this.salesOrderService.getApprovals(this.withEffectiveBranchScope(query, request));
  }

  @Get('master-data')
  getMasterData(
    @Query() query: ListSalesOrderQueryDto,
    @Req() request: { user?: Record<string, unknown> },
  ) {
    return this.salesOrderService.getMasterData(this.withEffectiveBranchScope(query, request));
  }

  @Get('customers/list')
  getCustomers(@Query('search') search?: string) {
    return this.salesOrderService.getCustomers(search);
  }

  @Get('customers')
  listCustomers(
    @Query('search') search?: string,
    @Query('type') type?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.salesOrderService.listCustomers({
      search,
      type,
      page: Number(page ?? 1),
      limit: Number(limit ?? 50),
    });
  }

  @Get('customers/:id')
  getCustomer(@Param('id') id: string) {
    return this.salesOrderService.getCustomer(String(id));
  }

  @Post('customers')
  createCustomer(
    @Body() createCustomerDto: CreateCustomerDto,
    @Req() request: { user?: Record<string, unknown> },
  ) {
    const userId = Number(request.user?.sub);
    return this.salesOrderService.createCustomer(
      createCustomerDto,
      Number.isFinite(userId) ? userId : undefined,
    );
  }

  @Patch('customers/:id')
  updateCustomer(
    @Param('id') id: string,
    @Body() updateCustomerDto: UpdateCustomerDto,
  ) {
    return this.salesOrderService.updateCustomer(String(id), updateCustomerDto);
  }

  @Delete('customers/:id')
  deleteCustomer(@Param('id') id: string) {
    return this.salesOrderService.deleteCustomer(String(id));
  }

  @Get('customers/:id/orders')
  getCustomerOrders(
    @Param('id') id: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.salesOrderService.getCustomerOrders(String(id), {
      page: Number(page ?? 1),
      limit: Number(limit ?? 50),
    });
  }

  @Get('customers/:id/payments')
  getCustomerPayments(@Param('id') id: string) {
    return this.salesOrderService.getCustomerPayments(String(id));
  }

  @Get('customers/:id/concerns')
  getCustomerConcerns(@Param('id') id: string) {
    return this.salesOrderService.getCustomerConcerns(String(id));
  }

  @Get('customers/:id/statement-of-account')
  getCustomerStatementOfAccounts(
    @Param('id') id: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.salesOrderService.getCustomerStatementOfAccounts(String(id), {
      page: Number(page ?? 1),
      limit: Number(limit ?? 50),
    });
  }

  @Post('customers/:id/statement-of-account')
  createCustomerStatementOfAccount(
    @Param('id') id: string,
    @Body() dto: CreateStatementOfAccountDto,
    @Req() request: { user?: Record<string, unknown> },
  ) {
    const userId = Number(request.user?.sub);
    return this.salesOrderService.createStatementOfAccountForCustomer(
      String(id),
      dto,
      Number.isFinite(userId) ? userId : undefined,
    );
  }

  @Get('branches')
  getBranches() {
    return this.salesOrderService.getBranches();
  }

  @Post('branches')
  createBranch(@Body() body: { branchName?: string; branchAddress?: string | null }) {
    return this.salesOrderService.createBranch(body.branchName, body.branchAddress);
  }

  @Put('branches/:id')
  updateBranch(
    @Param('id') id: string,
    @Body() body: { branchName?: string; branchAddress?: string | null },
  ) {
    return this.salesOrderService.updateBranch(+id, body.branchName, body.branchAddress);
  }

  @Delete('branches/:id')
  deleteBranch(@Param('id') id: string) {
    return this.salesOrderService.deleteBranch(+id);
  }

  @Post(':id/statement-of-account')
  createStatementOfAccount(
    @Param('id') id: string,
    @Body() dto: CreateStatementOfAccountDto,
    @Req() request: { user?: Record<string, unknown> },
  ) {
    const userId = Number(request.user?.sub);
    return this.salesOrderService.createStatementOfAccount(
      +id,
      dto,
      Number.isFinite(userId) ? userId : undefined,
    );
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.salesOrderService.findOne(+id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateSalesOrderDto: UpdateSalesOrderDto,
    @Req() request: { user?: Record<string, unknown> },
  ) {
    const userId = Number(request.user?.sub);
    const branchId = Number(
      request.user?.branchId ?? request.user?.branch_id ?? request.user?.branch,
    );

    return this.salesOrderService.update(
      +id,
      updateSalesOrderDto,
      Number.isFinite(userId) ? userId : undefined,
      Number.isFinite(branchId) ? branchId : undefined,
    );
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.salesOrderService.remove(+id);
  }

  // Material items endpoints
  @Post(':id/materials')
  async addMaterialItem(
    @Param('id') id: string,
    @Body() dto: AddMaterialItemDto | AddMaterialItemDto[],
  ) {
    const payloads = Array.isArray(dto) ? dto : [dto];

    const transformed = payloads.map((item) => ({
      trans_type: 'sales' as const,
      sales_id: +id,
      material_id: item.material_id,
      quantity: item.quantity,
      unit_price: item.unit_price,
      sell_price: item.sell_price,
      discount_price: item.discount_price,
    }));

    if (transformed.length === 1) {
      return this.materialTransactionsService.create(transformed[0]);
    }

    return this.materialTransactionsService.createMany(transformed);
  }

  @Get(':id/materials')
  getMaterialItems(@Param('id') id: string) {
    return this.materialTransactionsService.findBySalesId(+id);
  }

  @Delete(':id/materials/:materialItemId')
  removeMaterialItem(@Param('materialItemId') materialItemId: string) {
    return this.materialTransactionsService.remove(+materialItemId);
  }
}
