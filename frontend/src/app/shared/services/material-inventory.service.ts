/**
 * =====================================================
 * MATERIAL INVENTORY SERVICE
 * =====================================================
 * Purpose: Handle API calls for material inventory management
 *
 * This service communicates with backend /inventory/materials endpoints
 * =====================================================
 */

import { Injectable } from '@angular/core';
import { apiClient } from './api-client';

// Material interface matching backend entity
export interface Material {
  id: number;
  brand_id: number | null;
  material_name: string;
  material_code: string | null;
  description: string | null;
  unit: string;
  unit_price: number;
  sell_price: number;
  on_hand_stock: number;
  reorder_level: number;
  brand_name?: string;
  created_at: string;
  updated_at: string | null;
}

// Brand interface for material brands (type='MAT')
export interface MaterialBrand {
  id: number;
  brandName: string;
  prefix: string;
}

@Injectable({
  providedIn: 'root'
})
export class MaterialInventoryService {
  private baseUrl = '/inventory/materials';

  /**
   * Get all materials with optional filters
   */
  async getMaterials(search?: string, brandId?: number): Promise<Material[]> {
    const params: any = {};
    if (search) params.search = search;
     // only add when brandId is a real number
    if (typeof brandId === 'number' && !isNaN(brandId)) {
      params.brand_id = brandId; // also match backend expected snake_case
    }

    console.log('Fetching materials with params:', params, brandId);


    const response = await apiClient.get(this.baseUrl, { params });
    return response.data;
  }

  /**
   * Get single material by ID
   */
  async getMaterial(id: number): Promise<Material> {
    const response = await apiClient.get(`${this.baseUrl}/${id}`);
    return response.data;
  }

  /**
   * Get material brands (type='MAT')
   */
  async getMaterialBrands(): Promise<MaterialBrand[]> {
    const response = await apiClient.get(`${this.baseUrl}/brands`);
    return response.data;
  }

  /**
   * Get low stock materials
   */
  async getLowStockMaterials(): Promise<Material[]> {
    const response = await apiClient.get(`${this.baseUrl}/low-stock`);
    return response.data;
  }

  /**
   * Create new material
   */
  async createMaterial(data: Partial<Material>): Promise<Material> {
    const response = await apiClient.post(this.baseUrl, data);
    return response.data;
  }

  /**
   * Update material
   */
  async updateMaterial(id: number, data: Partial<Material>): Promise<Material> {
    const response = await apiClient.patch(`${this.baseUrl}/${id}`, data);
    return response.data;
  }

  /**
   * Create new brand
   */
  async createBrand(name: string, prefix?: string): Promise<void> {
    await apiClient.post('/brands', { name, prefix, type: 'MAT' });
  }
}
