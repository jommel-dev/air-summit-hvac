import { PurchaseTabItemDto } from './purchase-tab-item.dto';

export class PurchaseListResponseDto {
  success!: boolean;
  items!: PurchaseTabItemDto[];
  meta!: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}
