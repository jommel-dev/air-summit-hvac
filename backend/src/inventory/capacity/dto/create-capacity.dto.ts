export class CreateCapacityDto {
	productId: number;
	capacity: string;
	indoorModel?: string;
	outdoorModel?: string;
	srp?: number;
	netPrice?: number;
}
