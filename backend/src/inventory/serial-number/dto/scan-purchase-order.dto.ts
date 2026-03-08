export class ScanPurchaseOrderDto {
  serialNumber!: string;
  purchaseId!: number;
  expectedProductId?: number | null;
  expectedCapacityId?: number | null;
  unitType?: string | null;
}
