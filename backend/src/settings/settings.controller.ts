import {
  Body,
  Controller,
  Get,
  Post,
  Put,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { UpdateBusinessProfileDto } from './dto/update-business-profile.dto';
import { SettingsService } from './settings.service';

@Controller('settings')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

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
  updateBusinessProfile(@Body() dto: UpdateBusinessProfileDto) {
    return this.settingsService.updateBusinessProfile(dto);
  }

  @Post('business-profile/logo/light')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('file'))
  uploadLightLogo(@UploadedFile() file: any) {
    return this.settingsService.uploadBusinessAsset('businessLogoLight', file);
  }

  @Post('business-profile/logo/dark')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('file'))
  uploadDarkLogo(@UploadedFile() file: any) {
    return this.settingsService.uploadBusinessAsset('businessLogoDark', file);
  }

  @Post('business-profile/template/dr')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('file'))
  uploadDrTemplate(@UploadedFile() file: any) {
    return this.settingsService.uploadBusinessAsset('drTemplatePdf', file);
  }

  @Post('business-profile/signature/prepared-by')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('file'))
  uploadPreparedBySignature(@UploadedFile() file: any) {
    return this.settingsService.uploadBusinessAsset('printSignaturePreparedBy', file);
  }

  @Post('business-profile/signature/checked-by')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('file'))
  uploadCheckedBySignature(@UploadedFile() file: any) {
    return this.settingsService.uploadBusinessAsset('printSignatureCheckedBy', file);
  }

  @Post('business-profile/signature/approved-by')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('file'))
  uploadApprovedBySignature(@UploadedFile() file: any) {
    return this.settingsService.uploadBusinessAsset('printSignatureApprovedBy', file);
  }
}
