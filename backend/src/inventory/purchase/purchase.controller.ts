import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  Req,
} from '@nestjs/common';
import { PurchaseService } from './purchase.service';
import { CreatePurchaseDto } from './dto/create-purchase.dto';
import { UpdatePurchaseDto } from './dto/update-purchase.dto';
import { UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { ListPurchaseQueryDto } from './dto/list-purchase-query.dto';

@Controller('purchase')
@UseGuards(JwtAuthGuard)
export class PurchaseController {
  constructor(private readonly purchaseService: PurchaseService) {}

  @Post()
  async create(
    @Body() createPurchaseDto: CreatePurchaseDto,
    @Req() request: { user?: { sub?: unknown } },
  ) {
    try {
      const userId = Number(request.user?.sub);
      const normalizedUserId = Number.isFinite(userId) ? userId : undefined;

      return await this.purchaseService.create(createPurchaseDto, normalizedUserId);
    } catch (error) {
      return {
        success: false,
        message:
          error instanceof Error ? error.message : 'Failed to create purchase request',
      };
    }
  }

  @Get()
  findAll(@Query() query: ListPurchaseQueryDto) {
    return this.purchaseService.findAll(query);
  }

  @Get('deliveries')
  getDeliveries(@Query() query: ListPurchaseQueryDto) {
    return this.purchaseService.getDeliveries(query);
  }

  @Get('approvals')
  getApprovals(@Query() query: ListPurchaseQueryDto) {
    return this.purchaseService.getApprovals(query);
  }

  @Get('master-data')
  getMasterData(@Query() query: ListPurchaseQueryDto) {
    return this.purchaseService.getMasterData(query);
  }

  @Get('vendors/list')
  getVendors(@Query('search') search?: string) {
    return this.purchaseService.getVendors(search);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.purchaseService.findOne(+id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updatePurchaseDto: UpdatePurchaseDto,
    @Req() request: {
      user?: Record<string, unknown>;
      body?: unknown;
      headers?: Record<string, unknown>;
    },
  ) {
    let payload: UpdatePurchaseDto | undefined = updatePurchaseDto;

    if (!payload || (typeof payload === 'object' && Object.keys(payload).length === 0)) {
      const fallbackBody = request.body;

      if (typeof fallbackBody === 'string') {
        try {
          payload = JSON.parse(fallbackBody) as UpdatePurchaseDto;
        } catch {
          payload = undefined;
        }
      } else if (fallbackBody && typeof fallbackBody === 'object') {
        payload = fallbackBody as UpdatePurchaseDto;
      }
    }

    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      const contentType = String(request.headers?.['content-type'] ?? 'unknown');
      return {
        success: false,
        message: `Invalid request body. Send a JSON object with Content-Type application/json (received: ${contentType}).`,
      };
    }

    const userId = Number(request.user?.sub);
    const branchId = Number(
      request.user?.branchId ?? request.user?.branch_id ?? request.user?.branch,
    );

    return this.purchaseService.update(
      +id,
      payload,
      Number.isFinite(userId) ? userId : undefined,
      Number.isFinite(branchId) ? branchId : undefined,
    );
  }

  @Patch(':id/revert-in-progress')
  revertInProgress(
    @Param('id') id: string,
    @Req() request: { user?: { sub?: unknown } },
  ) {
    const userId = Number(request.user?.sub);
    return this.purchaseService.revertInProgress(
      +id,
      Number.isFinite(userId) ? userId : undefined,
    );
  }

  @Patch(':id/approve')
  approve(
    @Param('id') id: string,
    @Req() request: { user?: { sub?: unknown } },
  ) {
    const userId = Number(request.user?.sub);
    return this.purchaseService.approve(
      +id,
      Number.isFinite(userId) ? userId : undefined,
    );
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.purchaseService.remove(+id);
  }
}
