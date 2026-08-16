import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { verify } from 'jsonwebtoken';
import { CreateLoginDto } from './dto/create-login.dto';
import { UpdateLoginDto } from './dto/update-login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { DatabaseService } from 'src/database/database.service';
import { AuditActorContext, AuditLogService } from 'src/audit-log/audit-log.service';

@Injectable()
export class LoginService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly auditLogService: AuditLogService,
  ) {}

  private getRefreshSecret(): string {
    return this.configService.get<string>(
      'JWT_REFRESH_SECRET',
      this.configService.get<string>('JWT_SECRET', 'dev-secret'),
    );
  }

  private getRefreshExpiry(): string {
    return this.configService.get<string>('JWT_REFRESH_EXPIRES_IN', '7d');
  }

  async create(createLoginDto: CreateLoginDto, auditActor?: AuditActorContext) {
    const { username, password } = createLoginDto;
    const passwordSha1 = createHash('sha1').update(password).digest('hex');
    const safeUsername = String(username ?? '').trim();

    try {
      const result = await this.databaseService.query<{
        id: number;
        username: string;
        fullname: string | null;
        email: string | null;
        branchId: number | null;
        roleId: number | null;
        roleName: string | null;
        roleMenus: string | null;
        rolePermission: string | null;
      }>(
        `SELECT
          u.id,
          u.username,
          COALESCE(
            to_jsonb(u)->>'fullname',
            to_jsonb(u)->>'fullName',
            to_jsonb(u)->>'full_name'
          ) AS fullname,
          COALESCE(
            to_jsonb(u)->>'email',
            to_jsonb(u)->>'emailAddress',
            to_jsonb(u)->>'email_address'
          ) AS email,
          NULLIF(
            COALESCE(
              to_jsonb(u)->>'branchId',
              to_jsonb(u)->>'branchid',
              to_jsonb(u)->>'branch_id'
            ),
            ''
          )::int AS "branchId",
          NULLIF(
            COALESCE(
              to_jsonb(u)->>'roleId',
              to_jsonb(u)->>'roleid',
              to_jsonb(u)->>'role_id'
            ),
            ''
          )::int AS "roleId",
          COALESCE(to_jsonb(r)->>'roleName', to_jsonb(r)->>'rolename') AS "roleName",
          COALESCE(to_jsonb(r)->>'roleMenus', to_jsonb(r)->>'rolemenus') AS "roleMenus",
          COALESCE(to_jsonb(r)->>'rolePermission', to_jsonb(r)->>'rolepermission') AS "rolePermission"
        FROM tblusers u
        LEFT JOIN tblrbac r
          ON r.id::text = COALESCE(
            to_jsonb(u)->>'roleId',
            to_jsonb(u)->>'roleid',
            to_jsonb(u)->>'role_id'
          )
        WHERE u.username = $1 AND u.password = $2
        LIMIT 1`,
        [username, passwordSha1],
      );

      if (result.rowCount === 0) {
        await this.auditLogService.logMutation({
          action: 'AUTH_LOGIN_FAILURE',
          entityType: 'auth',
          entityId: safeUsername || null,
          actor: {
            ...(auditActor ?? {}),
            username: auditActor?.username || safeUsername || undefined,
          },
          description: `Failed login attempt for ${safeUsername || 'unknown user'}`,
          requestBody: { username: safeUsername || null },
          metadata: {
            reason: 'invalid_credentials',
          },
        });

        return {
          success: false,
          message: 'Invalid username or password',
        };
      }

      const user = result.rows[0];

      const payload = {
        sub: user.id,
        branchId: user.branchId,
        username: user.username,
        fullname: user.fullname,
        email: user.email,
        roleId: user.roleId,
        roleName: user.roleName,
        menus: user.roleMenus,
        permissions: user.rolePermission,
      };

      const accessToken = await this.jwtService.signAsync(payload);
      const refreshToken = await this.jwtService.signAsync(
        {
          sub: user.id,
          username: user.username,
          tokenType: 'refresh',
        },
        {
          secret: this.getRefreshSecret(),
          expiresIn: this.getRefreshExpiry() as any,
        },
      );

      await this.auditLogService.logMutation({
        action: 'AUTH_LOGIN_SUCCESS',
        entityType: 'auth',
        entityId: user.id,
        actor: {
          userId: user.id,
          username: user.username,
          roleName: user.roleName,
          branchId: user.branchId ?? undefined,
          ipAddress: auditActor?.ipAddress,
        },
        description: `Successful login for ${user.username}`,
        requestBody: { username: user.username },
        after: {
          userId: user.id,
          username: user.username,
          roleId: user.roleId,
          roleName: user.roleName,
          branchId: user.branchId,
        },
      });

      return {
        success: true,
        accessToken,
        refreshToken,
        role: {
          id: user.roleId,
          name: user.roleName,
          menus: user.roleMenus,
          permissions: user.rolePermission,
        },
      };
    } catch (error) {
      return {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : 'Unable to connect to PostgreSQL',
      };
    }
  }

  async refresh(refreshTokenDto: RefreshTokenDto) {
    const refreshToken = String(refreshTokenDto?.refreshToken ?? '').trim();
    if (!refreshToken) {
      return {
        success: false,
        message: 'refreshToken is required',
      };
    }

    try {
      const payload = verify(refreshToken, this.getRefreshSecret()) as {
        sub?: unknown;
        tokenType?: string;
      };

      if (payload?.tokenType !== 'refresh') {
        return {
          success: false,
          message: 'Invalid refresh token',
        };
      }

      const userId = Number(payload.sub);
      if (!Number.isFinite(userId) || userId <= 0) {
        return {
          success: false,
          message: 'Invalid refresh token payload',
        };
      }

      const result = await this.databaseService.query<{
        id: number;
        username: string;
        fullname: string | null;
        email: string | null;
        branchId: number | null;
        roleId: number | null;
        roleName: string | null;
        roleMenus: string | null;
        rolePermission: string | null;
      }>(
        `SELECT
          u.id,
          u.username,
          COALESCE(
            to_jsonb(u)->>'fullname',
            to_jsonb(u)->>'fullName',
            to_jsonb(u)->>'full_name'
          ) AS fullname,
          COALESCE(
            to_jsonb(u)->>'email',
            to_jsonb(u)->>'emailAddress',
            to_jsonb(u)->>'email_address'
          ) AS email,
          NULLIF(
            COALESCE(
              to_jsonb(u)->>'branchId',
              to_jsonb(u)->>'branchid',
              to_jsonb(u)->>'branch_id'
            ),
            ''
          )::int AS "branchId",
          NULLIF(
            COALESCE(
              to_jsonb(u)->>'roleId',
              to_jsonb(u)->>'roleid',
              to_jsonb(u)->>'role_id'
            ),
            ''
          )::int AS "roleId",
          COALESCE(to_jsonb(r)->>'roleName', to_jsonb(r)->>'rolename') AS "roleName",
          COALESCE(to_jsonb(r)->>'roleMenus', to_jsonb(r)->>'rolemenus') AS "roleMenus",
          COALESCE(to_jsonb(r)->>'rolePermission', to_jsonb(r)->>'rolepermission') AS "rolePermission"
        FROM tblusers u
        LEFT JOIN tblrbac r
          ON r.id::text = COALESCE(
            to_jsonb(u)->>'roleId',
            to_jsonb(u)->>'roleid',
            to_jsonb(u)->>'role_id'
          )
        WHERE u.id = $1
        LIMIT 1`,
        [userId],
      );

      if (result.rowCount === 0) {
        return {
          success: false,
          message: 'User not found for refresh token',
        };
      }

      const user = result.rows[0];

      const nextPayload = {
        sub: user.id,
        branchId: user.branchId,
        username: user.username,
        fullname: user.fullname,
        email: user.email,
        roleId: user.roleId,
        roleName: user.roleName,
        menus: user.roleMenus,
        permissions: user.rolePermission,
      };

      const nextAccessToken = await this.jwtService.signAsync(nextPayload);
      const nextRefreshToken = await this.jwtService.signAsync(
        {
          sub: user.id,
          username: user.username,
          tokenType: 'refresh',
        },
        {
          secret: this.getRefreshSecret(),
          expiresIn: this.getRefreshExpiry() as any,
        },
      );

      return {
        success: true,
        accessToken: nextAccessToken,
        refreshToken: nextRefreshToken,
        role: {
          id: user.roleId,
          name: user.roleName,
          menus: user.roleMenus,
          permissions: user.rolePermission,
        },
      };
    } catch {
      return {
        success: false,
        message: 'Invalid or expired refresh token',
      };
    }
  }

  findAll() {
    return `This action returns all login`;
  }

  findOne(id: number) {
    return `This action returns a #${id} login`;
  }

  update(id: number, updateLoginDto: UpdateLoginDto) {
    void updateLoginDto;
    return `This action updates a #${id} login`;
  }

  remove(id: number) {
    return `This action removes a #${id} login`;
  }
}
