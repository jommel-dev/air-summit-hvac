import { Injectable } from '@nestjs/common';
import { DatabaseService } from 'src/database/database.service';
import { UpdateBusinessProfileDto } from './dto/update-business-profile.dto';

type BusinessProfileKey =
  | 'businessName'
  | 'businessAddress'
  | 'businessContact'
  | 'businessEmail'
  | 'businessOwner'
  | 'businessLogo'
  | 'businessLogoLight'
  | 'businessLogoDark'
  | 'drTemplatePdf';

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
        businessName: string | null;
        businessAddress: string | null;
        businessContact: string | null;
        businessEmail: string | null;
        businessOwner: string | null;
        businessLogo: string | null;
        businessLogoLight: string | null;
        businessLogoDark: string | null;
        drTemplatePdf: string | null;
      }>(
        `SELECT
           s.id::text AS id,
           COALESCE(to_jsonb(s)->>'businessName', to_jsonb(s)->>'business_name', null) AS "businessName",
           COALESCE(to_jsonb(s)->>'businessAddress', to_jsonb(s)->>'business_address', null) AS "businessAddress",
           COALESCE(to_jsonb(s)->>'businessContact', to_jsonb(s)->>'business_contact', null) AS "businessContact",
           COALESCE(to_jsonb(s)->>'businessEmail', to_jsonb(s)->>'business_email', null) AS "businessEmail",
           COALESCE(to_jsonb(s)->>'businessOwner', to_jsonb(s)->>'business_owner', null) AS "businessOwner",
           COALESCE(to_jsonb(s)->>'businessLogo', to_jsonb(s)->>'business_logo', null) AS "businessLogo",
           COALESCE(to_jsonb(s)->>'businessLogoLight', to_jsonb(s)->>'business_logo_light', null) AS "businessLogoLight",
           COALESCE(to_jsonb(s)->>'businessLogoDark', to_jsonb(s)->>'business_logo_dark', null) AS "businessLogoDark",
           COALESCE(to_jsonb(s)->>'drTemplatePdf', to_jsonb(s)->>'dr_template_pdf', null) AS "drTemplatePdf"
         FROM tblsettings s
         ORDER BY s.id ASC
         LIMIT 1`,
      );

      return {
        success: true,
        item: result.rows[0] ?? {
          id: '0',
          businessName: null,
          businessAddress: null,
          businessContact: null,
          businessEmail: null,
          businessOwner: null,
          businessLogo: null,
          businessLogoLight: null,
          businessLogoDark: null,
          drTemplatePdf: null,
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
        businessName: ['businessName', 'business_name'],
        businessAddress: ['businessAddress', 'business_address'],
        businessContact: ['businessContact', 'business_contact'],
        businessEmail: ['businessEmail', 'business_email'],
        businessOwner: ['businessOwner', 'business_owner'],
        businessLogo: ['businessLogo', 'business_logo'],
        businessLogoLight: ['businessLogoLight', 'business_logo_light'],
        businessLogoDark: ['businessLogoDark', 'business_logo_dark'],
        drTemplatePdf: ['drTemplatePdf', 'dr_template_pdf'],
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

      appendUpdate('businessName');
      appendUpdate('businessAddress');
      appendUpdate('businessContact');
      appendUpdate('businessEmail');
      appendUpdate('businessOwner');
      appendUpdate('businessLogo');
      appendUpdate('businessLogoLight');
      appendUpdate('businessLogoDark');
      appendUpdate('drTemplatePdf');

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
    key: 'businessLogoLight' | 'businessLogoDark' | 'drTemplatePdf',
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
