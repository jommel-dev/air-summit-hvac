export class BulkTransferDto {
  serialIds!: number[];
  targetProductId!: number;
  targetCapacityId!: number;
  reason?: string;
}
