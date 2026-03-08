export class CreateProductCapacityDto {
    capacity: string;
    indoorModel: string;
    outdoorModel: string;
    srp: number;
    netPrice: number;
    supplierId?: number;
    purchaseOrderId?: number;
    purchaseOrderNo?: string;
}

export class CreateProductDto {
    brandId: number;
    productName: string;
    unitTypes: string[];
    unit: string;
    capacities?: CreateProductCapacityDto[];
}
