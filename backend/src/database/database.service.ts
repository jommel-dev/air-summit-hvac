import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool, PoolClient, QueryResult } from 'pg';

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly pool: Pool;

  constructor(private readonly configService: ConfigService) {
    console.log('🔌 Initializing database connection...');

    const databaseUrl = this.configService.get<string>('DATABASE_URL');
    const shouldUseSsl = this.resolveSslEnabled(databaseUrl);
    const rejectUnauthorized = this.resolveRejectUnauthorized(databaseUrl);
    const ssl = shouldUseSsl ? { rejectUnauthorized } : undefined;
    const connectionString = this.normalizeConnectionString(
      databaseUrl,
      shouldUseSsl,
      rejectUnauthorized,
    );

    console.log('DB_SSL:', shouldUseSsl);
    console.log('DB_SSL_REJECT_UNAUTHORIZED:', rejectUnauthorized);
    console.log('Using connection string:', !!connectionString);

    try {
      this.pool = connectionString
        ? new Pool({ connectionString, ssl })
        : new Pool({
            host: this.configService.get<string>('DB_HOST', '127.0.0.1'),
            port: Number(this.configService.get<string>('DB_PORT', '5432')),
            database: this.configService.get<string>('DB_NAME', 'postgres'),
            user: this.configService.get<string>('DB_USER', 'postgres'),
            password: this.configService.get<string>('DB_PASSWORD', ''),
            ssl,
          });

      console.log('✅ Database pool created successfully');
    } catch (error) {
      console.error('❌ Failed to create database pool:', error);
      throw error;
    }
  }

  private resolveSslEnabled(databaseUrl?: string): boolean {
    const defaultFromUrl = Boolean(databaseUrl?.includes('sslmode=require'));
    return this.getBooleanEnv('DB_SSL', defaultFromUrl);
  }

  private resolveRejectUnauthorized(databaseUrl?: string): boolean {
    const isSupabasePooler = Boolean(databaseUrl?.includes('.pooler.supabase.com'));
    return this.getBooleanEnv('DB_SSL_REJECT_UNAUTHORIZED', !isSupabasePooler);
  }

  private getBooleanEnv(key: string, defaultValue: boolean): boolean {
    const rawValue = this.configService.get<string>(key);
    if (rawValue === undefined) {
      return defaultValue;
    }

    const normalized = rawValue.trim().toLowerCase();
    return ['1', 'true', 'yes', 'on'].includes(normalized);
  }

  private normalizeConnectionString(
    databaseUrl: string | undefined,
    shouldUseSsl: boolean,
    rejectUnauthorized: boolean,
  ): string | undefined {
    if (!databaseUrl) {
      return undefined;
    }

    if (!shouldUseSsl) {
      return databaseUrl;
    }

    if (!rejectUnauthorized) {
      if (databaseUrl.includes('sslmode=')) {
        return databaseUrl.replace(/sslmode=[^&]*/i, 'sslmode=no-verify');
      }

      return `${databaseUrl}${databaseUrl.includes('?') ? '&' : '?'}sslmode=no-verify`;
    }

    return databaseUrl;
  }

  async query<T = unknown>(
    text: string,
    params: unknown[] = [],
  ): Promise<QueryResult<T>> {
    return this.pool.query<T>(text, params);
  }

  async withTransaction<T>(
    callback: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
