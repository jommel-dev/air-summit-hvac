export class ScanSalesOrderBatchItemDto {
  serialNumber!: string;
  salesId!: number;
  branchId?: number | null;
  expectedProductId?: number | null;
  expectedCapacityId?: number | null;
  expectedUnitType?: string | null;
}

export class ScanSalesOrderBatchDto {
  items!: ScanSalesOrderBatchItemDto[];
}
