import { Controller, Get, Post, Body, Patch, Param, Delete, Query, Req } from '@nestjs/common';
import { VendorService } from './vendor.service';
import { CreateVendorDto } from './dto/create-vendor.dto';
import { UpdateVendorDto } from './dto/update-vendor.dto';
import { AuditActorContext } from 'src/audit-log/audit-log.service';

@Controller('vendor')
export class VendorController {
  constructor(private readonly vendorService: VendorService) {}

  private buildAuditContext(
    request: { user?: Record<string, unknown>; ip?: string },
  ): AuditActorContext {
    const userId = Number(request.user?.sub);
    const branchId = Number(
      request.user?.branchId ?? request.user?.branch_id ?? request.user?.branch,
    );

    return {
      userId: Number.isFinite(userId) ? userId : undefined,
      username: String(request.user?.username ?? '').trim() || undefined,
      roleName: String(request.user?.roleName ?? request.user?.role_name ?? '').trim() || undefined,
      branchId: Number.isFinite(branchId) ? branchId : undefined,
      ipAddress: String(request.ip ?? '').trim() || undefined,
    };
  }

  @Post()
  create(
    @Body() createVendorDto: CreateVendorDto,
    @Req() request: { user?: Record<string, unknown>; ip?: string },
  ) {
    return this.vendorService.create(createVendorDto, this.buildAuditContext(request));
  }

  @Get()
  findAll(
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.vendorService.findAll({
      search,
      page: Number(page ?? 1),
      limit: Number(limit ?? 50),
    });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.vendorService.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateVendorDto: UpdateVendorDto,
    @Req() request: { user?: Record<string, unknown>; ip?: string },
  ) {
    return this.vendorService.update(id, updateVendorDto, this.buildAuditContext(request));
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.vendorService.remove(id);
  }
}
