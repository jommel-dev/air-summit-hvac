export class ScanSalesOrderDto {
  serialNumber!: string;
  salesId!: number;
  branchId?: number;
  expectedProductId?: number;
  expectedCapacityId?: number;
  expectedUnitType?: string;
}