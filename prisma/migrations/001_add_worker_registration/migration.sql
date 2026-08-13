-- CreateTable WorkerRegistration
CREATE TABLE "WorkerRegistration" (
    "workerId" TEXT NOT NULL,
    "registeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastHeartbeat" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'admitted',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkerRegistration_pkey" PRIMARY KEY ("workerId")
);

-- CreateIndex
CREATE INDEX "WorkerRegistration_status_idx" ON "WorkerRegistration"("status");

-- CreateIndex
CREATE INDEX "WorkerRegistration_lastHeartbeat_idx" ON "WorkerRegistration"("lastHeartbeat");
