import { IsOptional, IsBoolean } from 'class-validator';

export class ScanPurchaseOrderBatchItemDto {
  serialNumber!: string;
  purchaseId!: number;
  branchId?: number | null;
  expectedProductId?: number | null;
  expectedCapacityId?: number | null;
  unitType?: string | null;
}

export class ScanPurchaseOrderBatchDto {
  items!: ScanPurchaseOrderBatchItemDto[];

  @IsOptional()
  @IsBoolean()
  trackPreviousPurchase?: boolean;
}
