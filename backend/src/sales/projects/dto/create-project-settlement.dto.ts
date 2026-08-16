export class CreateProjectSettlementDto {
  amount?: number;
  mode?: 'partial' | 'full' | 'cheque' | 'split';
  method?: string;
  salesOrderId?: number;
  bankAmount?: number;
  chequeAmount?: number;
  bankName?: string | null;
  checkNo?: string | null;
  postDated?: string | null;
  notes?: string;
}
