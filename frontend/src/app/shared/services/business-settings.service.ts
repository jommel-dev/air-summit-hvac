import { Injectable } from '@angular/core';
import { apiClient } from './api-client';

export interface BusinessProfileSettings {
  id: string;
  businessName: string | null;
  businessAddress: string | null;
  businessContact: string | null;
  businessEmail: string | null;
  businessOwner: string | null;
  businessLogo: string | null;
  businessLogoLight: string | null;
  businessLogoDark: string | null;
  drTemplatePdf: string | null;
}

interface BusinessProfileResponse {
  success: boolean;
  message?: string;
  item?: BusinessProfileSettings;
}

@Injectable({ providedIn: 'root' })
export class BusinessSettingsService {
  async getPublicBusinessProfile(): Promise<BusinessProfileSettings | null> {
    const response = await apiClient.get<BusinessProfileResponse>('/settings/public/business-profile');
    if (!response.data.success) {
      return null;
    }

    return response.data.item ?? null;
  }

  async getBusinessProfile(): Promise<BusinessProfileSettings | null> {
    const response = await apiClient.get<BusinessProfileResponse>('/settings/business-profile');
    if (!response.data.success) {
      return null;
    }

    return response.data.item ?? null;
  }

  async updateBusinessProfile(payload: Partial<BusinessProfileSettings>): Promise<BusinessProfileResponse> {
    const response = await apiClient.put<BusinessProfileResponse>('/settings/business-profile', payload);
    return response.data;
  }

  async uploadBusinessLogo(
    mode: 'light' | 'dark',
    file: File,
  ): Promise<BusinessProfileResponse> {
    const form = new FormData();
    form.append('file', file);

    const response = await apiClient.post<BusinessProfileResponse>(
      `/settings/business-profile/logo/${mode}`,
      form,
      {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      },
    );

    return response.data;
  }

  async uploadDrTemplate(file: File): Promise<BusinessProfileResponse> {
    const form = new FormData();
    form.append('file', file);

    const response = await apiClient.post<BusinessProfileResponse>(
      '/settings/business-profile/template/dr',
      form,
      {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      },
    );

    return response.data;
  }
}
