import { Controller, Get, Post, Body, Patch, Param, Delete, Query, Req } from '@nestjs/common';
import { VendorService } from './vendor.service';
import { CreateVendorDto } from './dto/create-vendor.dto';
import { UpdateVendorDto } from './dto/update-vendor.dto';
import { buildAuditContext } from 'src/common/utils/build-audit-context';

@Controller('vendor')
export class VendorController {
  constructor(private readonly vendorService: VendorService) {}

  @Post()
  create(
    @Body() createVendorDto: CreateVendorDto,
    @Req() request: { user?: Record<string, unknown>; ip?: string },
  ) {
    return this.vendorService.create(createVendorDto, buildAuditContext(request));
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
    return this.vendorService.update(id, updateVendorDto, buildAuditContext(request));
  }

  @Delete(':id')
  remove(
    @Param('id') id: string,
    @Req() request: { user?: Record<string, unknown>; ip?: string },
  ) {
    return this.vendorService.remove(id, buildAuditContext(request));
  }
}
