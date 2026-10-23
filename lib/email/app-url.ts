// lib/email/app-url.ts

/** Public origin for links in emails. NEXTAUTH_URL is the deployment's canonical URL. */
export function appBaseUrl(fallbackOrigin?: string): string {
  const base = process.env.APP_URL?.trim() || process.env.NEXTAUTH_URL?.trim() || fallbackOrigin || '';
  return base.replace(/\/+$/, '');
}
