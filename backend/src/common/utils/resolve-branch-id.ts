/**
 * Utility function to resolve branchId from query parameter or JWT token
 * Priority: Query param > JWT token > undefined
 *
 * Usage:
 * const branchId = resolveBranchId(request, branchIdQuery);
 */
export function resolveBranchId(
  request: { user?: Record<string, unknown> },
  branchIdQuery?: string | number,
): number | undefined {
  // 1. Try query parameter first (explicit override)
  if (branchIdQuery !== undefined && branchIdQuery !== null && branchIdQuery !== '') {
    const queryBranchId = Number(branchIdQuery);
    if (Number.isFinite(queryBranchId) && queryBranchId > 0) {
      return queryBranchId;
    }
  }

  // 2. Fall back to JWT token branchId
  const branchIdFromToken = Number(
    request.user?.branchId ?? request.user?.branch_id ?? request.user?.branch,
  );
  if (Number.isFinite(branchIdFromToken) && branchIdFromToken > 0) {
    return branchIdFromToken;
  }

  // 3. No valid branchId found
  return undefined;
}

/**
 * Utility function to resolve branchId allowing null/0 for global/unassigned scope
 * Priority: Query param > JWT token > undefined
 *
 * Note: This allows 0 or null values for global/unassigned scope queries
 */
export function resolveBranchIdWithNullable(
  request: { user?: Record<string, unknown> },
  branchIdQuery?: string | number,
): number | undefined {
  // 1. Try query parameter first (explicit override)
  if (branchIdQuery !== undefined && branchIdQuery !== null && branchIdQuery !== '') {
    const queryBranchId = Number(branchIdQuery);
    if (Number.isFinite(queryBranchId) && queryBranchId >= 0) {
      return queryBranchId;
    }
  }

  // 2. Fall back to JWT token branchId
  const branchIdFromToken = Number(
    request.user?.branchId ?? request.user?.branch_id ?? request.user?.branch,
  );
  if (Number.isFinite(branchIdFromToken) && branchIdFromToken > 0) {
    return branchIdFromToken;
  }

  // 3. No valid branchId found
  return undefined;
}
