export class ScanSalesOrderBatchItemDto {
  serialNumber!: string;
  salesId!: number;
  branchId?: number | null;
  expectedProductId?: number | null;
  expectedCapacityId?: number | null;
  expectedUnitType?: string | null;
  /** Skip mismatch and defective warnings */
  forceAssign?: boolean;
  /** Create serial if not found */
  forceInsert?: boolean;
  /** Reassign from another SO */
  forceReassign?: boolean;
  /** Update serial unit type to match the active scan field */
  forceCorrectUnitType?: boolean;
}

export class ScanSalesOrderBatchDto {
  items!: ScanSalesOrderBatchItemDto[];
}
