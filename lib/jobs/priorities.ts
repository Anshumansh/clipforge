/**
 * Queue priorities shared by job creation and claiming.
 *
 * Paid work must consistently outrank free work, and anonymous demos must
 * always remain last. Keeping the values in this dependency-free module
 * prevents a route from importing the database-heavy claim implementation
 * just to stamp a new Job row.
 */
export const JOB_PRIORITY_PAID_URGENT = 100;
export const JOB_PRIORITY_PAID_STANDARD = 50;
export const JOB_PRIORITY_VERIFIED_FREE = 10;
export const JOB_PRIORITY_STANDARD = 0;
export const JOB_PRIORITY_HEAVY = -5;
export const JOB_PRIORITY_4K = -8;
export const JOB_PRIORITY_DEMO = -10;

export function getGenerationPriority(plan: string): number {
  if (plan === "business") return JOB_PRIORITY_PAID_URGENT;
  if (plan === "hobby" || plan === "creator") return JOB_PRIORITY_PAID_STANDARD;
  if (plan === "free") return JOB_PRIORITY_VERIFIED_FREE;
  return JOB_PRIORITY_STANDARD;
}
