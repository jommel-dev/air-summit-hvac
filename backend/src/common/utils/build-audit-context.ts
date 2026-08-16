import { AuditActorContext } from 'src/audit-log/audit-log.service';

export function buildAuditContext(request: {
  user?: Record<string, unknown>;
  ip?: string;
}): AuditActorContext {
  const userId = Number(request.user?.sub);
  const branchId = Number(
    request.user?.branchId ??
      request.user?.branch_id ??
      request.user?.branch ??
      request.user?.tokenBranchId,
  );

  return {
    userId: Number.isFinite(userId) && userId > 0 ? userId : undefined,
    username: String(request.user?.username ?? '').trim() || undefined,
    roleName:
      String(request.user?.roleName ?? request.user?.role_name ?? '').trim() || undefined,
    branchId: Number.isFinite(branchId) && branchId > 0 ? branchId : undefined,
    ipAddress: String(request.ip ?? '').trim() || undefined,
  };
}
