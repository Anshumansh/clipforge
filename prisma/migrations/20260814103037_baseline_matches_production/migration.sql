-- Baseline reflecting ONLY schema confirmed present in the production
-- database (Neon) via read-only introspection on 2026-08-14 (information_
-- schema.tables/columns/indexes -- no row data was read). This does NOT
-- include the Job lease-fencing columns/indexes, WorkerRegistration, or
-- DemoQuota -- those are unapplied development schema and live in the
-- next migration (20260814103100_add_queue_lifecycle_fencing) as an
-- explicit additive migration instead, specifically so this baseline can
-- be marked `prisma migrate resolve --applied` against production without
-- falsely claiming objects exist there that don't. See
-- PRODUCTION_READINESS_VERIFIED_2026-08-14.md's migration reconciliation
-- section for the full column-by-column comparison this was generated from.
-- Generated via: prisma migrate diff --from-empty
--   --to-schema-datamodel=<schema.prisma with Job's 15 new columns/4 new
--   indexes and the WorkerRegistration/DemoQuota models removed> --script

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "credits" INTEGER NOT NULL DEFAULT 50,
    "plan" TEXT NOT NULL DEFAULT 'free',
    "stripeCustomerId" TEXT,
    "stripeSubscriptionId" TEXT,
    "stripePriceId" TEXT,
    "stripeCurrentPeriodEnd" TIMESTAMP(3),
    "billingIssue" TEXT,
    "currentStreak" INTEGER NOT NULL DEFAULT 0,
    "longestStreak" INTEGER NOT NULL DEFAULT 0,
    "lastActiveAt" TIMESTAMP(3),
    "isAdmin" BOOLEAN NOT NULL DEFAULT false,
    "compPlanExpiresAt" TIMESTAMP(3),
    "totpSecret" TEXT,
    "totpEnabledAt" TIMESTAMP(3),
    "totpBackupCodes" TEXT,
    "emailVerifiedAt" TIMESTAMP(3),
    "planVersionId" TEXT,
    "billingIntervalMonths" INTEGER,
    "seats" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminAction" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "targetUserId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "creditsGranted" INTEGER,
    "planGranted" TEXT,
    "previousPlan" TEXT,
    "days" INTEGER,
    "note" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceMember" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkspaceMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceInvite" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkspaceInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "keyPrefix" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrandKit" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "logoUrl" TEXT,
    "primaryColor" TEXT,
    "secondaryColor" TEXT,
    "fontFamily" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrandKit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeatureRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeatureRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeatureVote" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "featureRequestId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeatureVote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "input" TEXT NOT NULL,
    "script" TEXT,
    "captionsJson" TEXT,
    "scenesJson" TEXT,
    "voiceoverUrl" TEXT,
    "videoUrl" TEXT,
    "thumbnailUrl" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Clip" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "startSec" DOUBLE PRECISION NOT NULL,
    "endSec" DOUBLE PRECISION NOT NULL,
    "score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "videoUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Clip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailVerificationToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailVerificationToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "platformUserId" TEXT NOT NULL,
    "handle" TEXT,
    "accessTokenEnc" TEXT NOT NULL,
    "refreshTokenEnc" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialPost" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "socialAccountId" TEXT NOT NULL,
    "projectId" TEXT,
    "clipId" TEXT,
    "videoUrl" TEXT NOT NULL,
    "caption" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "scheduledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "postedAt" TIMESTAMP(3),
    "platformPostId" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SocialPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "log" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserNiche" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "niche" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserNiche_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrackedChannel" (
    "id" TEXT NOT NULL,
    "userNicheId" TEXT NOT NULL,
    "youtubeChannelId" TEXT NOT NULL,
    "channelTitle" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrackedChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "YoutubeVideo" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "thumbnailUrl" TEXT,
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "YoutubeVideo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrendSnapshot" (
    "id" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "views" INTEGER NOT NULL,
    "likes" INTEGER NOT NULL,
    "comments" INTEGER NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrendSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BreakoutScore" (
    "id" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "velocity" DOUBLE PRECISION NOT NULL,
    "channelMedianVelocity" DOUBLE PRECISION NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BreakoutScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExtractedPattern" (
    "id" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "hookType" TEXT NOT NULL,
    "structure" TEXT NOT NULL,
    "pacingNotes" TEXT NOT NULL,
    "titleFormula" TEXT NOT NULL,
    "thumbnailFormula" TEXT NOT NULL,
    "emotionalDriver" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExtractedPattern_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaptureSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "personaType" TEXT NOT NULL DEFAULT 'generic',
    "durationSec" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'processing',
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CaptureSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpeakerSegment" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "speakerLabel" TEXT NOT NULL,
    "startSec" DOUBLE PRECISION NOT NULL,
    "endSec" DOUBLE PRECISION NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SpeakerSegment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HighlightScore" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "startSec" DOUBLE PRECISION NOT NULL,
    "endSec" DOUBLE PRECISION NOT NULL,
    "audioScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "transcriptScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "chatScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalScore" DOUBLE PRECISION NOT NULL,
    "signals" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HighlightScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClipCandidate" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "startSec" DOUBLE PRECISION NOT NULL,
    "endSec" DOUBLE PRECISION NOT NULL,
    "predictedScore" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "videoUrl" TEXT,
    "reframeMode" TEXT NOT NULL DEFAULT 'center',
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClipCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradeCall" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "targetPrice" DOUBLE PRECISION,
    "calledAtPrice" DOUBLE PRECISION,
    "calledAtSec" DOUBLE PRECISION NOT NULL,
    "resolveAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "outcome" TEXT,
    "resolvedPrice" DOUBLE PRECISION,
    "clipCandidateId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TradeCall_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceSnapshot" (
    "id" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriceSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DisclaimerConfig" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "region" TEXT NOT NULL DEFAULT 'US',
    "text" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DisclaimerConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameTemplate" (
    "id" TEXT NOT NULL,
    "gameName" TEXT NOT NULL,
    "hudRegion" TEXT,
    "killfeedKeywords" TEXT,
    "detectionMode" TEXT NOT NULL DEFAULT 'audio',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GameTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditLedgerEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT,
    "type" TEXT NOT NULL,
    "delta" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "projectId" TEXT,
    "jobId" TEXT,
    "reservationId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditReservation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT,
    "jobId" TEXT,
    "amount" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'reserved',
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "CreditReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobCostRecord" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "aiProvider" TEXT,
    "aiModel" TEXT,
    "aiInputTokens" INTEGER,
    "aiOutputTokens" INTEGER,
    "aiCostUsd" DOUBLE PRECISION,
    "transcriptionSeconds" DOUBLE PRECISION,
    "transcriptionCostUsd" DOUBLE PRECISION,
    "ttsCharacters" INTEGER,
    "ttsSeconds" DOUBLE PRECISION,
    "ttsCostUsd" DOUBLE PRECISION,
    "voiceCloneComputeSec" DOUBLE PRECISION,
    "voiceCloneCostUsd" DOUBLE PRECISION,
    "renderSeconds" DOUBLE PRECISION,
    "renderCostUsd" DOUBLE PRECISION,
    "storageBytes" BIGINT,
    "storageCostUsd" DOUBLE PRECISION,
    "bandwidthBytes" BIGINT,
    "bandwidthCostUsd" DOUBLE PRECISION,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "retryCostUsd" DOUBLE PRECISION,
    "creditsCharged" INTEGER NOT NULL DEFAULT 0,
    "creditsRefunded" INTEGER NOT NULL DEFAULT 0,
    "netRevenueUsdAllocated" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobCostRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonthlyExpense" (
    "id" TEXT NOT NULL,
    "month" TIMESTAMP(3) NOT NULL,
    "category" TEXT NOT NULL,
    "amountUsd" DOUBLE PRECISION,
    "isEstimate" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "updatedByUserId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MonthlyExpense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompetitorBenchmark" (
    "id" TEXT NOT NULL,
    "competitor" TEXT NOT NULL,
    "planName" TEXT NOT NULL,
    "priceUsd" DOUBLE PRECISION,
    "billingPeriod" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompetitorBenchmark_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KillSwitch" (
    "id" TEXT NOT NULL,
    "feature" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "reason" TEXT,
    "updatedByUserId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KillSwitch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarginAlert" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "acknowledgedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarginAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanVersion" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "versionLabel" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "monthlyPriceUsd" DOUBLE PRECISION NOT NULL,
    "annualPriceUsd" DOUBLE PRECISION,
    "monthlyCredits" INTEGER NOT NULL,
    "configJson" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlanVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StripeWebhookEvent" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payloadSummary" TEXT,

    CONSTRAINT "StripeWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrandPreset" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "logoUrl" TEXT,
    "primaryColor" TEXT,
    "secondaryColor" TEXT,
    "fontFamily" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrandPreset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_stripeCustomerId_key" ON "User"("stripeCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "User_stripeSubscriptionId_key" ON "User"("stripeSubscriptionId");

-- CreateIndex
CREATE INDEX "AdminAction_targetUserId_idx" ON "AdminAction"("targetUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Workspace_ownerId_key" ON "Workspace"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceMember_userId_key" ON "WorkspaceMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceInvite_tokenHash_key" ON "WorkspaceInvite"("tokenHash");

-- CreateIndex
CREATE INDEX "WorkspaceInvite_workspaceId_idx" ON "WorkspaceInvite"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_keyHash_key" ON "ApiKey"("keyHash");

-- CreateIndex
CREATE UNIQUE INDEX "BrandKit_userId_key" ON "BrandKit"("userId");

-- CreateIndex
CREATE INDEX "FeatureRequest_status_idx" ON "FeatureRequest"("status");

-- CreateIndex
CREATE UNIQUE INDEX "FeatureVote_userId_featureRequestId_key" ON "FeatureVote"("userId", "featureRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");

-- CreateIndex
CREATE INDEX "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "EmailVerificationToken_tokenHash_key" ON "EmailVerificationToken"("tokenHash");

-- CreateIndex
CREATE INDEX "EmailVerificationToken_userId_idx" ON "EmailVerificationToken"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "SocialAccount_userId_platform_key" ON "SocialAccount"("userId", "platform");

-- CreateIndex
CREATE INDEX "SocialPost_status_scheduledAt_idx" ON "SocialPost"("status", "scheduledAt");

-- CreateIndex
CREATE UNIQUE INDEX "UserNiche_userId_key" ON "UserNiche"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "TrackedChannel_userNicheId_youtubeChannelId_key" ON "TrackedChannel"("userNicheId", "youtubeChannelId");

-- CreateIndex
CREATE INDEX "YoutubeVideo_channelId_idx" ON "YoutubeVideo"("channelId");

-- CreateIndex
CREATE INDEX "TrendSnapshot_videoId_capturedAt_idx" ON "TrendSnapshot"("videoId", "capturedAt");

-- CreateIndex
CREATE INDEX "TrendSnapshot_channelId_capturedAt_idx" ON "TrendSnapshot"("channelId", "capturedAt");

-- CreateIndex
CREATE INDEX "BreakoutScore_videoId_computedAt_idx" ON "BreakoutScore"("videoId", "computedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ExtractedPattern_videoId_key" ON "ExtractedPattern"("videoId");

-- CreateIndex
CREATE INDEX "CaptureSession_userId_createdAt_idx" ON "CaptureSession"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "SpeakerSegment_sessionId_startSec_idx" ON "SpeakerSegment"("sessionId", "startSec");

-- CreateIndex
CREATE INDEX "HighlightScore_sessionId_totalScore_idx" ON "HighlightScore"("sessionId", "totalScore");

-- CreateIndex
CREATE INDEX "ClipCandidate_sessionId_predictedScore_idx" ON "ClipCandidate"("sessionId", "predictedScore");

-- CreateIndex
CREATE INDEX "TradeCall_resolveAt_outcome_idx" ON "TradeCall"("resolveAt", "outcome");

-- CreateIndex
CREATE INDEX "PriceSnapshot_asset_capturedAt_idx" ON "PriceSnapshot"("asset", "capturedAt");

-- CreateIndex
CREATE UNIQUE INDEX "DisclaimerConfig_userId_key" ON "DisclaimerConfig"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "GameTemplate_gameName_key" ON "GameTemplate"("gameName");

-- CreateIndex
CREATE UNIQUE INDEX "CreditLedgerEntry_idempotencyKey_key" ON "CreditLedgerEntry"("idempotencyKey");

-- CreateIndex
CREATE INDEX "CreditLedgerEntry_userId_createdAt_idx" ON "CreditLedgerEntry"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CreditReservation_jobId_key" ON "CreditReservation"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX "CreditReservation_idempotencyKey_key" ON "CreditReservation"("idempotencyKey");

-- CreateIndex
CREATE INDEX "CreditReservation_userId_status_idx" ON "CreditReservation"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "JobCostRecord_jobId_key" ON "JobCostRecord"("jobId");

-- CreateIndex
CREATE INDEX "JobCostRecord_userId_createdAt_idx" ON "JobCostRecord"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MonthlyExpense_month_category_key" ON "MonthlyExpense"("month", "category");

-- CreateIndex
CREATE INDEX "CompetitorBenchmark_competitor_verifiedAt_idx" ON "CompetitorBenchmark"("competitor", "verifiedAt");

-- CreateIndex
CREATE UNIQUE INDEX "KillSwitch_feature_key" ON "KillSwitch"("feature");

-- CreateIndex
CREATE INDEX "MarginAlert_type_createdAt_idx" ON "MarginAlert"("type", "createdAt");

-- CreateIndex
CREATE INDEX "PlanVersion_planId_effectiveFrom_idx" ON "PlanVersion"("planId", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "PlanVersion_planId_versionLabel_key" ON "PlanVersion"("planId", "versionLabel");

-- CreateIndex
CREATE INDEX "BrandPreset_userId_idx" ON "BrandPreset"("userId");

-- AddForeignKey
ALTER TABLE "AdminAction" ADD CONSTRAINT "AdminAction_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminAction" ADD CONSTRAINT "AdminAction_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Workspace" ADD CONSTRAINT "Workspace_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceInvite" ADD CONSTRAINT "WorkspaceInvite_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrandKit" ADD CONSTRAINT "BrandKit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeatureRequest" ADD CONSTRAINT "FeatureRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeatureVote" ADD CONSTRAINT "FeatureVote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeatureVote" ADD CONSTRAINT "FeatureVote_featureRequestId_fkey" FOREIGN KEY ("featureRequestId") REFERENCES "FeatureRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Clip" ADD CONSTRAINT "Clip_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailVerificationToken" ADD CONSTRAINT "EmailVerificationToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialAccount" ADD CONSTRAINT "SocialAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialPost" ADD CONSTRAINT "SocialPost_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialPost" ADD CONSTRAINT "SocialPost_socialAccountId_fkey" FOREIGN KEY ("socialAccountId") REFERENCES "SocialAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserNiche" ADD CONSTRAINT "UserNiche_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackedChannel" ADD CONSTRAINT "TrackedChannel_userNicheId_fkey" FOREIGN KEY ("userNicheId") REFERENCES "UserNiche"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrendSnapshot" ADD CONSTRAINT "TrendSnapshot_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "YoutubeVideo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BreakoutScore" ADD CONSTRAINT "BreakoutScore_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "YoutubeVideo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtractedPattern" ADD CONSTRAINT "ExtractedPattern_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "YoutubeVideo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaptureSession" ADD CONSTRAINT "CaptureSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpeakerSegment" ADD CONSTRAINT "SpeakerSegment_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "CaptureSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HighlightScore" ADD CONSTRAINT "HighlightScore_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "CaptureSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClipCandidate" ADD CONSTRAINT "ClipCandidate_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "CaptureSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeCall" ADD CONSTRAINT "TradeCall_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "CaptureSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DisclaimerConfig" ADD CONSTRAINT "DisclaimerConfig_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditLedgerEntry" ADD CONSTRAINT "CreditLedgerEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditReservation" ADD CONSTRAINT "CreditReservation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobCostRecord" ADD CONSTRAINT "JobCostRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrandPreset" ADD CONSTRAINT "BrandPreset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

