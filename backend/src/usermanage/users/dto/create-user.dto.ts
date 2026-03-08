export class CreateUserDto {
	username: string;
	password: string;
	fullname: string;
	birthdate?: string;
	address?: string;
	email?: string;
	contact?: string;
	status?: number;
	is_deleted?: boolean;
	created_by?: number;
	roleId?: number;
	branchId?: number;
}
