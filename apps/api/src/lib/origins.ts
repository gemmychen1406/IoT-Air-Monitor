// Only loopback aliases of the explicitly configured scheme and port are expanded.
export function allowedWebOrigins(configured: string): string[] {
  const url = new URL(configured);
  if (!['localhost', '127.0.0.1'].includes(url.hostname)) return [url.origin];
  return ['localhost', '127.0.0.1'].map((host) => {
    const alias = new URL(url);
    alias.hostname = host;
    return alias.origin;
  });
}
