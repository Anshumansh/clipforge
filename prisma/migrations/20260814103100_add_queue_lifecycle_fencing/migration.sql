-- The genuinely NEW schema this branch's queue-lifecycle-hardening/lease-
-- fencing/worker-admission/demo-quota work depends on. Confirmed via
-- read-only production introspection on 2026-08-14 that NONE of this
-- exists in production today (production's Job table has only the original
-- 9 columns; WorkerRegistration and DemoQuota don't exist at all). This
-- migration must actually be EXECUTED against production when the owner
-- approves deployment -- never marked `--applied` without running it, since
-- doing so would leave production's schema silently mismatched with what
-- the application code expects.
--
-- Every ADD COLUMN below is either nullable or NOT NULL with a DEFAULT, so
-- it applies cleanly to a table with existing rows: old Job rows get
-- attemptToken=NULL/workerId=NULL/leaseExpiresAt=NULL (correct semantics --
-- "not currently fenced," matching their pre-lease-fencing history) and
-- priority=0/attemptCount=0/maxAttempts=3 (the same defaults new rows get).
-- No existing Job or CreditReservation row is invalidated by this migration
-- (CreditReservation itself has zero schema changes here).
--
-- Generated via: prisma migrate diff
--   --from-schema-datamodel=<the production-shaped schema above>
--   --to-schema-datamodel=prisma/schema.prisma --script

-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "attemptCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "attemptToken" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "deadLetteredAt" TIMESTAMP(3),
ADD COLUMN     "failedAt" TIMESTAMP(3),
ADD COLUMN     "failureReason" TEXT,
ADD COLUMN     "heartbeatAt" TIMESTAMP(3),
ADD COLUMN     "idempotencyKey" TEXT,
ADD COLUMN     "leaseExpiresAt" TIMESTAMP(3),
ADD COLUMN     "maxAttempts" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "notBeforeAt" TIMESTAMP(3),
ADD COLUMN     "priority" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "stage" TEXT,
ADD COLUMN     "workerId" TEXT;

-- CreateTable
CREATE TABLE "WorkerRegistration" (
    "workerId" TEXT NOT NULL,
    "registeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastHeartbeat" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'admitted',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkerRegistration_pkey" PRIMARY KEY ("workerId")
);

-- CreateTable
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
CREATE INDEX "WorkerRegistration_status_idx" ON "WorkerRegistration"("status");

-- CreateIndex
CREATE INDEX "WorkerRegistration_lastHeartbeat_idx" ON "WorkerRegistration"("lastHeartbeat");

-- CreateIndex
CREATE INDEX "DemoQuota_utcDate_idx" ON "DemoQuota"("utcDate");

-- CreateIndex
CREATE INDEX "DemoQuota_ipAddress_utcDate_idx" ON "DemoQuota"("ipAddress", "utcDate");

-- CreateIndex
CREATE UNIQUE INDEX "DemoQuota_ipAddress_utcDate_key" ON "DemoQuota"("ipAddress", "utcDate");

-- CreateIndex
CREATE INDEX "Job_status_priority_createdAt_idx" ON "Job"("status", "priority", "createdAt");

-- CreateIndex
CREATE INDEX "Job_status_leaseExpiresAt_idx" ON "Job"("status", "leaseExpiresAt");

-- CreateIndex
CREATE INDEX "Job_userId_status_idx" ON "Job"("userId", "status");

-- CreateIndex
CREATE INDEX "Job_workerId_status_idx" ON "Job"("workerId", "status");

