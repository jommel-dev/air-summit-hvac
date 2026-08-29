import { ENV } from './env.generated';

export const API_BASE_URL = String(ENV.NG_APP_API_BASE_URL ?? '').trim().replace(/\/+$/, '');
