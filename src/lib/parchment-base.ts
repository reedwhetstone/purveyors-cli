const DEFAULT_PARCHMENT_BASE_URL = 'https://api.purveyors.io';

/** Resolve the canonical API base URL without depending on auth/session modules. */
export function getParchmentBaseUrl(): string {
  const raw =
    process.env.PARCHMENT_API_BASE_URL ??
    process.env.PURVEYORS_BASE_URL ??
    DEFAULT_PARCHMENT_BASE_URL;
  return raw.replace(/\/+$/, '');
}
