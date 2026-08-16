export interface GlobalSearchResult {
  id: number;
  serialNumber: string;
  status: string | null;
  unitType: string | null;
  brandName: string | null;
  productName: string | null;
  capacity: string | null;
  branchName: string | null;
  poNumber: string | null;
  soNumber: string | null;
  customerName: string | null;
  isDefective: boolean;
  isReturned: boolean;
  createdAt: string;
}

export interface GlobalSearchResponse {
  success: boolean;
  items: GlobalSearchResult[];
  total: number;
  page: number;
  pageSize: number;
}

export interface BulkSearchResponse {
  success: boolean;
  items: GlobalSearchResult[];
  total: number;
  queriedCount: number;
  notFound: string[];
}

export interface BulkTransferResponse {
  success: boolean;
  message: string;
  transferredCount?: number;
}

export interface BulkAssignOrderResponse {
  success: boolean;
  message: string;
  assignedCount?: number;
}
