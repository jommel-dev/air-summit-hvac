export class CreatePurchaseVendorDto {
	name: string;
	address?: string;
	contact_person?: string;
	contact_number?: string;
}

export class CreatePurchasePaymentDetailsDto {
	method?: string;
	terms?: string;
	amount?: number;
	termsDueDate?: string | null;
	status?: 'unpaid' | 'paid' | 'partial' | 'overdue';
	paymentDate?: string | null;
	bankName?: string;
	referenceNo?: string;
	checkNo?: string;
	chequeDate?: string | null;
	issuedBy?: string;
	downPayment?: number;
}

export class CreatePurchaseUnitTypeQtyDto {
	unitType?: string;
	qty?: number;
	label?: string;
	value?: number;
}

export class CreatePurchaseProductItemDto {
	transType: 'purchase' | 'sales' | string;
	productId?: string | number;
	capacityId?: string | number;
	unitPrice?: string | number;
	sellPrice?: string | number;
	discountPrice?: string | number;
	unitTypesQty?: CreatePurchaseUnitTypeQtyDto[];
	serialNumbers?: Record<string, unknown>;
	totalSetQty?: number;
	purchaseId?: number | null;
	salesId?: number | null;
}

export class CreatePurchaseDto {
	poNumber?: string;
	vendorId?: string;
	vendor?: CreatePurchaseVendorDto;
	paymentDetails?:
		| CreatePurchasePaymentDetailsDto
		| CreatePurchasePaymentDetailsDto[];
	productItems: CreatePurchaseProductItemDto[];
	totalAmount?: number;
	status?: string;
	purchaseStatus?: string;
}
