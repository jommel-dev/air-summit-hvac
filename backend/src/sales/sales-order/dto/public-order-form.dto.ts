export class PublicOrderFormProductItemDto {
  productId!: number;
  capacityId!: number;
  qty!: number;
  unitPrice?: number;
  sellPrice?: number;
  unitTypes?: string[];
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
}
