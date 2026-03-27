import { Injectable } from '@nestjs/common';
import { DatabaseService } from 'src/database/database.service';
import { UpdateBusinessProfileDto } from './dto/update-business-profile.dto';

type BusinessProfileKey =
  | 'websiteTabName'
  | 'routingTabName'
  | 'businessName'
  | 'businessAddress'
  | 'businessContact'
  | 'businessEmail'
  | 'businessOwner'
  | 'businessLogo'
  | 'businessLogoLight'
  | 'businessLogoDark'
  | 'drTemplatePdf'
  | 'printPaperSize'
  | 'printShowLogo'
  | 'printLogoVariant'
  | 'printFooterText'
  | 'printQuoteHeaderColor'
  | 'printQuoteShowTerms'
  | 'printQuoteShowMisc'
  | 'printQuoteShowValidity'
  | 'printSoShowDiscount'
  | 'printSoShowPaymentTerms'
  | 'printSoShowSerials'
  | 'printDrShowSerials'
  | 'printDrShowSignature'
  | 'printReportShowHeader'
  | 'printCvShowPreparedBy'
  | 'printCvShowSignatureLine'
  | 'printAddressDetails'
  | 'printAddressShowSoInvoice'
  | 'printAddressShowQuotation'
  | 'printAddressShowDr'
  | 'printAddressShowAccounting'
  | 'printSignaturePreparedBy'
  | 'printSignatureCheckedBy'
  | 'printSignatureApprovedBy'
  | 'cvNumberPrefix'
  | 'cvNumberSuffix'
  | 'gjNumberPrefix'
  | 'gjNumberSuffix';

@Injectable()
export class SettingsService {
  constructor(private readonly databaseService: DatabaseService) {}

  private normalizeNullableText(value: unknown): string | null {
    if (value === undefined) {
      return null;
    }

    const text = String(value ?? '').trim();
    return text.length > 0 ? text : null;
  }

  private normalizeRequiredText(value: unknown, fallback: string): string {
    const text = String(value ?? '').trim();
    return text.length > 0 ? text : fallback;
  }

  private async getSettingsColumns(): Promise<string[]> {
    const columnsResult = await this.databaseService.query<{ column_name: string }>(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'tblsettings'`,
    );

    return columnsResult.rows.map((row) => row.column_name);
  }

  private pickColumn(columns: string[], candidates: string[]): string | null {
    for (const candidate of candidates) {
      if (columns.includes(candidate)) {
        return candidate;
      }
    }

    return null;
  }

  private async ensureSettingsRow(): Promise<number> {
    const existingResult = await this.databaseService.query<{ id: number }>(
      `SELECT id
       FROM tblsettings
       ORDER BY id ASC
       LIMIT 1`,
    );

    if (existingResult.rowCount && existingResult.rows[0]?.id) {
      return Number(existingResult.rows[0].id);
    }

    const insertResult = await this.databaseService.query<{ id: number }>(
      `INSERT INTO tblsettings DEFAULT VALUES
       RETURNING id`,
    );

    return Number(insertResult.rows[0]?.id ?? 0);
  }

  async getBusinessProfile() {
    try {
      const result = await this.databaseService.query<{
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
      }>(


        `SELECT
           s.id::text AS id,
            COALESCE(to_jsonb(s)->>'websiteTabName', to_jsonb(s)->>'website_tab_name', null) AS "websiteTabName",
            COALESCE(to_jsonb(s)->>'routingTabName', to_jsonb(s)->>'routing_tab_name', null) AS "routingTabName",
           COALESCE(to_jsonb(s)->>'businessName', to_jsonb(s)->>'business_name', null) AS "businessName",
           COALESCE(to_jsonb(s)->>'businessAddress', to_jsonb(s)->>'business_address', null) AS "businessAddress",
           COALESCE(to_jsonb(s)->>'businessContact', to_jsonb(s)->>'business_contact', null) AS "businessContact",
           COALESCE(to_jsonb(s)->>'businessEmail', to_jsonb(s)->>'business_email', null) AS "businessEmail",
           COALESCE(to_jsonb(s)->>'businessOwner', to_jsonb(s)->>'business_owner', null) AS "businessOwner",
           COALESCE(to_jsonb(s)->>'businessLogo', to_jsonb(s)->>'business_logo', null) AS "businessLogo",
           COALESCE(to_jsonb(s)->>'businessLogoLight', to_jsonb(s)->>'business_logo_light', null) AS "businessLogoLight",
           COALESCE(to_jsonb(s)->>'businessLogoDark', to_jsonb(s)->>'business_logo_dark', null) AS "businessLogoDark",
           COALESCE(to_jsonb(s)->>'drTemplatePdf', to_jsonb(s)->>'dr_template_pdf', null) AS "drTemplatePdf",
           COALESCE(to_jsonb(s)->>'printPaperSize', to_jsonb(s)->>'print_paper_size', null) AS "printPaperSize",
           COALESCE(to_jsonb(s)->>'printShowLogo', to_jsonb(s)->>'print_show_logo', null) AS "printShowLogo",
           COALESCE(to_jsonb(s)->>'printLogoVariant', to_jsonb(s)->>'print_logo_variant', null) AS "printLogoVariant",
           COALESCE(to_jsonb(s)->>'printFooterText', to_jsonb(s)->>'print_footer_text', null) AS "printFooterText",
           COALESCE(to_jsonb(s)->>'printQuoteHeaderColor', to_jsonb(s)->>'print_quote_header_color', null) AS "printQuoteHeaderColor",
           COALESCE(to_jsonb(s)->>'printQuoteShowTerms', to_jsonb(s)->>'print_quote_show_terms', null) AS "printQuoteShowTerms",
           COALESCE(to_jsonb(s)->>'printQuoteShowMisc', to_jsonb(s)->>'print_quote_show_misc', null) AS "printQuoteShowMisc",
           COALESCE(to_jsonb(s)->>'printQuoteShowValidity', to_jsonb(s)->>'print_quote_show_validity', null) AS "printQuoteShowValidity",
           COALESCE(to_jsonb(s)->>'printSoShowDiscount', to_jsonb(s)->>'print_so_show_discount', null) AS "printSoShowDiscount",
           COALESCE(to_jsonb(s)->>'printSoShowPaymentTerms', to_jsonb(s)->>'print_so_show_payment_terms', null) AS "printSoShowPaymentTerms",
           COALESCE(to_jsonb(s)->>'printSoShowSerials', to_jsonb(s)->>'print_so_show_serials', null) AS "printSoShowSerials",
           COALESCE(to_jsonb(s)->>'printDrShowSerials', to_jsonb(s)->>'print_dr_show_serials', null) AS "printDrShowSerials",
           COALESCE(to_jsonb(s)->>'printDrShowSignature', to_jsonb(s)->>'print_dr_show_signature', null) AS "printDrShowSignature",
           COALESCE(to_jsonb(s)->>'printReportShowHeader', to_jsonb(s)->>'print_report_show_header', null) AS "printReportShowHeader",
           COALESCE(to_jsonb(s)->>'printCvShowPreparedBy', to_jsonb(s)->>'print_cv_show_prepared_by', null) AS "printCvShowPreparedBy",
           COALESCE(to_jsonb(s)->>'printCvShowSignatureLine', to_jsonb(s)->>'print_cv_show_signature_line', null) AS "printCvShowSignatureLine",
           COALESCE(to_jsonb(s)->>'printAddressDetails', to_jsonb(s)->>'print_address_details', null) AS "printAddressDetails",
           COALESCE(to_jsonb(s)->>'printAddressShowSoInvoice', to_jsonb(s)->>'print_address_show_so_invoice', null) AS "printAddressShowSoInvoice",
           COALESCE(to_jsonb(s)->>'printAddressShowQuotation', to_jsonb(s)->>'print_address_show_quotation', null) AS "printAddressShowQuotation",
           COALESCE(to_jsonb(s)->>'printAddressShowDr', to_jsonb(s)->>'print_address_show_dr', null) AS "printAddressShowDr",
           COALESCE(to_jsonb(s)->>'printAddressShowAccounting', to_jsonb(s)->>'print_address_show_accounting', null) AS "printAddressShowAccounting",
           COALESCE(to_jsonb(s)->>'printSignaturePreparedBy', to_jsonb(s)->>'print_signature_prepared_by', null) AS "printSignaturePreparedBy",
           COALESCE(to_jsonb(s)->>'printSignatureCheckedBy', to_jsonb(s)->>'print_signature_checked_by', null) AS "printSignatureCheckedBy",
           COALESCE(to_jsonb(s)->>'printSignatureApprovedBy', to_jsonb(s)->>'print_signature_approved_by', null) AS "printSignatureApprovedBy",
           COALESCE(to_jsonb(s)->>'cv_number_prefix', null) AS "cvNumberPrefix",
           COALESCE(to_jsonb(s)->>'cv_number_suffix', null) AS "cvNumberSuffix",
           COALESCE(to_jsonb(s)->>'gj_number_prefix', null) AS "gjNumberPrefix",
           COALESCE(to_jsonb(s)->>'gj_number_suffix', null) AS "gjNumberSuffix"
         FROM tblsettings s
         ORDER BY s.id ASC
         LIMIT 1`,
      );

      return {
        success: true,
        item: result.rows[0] ?? {
          id: '0',
          websiteTabName: null,
          routingTabName: null,
          businessName: null,
          businessAddress: null,
          businessContact: null,
          businessEmail: null,
          businessOwner: null,
          businessLogo: null,
          businessLogoLight: null,
          businessLogoDark: null,
          drTemplatePdf: null,
          printPaperSize: null,
          printShowLogo: null,
          printLogoVariant: null,
          printFooterText: null,
          printQuoteHeaderColor: null,
          printQuoteShowTerms: null,
          printQuoteShowMisc: null,
          printQuoteShowValidity: null,
          printSoShowDiscount: null,
          printSoShowPaymentTerms: null,
          printSoShowSerials: null,
          printDrShowSerials: null,
          printDrShowSignature: null,
          printReportShowHeader: null,
          printCvShowPreparedBy: null,
          printCvShowSignatureLine: null,
          printAddressDetails: null,
          printAddressShowSoInvoice: null,
          printAddressShowQuotation: null,
          printAddressShowDr: null,
          printAddressShowAccounting: null,
          printSignaturePreparedBy: null,
          printSignatureCheckedBy: null,
          printSignatureApprovedBy: null,
          cvNumberPrefix: null,
          cvNumberSuffix: null,
          gjNumberPrefix: null,
          gjNumberSuffix: null,
        },
      };
    } catch (error) {
      return {
        success: false,
        message:
          error instanceof Error ? error.message : 'Unable to load business profile settings',
      };
    }
  }

  async updateBusinessProfile(dto: UpdateBusinessProfileDto) {
    try {
      const settingsId = await this.ensureSettingsRow();
      const columns = await this.getSettingsColumns();

      const fieldCandidates: Record<BusinessProfileKey, string[]> = {
        websiteTabName: ['websiteTabName', 'website_tab_name'],
        routingTabName: ['routingTabName', 'routing_tab_name'],
        businessName: ['businessName', 'business_name'],
        businessAddress: ['businessAddress', 'business_address'],
        businessContact: ['businessContact', 'business_contact'],
        businessEmail: ['businessEmail', 'business_email'],
        businessOwner: ['businessOwner', 'business_owner'],
        businessLogo: ['businessLogo', 'business_logo'],
        businessLogoLight: ['businessLogoLight', 'business_logo_light'],
        businessLogoDark: ['businessLogoDark', 'business_logo_dark'],
        drTemplatePdf: ['drTemplatePdf', 'dr_template_pdf'],
        printPaperSize: ['printPaperSize', 'print_paper_size'],
        printShowLogo: ['printShowLogo', 'print_show_logo'],
        printLogoVariant: ['printLogoVariant', 'print_logo_variant'],
        printFooterText: ['printFooterText', 'print_footer_text'],
        printQuoteHeaderColor: ['printQuoteHeaderColor', 'print_quote_header_color'],
        printQuoteShowTerms: ['printQuoteShowTerms', 'print_quote_show_terms'],
        printQuoteShowMisc: ['printQuoteShowMisc', 'print_quote_show_misc'],
        printQuoteShowValidity: ['printQuoteShowValidity', 'print_quote_show_validity'],
        printSoShowDiscount: ['printSoShowDiscount', 'print_so_show_discount'],
        printSoShowPaymentTerms: ['printSoShowPaymentTerms', 'print_so_show_payment_terms'],
        printSoShowSerials: ['printSoShowSerials', 'print_so_show_serials'],
        printDrShowSerials: ['printDrShowSerials', 'print_dr_show_serials'],
        printDrShowSignature: ['printDrShowSignature', 'print_dr_show_signature'],
        printReportShowHeader: ['printReportShowHeader', 'print_report_show_header'],
        printCvShowPreparedBy: ['printCvShowPreparedBy', 'print_cv_show_prepared_by'],
        printCvShowSignatureLine: ['printCvShowSignatureLine', 'print_cv_show_signature_line'],
        printAddressDetails: ['printAddressDetails', 'print_address_details'],
        printAddressShowSoInvoice: ['printAddressShowSoInvoice', 'print_address_show_so_invoice'],
        printAddressShowQuotation: ['printAddressShowQuotation', 'print_address_show_quotation'],
        printAddressShowDr: ['printAddressShowDr', 'print_address_show_dr'],
        printAddressShowAccounting: ['printAddressShowAccounting', 'print_address_show_accounting'],
        printSignaturePreparedBy: ['printSignaturePreparedBy', 'print_signature_prepared_by'],
        printSignatureCheckedBy: ['printSignatureCheckedBy', 'print_signature_checked_by'],
        printSignatureApprovedBy: ['printSignatureApprovedBy', 'print_signature_approved_by'],
        cvNumberPrefix: ['cv_number_prefix'],
        cvNumberSuffix: ['cv_number_suffix'],
        gjNumberPrefix: ['gj_number_prefix'],
        gjNumberSuffix: ['gj_number_suffix'],
      };

      const values: unknown[] = [];
      const setClauses: string[] = [];

      const appendUpdate = (key: BusinessProfileKey) => {
        if (dto[key] === undefined) {
          return;
        }

        const column = this.pickColumn(columns, fieldCandidates[key]);
        if (!column) {
          return;
        }

        values.push(this.normalizeNullableText(dto[key]));
        setClauses.push(`"${column}" = $${values.length}`);
      };

      appendUpdate('websiteTabName');
      appendUpdate('routingTabName');
      appendUpdate('businessName');
      appendUpdate('businessAddress');
      appendUpdate('businessContact');
      appendUpdate('businessEmail');
      appendUpdate('businessOwner');
      appendUpdate('businessLogo');
      appendUpdate('businessLogoLight');
      appendUpdate('businessLogoDark');
      appendUpdate('drTemplatePdf');
      appendUpdate('printPaperSize');
      appendUpdate('printShowLogo');
      appendUpdate('printLogoVariant');
      appendUpdate('printFooterText');
      appendUpdate('printQuoteHeaderColor');
      appendUpdate('printQuoteShowTerms');
      appendUpdate('printQuoteShowMisc');
      appendUpdate('printQuoteShowValidity');
      appendUpdate('printSoShowDiscount');
      appendUpdate('printSoShowPaymentTerms');
      appendUpdate('printSoShowSerials');
      appendUpdate('printDrShowSerials');
      appendUpdate('printDrShowSignature');
      appendUpdate('printReportShowHeader');
      appendUpdate('printCvShowPreparedBy');
      appendUpdate('printCvShowSignatureLine');
      appendUpdate('printAddressDetails');
      appendUpdate('printAddressShowSoInvoice');
      appendUpdate('printAddressShowQuotation');
      appendUpdate('printAddressShowDr');
      appendUpdate('printAddressShowAccounting');
      appendUpdate('printSignaturePreparedBy');
      appendUpdate('printSignatureCheckedBy');
      appendUpdate('printSignatureApprovedBy');

      // cv_number_prefix / cv_number_suffix are NOT NULL — use empty-string fallback
      const appendRequiredText = (key: BusinessProfileKey, fallback: string) => {
        if (dto[key] === undefined) return;
        const column = this.pickColumn(columns, fieldCandidates[key]);
        if (!column) return;
        values.push(this.normalizeRequiredText(dto[key], fallback));
        setClauses.push(`"${column}" = $${values.length}`);
      };
      appendRequiredText('cvNumberPrefix', 'CV');
      appendRequiredText('cvNumberSuffix', '');
      appendRequiredText('gjNumberPrefix', 'GJ');
      appendRequiredText('gjNumberSuffix', '');

      if (setClauses.length > 0) {
        values.push(settingsId);
        await this.databaseService.query(
          `UPDATE tblsettings
           SET ${setClauses.join(', ')}
           WHERE id = $${values.length}`,
          values,
        );
      }

      return this.getBusinessProfile();
    } catch (error) {
      return {
        success: false,
        message:
          error instanceof Error ? error.message : 'Unable to update business profile settings',
      };
    }
  }

  private convertFileToDataUrl(file: any): string {
    const mimeType = String(file.mimetype || 'application/octet-stream').trim();
    const base64 = file.buffer.toString('base64');
    return `data:${mimeType};base64,${base64}`;
  }

  async uploadBusinessAsset(
    key:
      | 'businessLogoLight'
      | 'businessLogoDark'
      | 'drTemplatePdf'
      | 'printSignaturePreparedBy'
      | 'printSignatureCheckedBy'
      | 'printSignatureApprovedBy',
    file: any,
  ) {
    if (!file || !file.buffer || file.size <= 0) {
      return {
        success: false,
        message: 'File is required',
      };
    }

    if (key === 'drTemplatePdf' && !String(file.mimetype || '').toLowerCase().includes('pdf')) {
      return {
        success: false,
        message: 'Only PDF file is allowed for DR template',
      };
    }

    if (key !== 'drTemplatePdf' && !String(file.mimetype || '').toLowerCase().startsWith('image/')) {
      return {
        success: false,
        message: 'Only image file is allowed for logo upload',
      };
    }

    const payload: UpdateBusinessProfileDto = {
      [key]: this.convertFileToDataUrl(file),
    };

    return this.updateBusinessProfile(payload);
  }
}
