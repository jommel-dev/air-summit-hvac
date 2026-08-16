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
import { CapacityService } from './capacity.service';
import { CreateCapacityDto } from './dto/create-capacity.dto';
import { UpdateCapacityDto } from './dto/update-capacity.dto';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { buildAuditContext } from 'src/common/utils/build-audit-context';

@Controller('capacity')
@UseGuards(JwtAuthGuard)
export class CapacityController {
  constructor(private readonly capacityService: CapacityService) {}

  @Post()
  create(
    @Body() createCapacityDto: CreateCapacityDto,
    @Req() request: { user?: Record<string, unknown>; ip?: string },
  ) {
    return this.capacityService.create(
      createCapacityDto,
      buildAuditContext(request),
    );
  }

  @Get()
  findAll() {
    return this.capacityService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.capacityService.findOne(+id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateCapacityDto: UpdateCapacityDto,
    @Req() request: { user?: Record<string, unknown>; ip?: string },
  ) {
    return this.capacityService.update(
      +id,
      updateCapacityDto,
      buildAuditContext(request),
    );
  }

  @Delete(':id')
  remove(
    @Param('id') id: string,
    @Req() request: { user?: Record<string, unknown>; ip?: string },
  ) {
    const userId = Number(request.user?.sub ?? request.user?.id);
    return this.capacityService.remove(
      +id,
      Number.isFinite(userId) ? userId : undefined,
      buildAuditContext(request),
    );
  }
}
