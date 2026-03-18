import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { BranchOption } from './sales-order.service';
import { RbacService } from './rbac.service';

const STORAGE_KEY = 'activeBranchId';

@Injectable({ providedIn: 'root' })
export class BranchService {
  private activeBranchSubject = new BehaviorSubject<BranchOption | null>(null);
  readonly activeBranch$ = this.activeBranchSubject.asObservable();

  /**
   * When the user's JWT contains a branchId, they are restricted to that branch.
   * The switcher is disabled and they can only ever see their own branch's data.
   */
  private lockedBranchId: number | null = null;

  constructor(private readonly rbacService: RbacService) {}

  private get isAdminOrSuperRole(): boolean {
    const roleName = (this.rbacService.getPayload()?.roleName ?? '').toLowerCase();
    return roleName.includes('admin') || roleName.includes('super');
  }

  private get hasSwitchPrivilege(): boolean {
    if (this.rbacService.hasEffectivePermissionKey('branch.switch')) return true;
    return this.isAdminOrSuperRole;
  }

  /** Only Admin/SuperAdmin can select the static "All Branches" option. */
  get canSelectAllBranches(): boolean {
    return this.isAdminOrSuperRole;
  }

  /** Returns true when the user is locked to a specific branch (cannot switch). */
  get isLocked(): boolean {
    return this.lockedBranchId !== null && !this.hasSwitchPrivilege;
  }

  /**
   * Returns true when the user is allowed to switch branches.
   * Requires the user to NOT be locked to a branch AND to either:
   *   - have the `branch.switch` RBAC permission key (configurable via RBAC Configs), OR
   *   - belong to a role whose name contains "admin" or "super" (built-in fallback).
   */
  get canSwitch(): boolean {
    return this.hasSwitchPrivilege;
  }

  getActiveBranch(): BranchOption | null {
    return this.activeBranchSubject.value;
  }

  getActiveBranchId(): number | null {
    return this.activeBranchSubject.value?.id ?? null;
  }

  getActiveBranchName(): string {
    return this.activeBranchSubject.value?.branchName ?? 'All Branches';
  }

  /**
   * Only works when the user has switch access (`canSwitch === true`).
   */
  setActiveBranch(branch: BranchOption | null): void {
    if (!this.canSwitch) return;
    this.activeBranchSubject.next(branch);
    if (branch) {
      localStorage.setItem(STORAGE_KEY, String(branch.id));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }

  /**
   * Called by BranchSwitcherComponent after loading branches.
   * - Non-privileged users with JWT branchId are locked to that branch.
   * - Privileged users (admin/superadmin/branch.switch) can use localStorage selection.
   */
  initFromBranches(branches: BranchOption[]): void {
    const jwtBranchId = this.rbacService.getBranchId();
    const canOverrideJwtBranch = this.hasSwitchPrivilege;

    if (jwtBranchId !== null && !canOverrideJwtBranch) {
      // User is restricted to their assigned branch
      this.lockedBranchId = jwtBranchId;
      const locked = branches.find((b) => b.id === jwtBranchId) ?? null;
      this.activeBranchSubject.next(locked);
      return;
    }

    // Privileged user (or user without assigned branch): restore from localStorage
    this.lockedBranchId = null;
    const storedId = localStorage.getItem(STORAGE_KEY);
    if (storedId) {
      const found = branches.find((b) => String(b.id) === storedId);
      if (found) {
        this.activeBranchSubject.next(found);
        return;
      }
    }

    if (jwtBranchId !== null && canOverrideJwtBranch) {
      // Privileged user default fallback is their assigned branch when no stored selection exists.
      const fallback = branches.find((b) => b.id === jwtBranchId) ?? null;
      this.activeBranchSubject.next(fallback);
      return;
    }

    // Default: show all
    this.activeBranchSubject.next(null);
  }

  /** Call on logout to reset state. */
  reset(): void {
    this.lockedBranchId = null;
    this.activeBranchSubject.next(null);
    localStorage.removeItem(STORAGE_KEY);
  }
}
