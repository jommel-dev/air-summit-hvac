import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const repoRoot = resolve(root, '..');

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) {
    return;
  }

  const text = readFileSync(filePath, 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const eq = line.indexOf('=');
    if (eq <= 0) {
      continue;
    }

    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (process.env[key] === undefined || process.env[key] === '') {
      process.env[key] = value;
    }
  }
}

// Existing process.env (Docker ARG/ENV, Vercel) wins over files.
// frontend/.env is loaded only inside Docker (the image build writes it).
// Local `ng serve` stays on localhost unless NG_APP_API_BASE_URL is exported.
if (existsSync('/.dockerenv')) {
  loadEnvFile(resolve(root, '.env'));
}
loadEnvFile(resolve(repoRoot, '.env.docker'));

const apiBaseUrl = (
  process.env.NG_APP_API_BASE_URL?.trim() ||
  process.env.API_PUBLIC_URL?.trim() ||
  process.env.API_URL?.trim() ||
  'http://localhost:3000'
).replace(/\/+$/, '');

const escape = (value) => value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

const content = `// Auto-generated from frontend/.env, .env.docker, or process.env — do not edit.
// Regenerated when you run \`npm start\` or \`npm run build\`.

export const ENV = {
  NG_APP_API_BASE_URL: '${escape(apiBaseUrl)}',
} as const;
`;

const outDir = resolve(root, 'src/app/core/config');
mkdirSync(outDir, { recursive: true });
writeFileSync(resolve(outDir, 'env.generated.ts'), content, 'utf8');

console.log('[env] NG_APP_API_BASE_URL:', apiBaseUrl);
