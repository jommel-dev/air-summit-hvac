export class ListSalesOrderQueryDto {
  page?: number;
  limit?: number;
  search?: string;
  branchId?: number;
  scheduleDateFrom?: string;
  scheduleDateTo?: string;
}
