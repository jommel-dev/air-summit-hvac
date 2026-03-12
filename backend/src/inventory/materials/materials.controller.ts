/**
 * =====================================================
 * MATERIALS CONTROLLER
 * =====================================================
 * Purpose: HTTP REST API endpoints for material inventory management
 * 
 * This controller exposes the following endpoints:
 * - GET    /materials              - List all materials
 * - GET    /materials/brands       - Get material brands
 * - GET    /materials/low-stock    - Get low stock materials
 * - GET    /materials/:id          - Get single material
 * - POST   /materials              - Create new material
 * - PATCH  /materials/:id          - Update material
 * - DELETE /materials/:id          - Delete material
 * 
 * Base URL: /inventory/materials
 * =====================================================
 */

import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  ParseIntPipe,
  UseGuards,
  Request,
} from '@nestjs/common';
import { MaterialsService } from './materials.service';
import { CreateMaterialDto } from './dto/create-material.dto';
import { UpdateMaterialDto } from './dto/update-material.dto';

/**
 * @Controller decorator defines the base route
 * All endpoints in this controller will be prefixed with /inventory/materials
 */
@Controller('inventory/materials')
export class MaterialsController {
  /**
   * Constructor - Inject MaterialsService
   * The service contains all business logic
   */
  constructor(private readonly materialsService: MaterialsService) {}

  /**
   * =====================================================
   * CREATE MATERIAL
   * =====================================================
   * POST /inventory/materials
   * 
   * Request Body Example:
   * {
   *   "brand_id": 1,
   *   "material_name": "1/4 Copper Tube",
   *   "material_code": "CU-1/4",
   *   "description": "High quality copper tube",
   *   "unit": "METERS",
   *   "unit_price": 150.00,
   *   "sell_price": 200.00,
   *   "on_hand_stock": 100,
   *   "reorder_level": 20
   * }
   * 
   * Response: Created material object
   * =====================================================
   */
  @Post()
  async create(@Body() createMaterialDto: CreateMaterialDto, @Request() req: any) {
    // Extract user ID from request (set by auth middleware)
    const userId = req.user?.id || 1;
    
    return this.materialsService.create(createMaterialDto, userId);
  }

  /**
   * =====================================================
   * GET ALL MATERIALS
   * =====================================================
   * GET /inventory/materials?search=copper&brandId=1
   * 
   * Query Parameters:
   * - search (optional): Search by material name
   * - brandId (optional): Filter by brand ID
   * 
   * Response: Array of material objects
   * =====================================================
   */
  @Get()
  async findAll(
    @Query('search') search?: string,
    @Query('brandId', new ParseIntPipe({ optional: true })) brandId?: number,
  ) {
    return this.materialsService.findAll(search, brandId);
  }

  /**
   * =====================================================
   * GET MATERIAL BRANDS
   * =====================================================
   * GET /inventory/materials/brands
   * 
   * Returns all brands with type='MAT'
   * Used for dropdown options in the UI
   * 
   * Response Example:
   * [
   *   { "id": 1, "brandName": "Generic Materials", "prefix": "GEN" },
   *   { "id": 2, "brandName": "Premium Pipes Co.", "prefix": "PPC" }
   * ]
   * =====================================================
   */
  @Get('brands')
  async getMaterialBrands() {
    return this.materialsService.getMaterialBrands();
  }

  /**
   * =====================================================
   * GET LOW STOCK MATERIALS
   * =====================================================
   * GET /inventory/materials/low-stock
   * 
   * Returns materials where on_hand_stock <= reorder_level
   * Used for inventory alerts
   * 
   * Response: Array of material objects with low stock
   * =====================================================
   */
  @Get('low-stock')
  async getLowStockMaterials() {
    return this.materialsService.getLowStockMaterials();
  }

  /**
   * =====================================================
   * GET SINGLE MATERIAL
   * =====================================================
   * GET /inventory/materials/:id
   * 
   * Path Parameter:
   * - id: Material ID (number)
   * 
   * Response: Single material object
   * Throws 404 if not found
   * =====================================================
   */
  @Get(':id')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    return this.materialsService.findOne(id);
  }

  /**
   * =====================================================
   * UPDATE MATERIAL
   * =====================================================
   * PATCH /inventory/materials/:id
   * 
   * Path Parameter:
   * - id: Material ID (number)
   * 
   * Request Body: Partial material object (only fields to update)
   * Example:
   * {
   *   "sell_price": 220.00,
   *   "on_hand_stock": 150
   * }
   * 
   * Response: Updated material object
   * =====================================================
   */
  @Patch(':id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateMaterialDto: UpdateMaterialDto,
    @Request() req: any,
  ) {
    const userId = req.user?.id || 1;
    return this.materialsService.update(id, updateMaterialDto, userId);
  }

  /**
   * =====================================================
   * DELETE MATERIAL
   * =====================================================
   * DELETE /inventory/materials/:id
   * 
   * Path Parameter:
   * - id: Material ID (number)
   * 
   * Performs soft delete (sets deleted_at timestamp)
   * Response: Success message
   * =====================================================
   */
  @Delete(':id')
  async remove(@Param('id', ParseIntPipe) id: number, @Request() req: any) {
    const userId = req.user?.id || 1;
    await this.materialsService.remove(id, userId);
    
    return {
      success: true,
      message: 'Material deleted successfully',
    };
  }
}
