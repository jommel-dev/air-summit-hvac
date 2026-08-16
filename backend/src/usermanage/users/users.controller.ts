import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { buildAuditContext } from 'src/common/utils/build-audit-context';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('roles')
  findRoles() {
    return this.usersService.findRoles();
  }

  @Get('permission-keys')
  findPermissionKeys() {
    return this.usersService.findPermissionKeys();
  }

  @Post('permission-keys')
  createPermissionKey(
    @Body()
    body: { key?: string; label?: string; module?: string; scope?: 'feature' | 'menu' | 'tab' | 'action' },
    @Req() request: { user?: Record<string, unknown>; ip?: string },
  ) {
    return this.usersService.createPermissionKey(body, buildAuditContext(request));
  }

  @Get('roles/:roleId/permissions')
  findRolePermissions(@Param('roleId') roleId: string) {
    return this.usersService.findRolePermissions(+roleId);
  }

  @Put('roles/:roleId/permissions')
  setRolePermissions(
    @Param('roleId') roleId: string,
    @Body() body: { permissionKeys?: string[] },
    @Req() request: { user?: Record<string, unknown>; ip?: string },
  ) {
    return this.usersService.setRolePermissions(
      +roleId,
      body.permissionKeys ?? [],
      buildAuditContext(request),
    );
  }

  @Post()
  create(
    @Body() createUserDto: CreateUserDto,
    @Req() request: { user?: Record<string, unknown>; ip?: string },
  ) {
    return this.usersService.create(createUserDto, buildAuditContext(request));
  }

  @Get()
  findAll(@Query('includeDeleted') includeDeleted?: string) {
    const includeDeletedFlag = ['1', 'true', 'yes', 'on'].includes(
      String(includeDeleted ?? '').trim().toLowerCase(),
    );

    return this.usersService.findAll(includeDeletedFlag);
  }

  @Get(':id/permission-overrides')
  findUserPermissionOverrides(@Param('id') id: string) {
    return this.usersService.findUserPermissionOverrides(+id);
  }

  @Put(':id/permission-overrides')
  setUserPermissionOverrides(
    @Param('id') id: string,
    @Body() body: { overrides?: Array<{ permissionKey: string; effect: 'allow' | 'deny'; reason?: string | null }> },
    @Req() request: { user?: Record<string, unknown>; ip?: string },
  ) {
    return this.usersService.setUserPermissionOverrides(
      +id,
      body.overrides ?? [],
      buildAuditContext(request),
    );
  }

  @Get(':id/effective-permissions')
  findUserEffectivePermissions(@Param('id') id: string) {
    return this.usersService.findUserEffectivePermissions(+id);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.usersService.findOne(+id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateUserDto: UpdateUserDto,
    @Req() request: { user?: Record<string, unknown>; ip?: string },
  ) {
    return this.usersService.update(+id, updateUserDto, buildAuditContext(request));
  }

  @Delete(':id')
  remove(
    @Param('id') id: string,
    @Req() request: { user?: Record<string, unknown>; ip?: string },
  ) {
    return this.usersService.remove(+id, buildAuditContext(request));
  }

  @Patch(':id/restore')
  restore(
    @Param('id') id: string,
    @Req() request: { user?: Record<string, unknown>; ip?: string },
  ) {
    return this.usersService.restore(+id, buildAuditContext(request));
  }
}
