import { Body, Controller, Delete, Get, Param, Post, Put, Req } from '@nestjs/common';
import { MaterialItemsService } from './material-items.service';
import { buildAuditContext } from 'src/common/utils/build-audit-context';

// TODO: Add your auth guard if necessary, e.g. JwtAuthGuard
// @UseGuards(JwtAuthGuard)
@Controller('material-items')
export class MaterialItemsController {
  constructor(private readonly service: MaterialItemsService) {}

  @Post()
  async addMaterial(
    @Body() dto: { code: string; name: string; unit?: string },
    @Req() request: { user?: Record<string, unknown>; ip?: string },
  ) {
    return this.service.addMaterial(dto, buildAuditContext(request));
  }

  @Get()
  async listMaterials() {
    return this.service.listMaterials();
  }

  @Get(':id')
  async getMaterial(@Param('id') id: string) {
    return this.service.getMaterial(Number(id));
  }

  @Put(':id')
  async updateMaterial(
    @Param('id') id: string,
    @Body() dto: { code?: string; name?: string; unit?: string },
    @Req() request: { user?: Record<string, unknown>; ip?: string },
  ) {
    return this.service.updateMaterial(Number(id), dto, buildAuditContext(request));
  }

  @Delete(':id')
  async deleteMaterial(
    @Param('id') id: string,
    @Req() request: { user?: Record<string, unknown>; ip?: string },
  ) {
    return this.service.deleteMaterial(Number(id), buildAuditContext(request));
  }
}
