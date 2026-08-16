export class UpdateProjectDto {
  projectCode?: string;
  projectName?: string;
  customerId?: string;
  projectType?: string;
  projectOwner?: string;
  projectLocation?: string;
  projectStartDate?: string | null;
  projectEndDate?: string | null;
  projectManager?: string;
  projectStatus?: string;
  projectNotes?: string;
  pocName?: string;
  pocPhone?: string;
  pocEmail?: string;
  branchId?: number;
}
