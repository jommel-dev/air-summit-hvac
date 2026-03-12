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
  findAll(@Query() query: ListSalesOrderQueryDto) {
    return this.salesOrderService.findAll(query);
  }

  @Get('deliveries')
  getDeliveries(@Query() query: ListSalesOrderQueryDto) {
    return this.salesOrderService.getDeliveries(query);
  }

  @Get('schedules')
  getSchedules(@Query() query: ListSalesOrderQueryDto) {
    return this.salesOrderService.getSchedules(query);
  }

  @Get('services')
  getServices(@Query() query: ListSalesOrderQueryDto) {
    return this.salesOrderService.getServices(query);
  }

  @Get('projects')
  getProjects(@Query() query: ListSalesOrderQueryDto) {
    return this.salesOrderService.getProjects(query);
  }

  @Get('distribution')
  getDistribution(@Query() query: ListSalesOrderQueryDto) {
    return this.salesOrderService.getDistribution(query);
  }

  @Get('sales-receivable')
  getSalesReceivable(@Query() query: ListSalesOrderQueryDto) {
    return this.salesOrderService.getSalesReceivable(query);
  }

  @Get('remitted-sales')
  getRemittedSales(@Query() query: ListSalesOrderQueryDto) {
    return this.salesOrderService.getRemittedSales(query);
  }

  @Get('approvals')
  getApprovals(@Query() query: ListSalesOrderQueryDto) {
    return this.salesOrderService.getApprovals(query);
  }

  @Get('master-data')
  getMasterData(@Query() query: ListSalesOrderQueryDto) {
    return this.salesOrderService.getMasterData(query);
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
