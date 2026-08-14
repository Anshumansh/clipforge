/**
 * Distributed worker admission control: enforces MAX_ACTIVE_WORKERS limit
 * across multiple worker instances via database-backed coordination.
 *
 * Guarantees:
 * - At most MAX_ACTIVE_WORKERS instances can hold "admitted" status
 * - Stale registrations (no heartbeat for HEARTBEAT_TIMEOUT) are evicted
 * - A live worker's heartbeat is never interrupted by a peer
 * - Graceful shutdown cleans up the registration
 */
import { db } from "@/lib/db";

export const MAX_ACTIVE_WORKERS = Number(process.env.MAX_ACTIVE_WORKERS ?? "1");
export const HEARTBEAT_TIMEOUT_MS = 60_000; // Workers renew every ~15s, so 60s is 4x the interval
export const ADMISSION_CHECK_INTERVAL_MS = 10_000; // Periodically check if this worker is still admitted

// Fixed key for pg_advisory_xact_lock -- arbitrary but must stay constant
// across the whole app (two different keys would fail to serialize against
// each other). Scoped to the transaction (auto-released on commit/rollback),
// not the session, so a crashed connection can never leak a held lock.
const ADMISSION_LOCK_KEY = 822_310_147n;

/**
 * Attempts to register this worker and claim an admission slot. If successful,
 * returns true. If another worker holds the only available slot, returns false
 * and the caller should exit gracefully (or enter idle mode if desired).
 *
 * Atomically:
 * 0. Takes a transaction-scoped advisory lock so two concurrent callers can
 *    never both read "under limit" from the same pre-insert snapshot --
 *    proven to happen without this lock by a real, deterministic two-connection
 *    Postgres integration test (lib/workers/admission-race.integration.test.ts):
 *    under READ COMMITTED (Postgres's default), a plain SELECT COUNT inside
 *    db.$transaction does not see another still-open transaction's uncommitted
 *    insert, so two transactions started close enough together can both
 *    compute shouldAdmit=true and both commit a distinct 'admitted' row,
 *    exceeding MAX_ACTIVE_WORKERS. The lock forces the second caller's count
 *    read to wait until the first caller's transaction has fully committed
 *    (or rolled back), so it always counts the first caller's row.
 * 1. Deletes stale registrations (no heartbeat for HEARTBEAT_TIMEOUT_MS)
 * 2. Counts active admissions
 * 3. If under limit, inserts new registration with status="admitted"
 * 4. If at/over limit, inserts with status="idle" and returns false
 */
export async function requestAdmission(workerId: string): Promise<boolean> {
  const now = new Date();
  const staleThreshold = new Date(now.getTime() - HEARTBEAT_TIMEOUT_MS);

  try {
    // Use a transaction to make this atomic
    const result = await db.$transaction(async (tx) => {
      // 0. Serialize against every other concurrent requestAdmission() call
      // for the whole rest of this transaction.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ADMISSION_LOCK_KEY})`;

      // 1. Clean up stale registrations
      await tx.workerRegistration.deleteMany({
        where: {
          lastHeartbeat: { lt: staleThreshold },
          status: "admitted",
        },
      });

      // 2. Count current admitted workers
      const admittedCount = await tx.workerRegistration.count({
        where: { status: "admitted" },
      });

      // 3. Decide admission status
      const shouldAdmit = admittedCount < MAX_ACTIVE_WORKERS;
      const status = shouldAdmit ? "admitted" : "idle";

      // 4. Register this worker
      const registration = await tx.workerRegistration.upsert({
        where: { workerId },
        update: {
          status,
          lastHeartbeat: now,
        },
        create: {
          workerId,
          status,
          registeredAt: now,
          lastHeartbeat: now,
        },
      });

      return { admitted: shouldAdmit, registration };
    });

    if (!result.admitted) {
      console.log(
        `[worker:${workerId}] admission denied: ${MAX_ACTIVE_WORKERS} slot(s) full, entering idle mode`
      );
    } else {
      console.log(`[worker:${workerId}] admission granted (${MAX_ACTIVE_WORKERS} total capacity)`);
    }

    return result.admitted;
  } catch (err) {
    console.error(`[worker:${workerId}] admission check failed:`, err instanceof Error ? err.message : err);
    // Fail open: if the DB is down, let the worker start and fail naturally
    // rather than hanging on startup. The stale-lease reconciliation will
    // catch any orphaned jobs.
    return true;
  }
}

/**
 * Updates this worker's heartbeat to prove it's still alive. Called periodically
 * from the main event loop. Returns true if heartbeat succeeded, false if this
 * worker has been evicted (another worker took the slot).
 */
export async function renewAdmissionHeartbeat(workerId: string): Promise<boolean> {
  const now = new Date();

  try {
    const updated = await db.workerRegistration.updateMany({
      where: { workerId, status: "admitted" },
      data: { lastHeartbeat: now },
    });

    if (updated.count === 0) {
      // This worker is no longer admitted (was demoted to idle or deleted)
      console.warn(`[worker:${workerId}] admission revoked: another worker took this slot`);
      return false;
    }

    return true;
  } catch (err) {
    console.error(
      `[worker:${workerId}] heartbeat renewal failed:`,
      err instanceof Error ? err.message : err
    );
    // Transient DB error; assume still admitted and keep going
    return true;
  }
}

/**
 * Marks this worker's registration as retired (graceful shutdown).
 * Returns true if successfully retired, false if already gone.
 */
export async function retireRegistration(workerId: string): Promise<boolean> {
  try {
    const result = await db.workerRegistration.updateMany({
      where: { workerId },
      data: { status: "retired" },
    });

    if (result.count > 0) {
      console.log(`[worker:${workerId}] registration retired`);
      return true;
    }

    return false;
  } catch (err) {
    console.error(
      `[worker:${workerId}] retirement failed:`,
      err instanceof Error ? err.message : err
    );
    return false;
  }
}
