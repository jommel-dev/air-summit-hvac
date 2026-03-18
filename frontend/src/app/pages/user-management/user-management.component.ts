import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PageBreadcrumbComponent } from '../../shared/components/common/page-breadcrumb/page-breadcrumb.component';
import { ButtonComponent } from '../../shared/components/ui/button/button.component';
import { CanDirective } from '../../shared/directives/can.directive';
import {
  PermissionKeyApiItem,
  RoleApiItem,
  UserEffectivePermissionApiItem,
  UserApiItem,
  UserPermissionOverrideApiItem,
  UserManagementService,
} from '../../shared/services/user-management.service';
import { BranchOption, SalesOrderService } from '../../shared/services/sales-order.service';
import { NotificationService } from '../../shared/services/notification.service';
import axios from 'axios';

interface UserRow {
  id: number;
  username: string;
  fullName: string;
  role: string;
  roleMenus: string[];
  rolePermissions: string[];
  status: 'Active' | 'Inactive' | 'Deleted';
  isDeleted: boolean;
}

interface RoleOption {
  id: number;
  name: string;
}

interface PermissionOption {
  key: string;
  label: string;
  module: string;
  scope: string;
}

interface PermissionModuleGroup {
  module: string;
  items: PermissionOption[];
}

type OverrideEffect = 'inherit' | 'allow' | 'deny';

@Component({
  selector: 'app-user-management',
  imports: [CommonModule, FormsModule, PageBreadcrumbComponent, ButtonComponent, CanDirective],
  templateUrl: './user-management.component.html',
  styles: ``,
})
export class UserManagementComponent implements OnInit {
  users: UserRow[] = [];
  roleOptions: RoleOption[] = [];
  branchOptions: BranchOption[] = [];
  permissionOptions: PermissionOption[] = [];
  userSearch = '';
  permissionSearch = '';
  showDeletedUsers = false;
  page = 1;
  readonly pageSize = 10;

  isLoadingUsers = false;
  isLoadingRoles = false;
  isLoadingBranches = false;
  isLoadingPermissionKeys = false;
  isLoadingRolePermissions = false;
  isLoadingPermissionContext = false;
  isCreateDrawerOpen = false;
  isCreatingUser = false;
  drawerMode: 'create' | 'edit' = 'create';
  editingUserId: number | null = null;
  loadingEditUserId: number | null = null;
  deletingUserIds = new Set<number>();
  restoringUserIds = new Set<number>();
  errorMessage = '';
  rolePermissionKeys: string[] = [];
  savedEffectivePermissions: UserEffectivePermissionApiItem[] = [];
  overrideSelectionByKey: Record<string, OverrideEffect> = {};

  createForm = this.createInitialForm();

  constructor(
    private readonly userManagementService: UserManagementService,
    private readonly salesOrderService: SalesOrderService,
    private readonly notificationService: NotificationService,
  ) {}

  ngOnInit(): void {
    void this.loadUsers();
    void this.loadRoles();
    void this.loadBranches();
    void this.loadPermissionKeys();
  }

  onUserSearchChange(value: string): void {
    this.userSearch = value;
    this.page = 1;
  }

  onUserPageChange(nextPage: number): void {
    if (nextPage < 1 || nextPage > this.totalFilteredPages || nextPage === this.page) {
      return;
    }

    this.page = nextPage;
  }

  get filteredUsers(): UserRow[] {
    const keyword = this.userSearch.trim().toLowerCase();
    if (!keyword) {
      return this.users;
    }

    return this.users.filter((user) => {
      const haystack = [
        user.username,
        user.fullName,
        user.role,
        user.status,
        ...user.roleMenus,
        ...user.rolePermissions,
      ]
        .map((entry) => String(entry ?? '').toLowerCase())
        .join(' ');

      return haystack.includes(keyword);
    });
  }

  get pagedUsers(): UserRow[] {
    const start = (this.page - 1) * this.pageSize;
    const end = start + this.pageSize;
    return this.filteredUsers.slice(start, end);
  }

  get totalFilteredUsers(): number {
    return this.filteredUsers.length;
  }

  get totalFilteredPages(): number {
    return Math.max(1, Math.ceil(this.totalFilteredUsers / this.pageSize));
  }

  get activeUserCount(): number {
    return this.users.filter((user) => !user.isDeleted && user.status === 'Active').length;
  }

  get inactiveUserCount(): number {
    return this.users.filter((user) => !user.isDeleted && user.status === 'Inactive').length;
  }

  get deletedUserCount(): number {
    return this.users.filter((user) => user.isDeleted).length;
  }

  async onToggleShowDeletedUsers(value: unknown): Promise<void> {
    this.showDeletedUsers = value === true;
    this.page = 1;
    await this.loadUsers();
  }

  async loadUsers(): Promise<void> {
    this.isLoadingUsers = true;
    this.errorMessage = '';

    try {
      const response = await this.userManagementService.getUsers(this.showDeletedUsers);
      if (!response.success) {
        this.errorMessage = response.message ?? 'Failed to load users';
        this.users = [];
        return;
      }

      this.users = (response.data ?? []).map((item) => this.mapUserItem(item));
      this.page = 1;
    } catch (error: unknown) {
      this.errorMessage = this.extractApiError(error, 'Failed to load users');
      this.users = [];
      this.page = 1;
    } finally {
      this.isLoadingUsers = false;
    }
  }

  async loadRoles(): Promise<void> {
    this.isLoadingRoles = true;

    try {
      const response = await this.userManagementService.getRoles();
      if (!response.success) {
        this.roleOptions = [];
        this.notificationService.warning('Role Loading Failed', response.message ?? 'Failed to load roles from tblrbac.');
        return;
      }

      this.roleOptions = (response.data ?? [])
        .map((item) => this.mapRoleItem(item))
        .filter((item) => item.name.length > 0);
    } catch (error: unknown) {
      this.roleOptions = [];
      this.notificationService.error('Role Loading Failed', this.extractApiError(error, 'Failed to load roles from tblrbac.'));
    } finally {
      this.isLoadingRoles = false;
    }
  }

  openCreateDrawer(): void {
    this.createForm = this.createInitialForm();
    this.drawerMode = 'create';
    this.editingUserId = null;
    this.rolePermissionKeys = [];
    this.savedEffectivePermissions = [];
    this.overrideSelectionByKey = {};
    this.permissionSearch = '';
    this.isCreateDrawerOpen = true;
  }

  async openEditDrawer(user: UserRow): Promise<void> {
    if (this.loadingEditUserId === user.id || this.isCreatingUser) {
      return;
    }

    this.loadingEditUserId = user.id;

    try {
      const response = await this.userManagementService.getUserById(user.id);
      if (!response.success || !response.data) {
        this.notificationService.error('Load User Failed', response.message ?? 'Failed to load user details.');
        return;
      }

      const detail = response.data;
      const roleId = Number(detail.roleId ?? detail.roleid ?? detail.role_id ?? 0);

      this.createForm = {
        username: String(detail.username ?? '').trim(),
        password: '',
        fullname: String(detail.fullname ?? detail.fullName ?? detail.full_name ?? '').trim(),
        email: String(detail.email ?? '').trim(),
        address: String(detail.address ?? '').trim(),
        contact: String(detail.contact ?? '').trim(),
        birthdate: this.toDateInputValue(detail.birthdate),
        roleId: roleId > 0 ? roleId : '',
        branchId: Number(detail.branchId ?? detail.branchid ?? detail.branch_id ?? 0) > 0
          ? Number(detail.branchId ?? detail.branchid ?? detail.branch_id)
          : '',
        status: this.normalizeStatus(detail.status),
      };

      this.drawerMode = 'edit';
      this.editingUserId = user.id;
      await this.loadPermissionContext(user.id, roleId > 0 ? roleId : null);
      this.isCreateDrawerOpen = true;
    } catch (error: unknown) {
      this.notificationService.error('Load User Failed', this.extractApiError(error, 'Failed to load user details.'));
    } finally {
      this.loadingEditUserId = null;
    }
  }

  closeCreateDrawer(): void {
    if (this.isCreatingUser) {
      return;
    }

    this.isCreateDrawerOpen = false;
    this.drawerMode = 'create';
    this.editingUserId = null;
    this.rolePermissionKeys = [];
    this.savedEffectivePermissions = [];
    this.overrideSelectionByKey = {};
    this.permissionSearch = '';
  }

  async onRoleChange(nextRoleId: unknown): Promise<void> {
    const roleId = Number(nextRoleId);
    this.createForm.roleId = Number.isFinite(roleId) && roleId > 0 ? roleId : '';

    if (!Number.isFinite(roleId) || roleId <= 0) {
      this.rolePermissionKeys = [];
      return;
    }

    await this.loadRolePermissions(roleId);
  }

  async submitCreateUser(): Promise<void> {
    if (this.isCreatingUser) {
      return;
    }

    const username = this.createForm.username.trim();
    const fullname = this.createForm.fullname.trim();
    const password = this.createForm.password;
    const roleId = Number(this.createForm.roleId);
    const branchId = Number(this.createForm.branchId);

    if (!username || !fullname || (this.drawerMode === 'create' && !password)) {
      this.notificationService.warning(
        'Incomplete Form',
        this.drawerMode === 'create'
          ? 'Username, full name, and password are required.'
          : 'Username and full name are required.',
      );
      return;
    }

    if (!Number.isFinite(roleId) || roleId <= 0) {
      this.notificationService.warning('Role Required', 'Please select a role from RBAC options.');
      return;
    }

    this.isCreatingUser = true;

    try {
      const payload = {
        username,
        fullname,
        roleId,
        branchId: Number.isFinite(branchId) && branchId > 0 ? branchId : undefined,
        status: this.createForm.status,
        email: this.createForm.email.trim() || undefined,
        address: this.createForm.address.trim() || undefined,
        contact: this.createForm.contact.trim() || undefined,
        birthdate: this.createForm.birthdate || undefined,
      };

      const response =
        this.drawerMode === 'create'
          ? await this.userManagementService.createUser({ ...payload, password })
          : Number.isFinite(Number(this.editingUserId)) && Number(this.editingUserId) > 0
            ? await this.userManagementService.updateUser(Number(this.editingUserId), {
                ...payload,
                ...(password ? { password } : {}),
              })
            : {
                success: false,
                message: 'Invalid user id for edit',
              };

      if (!response.success) {
        this.notificationService.error(
          this.drawerMode === 'create' ? 'Create User Failed' : 'Update User Failed',
          response.message ?? (this.drawerMode === 'create' ? 'Failed to create user.' : 'Failed to update user.'),
        );
        return;
      }

      const targetUserId =
        this.drawerMode === 'create'
          ? Number(response.id ?? 0)
          : Number(this.editingUserId ?? 0);

      const overridePayload = this.selectedOverrides;
      const shouldSyncOverrides =
        this.drawerMode === 'edit' || overridePayload.length > 0;

      if (shouldSyncOverrides && Number.isFinite(targetUserId) && targetUserId > 0) {
        const overrideResponse = await this.userManagementService.saveUserPermissionOverrides(
          targetUserId,
          overridePayload,
        );

        if (!overrideResponse.success) {
          this.notificationService.warning(
            'Permission Overrides Not Saved',
            overrideResponse.message ?? 'User was saved but permission overrides failed to save.',
          );
        }
      }

      this.notificationService.success(
        this.drawerMode === 'create' ? 'User Created' : 'User Updated',
        this.drawerMode === 'create'
          ? 'New user has been created successfully.'
          : 'User details have been updated successfully.',
      );
      this.isCreateDrawerOpen = false;
      this.editingUserId = null;
      await this.loadUsers();
    } catch (error: unknown) {
      this.notificationService.error(
        this.drawerMode === 'create' ? 'Create User Failed' : 'Update User Failed',
        this.extractApiError(
          error,
          this.drawerMode === 'create' ? 'Failed to create user.' : 'Failed to update user.',
        ),
      );
    } finally {
      this.isCreatingUser = false;
    }
  }

  async deleteUser(user: UserRow): Promise<void> {
    if (user.isDeleted) {
      return;
    }

    if (this.deletingUserIds.has(user.id)) {
      return;
    }

    const confirmed = window.confirm(`Delete user ${user.username}?`);
    if (!confirmed) {
      return;
    }

    this.deletingUserIds.add(user.id);

    try {
      const response = await this.userManagementService.deleteUser(user.id);
      if (!response.success) {
        this.notificationService.error('Delete User Failed', response.message ?? 'Failed to delete user.');
        return;
      }

      this.notificationService.success('User Deleted', 'User has been removed successfully.');
      await this.loadUsers();
    } catch (error: unknown) {
      this.notificationService.error('Delete User Failed', this.extractApiError(error, 'Failed to delete user.'));
    } finally {
      this.deletingUserIds.delete(user.id);
    }
  }

  async restoreUser(user: UserRow): Promise<void> {
    if (!user.isDeleted || this.restoringUserIds.has(user.id)) {
      return;
    }

    const confirmed = window.confirm(`Restore user ${user.username}?`);
    if (!confirmed) {
      return;
    }

    this.restoringUserIds.add(user.id);

    try {
      const response = await this.userManagementService.restoreUser(user.id);
      if (!response.success) {
        this.notificationService.error('Restore User Failed', response.message ?? 'Failed to restore user.');
        return;
      }

      this.notificationService.success('User Restored', 'User account has been restored successfully.');
      await this.loadUsers();
    } catch (error: unknown) {
      this.notificationService.error('Restore User Failed', this.extractApiError(error, 'Failed to restore user.'));
    } finally {
      this.restoringUserIds.delete(user.id);
    }
  }

  trackByUserId(_: number, user: UserRow): number {
    return user.id;
  }

  getAccessTokenPreview(user: UserRow, maxItems = 2): string[] {
    const tokens = [...new Set([...user.roleMenus, ...user.rolePermissions])]
      .filter((item) => item.length > 0)
      .map((item) => this.formatAccessTokenLabel(item));

    return tokens.slice(0, Math.max(0, maxItems));
  }

  getAccessTokenExtraCount(user: UserRow, maxItems = 2): number {
    const total = [...new Set([...user.roleMenus, ...user.rolePermissions])].length;
    return Math.max(0, total - Math.max(0, maxItems));
  }

  getAccessSummary(user: UserRow): string {
    const menuCount = user.roleMenus.length;
    const permissionCount = user.rolePermissions.length;
    return `${menuCount} menu${menuCount === 1 ? '' : 's'} and ${permissionCount} permission${permissionCount === 1 ? '' : 's'}`;
  }

  hasFullAccess(user: UserRow): boolean {
    return user.rolePermissions.some((item) => String(item).trim().toLowerCase() === 'candoall');
  }

  get filteredPermissionOptions(): PermissionOption[] {
    const keyword = this.permissionSearch.trim().toLowerCase();
    if (!keyword) {
      return this.permissionOptions;
    }

    return this.permissionOptions.filter((item) => {
      const haystack = `${item.key} ${item.label} ${item.module} ${item.scope}`.toLowerCase();
      return haystack.includes(keyword);
    });
  }

  get groupedFilteredPermissionOptions(): PermissionModuleGroup[] {
    const grouped = this.filteredPermissionOptions.reduce<Record<string, PermissionOption[]>>(
      (accumulator, item) => {
        const moduleKey = item.module || 'misc';
        if (!accumulator[moduleKey]) {
          accumulator[moduleKey] = [];
        }

        accumulator[moduleKey].push(item);
        return accumulator;
      },
      {},
    );

    return Object.entries(grouped)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([module, items]) => ({
        module,
        items: items.sort((left, right) => left.key.localeCompare(right.key)),
      }));
  }

  get selectedOverrides(): UserPermissionOverrideApiItem[] {
    return Object.entries(this.overrideSelectionByKey)
      .filter(([, effect]) => effect === 'allow' || effect === 'deny')
      .map(([permissionKey, effect]) => ({
        permissionKey,
        effect: effect as 'allow' | 'deny',
      }));
  }

  get selectedOverrideCount(): number {
    return this.selectedOverrides.length;
  }

  get effectivePreviewKeys(): string[] {
    const allowed = new Set(this.rolePermissionKeys);

    for (const [permissionKey, effect] of Object.entries(this.overrideSelectionByKey)) {
      if (effect === 'allow') {
        allowed.add(permissionKey);
      }

      if (effect === 'deny') {
        allowed.delete(permissionKey);
      }
    }

    return [...allowed].sort((a, b) => a.localeCompare(b));
  }

  get savedEffectivePermissionKeys(): string[] {
    return this.savedEffectivePermissions
      .map((item) => String(item.permissionKey ?? '').trim())
      .filter((item) => item.length > 0)
      .sort((a, b) => a.localeCompare(b));
  }

  get previewChangedCount(): number {
    if (this.drawerMode !== 'edit') {
      return 0;
    }

    const saved = new Set(this.savedEffectivePermissionKeys);
    const preview = new Set(this.effectivePreviewKeys);
    const allKeys = new Set([...saved, ...preview]);

    let changed = 0;
    for (const key of allKeys) {
      if (saved.has(key) !== preview.has(key)) {
        changed += 1;
      }
    }

    return changed;
  }

  getOverrideEffect(permissionKey: string): OverrideEffect {
    return this.overrideSelectionByKey[permissionKey] ?? 'inherit';
  }

  setOverrideEffect(permissionKey: string, nextEffect: unknown): void {
    const normalizedEffect =
      nextEffect === 'allow' || nextEffect === 'deny' ? nextEffect : 'inherit';

    if (normalizedEffect === 'inherit') {
      delete this.overrideSelectionByKey[permissionKey];
      this.overrideSelectionByKey = { ...this.overrideSelectionByKey };
      return;
    }

    this.overrideSelectionByKey = {
      ...this.overrideSelectionByKey,
      [permissionKey]: normalizedEffect,
    };
  }

  clearOverrideSelections(): void {
    this.overrideSelectionByKey = {};
  }

  isRoleGranted(permissionKey: string): boolean {
    return this.rolePermissionKeys.includes(permissionKey);
  }

  formatPermissionModule(value: string): string {
    const normalized = String(value ?? '').trim();
    if (!normalized) {
      return 'Misc';
    }

    return normalized
      .split('-')
      .map((entry) => entry.charAt(0).toUpperCase() + entry.slice(1))
      .join(' ');
  }

  formatPermissionScope(value: string): string {
    const normalized = String(value ?? '').trim();
    if (!normalized) {
      return 'General';
    }

    return normalized.charAt(0).toUpperCase() + normalized.slice(1);
  }

  private formatAccessTokenLabel(value: string): string {
    const normalized = String(value ?? '').trim();
    if (!normalized) {
      return '-';
    }

    const spaced = normalized
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/[._-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    return spaced
      .split(' ')
      .map((entry) => entry.charAt(0).toUpperCase() + entry.slice(1).toLowerCase())
      .join(' ');
  }

  getPermissionLabel(permissionKey: string): string {
    const matched = this.permissionOptions.find((item) => item.key === permissionKey);
    return matched?.label ?? permissionKey;
  }

  private async loadPermissionKeys(): Promise<void> {
    this.isLoadingPermissionKeys = true;

    try {
      const response = await this.userManagementService.getPermissionKeys();
      if (!response.success) {
        this.permissionOptions = [];
        this.notificationService.warning(
          'Permission Keys Unavailable',
          response.message ?? 'Failed to load normalized permission keys.',
        );
        return;
      }

      this.permissionOptions = (response.data ?? []).map((item) => this.mapPermissionItem(item));
    } catch (error: unknown) {
      this.permissionOptions = [];
      this.notificationService.error(
        'Permission Keys Unavailable',
        this.extractApiError(error, 'Failed to load normalized permission keys.'),
      );
    } finally {
      this.isLoadingPermissionKeys = false;
    }
  }

  private async loadBranches(): Promise<void> {
    this.isLoadingBranches = true;

    try {
      this.branchOptions = await this.salesOrderService.getBranches();
    } catch (error: unknown) {
      this.branchOptions = [];
      this.notificationService.error(
        'Branch Loading Failed',
        this.extractApiError(error, 'Failed to load branches.'),
      );
    } finally {
      this.isLoadingBranches = false;
    }
  }

  private async loadRolePermissions(roleId: number): Promise<void> {
    this.isLoadingRolePermissions = true;

    try {
      const response = await this.userManagementService.getRolePermissions(roleId);
      if (!response.success) {
        this.rolePermissionKeys = [];
        this.notificationService.warning(
          'Role Permissions Unavailable',
          response.message ?? 'Failed to load role permissions.',
        );
        return;
      }

      this.rolePermissionKeys = (response.data ?? []).map((item) => item.permissionKey).filter(Boolean);
    } catch (error: unknown) {
      this.rolePermissionKeys = [];
      this.notificationService.error(
        'Role Permissions Unavailable',
        this.extractApiError(error, 'Failed to load role permissions.'),
      );
    } finally {
      this.isLoadingRolePermissions = false;
    }
  }

  private async loadPermissionContext(userId: number, roleId: number | null): Promise<void> {
    this.isLoadingPermissionContext = true;

    try {
      const tasks: Promise<unknown>[] = [];

      if (roleId && roleId > 0) {
        tasks.push(this.loadRolePermissions(roleId));
      } else {
        this.rolePermissionKeys = [];
      }

      tasks.push(this.loadUserOverrides(userId));
      tasks.push(this.loadUserEffectivePermissions(userId));

      await Promise.all(tasks);
    } finally {
      this.isLoadingPermissionContext = false;
    }
  }

  private async loadUserOverrides(userId: number): Promise<void> {
    try {
      const response = await this.userManagementService.getUserPermissionOverrides(userId);
      if (!response.success) {
        this.overrideSelectionByKey = {};
        return;
      }

      const overrides: Record<string, OverrideEffect> = {};
      for (const item of response.data ?? []) {
        if (!item.permissionKey) {
          continue;
        }

        if (item.effect === 'allow' || item.effect === 'deny') {
          overrides[item.permissionKey] = item.effect;
        }
      }

      this.overrideSelectionByKey = overrides;
    } catch {
      this.overrideSelectionByKey = {};
    }
  }

  private async loadUserEffectivePermissions(userId: number): Promise<void> {
    try {
      const response = await this.userManagementService.getUserEffectivePermissions(userId);
      if (!response.success) {
        this.savedEffectivePermissions = [];
        return;
      }

      this.savedEffectivePermissions = (response.data ?? []).filter((item) => item.isAllowed);
    } catch {
      this.savedEffectivePermissions = [];
    }
  }

  private createInitialForm(): {
    username: string;
    password: string;
    fullname: string;
    email: string;
    address: string;
    contact: string;
    birthdate: string;
    roleId: number | '';
    branchId: number | '';
    status: number;
  } {
    return {
      username: '',
      password: '',
      fullname: '',
      email: '',
      address: '',
      contact: '',
      birthdate: '',
      roleId: '',
      branchId: '',
      status: 1,
    };
  }

  private mapUserItem(item: UserApiItem): UserRow {
    const fullname =
      String(item.fullname ?? item.fullName ?? item.full_name ?? '').trim() ||
      String(item.username ?? '').trim();
    const role = String(item.roleName ?? item.rolename ?? '').trim() || '-';
    const roleMenus = this.toChipList(item.roleMenus ?? item.rolemenus ?? '');
    const rolePermissions = this.toChipList(item.rolePermission ?? item.rolepermission ?? '');
    const isDeletedRaw = item.isDeleted ?? item.is_deleted;
    const isDeleted =
      isDeletedRaw === true ||
      isDeletedRaw === 1 ||
      String(isDeletedRaw ?? '').trim().toLowerCase() === 'true' ||
      String(isDeletedRaw ?? '').trim() === '1' ||
      String(item.deletedAt ?? item.deleted_at ?? '').trim().length > 0;
    const statusValue = item.status;
    const normalizedStatus =
      isDeleted
        ? 'Deleted'
        : statusValue === 1 ||
            statusValue === '1' ||
            String(statusValue ?? '').trim().toLowerCase() === 'active'
          ? 'Active'
          : 'Inactive';

    return {
      id: Number(item.id) || 0,
      username: String(item.username ?? '').trim(),
      fullName: fullname,
      role,
      roleMenus,
      rolePermissions,
      status: normalizedStatus,
      isDeleted,
    };
  }

  private mapRoleItem(item: RoleApiItem): RoleOption {
    return {
      id: Number(item.id) || 0,
      name: String(item.roleName ?? item.rolename ?? '').trim(),
    };
  }

  private mapPermissionItem(item: PermissionKeyApiItem): PermissionOption {
    return {
      key: String(item.key ?? '').trim(),
      label: String(item.label ?? '').trim(),
      module: String(item.module ?? '').trim(),
      scope: String(item.scope ?? '').trim(),
    };
  }

  private toChipList(value: unknown): string[] {
    return String(value ?? '')
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }

  private normalizeStatus(value: unknown): number {
    const normalized = String(value ?? '').trim().toLowerCase();
    if (value === 1 || value === '1' || normalized === 'active') {
      return 1;
    }

    return 0;
  }

  private toDateInputValue(value: unknown): string {
    if (!value) {
      return '';
    }

    const parsed = new Date(String(value));
    if (Number.isNaN(parsed.getTime())) {
      return '';
    }

    const year = parsed.getFullYear();
    const month = String(parsed.getMonth() + 1).padStart(2, '0');
    const day = String(parsed.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private extractApiError(error: unknown, fallbackMessage: string): string {
    if (axios.isAxiosError(error)) {
      return (
        (error.response?.data as { message?: string } | undefined)?.message ??
        fallbackMessage
      );
    }

    return fallbackMessage;
  }
}
