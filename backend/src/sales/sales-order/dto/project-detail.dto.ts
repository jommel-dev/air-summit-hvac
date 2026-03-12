export class CreateSalesOrderProjectDetailDto {
	projectName!: string;
	projectCode?: string;
	projectLocation?: string;
	projectStartDate?: string | null;
	projectEndDate?: string | null;
	projectManager?: string;
	projectStatus?: string;
	projectNotes?: string;
}
