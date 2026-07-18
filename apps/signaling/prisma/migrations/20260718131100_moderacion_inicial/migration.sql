-- CreateTable
CREATE TABLE "Denuncia" (
    "id" TEXT NOT NULL,
    "creadaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "motivo" TEXT NOT NULL,
    "origen" TEXT NOT NULL DEFAULT 'manual',
    "sesionDenunciante" TEXT NOT NULL,
    "sesionDenunciado" TEXT NOT NULL,
    "roomId" TEXT,
    "ipHashDenunciado" TEXT,
    "fingerprintDenunciado" TEXT,
    "frame" BYTEA,
    "estado" TEXT NOT NULL DEFAULT 'pendiente',

    CONSTRAINT "Denuncia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ban" (
    "id" TEXT NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipHash" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "motivo" TEXT NOT NULL,
    "nivel" INTEGER NOT NULL,
    "expiraEn" TIMESTAMP(3),
    "activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Ban_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Denuncia_estado_creadaEn_idx" ON "Denuncia"("estado", "creadaEn");

-- CreateIndex
CREATE INDEX "Ban_activo_expiraEn_idx" ON "Ban"("activo", "expiraEn");

-- CreateIndex
CREATE INDEX "Ban_fingerprint_idx" ON "Ban"("fingerprint");

-- CreateIndex
CREATE INDEX "Ban_ipHash_idx" ON "Ban"("ipHash");
