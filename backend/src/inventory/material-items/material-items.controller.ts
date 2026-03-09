import { Body, Controller, Post } from '@nestjs/common';
import { MaterialItemsService } from './material-items.service';

@Controller('material-items')
export class MaterialItemsController {
  constructor(private readonly service: MaterialItemsService) {}

  @Post()
  async addMaterial(@Body() dto: { code: string; name: string; unit?: string }) {
    return this.service.addMaterial(dto);
  }
}
