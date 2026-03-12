// Material transaction item entity - tracks material items in purchase/sales orders
export class MaterialTransaction {
  id: number;
  trans_type: 'purchase' | 'sales';
  material_id: number;
  quantity: number;
  unit_price: number;
  sell_price: number;
  discount_price: number;
  purchase_id?: number;
  sales_id?: number;
  created_at: Date;
}
