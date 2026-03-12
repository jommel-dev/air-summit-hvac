export class CreateMaterialTransactionDto {
  trans_type: 'purchase' | 'sales';
  material_id: number;
  quantity: number;
  unit_price?: number;
  sell_price?: number;
  discount_price?: number;
  purchase_id?: number;
  sales_id?: number;
}
