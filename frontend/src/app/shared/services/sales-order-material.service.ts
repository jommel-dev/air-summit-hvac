import { Injectable } from '@angular/core';
import { apiClient } from './api-client';

export interface MaterialTransactionItem {
  id: number;
  trans_type: 'purchase' | 'sales';
  material_id: number;
  material_name?: string;
  material_code?: string;
  unit?: string;
  quantity: number;
  unit_price: number;
  sell_price: number;
  discount_price: number;
  purchase_id?: number;
  sales_id?: number;
  created_at: string;
}

export interface AddMaterialItemDto {
  material_id: number;
  quantity: number;
  unit_price?: number;
  sell_price?: number;
  discount_price?: number;
}

@Injectable({
  providedIn: 'root'
})
export class SalesOrderMaterialService {
  // Add material item to sales order
  async addMaterialItem(
    salesOrderId: number,
    dto: AddMaterialItemDto,
  ): Promise<MaterialTransactionItem> {
    const response = await apiClient.post<MaterialTransactionItem>(
      `/sales-order/${salesOrderId}/materials`,
      dto,
    );
    return response.data;
  }

  async addMaterialItems(
    salesOrderId: number,
    dtos: AddMaterialItemDto[],
  ): Promise<MaterialTransactionItem[]> {
    const response = await apiClient.post<MaterialTransactionItem[]>(
      `/sales-order/${salesOrderId}/materials`,
      dtos,
    );
    return response.data;
  }

  // Get all material items for a sales order
  async getMaterialItems(salesOrderId: number): Promise<MaterialTransactionItem[]> {
    const response = await apiClient.get<MaterialTransactionItem[]>(
      `/sales-order/${salesOrderId}/materials`,
    );
    return response.data;
  }

  // Remove material item from sales order
  async removeMaterialItem(salesOrderId: number, materialItemId: number): Promise<any> {
    const response = await apiClient.delete(
      `/sales-order/${salesOrderId}/materials/${materialItemId}`,
    );
    return response.data;
  }
}
