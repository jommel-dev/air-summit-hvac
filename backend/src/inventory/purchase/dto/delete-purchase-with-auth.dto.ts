export class DeletePurchaseWithAuthDto {
  /** The password to verify. For admin/superadmin: their own password. For warehouseman: the authorizing admin's password. */
  password: string;

  /** Required only when the requesting user is NOT an admin/superadmin/owner — the username of the authorizing admin/superadmin. */
  authUsername?: string;
}
