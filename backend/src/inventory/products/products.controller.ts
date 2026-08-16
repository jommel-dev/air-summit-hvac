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
import { Request } from 'express';
import { ProductsService } from './products.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { buildAuditContext } from 'src/common/utils/build-audit-context';

type AuthenticatedRequest = Request & {
  user?: {
    sub?: number | string;
    username?: string;
    roleName?: string;
    role_name?: string;
    branchId?: number | string;
    branch_id?: number | string;
    branch?: number | string;
  };
};

@Controller('products')
@UseGuards(JwtAuthGuard)
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Post()
  create(
    @Body() createProductDto: CreateProductDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const userId = Number(request.user?.sub);
    return this.productsService.create(
      createProductDto,
      userId,
      buildAuditContext(request),
    );
  }

  @Get()
  findAll() {
    return this.productsService.findAll();
  }

  @Get('pending-catalog-alerts')
  findPendingCatalogAlerts() {
    return this.productsService.findPendingCatalogAlerts();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.productsService.findOne(+id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateProductDto: UpdateProductDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.productsService.update(
      +id,
      updateProductDto,
      buildAuditContext(request),
    );
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    const userId = Number(request.user?.sub);
    return this.productsService.remove(
      +id,
      Number.isFinite(userId) ? userId : undefined,
      buildAuditContext(request),
    );
  }
}
