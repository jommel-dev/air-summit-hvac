import { createHash } from 'crypto';
import { DatabaseService } from 'src/database/database.service';

export async function verifyCurrentUserPassword(
  databaseService: DatabaseService,
  userId: number | undefined,
  password: unknown,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const normalizedPassword = String(password ?? '').trim();
  if (!normalizedPassword) {
    return { ok: false, message: 'Password is required.' };
  }

  const effectiveUserId = Number(userId);
  if (!Number.isFinite(effectiveUserId) || effectiveUserId <= 0) {
    return { ok: false, message: 'Invalid current user.' };
  }

  const passwordSha1 = createHash('sha1').update(normalizedPassword).digest('hex');
  const result = await databaseService.query<{ id: number }>(
    `SELECT u.id
     FROM tblusers u
     WHERE u.id = $1
       AND u.password = $2
     LIMIT 1`,
    [effectiveUserId, passwordSha1],
  );

  if ((result.rowCount ?? 0) === 0) {
    return { ok: false, message: 'Incorrect password. Please try again.' };
  }

  return { ok: true };
}
