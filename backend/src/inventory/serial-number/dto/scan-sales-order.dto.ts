export class ScanSalesOrderDto {
  serialNumber!: string;
  salesId!: number;
  branchId?: number;
  expectedProductId?: number;
  expectedCapacityId?: number;
  expectedUnitType?: string;
  /** Skip mismatch and defective warnings */
  forceAssign?: boolean;
  /** Create serial if not found */
  forceInsert?: boolean;
  /** Reassign from another SO */
  forceReassign?: boolean;
  /** Update serial unit type to match the active scan field */
  forceCorrectUnitType?: boolean;
}