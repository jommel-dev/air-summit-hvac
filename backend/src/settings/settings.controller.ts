import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { buildAuditContext } from 'src/common/utils/build-audit-context';
import { UpdateBusinessProfileDto } from './dto/update-business-profile.dto';
import { CreateBackupDto } from './dto/create-backup.dto';
import { SettingsService } from './settings.service';
import { BackupService } from './backup.service';

@Controller('settings')
export class SettingsController {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly backupService: BackupService,
  ) {}

  @Get('public/business-profile')
  getPublicBusinessProfile() {
    return this.settingsService.getBusinessProfile();
  }

  @Get('business-profile')
  @UseGuards(JwtAuthGuard)
  getBusinessProfile() {
    return this.settingsService.getBusinessProfile();
  }

  @Put('business-profile')
  @UseGuards(JwtAuthGuard)
  updateBusinessProfile(
    @Body() dto: UpdateBusinessProfileDto,
    @Req() request: { user?: Record<string, unknown>; ip?: string },
  ) {
    return this.settingsService.updateBusinessProfile(dto, buildAuditContext(request));
  }

  @Post('business-profile/logo/light')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('file'))
  uploadLightLogo(
    @UploadedFile() file: any,
    @Req() request: { user?: Record<string, unknown>; ip?: string },
  ) {
    return this.settingsService.uploadBusinessAsset(
      'businessLogoLight',
      file,
      buildAuditContext(request),
    );
  }

  @Post('business-profile/logo/dark')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('file'))
  uploadDarkLogo(
    @UploadedFile() file: any,
    @Req() request: { user?: Record<string, unknown>; ip?: string },
  ) {
    return this.settingsService.uploadBusinessAsset(
      'businessLogoDark',
      file,
      buildAuditContext(request),
    );
  }

  @Post('business-profile/template/dr')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('file'))
  uploadDrTemplate(
    @UploadedFile() file: any,
    @Req() request: { user?: Record<string, unknown>; ip?: string },
  ) {
    return this.settingsService.uploadBusinessAsset(
      'drTemplatePdf',
      file,
      buildAuditContext(request),
    );
  }

  @Post('business-profile/signature/prepared-by')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('file'))
  uploadPreparedBySignature(
    @UploadedFile() file: any,
    @Req() request: { user?: Record<string, unknown>; ip?: string },
  ) {
    return this.settingsService.uploadBusinessAsset(
      'printSignaturePreparedBy',
      file,
      buildAuditContext(request),
    );
  }

  @Post('business-profile/signature/checked-by')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('file'))
  uploadCheckedBySignature(
    @UploadedFile() file: any,
    @Req() request: { user?: Record<string, unknown>; ip?: string },
  ) {
    return this.settingsService.uploadBusinessAsset(
      'printSignatureCheckedBy',
      file,
      buildAuditContext(request),
    );
  }

  @Post('business-profile/signature/approved-by')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('file'))
  uploadApprovedBySignature(
    @UploadedFile() file: any,
    @Req() request: { user?: Record<string, unknown>; ip?: string },
  ) {
    return this.settingsService.uploadBusinessAsset(
      'printSignatureApprovedBy',
      file,
      buildAuditContext(request),
    );
  }

  // ─── Database Backup Endpoints ─────────────────────────────────────────────

  @Post('backup')
  @UseGuards(JwtAuthGuard)
  async createBackup(
    @Body() dto: CreateBackupDto,
    @Req() req: { user?: Record<string, unknown>; ip?: string },
  ) {
    const userId = req.user?.sub ?? req.user?.id ?? null;
    const record = await this.backupService.createBackup(
      dto.backupType,
      userId != null ? Number(userId) : undefined,
      buildAuditContext(req),
    );
    return { success: true, data: record };
  }

  @Get('backup/logs')
  @UseGuards(JwtAuthGuard)
  async getBackupLogs(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const p = Math.max(1, parseInt(page ?? '1', 10) || 1);
    const ps = Math.max(1, Math.min(100, parseInt(pageSize ?? '15', 10) || 15));
    const result = await this.backupService.getBackupLogs(p, ps);
    return { success: true, data: result };
  }

  @Get('backup/download/:fileName')
  @UseGuards(JwtAuthGuard)
  async downloadBackup(@Param('fileName') fileName: string, @Res() res: any) {
    // Sanitize fileName to prevent path traversal
    const sanitizedName = fileName.replace(/[^a-zA-Z0-9._-]/g, '');
    const { filePath, exists } = await this.backupService.downloadBackup(sanitizedName);

    if (!exists) {
      return res.status(404).json({ success: false, message: 'Backup file not found' });
    }

    res.download(filePath, sanitizedName);
  }

  @Delete('backup/:id')
  @UseGuards(JwtAuthGuard)
  async deleteBackup(
    @Param('id') id: string,
    @Req() request: { user?: Record<string, unknown>; ip?: string },
  ) {
    const numId = parseInt(id, 10);
    if (!Number.isFinite(numId) || numId <= 0) {
      return { success: false, message: 'Invalid backup ID' };
    }
    const result = await this.backupService.deleteBackup(numId, buildAuditContext(request));
    return result;
  }
}
