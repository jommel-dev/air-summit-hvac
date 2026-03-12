export class CreateSalesOrderServiceDetailDto {
	serviceName!: string;
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
