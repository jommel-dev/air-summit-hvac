export class ScanPurchaseOrderBatchItemDto {
  serialNumber!: string;
  purchaseId!: number;
  expectedProductId?: number | null;
  expectedCapacityId?: number | null;
  unitType?: string | null;
}

export class ScanPurchaseOrderBatchDto {
  items!: ScanPurchaseOrderBatchItemDto[];
}