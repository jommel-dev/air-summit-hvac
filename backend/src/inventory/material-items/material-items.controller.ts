import { Body, Controller, Delete, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { MaterialItemsService } from './material-items.service';

// TODO: Add your auth guard if necessary, e.g. JwtAuthGuard
// @UseGuards(JwtAuthGuard)
@Controller('material-items')
export class MaterialItemsController {
  constructor(private readonly service: MaterialItemsService) {}

  @Post()
  async addMaterial(@Body() dto: { code: string; name: string; unit?: string }) {
    return this.service.addMaterial(dto);
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
  ) {
    return this.service.updateMaterial(Number(id), dto);
  }

  @Delete(':id')
  async deleteMaterial(@Param('id') id: string) {
    return this.service.deleteMaterial(Number(id));
  }
}