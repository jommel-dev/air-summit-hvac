import { ENV } from './env.generated';

const appEnv = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
const fromGenerated = String(ENV.NG_APP_API_BASE_URL ?? '').trim();
const fromMeta = String(appEnv?.['NG_APP_API_BASE_URL'] ?? '').trim();
const hostName = String(globalThis.location?.hostname ?? '').trim().toLowerCase();
const isLocalHost = hostName === 'localhost' || hostName === '127.0.0.1';
const fallbackProductionApiBaseUrl = 'https://air-summit-backend-ewbho.ondigitalocean.app';

function isUsableApiBaseUrl(value: string): boolean {
  if (!value) {
    return false;
  }

  const origin = value.replace(/\/+$/, '');
  const pageOrigin = String(globalThis.location?.origin ?? '').replace(/\/+$/, '');
  if (pageOrigin && origin === pageOrigin) {
    return false;
  }

  const lower = value.toLowerCase();
  if (lower.includes('localhost') || lower.includes('127.0.0.1') || lower.includes('api.example.com')) {
    return isLocalHost;
  }

  return true;
}

export const API_BASE_URL = (
  (isUsableApiBaseUrl(fromGenerated) ? fromGenerated : '') ||
  (isUsableApiBaseUrl(fromMeta) ? fromMeta : '') ||
  (isLocalHost ? 'http://localhost:3000' : fallbackProductionApiBaseUrl)
).replace(/\/+$/, '');

const pageOrigin = String(globalThis.location?.origin ?? '').replace(/\/+$/, '');
if (pageOrigin && API_BASE_URL === pageOrigin) {
  console.error(
    `NG_APP_API_BASE_URL is "${API_BASE_URL}", which is this frontend host. Login will POST to ${pageOrigin}/login instead of the API. Set NG_APP_API_BASE_URL to the API origin (e.g. https://api-demo-hvac.pcmazing.com).`,
  );
}
