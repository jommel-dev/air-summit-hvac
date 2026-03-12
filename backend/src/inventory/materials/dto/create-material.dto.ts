/**
 * =====================================================
 * CREATE MATERIAL DTO (Data Transfer Object)
 * =====================================================
 * Purpose: Defines the structure for creating a new material
 * 
 * DTOs are used to:
 * 1. Define expected request format
 * 2. Ensure type safety
 * 3. Document API contract
 * =====================================================
 */

export class CreateMaterialDto {
  /**
   * Brand ID - Must reference a brand with type='MAT'
   * Optional: Some materials might not have a specific brand
   */
  brand_id?: number;

  /**
   * Material name - Required and must be unique
   * Example: "1/4 Copper Tube"
   */
  material_name: string;

  /**
   * Material code - Optional SKU/code
   * Example: "CU-1/4"
   */
  material_code?: string;

  /**
   * Description - Optional additional details
   */
  description?: string;

  /**
   * Unit of measurement
   * Default: 'PCS' (pieces)
   * Common values: PCS, METERS, LITERS, KG, ROLLS, BOXES
   */
  unit?: string;

  /**
   * Unit price - Cost price
   * This is how much we buy it for
   */
  unit_price?: number;

  /**
   * Sell price - Selling price
   * This is how much we sell it for
   */
  sell_price?: number;

  /**
   * Initial stock quantity
   * Default: 0
   */
  on_hand_stock?: number;

  /**
   * Reorder level - Alert threshold
   * When stock falls below this, system alerts for reordering
   */
  reorder_level?: number;
}
