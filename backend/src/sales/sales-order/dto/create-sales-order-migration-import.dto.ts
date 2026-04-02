export class CreateSalesOrderMigrationImportDto {
  rows!: Array<Record<string, unknown>>;
  selectedMediumRowNumbers?: number[];
  editedPayloads?: Array<{
    rowNumber: number;
    payload: Record<string, unknown>;
  }>;
}
