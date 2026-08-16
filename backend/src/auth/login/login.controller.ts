import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  HttpCode,
  HttpStatus,
  Req,
} from '@nestjs/common';
import { LoginService } from './login.service';
import { CreateLoginDto } from './dto/create-login.dto';
import { UpdateLoginDto } from './dto/update-login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { buildAuditContext } from 'src/common/utils/build-audit-context';

@Controller('login')
export class LoginController {
  constructor(private readonly loginService: LoginService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  create(
    @Body() createLoginDto: CreateLoginDto,
    @Req() request: { user?: Record<string, unknown>; ip?: string },
  ) {
    return this.loginService.create(createLoginDto, buildAuditContext(request));
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Body() refreshTokenDto: RefreshTokenDto) {
    return this.loginService.refresh(refreshTokenDto);
  }

  @Get()
  findAll() {
    return this.loginService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.loginService.findOne(+id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateLoginDto: UpdateLoginDto) {
    return this.loginService.update(+id, updateLoginDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.loginService.remove(+id);
  }
}
