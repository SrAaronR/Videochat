# Servidor de señalización (Socket.IO + Redis).
# Contexto de build: la RAÍZ del monorepo (ver docker-compose.yml).
FROM node:22-alpine

WORKDIR /app

# Manifiestos primero para aprovechar la caché de capas.
COPY package.json package-lock.json ./
COPY apps/signaling/package.json apps/signaling/
COPY packages/shared/package.json packages/shared/

RUN npm ci --workspace apps/signaling --workspace packages/shared

# Código fuente (tsx ejecuta TypeScript directamente; ver deuda técnica en README).
COPY packages/shared packages/shared
COPY apps/signaling apps/signaling

# Cliente Prisma para el esquema de moderación. Se invoca a través de un
# script de npm (no `npx`) para que npm resuelva el binario de prisma del
# workspace en el PATH — igual que hace `start:docker` en tiempo de ejecución.
RUN npm run db:generate --workspace apps/signaling

ENV NODE_ENV=production
EXPOSE 4000

# Aplica las migraciones pendientes y arranca.
CMD ["npm", "run", "start:docker", "--workspace", "apps/signaling"]
