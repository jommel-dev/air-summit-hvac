export class BulkAssignOrderDto {
  serialIds!: number[];
  purchaseId?: number | null;
  salesId?: number | null;
  reason?: string;
}
