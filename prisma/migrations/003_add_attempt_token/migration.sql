-- Add attemptToken column to Job for lease fencing
ALTER TABLE "Job" ADD COLUMN "attemptToken" TEXT;

-- Create index for querying by token (rare but needed for verification)
CREATE INDEX "Job_attemptToken_idx" ON "Job"("attemptToken");
