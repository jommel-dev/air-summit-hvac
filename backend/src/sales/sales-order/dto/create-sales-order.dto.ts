export class CreateSalesCustomerDto {
	name!: string;
	address?: string;
	contact_person?: string;
	contact_number?: string;
	email?: string;
	tin_number?: string;
}

export class CreateSalesPaymentDetailsDto {
	method?: string;
	amount?: number;
	terms?: string;
	termsDueDate?: string | null;
	status?: string;
	referenceNo?: string;
	paymentDate?: string | null;
	issuedBy?: string;
	ccCharge?: string;
	checkNo?: string;
	bankName?: string;
	bankAccount?: string;
	postDated?: string;
	downPayment?: number;
}

export class CreateSalesUnitTypeQtyDto {
	unitType?: string;
	qty?: number;
	label?: string;
	value?: number;
}

export class CreateSalesProductItemDto {
	transType: 'sales' | 'purchase' | string = 'sales';
	productId?: number | string;
	capacityId?: number | string;
	unitPrice?: number | string;
	sellPrice?: number | string;
	discountPrice?: number | string;
	unitTypesQty?: CreateSalesUnitTypeQtyDto[];
	totalSetQty?: number;
	purchaseId?: number | null;
	salesId?: number | null;
	serialNumbers?: Record<string, unknown>;
}

export class CreateSalesOrderDto {
	customer_id?: string | null;
	customer?: CreateSalesCustomerDto;
	paymentDetails?: CreateSalesPaymentDetailsDto | CreateSalesPaymentDetailsDto[];
	productItems!: CreateSalesProductItemDto[];
	so_number?: string;
	totalAmount?: number;
	scheduleDate?: string | null;
	salesType?: string;
	installer?: string;
	remarks?: string;
	status?: string;
}
