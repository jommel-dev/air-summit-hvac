import { Injectable } from '@angular/core';
import { apiClient } from './api-client';

export interface BusinessProfileSettings {
  id: string;
  websiteTabName: string | null;
  routingTabName: string | null;
  businessName: string | null;
  businessAddress: string | null;
  businessContact: string | null;
  businessEmail: string | null;
  businessOwner: string | null;
  businessLogo: string | null;
  businessLogoLight: string | null;
  businessLogoDark: string | null;
  drTemplatePdf: string | null;
  printPaperSize: string | null;
  printShowLogo: string | null;
  printLogoVariant: string | null;
  printFooterText: string | null;
  printQuoteHeaderColor: string | null;
  printQuoteShowTerms: string | null;
  printQuoteShowMisc: string | null;
  printQuoteShowValidity: string | null;
  printSoShowDiscount: string | null;
  printSoShowPaymentTerms: string | null;
  printSoShowSerials: string | null;
  printDrShowSerials: string | null;
  printDrShowSignature: string | null;
  printReportShowHeader: string | null;
  printCvShowPreparedBy: string | null;
  printCvShowSignatureLine: string | null;
  printAddressDetails: string | null;
  printAddressShowSoInvoice: string | null;
  printAddressShowQuotation: string | null;
  printAddressShowDr: string | null;
  printAddressShowAccounting: string | null;
  printSignaturePreparedBy: string | null;
  printSignatureCheckedBy: string | null;
  printSignatureApprovedBy: string | null;
  cvNumberPrefix: string | null;
  cvNumberSuffix: string | null;
  gjNumberPrefix: string | null;
  gjNumberSuffix: string | null;
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

  async uploadSignatorySignature(
    role: 'prepared-by' | 'checked-by' | 'approved-by',
    file: File,
  ): Promise<BusinessProfileResponse> {
    const form = new FormData();
    form.append('file', file);

    const response = await apiClient.post<BusinessProfileResponse>(
      `/settings/business-profile/signature/${role}`,
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
