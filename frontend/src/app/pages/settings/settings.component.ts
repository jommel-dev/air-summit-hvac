import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PageBreadcrumbComponent } from '../../shared/components/common/page-breadcrumb/page-breadcrumb.component';
import {
  BusinessProfileSettings,
  BusinessSettingsService,
} from '../../shared/services/business-settings.service';
import { RbacService } from '../../shared/services/rbac.service';
import { BranchOption, SalesOrderService } from '../../shared/services/sales-order.service';
import {
  CreatePermissionKeyPayload,
  PermissionKeyApiItem,
  RoleApiItem,
  UserManagementService,
} from '../../shared/services/user-management.service';
import axios from 'axios';

type SettingsTab = 'system' | 'branches' | 'print-settings' | 'rbac-configs';

interface SettingsPermissionOption {
  key: string;
  label: string;
  module: string;
  scope: 'feature' | 'menu' | 'tab' | 'action' | string;
}

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [CommonModule, FormsModule, PageBreadcrumbComponent],
  templateUrl: './settings.component.html',
  styles: ``,
})
export class SettingsComponent implements OnInit {
  private readonly defaultBusinessLogoLight = '/images/fwdslogo.png';
  private readonly defaultBusinessLogoDark = '/images/fwdslogo-dark.png';
  private readonly defaultDrTemplatePdf = '/docs/DefaultHVAC-DR.pdf';

  isLoading = false;
  isSaving = false;
  isUploadingLightLogo = false;
  isUploadingDarkLogo = false;
  isRemovingLightLogo = false;
  isRemovingDarkLogo = false;
  isUploadingDrTemplate = false;

  uiMessage = '';
  uiError = '';
  activeTab: SettingsTab = 'system';
  isLoadingBranches = false;
  isCreatingBranch = false;
  isUpdatingBranch = false;
  deletingBranchId: number | null = null;
  branchError = '';
  branchOptions: BranchOption[] = [];
  newBranchName = '';
  newBranchAddress = '';
  editingBranchId: number | null = null;
  editingBranchName = '';
  editingBranchAddress = '';
  isLoadingRoles = false;
  isLoadingPermissionKeys = false;
  isLoadingRolePermissions = false;
  isCreatingPermissionKey = false;
  isSavingRolePermissions = false;
  rbacError = '';
  rbacSearch = '';
  roles: Array<{ id: number; name: string }> = [];
  selectedRoleId: number | '' = '';
  permissionOptions: SettingsPermissionOption[] = [];
  rolePermissionKeys: string[] = [];
  newPermissionForm: CreatePermissionKeyPayload = {
    key: '',
    label: '',
    module: '',
    scope: 'action',
  };

  form: {
    businessName: string;
    businessAddress: string;
    businessContact: string;
    businessEmail: string;
    businessOwner: string;
  } = {
    businessName: '',
    businessAddress: '',
    businessContact: '',
    businessEmail: '',
    businessOwner: '',
  };

  preview: {
    businessLogoLight: string | null;
    businessLogoDark: string | null;
    drTemplatePdf: string | null;
  } = {
    businessLogoLight: null,
    businessLogoDark: null,
    drTemplatePdf: null,
  };

  constructor(
    private readonly businessSettingsService: BusinessSettingsService,
    private readonly rbacService: RbacService,
    private readonly salesOrderService: SalesOrderService,
    private readonly userManagementService: UserManagementService,
  ) {}

  ngOnInit(): void {
    void this.loadBusinessProfile();
    void this.loadBranches();
    void this.loadRbacConfig();
  }

  readonly tabs: Array<{ key: SettingsTab; label: string; disabled?: boolean }> = [
    { key: 'system', label: 'System' },
    { key: 'branches', label: 'Branches' },
    { key: 'print-settings', label: 'Print Settings' },
    { key: 'rbac-configs', label: 'RBAC Configs' },
  ];

  get canReadSettings(): boolean {
    return this.rbacService.canAccess('settings', 'canRead');
  }

  get canUpdateSettings(): boolean {
    return this.rbacService.canAccess('settings', 'canUpdate');
  }

  get allowedMenus(): string[] {
    return Array.from(this.rbacService.getAllowedMenus()).sort((left, right) =>
      left.localeCompare(right),
    );
  }

  get effectivePermissionKeys(): string[] {
    return Array.from(this.rbacService.getEffectivePermissionKeys()).sort((left, right) =>
      left.localeCompare(right),
    );
  }

  get deniedPermissionKeys(): string[] {
    return Array.from(this.rbacService.getDeniedPermissionKeys()).sort((left, right) =>
      left.localeCompare(right),
    );
  }

  get filteredRbacPermissionOptions(): SettingsPermissionOption[] {
    const keyword = this.rbacSearch.trim().toLowerCase();
    if (!keyword) {
      return this.permissionOptions;
    }

    return this.permissionOptions.filter((item) => {
      const haystack = `${item.key} ${item.label} ${item.module} ${item.scope}`.toLowerCase();
      return haystack.includes(keyword);
    });
  }

  get selectedRoleName(): string {
    return this.roles.find((item) => item.id === this.selectedRoleId)?.name ?? 'No role selected';
  }

  get permissionUsageExample(): string {
    const permissionKey = String(this.newPermissionForm.key ?? '').trim() || 'sales-order.button.print-discount';
    return `*appCan="{ permissionKey: '${permissionKey}' }"`;
  }

  setActiveTab(tab: SettingsTab): void {
    this.activeTab = tab;
  }

  async loadRbacConfig(): Promise<void> {
    this.rbacError = '';
    await Promise.all([this.loadRoles(), this.loadPermissionKeys()]);
  }

  async loadRoles(): Promise<void> {
    this.isLoadingRoles = true;

    try {
      const response = await this.userManagementService.getRoles();
      if (!response.success) {
        this.roles = [];
        this.rbacError = response.message ?? 'Failed to load roles.';
        return;
      }

      this.roles = (response.data ?? [])
        .map((item) => this.mapRole(item))
        .filter((item) => item.id > 0)
        .sort((left, right) => left.name.localeCompare(right.name));

      if (this.roles.length > 0 && !this.selectedRoleId) {
        this.selectedRoleId = this.roles[0].id;
        await this.loadRolePermissions(this.roles[0].id);
      }
    } catch (error: unknown) {
      this.roles = [];
      this.rbacError = this.resolveErrorMessage(error, 'Failed to load roles.');
    } finally {
      this.isLoadingRoles = false;
    }
  }

  async loadPermissionKeys(): Promise<void> {
    this.isLoadingPermissionKeys = true;

    try {
      const response = await this.userManagementService.getPermissionKeys();
      if (!response.success) {
        this.permissionOptions = [];
        this.rbacError = response.message ?? 'Failed to load permission keys.';
        return;
      }

      this.permissionOptions = (response.data ?? []).map((item) => this.mapPermissionItem(item));
    } catch (error: unknown) {
      this.permissionOptions = [];
      this.rbacError = this.resolveErrorMessage(error, 'Failed to load permission keys.');
    } finally {
      this.isLoadingPermissionKeys = false;
    }
  }

  async onRoleChange(value: number | string): Promise<void> {
    const roleId = Number(value);
    this.selectedRoleId = Number.isFinite(roleId) && roleId > 0 ? roleId : '';
    this.rolePermissionKeys = [];

    if (typeof this.selectedRoleId === 'number') {
      await this.loadRolePermissions(this.selectedRoleId);
    }
  }

  async loadRolePermissions(roleId: number): Promise<void> {
    this.isLoadingRolePermissions = true;

    try {
      const response = await this.userManagementService.getRolePermissions(roleId);
      if (!response.success) {
        this.rolePermissionKeys = [];
        this.rbacError = response.message ?? 'Failed to load role permissions.';
        return;
      }

      this.rolePermissionKeys = (response.data ?? [])
        .map((item) => String(item.permissionKey ?? '').trim())
        .filter((item) => item.length > 0)
        .sort((left, right) => left.localeCompare(right));
    } catch (error: unknown) {
      this.rolePermissionKeys = [];
      this.rbacError = this.resolveErrorMessage(error, 'Failed to load role permissions.');
    } finally {
      this.isLoadingRolePermissions = false;
    }
  }

  async createPermissionKey(): Promise<void> {
    if (!this.canUpdateSettings) {
      this.uiError = 'You do not have permission to create permission keys.';
      return;
    }

    this.isCreatingPermissionKey = true;
    this.uiError = '';
    this.uiMessage = '';
    this.rbacError = '';

    try {
      const response = await this.userManagementService.createPermissionKey({
        key: String(this.newPermissionForm.key ?? '').trim().toLowerCase(),
        label: String(this.newPermissionForm.label ?? '').trim(),
        module: String(this.newPermissionForm.module ?? '').trim().toLowerCase(),
        scope: this.newPermissionForm.scope,
      });

      if (!response.success) {
        this.rbacError = response.message ?? 'Failed to create permission key.';
        return;
      }

      this.permissionOptions = (response.data ?? []).map((item) => this.mapPermissionItem(item));
      this.uiMessage = 'Permission key created successfully.';
      this.newPermissionForm = {
        key: '',
        label: '',
        module: '',
        scope: 'action',
      };
    } catch (error: unknown) {
      this.rbacError = this.resolveErrorMessage(error, 'Failed to create permission key.');
    } finally {
      this.isCreatingPermissionKey = false;
    }
  }

  toggleRolePermission(permissionKey: string, enabled: boolean): void {
    if (!permissionKey) {
      return;
    }

    const selected = new Set(this.rolePermissionKeys);
    if (enabled) {
      selected.add(permissionKey);
    } else {
      selected.delete(permissionKey);
    }

    this.rolePermissionKeys = [...selected].sort((left, right) => left.localeCompare(right));
  }

  isRolePermissionSelected(permissionKey: string): boolean {
    return this.rolePermissionKeys.includes(permissionKey);
  }

  async saveRolePermissions(): Promise<void> {
    if (!this.canUpdateSettings) {
      this.uiError = 'You do not have permission to update role permissions.';
      return;
    }

    if (typeof this.selectedRoleId !== 'number' || this.selectedRoleId <= 0) {
      this.rbacError = 'Select a role before saving permissions.';
      return;
    }

    this.isSavingRolePermissions = true;
    this.uiError = '';
    this.uiMessage = '';
    this.rbacError = '';

    try {
      const response = await this.userManagementService.saveRolePermissions(
        this.selectedRoleId,
        this.rolePermissionKeys,
      );

      if (!response.success) {
        this.rbacError = response.message ?? 'Failed to save role permissions.';
        return;
      }

      this.rolePermissionKeys = (response.data ?? [])
        .map((item) => String(item.permissionKey ?? '').trim())
        .filter((item) => item.length > 0)
        .sort((left, right) => left.localeCompare(right));

      const currentRoleId = Number(this.rbacService.getPayload()?.roleId ?? 0);
      if (currentRoleId > 0 && currentRoleId === this.selectedRoleId) {
        await this.rbacService.syncEffectivePermissions();
      }

      this.uiMessage = `Role permissions saved for ${this.selectedRoleName}.`;
    } catch (error: unknown) {
      this.rbacError = this.resolveErrorMessage(error, 'Failed to save role permissions.');
    } finally {
      this.isSavingRolePermissions = false;
    }
  }

  async loadBusinessProfile(): Promise<void> {
    if (!this.canReadSettings) {
      this.uiError = 'You do not have permission to view settings.';
      return;
    }

    this.isLoading = true;
    this.uiError = '';
    this.uiMessage = '';

    try {
      const item = await this.businessSettingsService.getBusinessProfile();
      this.applyBusinessProfile(item);
    } catch (error: unknown) {
      this.uiError = this.resolveErrorMessage(error, 'Failed to load business settings.');
    } finally {
      this.isLoading = false;
    }
  }

  async loadBranches(): Promise<void> {
    this.isLoadingBranches = true;
    this.branchError = '';

    try {
      const branches = await this.salesOrderService.getBranches();
      this.branchOptions = Array.isArray(branches) ? branches : [];
    } catch (error: unknown) {
      this.branchError = this.resolveErrorMessage(error, 'Failed to load branches.');
      this.branchOptions = [];
    } finally {
      this.isLoadingBranches = false;
    }
  }

  async createBranch(): Promise<void> {
    if (!this.canUpdateSettings) {
      this.uiError = 'You do not have permission to add branches.';
      return;
    }

    const branchName = String(this.newBranchName ?? '').trim();
    const branchAddress = String(this.newBranchAddress ?? '').trim();
    if (!branchName) {
      this.branchError = 'Branch name is required.';
      return;
    }

    this.isCreatingBranch = true;
    this.branchError = '';
    this.uiError = '';
    this.uiMessage = '';

    try {
      const response = await this.salesOrderService.createBranch({
        branchName,
        branchAddress: branchAddress || null,
      });
      if (!response.success) {
        this.branchError = response.message ?? 'Failed to create branch.';
        return;
      }

      this.branchOptions = Array.isArray(response.items) ? response.items : [];
      this.newBranchName = '';
      this.newBranchAddress = '';
      this.uiMessage = 'Branch added successfully.';
    } catch (error: unknown) {
      this.branchError = this.resolveErrorMessage(error, 'Failed to create branch.');
    } finally {
      this.isCreatingBranch = false;
    }
  }

  startEditBranch(branch: BranchOption): void {
    this.editingBranchId = Number(branch.id);
    this.editingBranchName = String(branch.branchName ?? '').trim();
    this.editingBranchAddress = String(branch.branchAddress ?? '').trim();
    this.branchError = '';
  }

  cancelEditBranch(): void {
    this.editingBranchId = null;
    this.editingBranchName = '';
    this.editingBranchAddress = '';
  }

  async saveBranch(branchId: number): Promise<void> {
    if (!this.canUpdateSettings) {
      this.uiError = 'You do not have permission to edit branches.';
      return;
    }

    const branchName = String(this.editingBranchName ?? '').trim();
    const branchAddress = String(this.editingBranchAddress ?? '').trim();
    if (!branchName) {
      this.branchError = 'Branch name is required.';
      return;
    }

    this.isUpdatingBranch = true;
    this.branchError = '';
    this.uiError = '';
    this.uiMessage = '';

    try {
      const response = await this.salesOrderService.updateBranch(branchId, {
        branchName,
        branchAddress: branchAddress || null,
      });
      if (!response.success) {
        this.branchError = response.message ?? 'Failed to update branch.';
        return;
      }

      this.branchOptions = Array.isArray(response.items) ? response.items : [];
      this.cancelEditBranch();
      this.uiMessage = 'Branch updated successfully.';
    } catch (error: unknown) {
      this.branchError = this.resolveErrorMessage(error, 'Failed to update branch.');
    } finally {
      this.isUpdatingBranch = false;
    }
  }

  async deleteBranch(branch: BranchOption): Promise<void> {
    if (!this.canUpdateSettings) {
      this.uiError = 'You do not have permission to delete branches.';
      return;
    }

    const confirmed = window.confirm(
      `Delete branch ${branch.branchName || branch.id}? This will fail if the branch is still referenced by records.`,
    );
    if (!confirmed) {
      return;
    }

    this.deletingBranchId = Number(branch.id);
    this.branchError = '';
    this.uiError = '';
    this.uiMessage = '';

    try {
      const response = await this.salesOrderService.deleteBranch(Number(branch.id));
      if (!response.success) {
        this.branchError = response.message ?? 'Failed to delete branch.';
        return;
      }

      this.branchOptions = Array.isArray(response.items) ? response.items : [];
      if (this.editingBranchId === Number(branch.id)) {
        this.cancelEditBranch();
      }
      this.uiMessage = 'Branch deleted successfully.';
    } catch (error: unknown) {
      this.branchError = this.resolveErrorMessage(error, 'Failed to delete branch.');
    } finally {
      this.deletingBranchId = null;
    }
  }

  async saveBusinessProfile(): Promise<void> {
    if (!this.canUpdateSettings) {
      this.uiError = 'You do not have permission to update settings.';
      return;
    }

    this.isSaving = true;
    this.uiError = '';
    this.uiMessage = '';

    try {
      const response = await this.businessSettingsService.updateBusinessProfile({
        businessName: this.toNullable(this.form.businessName),
        businessAddress: this.toNullable(this.form.businessAddress),
        businessContact: this.toNullable(this.form.businessContact),
        businessEmail: this.toNullable(this.form.businessEmail),
        businessOwner: this.toNullable(this.form.businessOwner),
      });

      if (!response.success) {
        this.uiError = response.message ?? 'Failed to save business settings.';
        return;
      }

      this.applyBusinessProfile(response.item ?? null);
      this.uiMessage = 'Business settings saved successfully.';
    } catch (error: unknown) {
      this.uiError = this.resolveErrorMessage(error, 'Failed to save business settings.');
    } finally {
      this.isSaving = false;
    }
  }

  async onUploadLogo(mode: 'light' | 'dark', event: Event): Promise<void> {
    if (!this.canUpdateSettings) {
      this.uiError = 'You do not have permission to upload logos.';
      return;
    }

    const file = this.readSelectedFile(event);
    if (!file) {
      return;
    }

    if (!file.type.startsWith('image/')) {
      this.uiError = 'Please upload an image file for business logo.';
      return;
    }

    if (mode === 'light') {
      this.isUploadingLightLogo = true;
    } else {
      this.isUploadingDarkLogo = true;
    }

    this.uiError = '';
    this.uiMessage = '';

    try {
      const response = await this.businessSettingsService.uploadBusinessLogo(mode, file);
      if (!response.success) {
        this.uiError = response.message ?? 'Failed to upload logo.';
        return;
      }

      this.applyBusinessProfile(response.item ?? null);
      this.uiMessage = `${mode === 'light' ? 'Light' : 'Dark'} logo uploaded successfully.`;
    } catch (error: unknown) {
      this.uiError = this.resolveErrorMessage(error, 'Failed to upload logo.');
    } finally {
      if (mode === 'light') {
        this.isUploadingLightLogo = false;
      } else {
        this.isUploadingDarkLogo = false;
      }
      this.resetFileInput(event);
    }
  }

  async onRemoveLogo(mode: 'light' | 'dark'): Promise<void> {
    if (!this.canUpdateSettings) {
      this.uiError = 'You do not have permission to remove logos.';
      return;
    }

    if (mode === 'light') {
      this.isRemovingLightLogo = true;
    } else {
      this.isRemovingDarkLogo = true;
    }

    this.uiError = '';
    this.uiMessage = '';

    try {
      const response = await this.businessSettingsService.updateBusinessProfile({
        [mode === 'light' ? 'businessLogoLight' : 'businessLogoDark']: null,
      });

      if (!response.success) {
        this.uiError = response.message ?? 'Failed to remove logo.';
        return;
      }

      this.applyBusinessProfile(response.item ?? null);
      this.uiMessage = `${mode === 'light' ? 'Light' : 'Dark'} logo removed successfully.`;
    } catch (error: unknown) {
      this.uiError = this.resolveErrorMessage(error, 'Failed to remove logo.');
    } finally {
      if (mode === 'light') {
        this.isRemovingLightLogo = false;
      } else {
        this.isRemovingDarkLogo = false;
      }
    }
  }

  async onUploadDrTemplate(event: Event): Promise<void> {
    if (!this.canUpdateSettings) {
      this.uiError = 'You do not have permission to upload DR template.';
      return;
    }

    const file = this.readSelectedFile(event);
    if (!file) {
      return;
    }

    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    if (!isPdf) {
      this.uiError = 'Please upload a PDF file for DR template.';
      return;
    }

    this.isUploadingDrTemplate = true;
    this.uiError = '';
    this.uiMessage = '';

    try {
      const response = await this.businessSettingsService.uploadDrTemplate(file);
      if (!response.success) {
        this.uiError = response.message ?? 'Failed to upload DR template.';
        return;
      }

      this.applyBusinessProfile(response.item ?? null);
      this.uiMessage = 'DR template uploaded successfully.';
    } catch (error: unknown) {
      this.uiError = this.resolveErrorMessage(error, 'Failed to upload DR template.');
    } finally {
      this.isUploadingDrTemplate = false;
      this.resetFileInput(event);
    }
  }

  private applyBusinessProfile(item: BusinessProfileSettings | null): void {
    this.form = {
      businessName: item?.businessName ?? '',
      businessAddress: item?.businessAddress ?? '',
      businessContact: item?.businessContact ?? '',
      businessEmail: item?.businessEmail ?? '',
      businessOwner: item?.businessOwner ?? '',
    };

    this.preview = {
      businessLogoLight: item?.businessLogoLight ?? item?.businessLogo ?? this.defaultBusinessLogoLight,
      businessLogoDark: item?.businessLogoDark ?? item?.businessLogo ?? this.defaultBusinessLogoDark,
      drTemplatePdf: item?.drTemplatePdf ?? this.defaultDrTemplatePdf,
    };
  }

  private mapRole(item: RoleApiItem): { id: number; name: string } {
    return {
      id: Number(item.id ?? 0),
      name: String(item.roleName ?? item.rolename ?? '').trim() || `Role #${item.id}`,
    };
  }

  private mapPermissionItem(item: PermissionKeyApiItem): SettingsPermissionOption {
    return {
      key: String(item.key ?? '').trim(),
      label: String(item.label ?? '').trim() || String(item.key ?? '').trim(),
      module: String(item.module ?? '').trim(),
      scope: String(item.scope ?? '').trim() || 'action',
    };
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

  private readSelectedFile(event: Event): File | null {
    const input = event.target as HTMLInputElement | null;
    const file = input?.files?.[0] ?? null;
    return file;
  }

  private resetFileInput(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    if (input) {
      input.value = '';
    }
  }

  private toNullable(value: unknown): string | null {
    const normalized = String(value ?? '').trim();
    return normalized.length > 0 ? normalized : null;
  }

  private resolveErrorMessage(error: unknown, fallback: string): string {
    if (axios.isAxiosError(error)) {
      return (error.response?.data as { message?: string } | undefined)?.message ?? fallback;
    }

    if (error instanceof Error && error.message) {
      return error.message;
    }

    return fallback;
  }
}
