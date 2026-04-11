export class CreateSalesCustomerDto {
	name!: string;
	customer_type?: 'regular' | 'sub_dealer';
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

export class CreateSalesOrderServiceDetailDto {
	serviceName?: string;
	serviceDescription?: string;
	serviceType?: string;
	technicianAssigned?: string;
	serviceDate?: string | null;
	serviceDurationHours?: number;
	serviceCost?: number;
	partsCost?: number;
	laborCost?: number;
	serviceStatus?: string;
	serviceNotes?: string;
}

export class CreateSalesOrderProjectDetailDto {
	projectName?: string;
	projectCode?: string;
	projectLocation?: string;
	projectStartDate?: string | null;
	projectEndDate?: string | null;
	projectManager?: string;
	projectStatus?: string;
	projectNotes?: string;
}

export class CreateSalesOrderTransferDetailDto {
	fromBranchId?: number;
	toBranchId?: number;
	transferDate?: string | null;
	expectedDeliveryDate?: string | null;
	actualDeliveryDate?: string | null;
	transferStatus?: string;
	transferNotes?: string;
	sentBy?: number;
	receivedBy?: number;
	acknowledgedBy?: number;
	acknowledgedAt?: string | null;
}

export class CreateSalesOrderExpenseDetailDto {
	expenseType?: string;
	expenseDescription?: string;
	amount?: number;
	expenseDate?: string | null;
	paidTo?: string;
	paymentMethod?: string;
	referenceNo?: string;
}

export class CreateSalesOrderConcernDetailDto {
	customerId?: string;
	concernType?: string;
	concernSubject?: string;
	concernDescription?: string;
	concernStatus?: string;
	priority?: string;
	assignedTo?: number;
	resolutionNotes?: string;
	resolvedAt?: string | null;
}

export class CreateSalesOrderReturnedSerialDetailDto {
	isDefective?: boolean;
	defectReason?: string;
	defectDate?: string | null;
	serialNumbers?: string[];
}

export class CreateSalesOrderDto {
	customer_id?: string | null;
	customer?: CreateSalesCustomerDto;
	paymentDetails?: CreateSalesPaymentDetailsDto | CreateSalesPaymentDetailsDto[];
	productItems!: CreateSalesProductItemDto[];
	serviceItems?: CreateSalesOrderServiceDetailDto[];
	expenseDetails?: CreateSalesOrderExpenseDetailDto[];
	so_number?: string;
	totalAmount?: number;
	scheduleDate?: string | null;
	salesType?: string;
	projectName?: string;
	projectCode?: string;
	projectDetails?: CreateSalesOrderProjectDetailDto;
	installer?: string;
	remarks?: string;
	transferDetails?: CreateSalesOrderTransferDetailDto;
	concernDetails?: CreateSalesOrderConcernDetailDto;
	returnedSerialDetails?: CreateSalesOrderReturnedSerialDetailDto;
	status?: string;
}
