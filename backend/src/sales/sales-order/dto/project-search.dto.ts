export class ProjectSearchQueryDto {
	search?: string; // search by project_code or project_name
	status?: string;
	page?: number;
	limit?: number;
	branchId?: number;
}

export class ProjectDetailDto {
	id: number;
	projectCode: string;
	projectName: string;
	projectType?: string;
	projectOwner?: string;
	projectLocation?: string;
	projectStartDate?: string | null;
	projectEndDate?: string | null;
	projectManager?: string;
	projectStatus: string;
	projectNotes?: string;
	relatedSOCount: number; // Count of related sales orders
	createdBy?: number;
	createdAt: string;
	updatedAt: string;
}

export class ProjectListResponse {
	success: boolean;
	items: ProjectDetailDto[];
	meta: {
		page: number;
		limit: number;
		total: number;
		totalPages: number;
	};
	message?: string;
}

export class CreateProjectDto {
	projectCode: string;
	projectName: string;
	projectType?: string;
	projectOwner?: string;
	projectLocation?: string;
	projectStartDate?: string | null;
	projectEndDate?: string | null;
	projectManager?: string;
	projectStatus?: string;
	projectNotes?: string;
}
