export type BackupType = 'full' | 'data_only' | 'schema_only';

export class CreateBackupDto {
  backupType: BackupType;
}
