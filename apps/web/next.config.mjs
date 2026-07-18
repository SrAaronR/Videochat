/** @type {import('next').NextConfig} */
const nextConfig = {
  // El paquete compartido se distribuye como TypeScript sin compilar,
  // así que Next debe transpilarlo.
  transpilePackages: ['@videochat/shared'],
  output: 'standalone',
};

export default nextConfig;
