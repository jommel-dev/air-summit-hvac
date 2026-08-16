import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Query,
  Req,
} from '@nestjs/common';
import { PurchaseService } from './purchase.service';
import { CreatePurchaseDto } from './dto/create-purchase.dto';
import { UpdatePurchaseDto } from './dto/update-purchase.dto';
import { UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { resolveBranchId } from 'src/common/utils/resolve-branch-id';
import { ListPurchaseQueryDto } from './dto/list-purchase-query.dto';
import { DeletePurchaseWithAuthDto } from './dto/delete-purchase-with-auth.dto';
import { AuditActorContext } from 'src/audit-log/audit-log.service';
import { buildAuditContext } from 'src/common/utils/build-audit-context';

@Controller('purchase')
@UseGuards(JwtAuthGuard)
export class PurchaseController {
  constructor(private readonly purchaseService: PurchaseService) {}

  private buildAuditContext(
    request: { user?: Record<string, unknown>; ip?: string },
  ): AuditActorContext {
    return buildAuditContext(request);
  }

  private withEffectiveBranchScope(
    query: ListPurchaseQueryDto,
    request: { user?: Record<string, unknown> },
  ): ListPurchaseQueryDto {
    const branchId = resolveBranchId(request, query.branchId ?? undefined);

    return {
      ...query,
      branchId: branchId !== undefined && Number.isFinite(branchId) && branchId > 0
        ? branchId
        : undefined,
    };
  }

  @Post()
  async create(
    @Body() createPurchaseDto: CreatePurchaseDto,
    @Req() request: { user?: Record<string, unknown> },
  ) {
    try {
      const userId = Number(request.user?.sub);
      const normalizedUserId = Number.isFinite(userId) ? userId : undefined;
      const branchId = Number(
        request.user?.branchId ?? request.user?.branch_id ?? request.user?.branch,
      );
      const normalizedBranchId =
        Number.isFinite(branchId) && branchId > 0 ? branchId : undefined;

      return await this.purchaseService.create(
        createPurchaseDto,
        normalizedUserId,
        normalizedBranchId,
        this.buildAuditContext(request),
      );
    } catch (error) {
      return {
        success: false,
        message:
          error instanceof Error ? error.message : 'Failed to create purchase request',
      };
    }
  }

  @Get()
  findAll(
    @Query() query: ListPurchaseQueryDto,
    @Req() request: { user?: Record<string, unknown> },
  ) {
    return this.purchaseService.findAll(this.withEffectiveBranchScope(query, request));
  }

  @Get('deliveries')
  getDeliveries(
    @Query() query: ListPurchaseQueryDto,
    @Req() request: { user?: Record<string, unknown> },
  ) {
    return this.purchaseService.getDeliveries(this.withEffectiveBranchScope(query, request));
  }

  @Get('approvals')
  getApprovals(
    @Query() query: ListPurchaseQueryDto,
    @Req() request: { user?: Record<string, unknown> },
  ) {
    return this.purchaseService.getApprovals(this.withEffectiveBranchScope(query, request));
  }

  @Get('master-data')
  getMasterData(
    @Query() query: ListPurchaseQueryDto,
    @Req() request: { user?: Record<string, unknown> },
  ) {
    return this.purchaseService.getMasterData(this.withEffectiveBranchScope(query, request));
  }

  @Get('vendors/list')
  getVendors(@Query('search') search?: string) {
    return this.purchaseService.getVendors(search);
  }

  @Get(':id')
  findOne(
    @Param('id') id: string,
    @Query('includeInstalled') includeInstalled?: string,
    @Query('preferPoLinkedSerials') preferPoLinkedSerials?: string,
  ) {
    const shouldIncludeInstalled =
      String(includeInstalled ?? '').trim().toLowerCase() === 'true';
    const shouldPreferPoLinkedSerials =
      String(preferPoLinkedSerials ?? '').trim().toLowerCase() === 'true';
    return this.purchaseService.findOne(+id, {
      includeInstalled: shouldIncludeInstalled,
      preferPoLinkedSerials: shouldPreferPoLinkedSerials,
    });
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
      this.buildAuditContext(request),
    );
  }

  @Patch(':id/revert-in-progress')
  revertInProgress(
    @Param('id') id: string,
    @Req() request: { user?: Record<string, unknown>; ip?: string },
  ) {
    const userId = Number(request.user?.sub);
    return this.purchaseService.revertInProgress(
      +id,
      Number.isFinite(userId) ? userId : undefined,
      this.buildAuditContext(request),
    );
  }

  @Patch(':id/revert-deliveries')
  revertDeliveries(
    @Param('id') id: string,
    @Req() request: { user?: Record<string, unknown>; ip?: string },
  ) {
    const userId = Number(request.user?.sub);
    return this.purchaseService.revertToDeliveries(
      +id,
      Number.isFinite(userId) ? userId : undefined,
      this.buildAuditContext(request),
    );
  }

  @Patch(':id/verify-receive')
  verifyAndReceive(
    @Param('id') id: string,
    @Req() request: { user?: Record<string, unknown>; ip?: string },
  ) {
    const userId = Number(request.user?.sub);
    return this.purchaseService.verifyAndReceive(
      +id,
      Number.isFinite(userId) ? userId : undefined,
      this.buildAuditContext(request),
    );
  }

  @Patch(':id/approve')
  approve(
    @Param('id') id: string,
    @Req() request: { user?: Record<string, unknown>; ip?: string },
  ) {
    const userId = Number(request.user?.sub);
    return this.purchaseService.approve(
      +id,
      Number.isFinite(userId) ? userId : undefined,
      this.buildAuditContext(request),
    );
  }

  @Patch(':id/cancel')
  cancelPurchase(
    @Param('id') id: string,
    @Req() request: { user?: Record<string, unknown> },
  ) {
    const userId = Number(request.user?.sub);
    const username = String(request.user?.username ?? '').trim();
    const roleName = String(
      request.user?.roleName ?? request.user?.role_name ?? '',
    ).trim();
    const branchId = Number(
      request.user?.branchId ?? request.user?.branch_id ?? request.user?.branch,
    );

    return this.purchaseService.cancelPurchase(+id, {
      userId: Number.isFinite(userId) ? userId : undefined,
      username: username || undefined,
      roleName: roleName || undefined,
      branchId: Number.isFinite(branchId) ? branchId : undefined,
    });
  }

  @Post(':id/delete-authorized')
  removeWithAuth(
    @Param('id') id: string,
    @Body() body: DeletePurchaseWithAuthDto,
    @Req() request: { user?: Record<string, unknown> },
  ) {
    const userId = Number(request.user?.sub);
    const roleName = String(
      request.user?.roleName ?? request.user?.role_name ?? '',
    ).trim();
    const username = String(request.user?.username ?? '').trim();
    const branchId = Number(
      request.user?.branchId ?? request.user?.branch_id ?? request.user?.branch,
    );

    return this.purchaseService.deletePurchaseWithAuth(
      +id,
      Number.isFinite(userId) ? userId : 0,
      roleName,
      username,
      String(body?.password ?? ''),
      String(body?.authUsername ?? '').trim() || undefined,
      Number.isFinite(branchId) ? branchId : undefined,
    );
  }

  @Post(':id/product-item')
  async addProductItem(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @Req() request: { user?: Record<string, unknown>; ip?: string },
  ) {
    const userId = Number(request.user?.sub);
    return this.purchaseService.addProductItem(
      +id,
      {
        productId: Number(body.productId),
        capacityId: Number(body.capacityId),
        unitPrice: body.unitPrice !== undefined ? Number(body.unitPrice) : undefined,
        sellPrice: body.sellPrice !== undefined ? Number(body.sellPrice) : undefined,
        discountPrice: body.discountPrice !== undefined ? Number(body.discountPrice) : undefined,
        totalSetQty: body.totalSetQty !== undefined ? Number(body.totalSetQty) : undefined,
        unitTypesQty: Array.isArray(body.unitTypesQty) ? body.unitTypesQty as Array<{ label: string; value: number }> : undefined,
        scannedSerials:
          body.scannedSerials && typeof body.scannedSerials === 'object'
            ? (body.scannedSerials as Record<string, unknown>)
            : undefined,
      },
      Number.isFinite(userId) ? userId : undefined,
      this.buildAuditContext(request),
    );
  }

  @Patch(':id/update-product-item')
  async updateProductItem(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @Req() request: { user?: Record<string, unknown>; ip?: string },
  ) {
    const userId = Number(request.user?.sub);
    return this.purchaseService.updateProductItem(
      +id,
      {
        oldProductId: Number(body.oldProductId),
        oldCapacityId: Number(body.oldCapacityId),
        productId: Number(body.productId),
        capacityId: Number(body.capacityId),
        unitPrice: body.unitPrice !== undefined ? Number(body.unitPrice) : undefined,
        sellPrice: body.sellPrice !== undefined ? Number(body.sellPrice) : undefined,
        discountPrice: body.discountPrice !== undefined ? Number(body.discountPrice) : undefined,
        totalSetQty: body.totalSetQty !== undefined ? Number(body.totalSetQty) : undefined,
        unitTypesQty: Array.isArray(body.unitTypesQty) ? body.unitTypesQty as Array<{ label: string; value: number }> : undefined,
        scannedSerials:
          body.scannedSerials && typeof body.scannedSerials === 'object'
            ? (body.scannedSerials as Record<string, unknown>)
            : undefined,
      },
      Number.isFinite(userId) ? userId : undefined,
      this.buildAuditContext(request),
    );
  }

  @Patch(':id/update-serials-assignment')
  async updateSerialsAssignment(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @Req() request: { user?: Record<string, unknown>; ip?: string },
  ) {
    return this.purchaseService.updateSerialsAssignment(
      +id,
      {
        oldProductId: body.oldProductId !== undefined ? Number(body.oldProductId) : null,
        oldCapacityId: body.oldCapacityId !== undefined ? Number(body.oldCapacityId) : null,
        newProductId: Number(body.newProductId),
        newCapacityId: Number(body.newCapacityId),
      },
      this.buildAuditContext(request),
    );
  }

  @Post(':id/remove-product-item')
  async removeProductItem(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @Req() request: { user?: Record<string, unknown>; ip?: string },
  ) {
    return this.purchaseService.removeProductItem(
      +id,
      {
        productId: Number(body.productId),
        capacityId: Number(body.capacityId),
      },
      this.buildAuditContext(request),
    );
  }
}
