/**
 * =====================================================
 * MATERIALS SERVICE
 * =====================================================
 * Purpose: Business logic layer for material inventory management
 * 
 * This service handles:
 * 1. CRUD operations (Create, Read, Update, Delete)
 * 2. Stock management
 * 3. Price history tracking
 * 4. Brand filtering (only MAT type brands)
 * 
 * Database Table: tblmaterials
 * =====================================================
 */

import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../../database/database.service';
import { CreateMaterialDto } from './dto/create-material.dto';
import { UpdateMaterialDto } from './dto/update-material.dto';
import { Material } from './entities/material.entity';
import { AuditActorContext, AuditLogService } from 'src/audit-log/audit-log.service';

export type QueryClient = {
  query: (text: string, params?: unknown[]) => Promise<any>;
};

@Injectable()
export class MaterialsService {
  /**
   * Constructor - Inject DatabaseService for database operations
   * DatabaseService provides the PostgreSQL connection pool
   */
  constructor(
    private readonly db: DatabaseService,
    private readonly auditLogService: AuditLogService,
  ) {}

  /**
   * =====================================================
   * CREATE MATERIAL
   * =====================================================
   * Creates a new material in the inventory
   * 
   * Steps:
   * 1. Validate brand_id (must be MAT type if provided)
   * 2. Check for duplicate material_name
   * 3. Insert into tblmaterials
   * 4. Return created material with brand info
   * =====================================================
   */
  async create(
    createMaterialDto: CreateMaterialDto,
    userId: number,
    auditActor?: AuditActorContext,
  ): Promise<Material> {
    // Step 1: Validate brand if provided
    if (createMaterialDto.brand_id) {
      const brandCheck = await this.db.query(
        `SELECT id, type FROM tblbrands WHERE id = $1`,
        [createMaterialDto.brand_id]
      );

      if (brandCheck.rows.length === 0) {
        throw new NotFoundException(`Brand with ID ${createMaterialDto.brand_id} not found`);
      }

      // Ensure brand is of type 'MAT' (Material)
      if (brandCheck.rows[0].type !== 'MAT') {
        throw new BadRequestException('Selected brand is not a material brand. Please select a brand with type MAT.');
      }
    }

    // Step 2: Check for duplicate material name
    const duplicateCheck = await this.db.query(
      `SELECT id FROM tblmaterials WHERE material_name = $1 AND deleted_at IS NULL`,
      [createMaterialDto.material_name]
    );

    if (duplicateCheck.rows.length > 0) {
      throw new BadRequestException(`Material with name "${createMaterialDto.material_name}" already exists`);
    }

    // Step 3: Insert new material
    const insertQuery = `
      INSERT INTO tblmaterials (
        brand_id, material_name, material_code, description, unit,
        unit_price, sell_price, on_hand_stock, reorder_level, created_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `;

    const values = [
      createMaterialDto.brand_id || null,
      createMaterialDto.material_name,
      createMaterialDto.material_code || null,
      createMaterialDto.description || null,
      createMaterialDto.unit || 'PCS',
      createMaterialDto.unit_price || 0,
      createMaterialDto.sell_price || 0,
      createMaterialDto.on_hand_stock || 0,
      createMaterialDto.reorder_level || 0,
      userId
    ];

    const result = await this.db.query(insertQuery, values);
    const material = result.rows[0];

    // Step 4: Fetch with brand info and return
    const created = await this.findOne(material.id);
    await this.auditLogService.logMutation({
      action: 'MATERIAL_CREATE',
      entityType: 'material',
      entityId: created.id,
      actor: auditActor ?? { userId },
      description: `Created material ${created.material_name ?? created.id}`,
      requestBody: createMaterialDto as unknown as Record<string, unknown>,
      after: created as unknown as Record<string, unknown>,
    });
    return created;
  }

  /**
   * =====================================================
   * FIND ALL MATERIALS
   * =====================================================
   * Retrieves all materials with optional filtering
   * 
   * Features:
   * - Joins with tblbrands to get brand name
   * - Filters out soft-deleted materials
   * - Optional search by material name
   * - Optional filter by brand
   * - Ordered by material name
   * =====================================================
   */
  async findAll(search?: string, brandId?: number): Promise<Material[]> {
    let query = `
      SELECT 
        m.*,
        b."brandName" as brand_name
      FROM tblmaterials m
      LEFT JOIN tblbrands b ON m.brand_id = b.id
      WHERE m.deleted_at IS NULL
    `;

    const params: any[] = [];
    let paramIndex = 1;

    // Add search filter if provided
    if (search) {
      query += ` AND m.material_name ILIKE $${paramIndex}`;
      params.push(`%${search}%`);
      paramIndex++;
    }

    // Add brand filter if provided
    if (brandId) {
      query += ` AND m.brand_id = $${paramIndex}`;
      params.push(brandId);
      paramIndex++;
    }

    query += ` ORDER BY m.material_name ASC`;

    const result = await this.db.query(query, params);
    return result.rows;
  }

  /**
   * =====================================================
   * FIND ONE MATERIAL
   * =====================================================
   * Retrieves a single material by ID with brand info
   * 
   * Throws NotFoundException if material doesn't exist or is deleted
   * =====================================================
   */
  async findOne(id: number, options?: { client?: QueryClient }): Promise<Material> {
    const executor = options?.client ?? this.db;

    const query = `
      SELECT 
        m.*,
        b."brandName" as brand_name
      FROM tblmaterials m
      LEFT JOIN tblbrands b ON m.brand_id = b.id
      WHERE m.id = $1 AND m.deleted_at IS NULL
    `;

    const result = await executor.query(query, [id]);

    if (result.rows.length === 0) {
      throw new NotFoundException(`Material with ID ${id} not found`);
    }

    return result.rows[0];
  }

  /**
   * =====================================================
   * UPDATE MATERIAL
   * =====================================================
   * Updates an existing material
   * 
   * Steps:
   * 1. Check if material exists
   * 2. Validate brand if being changed
   * 3. Check for duplicate name if being changed
   * 4. Update material
   * 5. Track price history if prices changed
   * =====================================================
   */
  async update(
    id: number,
    updateMaterialDto: UpdateMaterialDto,
    userId: number,
    auditActor?: AuditActorContext,
  ): Promise<Material> {
    // Step 1: Check if material exists
    const before = await this.findOne(id);

    // Step 2: Validate brand if provided
    if (updateMaterialDto.brand_id) {
      const brandCheck = await this.db.query(
        `SELECT id, type FROM tblbrands WHERE id = $1`,
        [updateMaterialDto.brand_id]
      );

      if (brandCheck.rows.length === 0) {
        throw new NotFoundException(`Brand with ID ${updateMaterialDto.brand_id} not found`);
      }

      if (brandCheck.rows[0].type !== 'MAT') {
        throw new BadRequestException('Selected brand is not a material brand');
      }
    }

    // Step 3: Check for duplicate name if being changed
    if (updateMaterialDto.material_name) {
      const duplicateCheck = await this.db.query(
        `SELECT id FROM tblmaterials 
         WHERE material_name = $1 AND id != $2 AND deleted_at IS NULL`,
        [updateMaterialDto.material_name, id]
      );

      if (duplicateCheck.rows.length > 0) {
        throw new BadRequestException(`Material with name "${updateMaterialDto.material_name}" already exists`);
      }
    }

    // Step 4: Build dynamic update query
    const updateFields: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    // Helper function to add field to update
    const addField = (field: string, value: any) => {
      if (value !== undefined) {
        updateFields.push(`${field} = $${paramIndex}`);
        values.push(value);
        paramIndex++;
      }
    };

    addField('brand_id', updateMaterialDto.brand_id);
    addField('material_name', updateMaterialDto.material_name);
    addField('material_code', updateMaterialDto.material_code);
    addField('description', updateMaterialDto.description);
    addField('unit', updateMaterialDto.unit);
    addField('unit_price', updateMaterialDto.unit_price);
    addField('sell_price', updateMaterialDto.sell_price);
    addField('on_hand_stock', updateMaterialDto.on_hand_stock);
    addField('reorder_level', updateMaterialDto.reorder_level);
    
    // Always update these fields
    updateFields.push(`updated_at = NOW()`);
    updateFields.push(`updated_by = $${paramIndex}`);
    values.push(userId);
    paramIndex++;

    // Add ID for WHERE clause
    values.push(id);

    const updateQuery = `
      UPDATE tblmaterials
      SET ${updateFields.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING *
    `;

    await this.db.query(updateQuery, values);

    // Step 5: Track price history if prices changed
    if (updateMaterialDto.unit_price !== undefined || updateMaterialDto.sell_price !== undefined) {
      const material = await this.findOne(id);
      await this.trackPriceHistory(id, material.unit_price, material.sell_price, userId);
    }

    const updated = await this.findOne(id);
    await this.auditLogService.logMutation({
      action: 'MATERIAL_UPDATE',
      entityType: 'material',
      entityId: id,
      actor: auditActor ?? { userId },
      description: `Updated material ${updated.material_name ?? id}`,
      requestBody: updateMaterialDto as unknown as Record<string, unknown>,
      before: before as unknown as Record<string, unknown>,
      after: updated as unknown as Record<string, unknown>,
    });
    return updated;
  }

  /**
   * =====================================================
   * DELETE MATERIAL (Soft Delete)
   * =====================================================
   * Soft deletes a material (sets deleted_at timestamp)
   * 
   * Soft delete means the record stays in database but is marked as deleted
   * This preserves historical data and relationships
   * =====================================================
   */
  async remove(
    id: number,
    userId: number,
    auditActor?: AuditActorContext,
  ): Promise<void> {
    // Check if material exists
    const before = await this.findOne(id);

    // Soft delete by setting deleted_at
    const deleteQuery = `
      UPDATE tblmaterials
      SET deleted_at = NOW(), deleted_by = $1
      WHERE id = $2
    `;

    await this.db.query(deleteQuery, [userId, id]);

    await this.auditLogService.logMutation({
      action: 'MATERIAL_DELETE',
      entityType: 'material',
      entityId: id,
      actor: auditActor ?? { userId },
      description: `Deleted material ${before.material_name ?? id}`,
      before: before as unknown as Record<string, unknown>,
    });
  }

  /**
   * =====================================================
   * GET MATERIAL BRANDS
   * =====================================================
   * Retrieves all brands with type='MAT'
   * Used for dropdown/select options in the UI
   * =====================================================
   */
  async getMaterialBrands(): Promise<any[]> {
    const query = `
      SELECT id, "brandName", prefix
      FROM tblbrands
      WHERE type = 'MAT'
      ORDER BY "brandName" ASC
    `;

    const result = await this.db.query(query);
    return result.rows;
  }

  /**
   * =====================================================
   * GET LOW STOCK MATERIALS
   * =====================================================
   * Retrieves materials where on_hand_stock <= reorder_level
   * Used for inventory alerts and reorder notifications
   * =====================================================
   */
  async getLowStockMaterials(): Promise<Material[]> {
    const query = `
      SELECT 
        m.*,
        b."brandName" as brand_name
      FROM tblmaterials m
      LEFT JOIN tblbrands b ON m.brand_id = b.id
      WHERE m.deleted_at IS NULL 
        AND m.on_hand_stock <= m.reorder_level
      ORDER BY m.on_hand_stock ASC
    `;

    const result = await this.db.query(query);
    return result.rows;
  }

  /**
   * =====================================================
   * TRACK PRICE HISTORY
   * =====================================================
   * Records price changes in tblmaterial_price_history
   * Useful for:
   * - Price trend analysis
   * - Profit margin calculations
   * - Audit trail
   * =====================================================
   */
  private async trackPriceHistory(
    materialId: number,
    unitPrice: number,
    sellPrice: number,
    userId: number
  ): Promise<void> {
    const query = `
      INSERT INTO tblmaterial_price_history (
        material_id, unit_price, sell_price, created_by
      )
      VALUES ($1, $2, $3, $4)
    `;

    await this.db.query(query, [materialId, unitPrice, sellPrice, userId]);
  }

  /**
   * =====================================================
   * UPDATE STOCK
   * =====================================================
   * Updates material stock quantity
   * Used when:
   * - Purchase Order is approved (increase stock)
   * - Sales Order is completed (decrease stock)
   * 
   * @param materialId - Material ID
   * @param quantity - Quantity to add (positive) or subtract (negative)
   * @param userId - User making the change
   * =====================================================
   */
  async updateStock(
    materialId: number,
    quantity: number,
    userId: number | null | undefined,
    options?: { client?: QueryClient },
  ): Promise<Material> {
    const executor = options?.client ?? this.db;

    const material = await this.findOne(materialId, options);

    // `pg` returns BIGINT columns as strings; ensure numeric math is performed.
    const currentStock = Number(material.on_hand_stock ?? 0);
    if (!Number.isFinite(currentStock)) {
      throw new BadRequestException(`Invalid stock value for material ${materialId}`);
    }

    const newStock = currentStock + quantity;

    if (newStock < 0) {
      throw new BadRequestException(
        `Insufficient stock. Available: ${currentStock}, Requested: ${Math.abs(quantity)}`
      );
    }

    const updateQuery = `
      UPDATE tblmaterials
      SET on_hand_stock = $1, updated_at = NOW(), updated_by = $2
      WHERE id = $3
    `;

    await executor.query(updateQuery, [newStock, userId ?? null, materialId]);

    return this.findOne(materialId, options);
  }
}
