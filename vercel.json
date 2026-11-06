
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": null,
  "installCommand": "npm ci --include=dev",
  "buildCommand": "npm run build -w @iot/web",
  "outputDirectory": "apps/web/dist",
  "rewrites": [
    {
      "source": "/api/:path*",
      "destination": "https://your-backend.up.railway.app/api/:path*"
    },
    {
      "source": "/socket.io/:path*",
      "destination": "https://your-backend.up.railway.app/socket.io/:path*"
    },
    {
      "source": "/(.*)",
      "destination": "/index.html"
    }
  ]
}
