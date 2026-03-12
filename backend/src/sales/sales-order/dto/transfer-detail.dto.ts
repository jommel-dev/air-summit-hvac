export class CreateSalesOrderTransferDetailDto {
	fromBranchId!: number;
	toBranchId!: number;
	transferDate?: string | null;
	expectedDeliveryDate?: string | null;
	actualDeliveryDate?: string | null;
	transferStatus?: string;
	transferNotes?: string;
	transferedBy?: number;
	receivedBy?: number;
	acknowledgedBy?: number;
	acknowledgedAt?: string | null;
}
