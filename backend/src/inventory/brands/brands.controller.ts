import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { BrandsService } from './brands.service';
import { CreateBrandDto } from './dto/create-brand.dto';
import { UpdateBrandDto } from './dto/update-brand.dto';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { buildAuditContext } from 'src/common/utils/build-audit-context';

@Controller('brands')
@UseGuards(JwtAuthGuard)
export class BrandsController {
  constructor(private readonly brandsService: BrandsService) {}

  @Post()
  create(
    @Body() createBrandDto: CreateBrandDto,
    @Req() request: { user?: Record<string, unknown>; ip?: string },
  ) {
    return this.brandsService.create(createBrandDto, buildAuditContext(request));
  }

  @Get()
  findAll() {
    return this.brandsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.brandsService.findOne(+id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateBrandDto: UpdateBrandDto,
    @Req() request: { user?: Record<string, unknown>; ip?: string },
  ) {
    return this.brandsService.update(+id, updateBrandDto, buildAuditContext(request));
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.brandsService.remove(+id);
  }
}
