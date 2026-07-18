/**
 * Validation status returned by the scanSalesOrder method.
 * Determines which modal/action the frontend should present.
 */
export type ScanSalesOrderValidationStatus =
  | 'ok'
  | 'not_found'
  | 'warning_defective'
  | 'warning_mismatch'
  | 'warning_reassignment'
  | 'error_unit_type_mismatch'
  | 'info_scanned_status';

/**
 * Contextual details accompanying validation warnings.
 * Fields are populated based on the specific validationStatus.
 */
export interface ScanSalesOrderResponseDetails {
  /** For mismatch warnings */
  expectedProductName?: string;
  expectedCapacityName?: string;
  actualProductName?: string;
  actualCapacityName?: string;
  /** For reassignment warnings */
  currentCustomerName?: string;
  currentSoNumber?: string;
  currentSalesId?: number;
  /** For scanned-status info */
  previousPoNumber?: string;
  previousPurchaseId?: number;
  /** For unit type mismatch errors */
  expectedUnitType?: string;
  actualUnitType?: string;
  serialNumber?: string;
}

/**
 * Item shape returned in scan responses.
 */
export interface SerialScanResultItem {
  serialNumber?: string | null;
  status?: string | null;
  salesId?: string | null;
  productId?: string | null;
  capacityId?: string | null;
  branchId?: string | null;
  unitType?: string | null;
  productName?: string | null;
  capacity?: string | null;
}

/**
 * Response from the scanSalesOrder method.
 * Extends the previous binary success/failure with structured validation info.
 */
export interface ScanSalesOrderResponse {
  success: boolean;
  message: string;
  validationStatus?: ScanSalesOrderValidationStatus;
  details?: ScanSalesOrderResponseDetails;
  item?: SerialScanResultItem;
}

/**
 * Individual item result within a batch scan response.
 */
export interface BatchScanResultItem {
  serialNumber: string;
  success: boolean;
  message?: string;
  validationStatus?: ScanSalesOrderValidationStatus;
  details?: ScanSalesOrderResponseDetails;
  item?: {
    serialNumber?: string | null;
  };
}

/**
 * Enhanced batch response with warningCount in summary.
 */
export interface ScanSalesOrderBatchResponse {
  success: boolean;
  message: string;
  summary: {
    total: number;
    successCount: number;
    failureCount: number;
    warningCount: number;
  };
  items: BatchScanResultItem[];
}
