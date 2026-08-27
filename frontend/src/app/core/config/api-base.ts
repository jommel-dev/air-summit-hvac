import { ENV } from './env.generated';

const appEnv = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
const fromGenerated = String(ENV.NG_APP_API_BASE_URL ?? '').trim();
const fromMeta = String(appEnv?.['NG_APP_API_BASE_URL'] ?? '').trim();
const hostName = String(globalThis.location?.hostname ?? '').trim().toLowerCase();
const isLocalHost = hostName === 'localhost' || hostName === '127.0.0.1';
const fallbackProductionApiBaseUrl = 'https://air-summit-backend-ewbho.ondigitalocean.app';

export const API_BASE_URL = (
  fromGenerated ||
  fromMeta ||
  (isLocalHost ? 'http://localhost:3000' : fallbackProductionApiBaseUrl)
).replace(/\/+$/, '');
