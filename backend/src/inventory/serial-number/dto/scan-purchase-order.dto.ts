export class ScanPurchaseOrderDto {
  serialNumber!: string;
  purchaseId!: number;
  branchId?: number | null;
  expectedProductId?: number | null;
  expectedCapacityId?: number | null;
  unitType?: string | null;
}
