/**
 * =====================================================
 * MATERIAL ENTITY
 * =====================================================
 * Purpose: Represents a material product in the inventory system
 * 
 * Materials are different from AC Units:
 * - AC Units have capacities and serial numbers
 * - Materials have quantities and stock levels
 * 
 * Examples: Pipes, wires, copper tubes, refrigerant, accessories
 * =====================================================
 */

export class Material {
  id: number;
  
  /**
   * Brand ID - Links to tblbrands with type='MAT'
   * This allows filtering material brands separately from AC unit brands
   */
  brand_id: number | null;
  
  /**
   * Material name - Unique identifier for the material
   * Example: "1/4 Copper Tube", "16mm PVC Pipe", "R410A Refrigerant"
   */
  material_name: string;
  
  /**
   * Material code - SKU or internal code for quick reference
   * Example: "CU-1/4", "PVC-16", "REF-410A"
   */
  material_code: string | null;
  
  /**
   * Description - Additional details about the material
   */
  description: string | null;
  
  /**
   * Unit of measurement
   * Common units: PCS (pieces), METERS, LITERS, KG (kilograms), ROLLS, BOXES
   */
  unit: string;
  
  /**
   * Unit price - Cost price (how much we buy it for)
   * Used for calculating profit margins
   */
  unit_price: number;
  
  /**
   * Sell price - Selling price (how much we sell it for)
   * This is what customers pay
   */
  sell_price: number;
  
  /**
   * On-hand stock - Current available quantity
   * This is updated when:
   * - Purchase Order is approved (increases)
   * - Sales Order is completed (decreases)
   */
  on_hand_stock: number;
  
  /**
   * Reorder level - Minimum stock threshold
   * When on_hand_stock falls below this, system alerts for reordering
   */
  reorder_level: number;
  
  // Audit fields
  created_at: Date;
  created_by: number | null;
  updated_at: Date | null;
  updated_by: number | null;
  deleted_at: Date | null;
  deleted_by: number | null;
  
  // Related data (joined from other tables)
  brand_name?: string; // From tblbrands
}
