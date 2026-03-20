export class CreateQuotationCustomerDto {
  name!: string;
  address?: string;
  contact_person?: string;
  contact_number?: string;
  email?: string;
  tin_number?: string;
}

export class QuotationTermsConditionsDto {
  warrantyException?: string;
  validity?: string;
  note?: string;
  penaltyFee?: string;
  warranty?: string;
}

export class CreateQuotationUnitTypeQtyDto {
  unitType?: string;
  qty?: number;
  label?: string;
  value?: number;
}

export class CreateQuotationProductItemDto {
  productId?: number | string;
  capacityId?: number | string;
  unitPrice?: number | string;
  sellPrice?: number | string;
  discountPrice?: number | string;
  unitTypesQty?: CreateQuotationUnitTypeQtyDto[];
  totalSetQty?: number;
  remarks?: string;
}

export class CreateQuotationDto {
  quoteNo?: string;
  quoteDate?: string;
  validityDays?: number;
  customer_id?: string | null;
  customer?: CreateQuotationCustomerDto;
  productItems!: CreateQuotationProductItemDto[];
  totalAmount?: number;
  remarks?: string;
  status?: string;
  termsConditions?: QuotationTermsConditionsDto;
}
