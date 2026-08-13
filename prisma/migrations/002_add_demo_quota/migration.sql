-- CreateTable DemoQuota
CREATE TABLE "DemoQuota" (
    "id" TEXT NOT NULL,
    "ipAddress" TEXT NOT NULL,
    "utcDate" TIMESTAMP(3) NOT NULL,
    "submissionCount" INTEGER NOT NULL DEFAULT 0,
    "estimatedCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lastUpdated" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DemoQuota_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DemoQuota_ipAddress_utcDate_key" ON "DemoQuota"("ipAddress", "utcDate");

-- CreateIndex
CREATE INDEX "DemoQuota_utcDate_idx" ON "DemoQuota"("utcDate");

-- CreateIndex
CREATE INDEX "DemoQuota_ipAddress_utcDate_idx" ON "DemoQuota"("ipAddress", "utcDate");
