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
import { UpdateSalesOrderDto } from './dto/update-sales-order.dto';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { ListSalesOrderQueryDto } from './dto/list-sales-order-query.dto';

@Controller('sales-order')
@UseGuards(JwtAuthGuard)
export class SalesOrderController {
  constructor(private readonly salesOrderService: SalesOrderService) {}

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
}
