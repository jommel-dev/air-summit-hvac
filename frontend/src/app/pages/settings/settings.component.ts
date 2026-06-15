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
import {
  AuditLogDetailResponse,
  AuditLogFrontendService,
  AuditLogListItem,
} from '../../shared/services/audit-log.service';
import axios from 'axios';
import { apiClient } from '../../shared/services/api-client';
import { BackupConfirmModalComponent, BackupConfirmMode } from './backup-confirm-modal/backup-confirm-modal.component';

type SettingsTab = 'system' | 'branches' | 'print-settings' | 'rbac-configs' | 'audit-logs' | 'scan-logs' | 'database-backup';

interface SettingsPermissionOption {
  key: string;
  label: string;
  module: string;
  scope: 'feature' | 'menu' | 'tab' | 'action' | string;
}

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [CommonModule, FormsModule, PageBreadcrumbComponent, BackupConfirmModalComponent],
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
  isSavingPrint = false;
  isLoadingCvNextNumber = false;
  cvNextNumber = '';
  isLoadingGjNextNumber = false;
  gjNextNumber = '';
  isUploadingPreparedBySignature = false;
  isUploadingCheckedBySignature = false;
  isUploadingApprovedBySignature = false;

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
  isLoadingAuditLogs = false;
  isLoadingAuditLogDetail = false;
  rbacError = '';
  auditLogError = '';
  rbacSearch = '';
  auditLogSearch = '';
  auditLogActionFilter = '';
  auditLogEntityTypeFilter = '';
  roles: Array<{ id: number; name: string }> = [];
  selectedRoleId: number | '' = '';
  permissionOptions: SettingsPermissionOption[] = [];
  rolePermissionKeys: string[] = [];
  auditLogs: AuditLogListItem[] = [];
  selectedAuditLog: AuditLogListItem | null = null;
  isAuditLogDrawerOpen = false;
  auditLogCurrentPage = 1;
  auditLogPageSize = 15;
  auditLogTotal = 0;
  auditLogTotalPages = 1;

  // Scan Logs
  isLoadingScanLogs = false;
  scanLogFiles: Array<{ filename: string; date: string; sizeKb: number }> = [];
  scanLogEntries: Array<{ timestamp: string; type: string; serialNumber: string; productId: number | null; capacityId: number | null; unitType: string | null; orderId: number | null; orderNumber: string | null; success: boolean; message?: string; userId?: number | null }> = [];
  selectedScanLogDate: string | null = null;
  isLoadingScanLogEntries = false;
  scanLogError = '';
  scanLogSearch = '';

  // Database Backup
  isLoadingBackupLogs = false;
  isCreatingBackup = false;
  backupError = '';
  backupMessage = '';
  selectedBackupType: 'full' | 'data_only' | 'schema_only' = 'full';
  backupLogs: Array<{
    id: number;
    backupType: string;
    fileName: string;
    fileSizeBytes: number;
    status: string;
    errorMessage: string | null;
    initiatedBy: number | null;
    initiatedByName?: string | null;
    startedAt: string;
    completedAt: string | null;
    createdAt: string;
  }> = [];
  backupCurrentPage = 1;
  backupPageSize = 10;
  backupTotal = 0;
  backupTotalPages = 1;
  deletingBackupId: number | null = null;
  isBackupModalOpen = false;
  backupModalMode: BackupConfirmMode = 'create';
  backupModalFileName = '';
  pendingDeleteBackupId: number | null = null;
  newPermissionForm: CreatePermissionKeyPayload = {
    key: '',
    label: '',
    module: '',
    scope: 'action',
  };

  form: {
    websiteTabName: string;
    routingTabName: string;
    businessName: string;
    businessAddress: string;
    businessContact: string;
    businessEmail: string;
    businessOwner: string;
  } = {
    websiteTabName: '',
    routingTabName: '{route}',
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
    printSignaturePreparedBy: string | null;
    printSignatureCheckedBy: string | null;
    printSignatureApprovedBy: string | null;
  } = {
    businessLogoLight: null,
    businessLogoDark: null,
    drTemplatePdf: null,
    printSignaturePreparedBy: null,
    printSignatureCheckedBy: null,
    printSignatureApprovedBy: null,
  };

  printForm: {
    paperSize: string;
    showLogo: boolean;
    logoVariant: string;
    footerText: string;
    quoteHeaderColor: string;
    quoteShowTerms: boolean;
    quoteShowMisc: boolean;
    quoteShowValidity: boolean;
    soShowDiscount: boolean;
    soShowPaymentTerms: boolean;
    soShowSerials: boolean;
    drShowSerials: boolean;
    drShowSignature: boolean;
    addressDetails: string;
    addressShowSoInvoice: boolean;
    addressShowQuotation: boolean;
    addressShowDr: boolean;
    cvNumberPrefix: string;
    cvNumberSuffix: string;
    gjNumberPrefix: string;
    gjNumberSuffix: string;
  } = {
    paperSize: 'A4',
    showLogo: true,
    logoVariant: 'light',
    footerText: '',
    quoteHeaderColor: '#0f9cdf',
    quoteShowTerms: true,
    quoteShowMisc: false,
    quoteShowValidity: true,
    soShowDiscount: false,
    soShowPaymentTerms: true,
    soShowSerials: true,
    drShowSerials: true,
    drShowSignature: true,
    addressDetails: '',
    addressShowSoInvoice: true,
    addressShowQuotation: true,
    addressShowDr: true,
    cvNumberPrefix: 'CV',
    cvNumberSuffix: '',
    gjNumberPrefix: 'GJ',
    gjNumberSuffix: '',
  };

  constructor(
    private readonly businessSettingsService: BusinessSettingsService,
    private readonly rbacService: RbacService,
    private readonly salesOrderService: SalesOrderService,
    private readonly userManagementService: UserManagementService,
    private readonly auditLogService: AuditLogFrontendService,
  ) {}

  ngOnInit(): void {
    void this.loadBusinessProfile();
    void this.loadBranches();
    void this.loadRbacConfig();
    void this.loadCvNextNumber();
    void this.loadGjNextNumber();
  }

  readonly tabs: Array<{ key: SettingsTab; label: string; disabled?: boolean }> = [
    { key: 'system', label: 'System' },
    { key: 'branches', label: 'Branches' },
    { key: 'print-settings', label: 'Print Settings' },
    { key: 'rbac-configs', label: 'RBAC Configs' },
    { key: 'audit-logs', label: 'Audit Logs' },
    { key: 'scan-logs', label: 'Scan Logs' },
    { key: 'database-backup', label: 'Database Backup' },
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
    if (tab === 'audit-logs') {
      void this.loadAuditLogs(1);
    }
    if (tab === 'scan-logs') {
      void this.loadScanLogFiles();
    }
    if (tab === 'database-backup') {
      void this.loadBackupLogs(1);
    }
  }

  get auditLogActionOptions(): string[] {
    return Array.from(
      new Set(
        this.auditLogs
          .map((item) => String(item.action ?? '').trim())
          .filter((item) => item.length > 0),
      ),
    ).sort((left, right) => left.localeCompare(right));
  }

  get auditLogEntityTypeOptions(): string[] {
    return Array.from(
      new Set(
        this.auditLogs
          .map((item) => String(item.entityType ?? '').trim())
          .filter((item) => item.length > 0),
      ),
    ).sort((left, right) => left.localeCompare(right));
  }

  async loadAuditLogs(page = 1): Promise<void> {
    this.isLoadingAuditLogs = true;
    this.auditLogError = '';

    try {
      const response = await this.auditLogService.getAuditLogs({
        page,
        limit: this.auditLogPageSize,
        search: this.auditLogSearch.trim() || undefined,
        action: this.auditLogActionFilter || undefined,
        entityType: this.auditLogEntityTypeFilter || undefined,
      });

      if (!response.success) {
        this.auditLogs = [];
        this.auditLogError = response.message ?? 'Failed to load audit logs.';
        return;
      }

      this.auditLogs = Array.isArray(response.items) ? response.items : [];
      this.auditLogCurrentPage = response.meta?.page ?? page;
      this.auditLogPageSize = response.meta?.limit ?? this.auditLogPageSize;
      this.auditLogTotal = response.meta?.total ?? 0;
      this.auditLogTotalPages = response.meta?.totalPages ?? 1;
    } catch (error: unknown) {
      this.auditLogs = [];
      this.auditLogError = this.resolveErrorMessage(error, 'Failed to load audit logs.');
    } finally {
      this.isLoadingAuditLogs = false;
    }
  }

  async applyAuditLogFilters(): Promise<void> {
    await this.loadAuditLogs(1);
  }

  async openAuditLogDrawer(item: AuditLogListItem): Promise<void> {
    this.isAuditLogDrawerOpen = true;
    this.isLoadingAuditLogDetail = true;
    this.auditLogError = '';
    this.selectedAuditLog = item;

    try {
      const response: AuditLogDetailResponse = await this.auditLogService.getAuditLog(item.id);
      if (!response.success || !response.item) {
        this.auditLogError = response.message ?? 'Failed to load audit log details.';
        return;
      }

      this.selectedAuditLog = response.item;
    } catch (error: unknown) {
      this.auditLogError = this.resolveErrorMessage(error, 'Failed to load audit log details.');
    } finally {
      this.isLoadingAuditLogDetail = false;
    }
  }

  closeAuditLogDrawer(): void {
    this.isAuditLogDrawerOpen = false;
    this.isLoadingAuditLogDetail = false;
    this.selectedAuditLog = null;
  }

  formatAuditTimestamp(value: string | null | undefined): string {
    const raw = String(value ?? '').trim();
    if (!raw) {
      return '-';
    }

    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) {
      return raw;
    }

    return date.toLocaleString('en-PH', {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  formatAuditAction(value: string | null | undefined): string {
    return String(value ?? '')
      .trim()
      .replace(/[_-]+/g, ' ')
      .replace(/\b\w/g, (char) => char.toUpperCase()) || 'Unknown Action';
  }

  formatAuditEntityType(value: string | null | undefined): string {
    return String(value ?? '')
      .trim()
      .replace(/[_-]+/g, ' ')
      .replace(/\b\w/g, (char) => char.toUpperCase()) || 'Unknown Entity';
  }

  getAuditActorLabel(item: AuditLogListItem | null | undefined): string {
    if (!item) {
      return '-';
    }

    const username = String(item.username ?? '').trim();
    const roleName = String(item.roleName ?? '').trim();
    if (username && roleName) {
      return `${username} • ${roleName}`;
    }
    if (username) {
      return username;
    }
    if (roleName) {
      return roleName;
    }

    return 'System / Unknown actor';
  }

  getAuditDescription(item: AuditLogListItem | null | undefined): string {
    const description = String(item?.description ?? item?.metadata?.description ?? '').trim();
    if (description) {
      return description;
    }

    return `${this.formatAuditAction(item?.action)} ${this.formatAuditEntityType(item?.entityType)}`;
  }

  getAuditChanges(item: AuditLogListItem | null | undefined): Array<{ field: string; oldValue: unknown; newValue: unknown }> {
    const changes = item?.metadata?.changes;
    return Array.isArray(changes) ? changes : [];
  }

  // --- Scan Logs ---

  async loadScanLogFiles(): Promise<void> {
    this.isLoadingScanLogs = true;
    this.scanLogError = '';
    try {
      const response = await apiClient.get<{ success: boolean; files: Array<{ filename: string; date: string; sizeKb: number }> }>('/serial-number/scan-logs');
      if (response.data.success) {
        this.scanLogFiles = response.data.files ?? [];
      } else {
        this.scanLogError = 'Failed to load scan log files.';
      }
    } catch {
      this.scanLogError = 'Failed to load scan log files.';
    } finally {
      this.isLoadingScanLogs = false;
    }
  }

  async loadScanLogEntries(date: string): Promise<void> {
    this.selectedScanLogDate = date;
    this.isLoadingScanLogEntries = true;
    this.scanLogError = '';
    this.scanLogEntries = [];
    try {
      const response = await apiClient.get<{ success: boolean; entries: Array<any> }>(`/serial-number/scan-logs/${date}`);
      if (response.data.success) {
        this.scanLogEntries = response.data.entries ?? [];
      } else {
        this.scanLogError = 'Failed to load scan log entries.';
      }
    } catch {
      this.scanLogError = 'Failed to load scan log entries.';
    } finally {
      this.isLoadingScanLogEntries = false;
    }
  }

  get filteredScanLogEntries() {
    const search = this.scanLogSearch.trim().toLowerCase();
    if (!search) return this.scanLogEntries;
    return this.scanLogEntries.filter((e) =>
      e.serialNumber?.toLowerCase().includes(search) ||
      e.type?.toLowerCase().includes(search) ||
      String(e.orderId ?? '').includes(search) ||
      e.orderNumber?.toLowerCase().includes(search)
    );
  }

  closeScanLogEntries(): void {
    this.selectedScanLogDate = null;
    this.scanLogEntries = [];
    this.scanLogSearch = '';
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
        websiteTabName: this.toNullable(this.form.websiteTabName),
        routingTabName: this.toNullable(this.form.routingTabName),
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

  async onUploadSignatorySignature(
    role: 'prepared-by' | 'checked-by' | 'approved-by',
    event: Event,
  ): Promise<void> {
    if (!this.canUpdateSettings) {
      this.uiError = 'You do not have permission to upload signatures.';
      return;
    }

    const file = this.readSelectedFile(event);
    if (!file) {
      return;
    }

    if (!file.type.startsWith('image/')) {
      this.uiError = 'Please upload an image file for signatory signature.';
      return;
    }

    if (role === 'prepared-by') {
      this.isUploadingPreparedBySignature = true;
    } else if (role === 'checked-by') {
      this.isUploadingCheckedBySignature = true;
    } else {
      this.isUploadingApprovedBySignature = true;
    }

    this.uiError = '';
    this.uiMessage = '';

    try {
      const response = await this.businessSettingsService.uploadSignatorySignature(role, file);
      if (!response.success) {
        this.uiError = response.message ?? 'Failed to upload signatory signature.';
        return;
      }

      this.applyBusinessProfile(response.item ?? null);
      this.uiMessage = 'Signatory signature uploaded successfully.';
    } catch (error: unknown) {
      this.uiError = this.resolveErrorMessage(error, 'Failed to upload signatory signature.');
    } finally {
      if (role === 'prepared-by') {
        this.isUploadingPreparedBySignature = false;
      } else if (role === 'checked-by') {
        this.isUploadingCheckedBySignature = false;
      } else {
        this.isUploadingApprovedBySignature = false;
      }

      this.resetFileInput(event);
    }
  }

  private applyBusinessProfile(item: BusinessProfileSettings | null): void {
    this.form = {
      websiteTabName: item?.websiteTabName ?? item?.businessName ?? 'HVAC Warehouse and Sales',
      routingTabName: item?.routingTabName ?? '{route}',
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
      printSignaturePreparedBy: item?.printSignaturePreparedBy ?? null,
      printSignatureCheckedBy: item?.printSignatureCheckedBy ?? null,
      printSignatureApprovedBy: item?.printSignatureApprovedBy ?? null,
    };

    this.printForm = {
      paperSize: item?.printPaperSize ?? 'A4',
      showLogo: this.parsePrintBool(item?.printShowLogo, true),
      logoVariant: item?.printLogoVariant ?? 'light',
      footerText: item?.printFooterText ?? '',
      quoteHeaderColor: item?.printQuoteHeaderColor ?? '#0f9cdf',
      quoteShowTerms: this.parsePrintBool(item?.printQuoteShowTerms, true),
      quoteShowMisc: this.parsePrintBool(item?.printQuoteShowMisc, false),
      quoteShowValidity: this.parsePrintBool(item?.printQuoteShowValidity, true),
      soShowDiscount: this.parsePrintBool(item?.printSoShowDiscount, false),
      soShowPaymentTerms: this.parsePrintBool(item?.printSoShowPaymentTerms, true),
      soShowSerials: this.parsePrintBool(item?.printSoShowSerials, true),
      drShowSerials: this.parsePrintBool(item?.printDrShowSerials, true),
      drShowSignature: this.parsePrintBool(item?.printDrShowSignature, true),
      addressDetails: item?.printAddressDetails ?? '',
      addressShowSoInvoice: this.parsePrintBool(item?.printAddressShowSoInvoice, true),
      addressShowQuotation: this.parsePrintBool(item?.printAddressShowQuotation, true),
      addressShowDr: this.parsePrintBool(item?.printAddressShowDr, true),
      cvNumberPrefix: item?.cvNumberPrefix ?? 'CV',
      cvNumberSuffix: item?.cvNumberSuffix ?? '',
      gjNumberPrefix: item?.gjNumberPrefix ?? 'GJ',
      gjNumberSuffix: item?.gjNumberSuffix ?? '',
    };
  }

  async savePrintSettings(): Promise<void> {
    if (!this.canUpdateSettings) {
      this.uiError = 'You do not have permission to update settings.';
      return;
    }

    this.isSavingPrint = true;
    this.uiError = '';
    this.uiMessage = '';

    try {
      const response = await this.businessSettingsService.updateBusinessProfile({
        printPaperSize: this.printForm.paperSize || 'A4',
        printShowLogo: String(this.printForm.showLogo),
        printLogoVariant: this.printForm.logoVariant || 'light',
        printFooterText: this.toNullable(this.printForm.footerText),
        printQuoteHeaderColor: this.printForm.quoteHeaderColor || '#0f9cdf',
        printQuoteShowTerms: String(this.printForm.quoteShowTerms),
        printQuoteShowMisc: String(this.printForm.quoteShowMisc),
        printQuoteShowValidity: String(this.printForm.quoteShowValidity),
        printSoShowDiscount: String(this.printForm.soShowDiscount),
        printSoShowPaymentTerms: String(this.printForm.soShowPaymentTerms),
        printSoShowSerials: String(this.printForm.soShowSerials),
        printDrShowSerials: String(this.printForm.drShowSerials),
        printDrShowSignature: String(this.printForm.drShowSignature),
        printAddressDetails: this.toNullable(this.printForm.addressDetails),
        printAddressShowSoInvoice: String(this.printForm.addressShowSoInvoice),
        printAddressShowQuotation: String(this.printForm.addressShowQuotation),
        printAddressShowDr: String(this.printForm.addressShowDr),
        cvNumberPrefix: this.printForm.cvNumberPrefix.trim() || 'CV',
        cvNumberSuffix: this.printForm.cvNumberSuffix.trim(),
        gjNumberPrefix: this.printForm.gjNumberPrefix.trim() || 'GJ',
        gjNumberSuffix: this.printForm.gjNumberSuffix.trim(),
      });

      if (!response.success) {
        this.uiError = response.message ?? 'Failed to save print settings.';
        return;
      }

      this.applyBusinessProfile(response.item ?? null);
      this.uiMessage = 'Print settings saved successfully.';
      void this.loadCvNextNumber();
      void this.loadGjNextNumber();
    } catch (error: unknown) {
      this.uiError = this.resolveErrorMessage(error, 'Failed to save print settings.');
    } finally {
      this.isSavingPrint = false;
    }
  }

  async loadCvNextNumber(): Promise<void> {
    this.isLoadingCvNextNumber = true;
    try {
      const response = await apiClient.get<{ success: boolean; data?: { cvNo?: string } }>(
        '/accounting/cheque-vouchers/next-number',
      );
      this.cvNextNumber = String(response.data?.data?.cvNo ?? '').trim();
    } catch {
      this.cvNextNumber = '';
    } finally {
      this.isLoadingCvNextNumber = false;
    }
  }

  async loadGjNextNumber(): Promise<void> {
    this.isLoadingGjNextNumber = true;
    try {
      const response = await apiClient.get<{ success: boolean; data?: { journalNo?: string } }>(
        '/accounting/general-journals/next-number',
      );

      this.gjNextNumber = String(response.data?.data?.journalNo ?? '').trim();
    } catch {
      this.gjNextNumber = '';
    } finally {
      this.isLoadingGjNextNumber = false;
    }
  }

  private parsePrintBool(value: string | null | undefined, defaultValue: boolean): boolean {
    if (value === null || value === undefined) {
      return defaultValue;
    }

    return String(value).trim().toLowerCase() === 'true';
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

  // ─── Database Backup ──────────────────────────────────────────────────────

  async loadBackupLogs(page = 1): Promise<void> {
    this.isLoadingBackupLogs = true;
    this.backupError = '';

    try {
      const response = await apiClient.get<{
        success: boolean;
        data: {
          items: Array<any>;
          total: number;
          totalPages: number;
        };
      }>('/settings/backup/logs', {
        params: { page, pageSize: this.backupPageSize },
      });

      if (response.data.success) {
        this.backupLogs = response.data.data.items ?? [];
        this.backupTotal = response.data.data.total ?? 0;
        this.backupTotalPages = response.data.data.totalPages ?? 1;
        this.backupCurrentPage = page;
      } else {
        this.backupError = 'Failed to load backup logs.';
      }
    } catch (error: unknown) {
      this.backupError = this.resolveErrorMessage(error, 'Failed to load backup logs.');
    } finally {
      this.isLoadingBackupLogs = false;
    }
  }

  async createBackup(): Promise<void> {
    if (!this.canUpdateSettings) {
      this.backupError = 'You do not have permission to create backups.';
      return;
    }

    // Open confirmation modal instead of window.confirm
    this.backupModalMode = 'create';
    this.backupModalFileName = '';
    this.isBackupModalOpen = true;
  }

  async onBackupModalConfirm(): Promise<void> {
    this.isBackupModalOpen = false;

    if (this.backupModalMode === 'create') {
      await this.executeCreateBackup();
    } else if (this.backupModalMode === 'delete' && this.pendingDeleteBackupId !== null) {
      await this.executeDeleteBackup(this.pendingDeleteBackupId);
      this.pendingDeleteBackupId = null;
    }
  }

  onBackupModalCancel(): void {
    this.isBackupModalOpen = false;
    this.pendingDeleteBackupId = null;
  }

  private async executeCreateBackup(): Promise<void> {
    this.isCreatingBackup = true;
    this.backupError = '';
    this.backupMessage = '';

    try {
      const response = await apiClient.post<{
        success: boolean;
        data: any;
        message?: string;
      }>('/settings/backup', {
        backupType: this.selectedBackupType,
      });

      if (response.data.success) {
        const record = response.data.data;
        if (record.status === 'completed') {
          this.backupMessage = `Backup "${record.fileName}" completed successfully (${this.formatFileSize(record.fileSizeBytes)}).`;
        } else if (record.status === 'failed') {
          this.backupError = `Backup failed: ${record.errorMessage || 'Unknown error'}`;
        }
        await this.loadBackupLogs(1);
      } else {
        this.backupError = response.data.message ?? 'Failed to create backup.';
      }
    } catch (error: unknown) {
      this.backupError = this.resolveErrorMessage(error, 'Failed to create backup.');
    } finally {
      this.isCreatingBackup = false;
    }
  }

  async downloadBackupFile(fileName: string): Promise<void> {
    try {
      const response = await apiClient.get(`/settings/backup/download/${fileName}`, {
        responseType: 'blob',
      });
      const blob = new Blob([response.data as BlobPart], { type: 'application/sql' });
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      window.URL.revokeObjectURL(url);
    } catch (error: unknown) {
      this.backupError = this.resolveErrorMessage(error, 'Failed to download backup file.');
    }
  }

  async deleteBackupRecord(id: number, fileName: string): Promise<void> {
    if (!this.canUpdateSettings) {
      this.backupError = 'You do not have permission to delete backups.';
      return;
    }

    // Open confirmation modal instead of window.confirm
    this.backupModalMode = 'delete';
    this.backupModalFileName = fileName;
    this.pendingDeleteBackupId = id;
    this.isBackupModalOpen = true;
  }

  private async executeDeleteBackup(id: number): Promise<void> {
    this.deletingBackupId = id;
    this.backupError = '';

    try {
      const response = await apiClient.delete<{ success: boolean; message?: string }>(`/settings/backup/${id}`);
      if (response.data.success) {
        this.backupMessage = 'Backup deleted successfully.';
        await this.loadBackupLogs(this.backupCurrentPage);
      } else {
        this.backupError = response.data.message ?? 'Failed to delete backup.';
      }
    } catch (error: unknown) {
      this.backupError = this.resolveErrorMessage(error, 'Failed to delete backup.');
    } finally {
      this.deletingBackupId = null;
    }
  }

  getBackupTypeLabel(type: string): string {
    switch (type) {
      case 'full': return 'Full Backup (Data + Schema + Functions)';
      case 'data_only': return 'Data Only';
      case 'schema_only': return 'Schema & Functions Only';
      default: return type;
    }
  }

  formatFileSize(bytes: number): string {
    if (bytes <= 0) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  formatBackupTimestamp(value: string | null | undefined): string {
    const raw = String(value ?? '').trim();
    if (!raw) return '-';
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return raw;
    return date.toLocaleString('en-PH', {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
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
