import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { DatabaseService } from 'src/database/database.service';

type PermissionOverrideInput = {
  permissionKey: string;
  effect: 'allow' | 'deny';
  reason?: string | null;
};

@Injectable()
export class UsersService {
  constructor(private readonly databaseService: DatabaseService) {}

  async findPermissionKeys() {
    try {
      const result = await this.databaseService.query<{
        key: string;
        label: string;
        module: string;
        scope: string;
      }>(
        `SELECT
          key,
          label,
          module,
          scope
        FROM auth_permission_keys
        ORDER BY module ASC, scope ASC, key ASC`,
      );

      return {
        success: true,
        data: result.rows,
      };
    } catch (error) {
      return {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : 'Unable to load permission keys',
      };
    }
  }

  async findRolePermissions(roleId: number) {
    if (!Number.isFinite(roleId) || roleId <= 0) {
      return {
        success: false,
        message: 'Invalid role id',
      };
    }

    try {
      const result = await this.databaseService.query<{
        permissionKey: string;
        label: string;
        module: string;
        scope: string;
      }>(
        `SELECT
          pk.key AS "permissionKey",
          pk.label,
          pk.module,
          pk.scope
        FROM auth_role_permissions rp
        INNER JOIN auth_permission_keys pk
          ON pk.id = rp.permission_id
        WHERE rp.role_id = $1
        ORDER BY pk.module ASC, pk.scope ASC, pk.key ASC`,
        [roleId],
      );

      return {
        success: true,
        data: result.rows,
      };
    } catch (error) {
      return {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : 'Unable to load role permissions',
      };
    }
  }

  async findUserPermissionOverrides(userId: number) {
    if (!Number.isFinite(userId) || userId <= 0) {
      return {
        success: false,
        message: 'Invalid user id',
      };
    }

    try {
      const result = await this.databaseService.query<{
        permissionKey: string;
        effect: 'allow' | 'deny';
        reason: string | null;
      }>(
        `SELECT
          pk.key AS "permissionKey",
          uo.effect,
          uo.reason
        FROM auth_user_permission_overrides uo
        INNER JOIN auth_permission_keys pk
          ON pk.id = uo.permission_id
        WHERE uo.user_id = $1
        ORDER BY pk.key ASC`,
        [userId],
      );

      return {
        success: true,
        data: result.rows,
      };
    } catch (error) {
      return {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : 'Unable to load user permission overrides',
      };
    }
  }

  async setUserPermissionOverrides(
    userId: number,
    overrides: PermissionOverrideInput[],
  ) {
    if (!Number.isFinite(userId) || userId <= 0) {
      return {
        success: false,
        message: 'Invalid user id',
      };
    }

    const normalizedOverrides = (overrides ?? [])
      .map((item) => ({
        permissionKey: String(item.permissionKey ?? '').trim(),
        effect: item.effect,
        reason:
          item.reason == null || String(item.reason).trim().length === 0
            ? null
            : String(item.reason).trim(),
      }))
      .filter(
        (item) =>
          item.permissionKey.length > 0 &&
          (item.effect === 'allow' || item.effect === 'deny'),
      );

    const deduplicatedOverrides = new Map<string, PermissionOverrideInput>();
    for (const item of normalizedOverrides) {
      deduplicatedOverrides.set(item.permissionKey, item);
    }

    const overridesToSave = [...deduplicatedOverrides.values()];

    try {
      const userExists = await this.databaseService.query<{ id: number }>(
        `SELECT id FROM tblusers WHERE id = $1 LIMIT 1`,
        [userId],
      );

      if (userExists.rowCount === 0) {
        return {
          success: false,
          message: 'User not found',
        };
      }

      if (overridesToSave.length === 0) {
        await this.databaseService.query(
          `DELETE FROM auth_user_permission_overrides
           WHERE user_id = $1`,
          [userId],
        );

        return {
          success: true,
          data: [],
        };
      }

      const requestedKeys = overridesToSave.map((item) => item.permissionKey);
      const keyRows = await this.databaseService.query<{
        id: number;
        key: string;
      }>(
        `SELECT id, key
         FROM auth_permission_keys
         WHERE key = ANY($1::text[])`,
        [requestedKeys],
      );

      const permissionIdByKey = new Map<string, number>(
        keyRows.rows.map((row) => [row.key, row.id]),
      );

      const missingKeys = requestedKeys.filter(
        (key) => !permissionIdByKey.has(key),
      );

      if (missingKeys.length > 0) {
        return {
          success: false,
          message: `Unknown permission keys: ${missingKeys.join(', ')}`,
        };
      }

      await this.databaseService.withTransaction(async (client) => {
        await client.query(
          `DELETE FROM auth_user_permission_overrides
           WHERE user_id = $1`,
          [userId],
        );

        const permissionIds = overridesToSave.map(
          (item) => permissionIdByKey.get(item.permissionKey) ?? 0,
        );
        const effects = overridesToSave.map((item) => item.effect);
        const reasons = overridesToSave.map((item) => item.reason ?? null);

        await client.query(
          `INSERT INTO auth_user_permission_overrides (
             user_id,
             permission_id,
             effect,
             reason
           )
           SELECT
             $1,
             data.permission_id,
             data.effect,
             data.reason
           FROM UNNEST(
             $2::bigint[],
             $3::text[],
             $4::text[]
           ) AS data(permission_id, effect, reason)`,
          [userId, permissionIds, effects, reasons],
        );
      });

      return {
        success: true,
        data: overridesToSave,
      };
    } catch (error) {
      return {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : 'Unable to save user permission overrides',
      };
    }
  }

  async findUserEffectivePermissions(userId: number) {
    if (!Number.isFinite(userId) || userId <= 0) {
      return {
        success: false,
        message: 'Invalid user id',
      };
    }

    try {
      const result = await this.databaseService.query<{
        permissionKey: string;
        permissionLabel: string;
        module: string;
        scope: string;
        isAllowed: boolean;
        source: 'role' | 'user-allow' | 'user-deny' | 'none';
      }>(
        `SELECT
          permission_key AS "permissionKey",
          permission_label AS "permissionLabel",
          module,
          scope,
          is_allowed AS "isAllowed",
          source
        FROM v_auth_user_effective_permissions
        WHERE user_id = $1
        ORDER BY module ASC, scope ASC, permission_key ASC`,
        [userId],
      );

      return {
        success: true,
        data: result.rows,
      };
    } catch (error) {
      return {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : 'Unable to load user effective permissions',
      };
    }
  }

  async findRoles() {
    try {
      const result = await this.databaseService.query<{
        id: number;
        roleName: string | null;
        roleMenus: string | null;
        rolePermission: string | null;
      }>(
        `SELECT
          r.id,
          COALESCE(to_jsonb(r)->>'roleName', to_jsonb(r)->>'rolename') AS "roleName",
          COALESCE(to_jsonb(r)->>'roleMenus', to_jsonb(r)->>'rolemenus') AS "roleMenus",
          COALESCE(to_jsonb(r)->>'rolePermission', to_jsonb(r)->>'rolepermission') AS "rolePermission"
        FROM tblrbac r
        ORDER BY r.id ASC`,
      );

      return {
        success: true,
        data: result.rows,
      };
    } catch (error) {
      return {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : 'Unable to load roles from tblrbac',
      };
    }
  }

  private async getTableColumns(tableName: string): Promise<string[]> {
    const result = await this.databaseService.query<{ column_name: string }>(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_name = $1
         AND table_schema = current_schema()`,
      [tableName],
    );

    return result.rows.map((row) => row.column_name);
  }

  private pickColumn(
    availableColumns: string[],
    candidates: string[],
  ): string | undefined {
    const availableColumnsLower = new Set(
      availableColumns.map((column) => column.toLowerCase()),
    );

    return candidates.find((candidate) =>
      availableColumnsLower.has(candidate.toLowerCase()),
    );
  }

  async create(createUserDto: CreateUserDto) {
    const username = createUserDto.username?.trim();
    const fullname = createUserDto.fullname?.trim();

    if (!username || !createUserDto.password || !fullname) {
      return {
        success: false,
        message: 'username, password, and fullname are required',
      };
    }

    const passwordSha1 = createHash('sha1')
      .update(createUserDto.password)
      .digest('hex');

    try {
      const duplicateUsername = await this.databaseService.query<{ id: number }>(
        `SELECT id
         FROM tblusers
         WHERE LOWER(TRIM(username)) = LOWER(TRIM($1))
         LIMIT 1`,
        [username],
      );

      if (duplicateUsername.rowCount > 0) {
        return {
          success: false,
          message: 'Username already exists',
        };
      }

      const email = createUserDto.email?.trim();
      if (email) {
        const duplicateEmail = await this.databaseService.query<{ id: number }>(
          `SELECT id
           FROM tblusers
           WHERE LOWER(TRIM(email)) = LOWER(TRIM($1))
           LIMIT 1`,
          [email],
        );

        if (duplicateEmail.rowCount > 0) {
          return {
            success: false,
            message: 'Email already exists',
          };
        }
      }

      const columns = await this.getTableColumns('tblusers');
      if (columns.length === 0) {
        return {
          success: false,
          message: 'tblusers table was not found in current schema',
        };
      }

      const record: Record<string, unknown> = {
        username,
        password: passwordSha1,
        fullname,
      };

      const birthdateColumn = this.pickColumn(columns, ['birthdate']);
      const addressColumn = this.pickColumn(columns, ['address']);
      const emailColumn = this.pickColumn(columns, ['email']);
      const contactColumn = this.pickColumn(columns, ['contact']);
      const statusColumn = this.pickColumn(columns, ['status']);
      const isDeletedColumn = this.pickColumn(columns, ['is_deleted', 'isDeleted']);
      const createdByColumn = this.pickColumn(columns, [
        'created_by',
        'createdBy',
      ]);
      const roleIdColumn = this.pickColumn(columns, ['roleId', 'role_id', 'roleid']);
      const branchIdColumn = this.pickColumn(columns, [
        'branchId',
        'branch_id',
        'branchid',
      ]);

      if (birthdateColumn && createUserDto.birthdate) {
        record[birthdateColumn] = createUserDto.birthdate;
      }
      if (addressColumn && createUserDto.address) {
        record[addressColumn] = createUserDto.address;
      }
      if (emailColumn && email) {
        record[emailColumn] = email;
      }
      if (contactColumn && createUserDto.contact) {
        record[contactColumn] = createUserDto.contact;
      }
      if (statusColumn) {
        record[statusColumn] = createUserDto.status ?? 1;
      }
      if (isDeletedColumn) {
        record[isDeletedColumn] = createUserDto.is_deleted ?? false;
      }
      if (createdByColumn && createUserDto.created_by != null) {
        record[createdByColumn] = createUserDto.created_by;
      }
      if (roleIdColumn && createUserDto.roleId != null) {
        record[roleIdColumn] = createUserDto.roleId;
      }
      if (branchIdColumn && createUserDto.branchId != null) {
        record[branchIdColumn] = createUserDto.branchId;
      }

      const insertColumns = Object.keys(record);
      const insertValues = Object.values(record);
      const quotedColumns = insertColumns.map((column) => `"${column}"`).join(', ');
      const placeholders = insertValues
        .map((_, index) => `$${index + 1}`)
        .join(', ');

      const result = await this.databaseService.query<{ id: number }>(
        `INSERT INTO tblusers (${quotedColumns}) VALUES (${placeholders}) RETURNING id`,
        insertValues,
      );

      if (result.rowCount === 0) {
        return {
          success: false,
          message: 'Failed to create user',
        };
      }

      return {
        success: true,
        id: result.rows[0].id,
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

  async findAll(includeDeleted = false) {
    try {
      const deletedFilter = includeDeleted
        ? ''
        : `WHERE COALESCE(
          LOWER(NULLIF(COALESCE(to_jsonb(u)->>'is_deleted', to_jsonb(u)->>'isDeleted'), '')),
          'false'
        ) NOT IN ('true', '1', 't', 'yes')
          AND NULLIF(
            COALESCE(to_jsonb(u)->>'deleted_at', to_jsonb(u)->>'deletedAt'),
            ''
          ) IS NULL`;

      const result = await this.databaseService.query<Record<string, unknown>>(
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
          COALESCE(
            to_jsonb(u)->>'status',
            '1'
          )::int AS status,
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
          COALESCE(to_jsonb(r)->>'rolePermission', to_jsonb(r)->>'rolepermission') AS "rolePermission",
          COALESCE(to_jsonb(u)->>'is_deleted', to_jsonb(u)->>'isDeleted') AS "isDeleted",
          COALESCE(to_jsonb(u)->>'deleted_at', to_jsonb(u)->>'deletedAt') AS "deletedAt"
        FROM tblusers u
        LEFT JOIN tblrbac r
          ON r.id::text = COALESCE(
            to_jsonb(u)->>'roleId',
            to_jsonb(u)->>'roleid',
            to_jsonb(u)->>'role_id'
          )
        ${deletedFilter}
        ORDER BY u.id DESC`,
      );

      return {
        success: true,
        data: result.rows,
      };
    } catch (error) {
      return {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : 'Unable to load users',
      };
    }
  }

  async findOne(id: number) {
    try {
      const result = await this.databaseService.query<Record<string, unknown>>(
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
          COALESCE(to_jsonb(u)->>'birthdate', '') AS birthdate,
          COALESCE(to_jsonb(u)->>'address', '') AS address,
          COALESCE(to_jsonb(u)->>'contact', '') AS contact,
          COALESCE(
            to_jsonb(u)->>'status',
            '1'
          )::int AS status,
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
          AND COALESCE(
            LOWER(NULLIF(COALESCE(to_jsonb(u)->>'is_deleted', to_jsonb(u)->>'isDeleted'), '')),
            'false'
          ) NOT IN ('true', '1', 't', 'yes')
          AND NULLIF(
            COALESCE(to_jsonb(u)->>'deleted_at', to_jsonb(u)->>'deletedAt'),
            ''
          ) IS NULL
        LIMIT 1`,
        [id],
      );

      if (result.rowCount === 0) {
        return {
          success: false,
          message: 'User not found',
        };
      }

      return {
        success: true,
        data: result.rows[0],
      };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Unable to load user',
      };
    }
  }

  async update(id: number, updateUserDto: UpdateUserDto) {
    if (!Number.isFinite(id) || id <= 0) {
      return {
        success: false,
        message: 'Invalid user id',
      };
    }

    try {
      const existingUser = await this.databaseService.query<{ id: number }>(
        `SELECT id FROM tblusers WHERE id = $1 LIMIT 1`,
        [id],
      );

      if (existingUser.rowCount === 0) {
        return {
          success: false,
          message: 'User not found',
        };
      }

      const columns = await this.getTableColumns('tblusers');
      if (columns.length === 0) {
        return {
          success: false,
          message: 'tblusers table was not found in current schema',
        };
      }

      const usernameColumn = this.pickColumn(columns, ['username']);
      const passwordColumn = this.pickColumn(columns, ['password']);
      const fullnameColumn = this.pickColumn(columns, [
        'fullname',
        'fullName',
        'full_name',
      ]);
      const birthdateColumn = this.pickColumn(columns, ['birthdate']);
      const addressColumn = this.pickColumn(columns, ['address']);
      const emailColumn = this.pickColumn(columns, ['email']);
      const contactColumn = this.pickColumn(columns, ['contact']);
      const statusColumn = this.pickColumn(columns, ['status']);
      const isDeletedColumn = this.pickColumn(columns, ['is_deleted', 'isDeleted']);
      const createdByColumn = this.pickColumn(columns, ['created_by', 'createdBy']);
      const roleIdColumn = this.pickColumn(columns, ['roleId', 'role_id', 'roleid']);
      const branchIdColumn = this.pickColumn(columns, [
        'branchId',
        'branch_id',
        'branchid',
      ]);

      const updates: Record<string, unknown> = {};

      const nextUsername = updateUserDto.username?.trim();
      if (usernameColumn && nextUsername) {
        const duplicateUsername = await this.databaseService.query<{ id: number }>(
          `SELECT id
           FROM tblusers
           WHERE LOWER(TRIM(username)) = LOWER(TRIM($1))
             AND id <> $2
           LIMIT 1`,
          [nextUsername, id],
        );

        if (duplicateUsername.rowCount > 0) {
          return {
            success: false,
            message: 'Username already exists',
          };
        }

        updates[usernameColumn] = nextUsername;
      }

      const nextFullname = updateUserDto.fullname?.trim();
      if (fullnameColumn && nextFullname) {
        updates[fullnameColumn] = nextFullname;
      }

      const nextPassword = updateUserDto.password?.trim();
      if (passwordColumn && nextPassword) {
        updates[passwordColumn] = createHash('sha1').update(nextPassword).digest('hex');
      }

      const nextEmail = updateUserDto.email?.trim();
      if (emailColumn && nextEmail) {
        const duplicateEmail = await this.databaseService.query<{ id: number }>(
          `SELECT id
           FROM tblusers
           WHERE LOWER(TRIM(email)) = LOWER(TRIM($1))
             AND id <> $2
           LIMIT 1`,
          [nextEmail, id],
        );

        if (duplicateEmail.rowCount > 0) {
          return {
            success: false,
            message: 'Email already exists',
          };
        }

        updates[emailColumn] = nextEmail;
      }

      if (birthdateColumn && updateUserDto.birthdate != null) {
        updates[birthdateColumn] = String(updateUserDto.birthdate).trim();
      }
      if (addressColumn && updateUserDto.address != null) {
        updates[addressColumn] = String(updateUserDto.address).trim();
      }
      if (contactColumn && updateUserDto.contact != null) {
        updates[contactColumn] = String(updateUserDto.contact).trim();
      }
      if (statusColumn && updateUserDto.status != null) {
        updates[statusColumn] = updateUserDto.status;
      }
      if (isDeletedColumn && updateUserDto.is_deleted != null) {
        updates[isDeletedColumn] = updateUserDto.is_deleted;
      }
      if (createdByColumn && updateUserDto.created_by != null) {
        updates[createdByColumn] = updateUserDto.created_by;
      }
      if (roleIdColumn && updateUserDto.roleId != null) {
        updates[roleIdColumn] = updateUserDto.roleId;
      }
      if (branchIdColumn && updateUserDto.branchId != null) {
        updates[branchIdColumn] = updateUserDto.branchId;
      }

      const updateEntries = Object.entries(updates);
      if (updateEntries.length === 0) {
        return {
          success: false,
          message: 'No changes were provided',
        };
      }

      const setClause = updateEntries
        .map(([column], index) => `"${column}" = $${index + 1}`)
        .join(', ');
      const values = updateEntries.map(([, value]) => value);

      const result = await this.databaseService.query<{ id: number }>(
        `UPDATE tblusers
         SET ${setClause}
         WHERE id = $${values.length + 1}
         RETURNING id`,
        [...values, id],
      );

      if (result.rowCount === 0) {
        return {
          success: false,
          message: 'Failed to update user',
        };
      }

      return {
        success: true,
        id: result.rows[0].id,
      };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Unable to update user',
      };
    }
  }

  async remove(id: number) {
    if (!Number.isFinite(id) || id <= 0) {
      return {
        success: false,
        message: 'Invalid user id',
      };
    }

    try {
      const columns = await this.getTableColumns('tblusers');
      const isDeletedColumn = this.pickColumn(columns, ['is_deleted', 'isDeleted']);
      const deletedAtColumn = this.pickColumn(columns, ['deleted_at', 'deletedAt']);
      const statusColumn = this.pickColumn(columns, ['status']);

      if (isDeletedColumn) {
        const setStatements = [`"${isDeletedColumn}" = true`];
        if (deletedAtColumn) {
          setStatements.push(`"${deletedAtColumn}" = NOW()`);
        }
        if (statusColumn) {
          setStatements.push(`"${statusColumn}" = 0`);
        }

        const softDelete = await this.databaseService.query<{ id: number }>(
          `UPDATE tblusers
           SET ${setStatements.join(', ')}
           WHERE id = $1
           RETURNING id`,
          [id],
        );

        if (softDelete.rowCount === 0) {
          return {
            success: false,
            message: 'User not found',
          };
        }

        return {
          success: true,
          id: softDelete.rows[0].id,
        };
      }

      if (deletedAtColumn) {
        const softDelete = await this.databaseService.query<{ id: number }>(
          `UPDATE tblusers
           SET "${deletedAtColumn}" = NOW()${statusColumn ? `, "${statusColumn}" = 0` : ''}
           WHERE id = $1
           RETURNING id`,
          [id],
        );

        if (softDelete.rowCount === 0) {
          return {
            success: false,
            message: 'User not found',
          };
        }

        return {
          success: true,
          id: softDelete.rows[0].id,
        };
      }

      await this.databaseService.query(
        `ALTER TABLE tblusers
         ADD COLUMN IF NOT EXISTS is_deleted boolean NOT NULL DEFAULT false`,
      );

      const softDelete = await this.databaseService.query<{ id: number }>(
        `UPDATE tblusers
         SET is_deleted = true${statusColumn ? `, "${statusColumn}" = 0` : ''}
         WHERE id = $1
         RETURNING id`,
        [id],
      );

      if (softDelete.rowCount === 0) {
        return {
          success: false,
          message: 'User not found',
        };
      }

      return {
        success: true,
        id: softDelete.rows[0].id,
      };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Unable to remove user',
      };
    }
  }

  async restore(id: number) {
    if (!Number.isFinite(id) || id <= 0) {
      return {
        success: false,
        message: 'Invalid user id',
      };
    }

    try {
      const columns = await this.getTableColumns('tblusers');
      const isDeletedColumn = this.pickColumn(columns, ['is_deleted', 'isDeleted']);
      const deletedAtColumn = this.pickColumn(columns, ['deleted_at', 'deletedAt']);
      const statusColumn = this.pickColumn(columns, ['status']);

      const setStatements: string[] = [];
      if (isDeletedColumn) {
        setStatements.push(`"${isDeletedColumn}" = false`);
      }
      if (deletedAtColumn) {
        setStatements.push(`"${deletedAtColumn}" = NULL`);
      }
      if (statusColumn) {
        setStatements.push(`"${statusColumn}" = 1`);
      }

      if (setStatements.length === 0) {
        return {
          success: false,
          message: 'No soft-delete columns found to restore user',
        };
      }

      const restored = await this.databaseService.query<{ id: number }>(
        `UPDATE tblusers
         SET ${setStatements.join(', ')}
         WHERE id = $1
         RETURNING id`,
        [id],
      );

      if (restored.rowCount === 0) {
        return {
          success: false,
          message: 'User not found',
        };
      }

      return {
        success: true,
        id: restored.rows[0].id,
      };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Unable to restore user',
      };
    }
  }
}
