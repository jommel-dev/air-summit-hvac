export class PublicOrderFormProductItemDto {
  productId!: number;
  capacityId!: number;
  qty!: number;
  unitPrice?: number;
  sellPrice?: number;
  unitTypes?: string[];
}

export interface MiscItemPayload {
  category: string;
  itemName: string;
  description?: string;
  materialId?: number;
  quantity: number;
  unit: string;
  unitPrice: number;
  isInclusion: boolean;
}

export class PublicOrderFormDto {
  salesType!: 'sales' | 'service' | 'concern' | 'sub-dealer';
  scheduleDate!: string;
  customerName!: string;
  address?: string;
  contactNumber?: string;
  landmark?: string;
  paymentMethod!: string;
  productItems!: PublicOrderFormProductItemDto[];
  miscItems?: MiscItemPayload[];
}
