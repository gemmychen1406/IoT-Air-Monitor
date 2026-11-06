/**
 * Vercel frontend (monorepo root). Set AIRGUARD_API_ORIGIN to your Railway HTTPS
 * origin in Vercel > Project > Settings > Environment Variables.
 * No secrets belong here: this is a public endpoint URL.
 * See HUONG_DAN_DEPLOY_CLOUD.md for step-by-step setup in Vietnamese.
 */
const configured = process.env.AIRGUARD_API_ORIGIN?.trim();
if (!configured) {
  throw new Error(
    'Thiếu AIRGUARD_API_ORIGIN. Vào Vercel > Project > Settings > Environment Variables ' +
      'và đặt URL HTTPS backend Railway (vd: https://ten-api.up.railway.app).',
  );
}
let upstream;
try {
  upstream = new URL(configured);
} catch {
  throw new Error('AIRGUARD_API_ORIGIN phải là URL HTTPS hợp lệ.');
}
if (
  upstream.protocol !== 'https:' ||
  upstream.username ||
  upstream.password ||
  upstream.pathname !== '/' ||
  upstream.search ||
  upstream.hash ||
  ['localhost', '127.0.0.1', '0.0.0.0'].includes(upstream.hostname)
) {
  throw new Error('AIRGUARD_API_ORIGIN phải là HTTPS origin công khai, không có path/query.');
}
const apiOrigin = upstream.origin;
export const config = {
  framework: null,
  installCommand: 'npm ci --include=dev',
  buildCommand: 'npm run build -w @iot/web',
  outputDirectory: 'apps/web/dist',
  rewrites: [
    { source: '/api/:path*', destination: `${apiOrigin}/api/:path*` },
    { source: '/socket.io/:path*', destination: `${apiOrigin}/socket.io/:path*` },
    { source: '/(.*)', destination: '/index.html' },
  ],
};
