import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PageBreadcrumbComponent } from '../../shared/components/common/page-breadcrumb/page-breadcrumb.component';
import {
  BusinessProfileSettings,
  BusinessSettingsService,
} from '../../shared/services/business-settings.service';
import { RbacService } from '../../shared/services/rbac.service';
import axios from 'axios';

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
  ) {}

  ngOnInit(): void {
    void this.loadBusinessProfile();
  }

  get canReadSettings(): boolean {
    return this.rbacService.canAccess('settings', 'canRead');
  }

  get canUpdateSettings(): boolean {
    return this.rbacService.canAccess('settings', 'canUpdate');
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
