/**
 * Deterministic idempotency for generation-charge requests (Phase 2.1
 * hardening pass, 2026-08-11; redesigned same day after review). Replaces
 * the `${type}-charge:${userId}:${Date.now()}` keys previously used in
 * app/api/projects/{script,repurpose,ugc}/route.ts -- Date.now() changes on
 * every call (including retries of the exact same request), which means the
 * "idempotency key" reserveCredits() relies on was never actually
 * idempotent for these three routes.
 *
 * First fix attempt keyed on a content hash of the request fields. That was
 * wrong: it permanently identified *content*, so a deliberate, later
 * generation of identical input (same topic/script/settings) would be
 * silently treated as a duplicate of an old, already-succeeded generation
 * instead of a new paid job.
 *
 * This version keys on a client-supplied operation id instead -- an opaque
 * token minted once per intentional Create/Generate action (see the
 * `Idempotency-Key` header read by the three routes, and
 * `crypto.randomUUID()` calls in the dashboard wizard pages / MCP tool).
 * Idempotency now identifies ONE SUBMISSION, not the content:
 *   - retries of the SAME action (double-click, network retry, lost
 *     response, retry while still processing) reuse the SAME operation id
 *     -> same key -> collapse onto the same reservation.
 *   - a genuinely NEW action -- even with byte-identical content -- gets a
 *     NEW operation id -> new key -> a fresh reservation and a new charge.
 *
 * No schema change was needed for this fix -- CreditReservation.idempotencyKey
 * is already a plain unique String column; only the value encoded into it
 * changed.
 */
import { db } from "@/lib/db";
import { reserveCredits } from "@/lib/pricing/ledger";

export type GenerationType = "script" | "repurpose" | "ugc";

const MAX_OPERATION_ID_LENGTH = 200;

export function isValidClientOperationId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_OPERATION_ID_LENGTH;
}

export type GenerationReservationResult =
  | { status: "new"; reservationId: string }
  | { status: "recoverable"; reservationId: string }
  | { status: "in-flight" | "already-completed"; reservationId: string; jobId: string | null }
  | { status: "failed"; reservationId: string };

/**
 * Reserves credits for a generation request using an operation-scoped
 * idempotency key: `gen:<type>:<requestingUserId>:<clientOperationId>`.
 *
 * Scoped by the ACTUAL REQUESTING USER, not the credit owner -- two
 * different workspace members who happen to submit identical-content
 * requests (each with their own operation id) must still both be charged
 * (each is a genuine, separate generation), even though both charges land
 * on the same workspace-owner balance. The client key is never trusted
 * globally by itself; it only ever collides with a PRIOR operation from the
 * SAME user for the SAME generation type.
 *
 * A reservation found under this exact key is a genuine duplicate of the
 * SAME operation -- a double-click, a browser/network retry, a concurrent
 * duplicate POST, or a lost HTTP response after the original request's
 * reservation already succeeded -- and its current state is returned
 * as-is instead of creating a second charge:
 *   - "captured"            -> already-completed (job finished billing)
 *   - "reserved" + jobId    -> in-flight (job created, still processing)
 *   - "reserved", no jobId  -> recoverable (crashed between reserve and
 *                              project/job creation -- safe to resume with
 *                              this same reservation, no new charge)
 *   - "released"            -> failed (this operation already failed and
 *                              was refunded; a genuine retry-with-intent
 *                              must come in under a NEW operation id, since
 *                              the client only ever reuses an id while an
 *                              action is still pending or just succeeded --
 *                              never after it observed a terminal failure)
 */
export async function reserveGenerationCredits(input: {
  type: GenerationType;
  requestingUserId: string;
  creditOwnerId: string;
  workspaceId: string | null;
  amount: number;
  clientOperationId: string;
}): Promise<GenerationReservationResult> {
  const idempotencyKey = `gen:${input.type}:${input.requestingUserId}:${input.clientOperationId}`;

  const result = await reserveCredits({
    userId: input.creditOwnerId,
    workspaceId: input.workspaceId,
    amount: input.amount,
    idempotencyKey,
  });

  if (result.isNew) {
    return { status: "new", reservationId: result.reservationId };
  }

  // isNew: false -- a reservation with this exact key already exists,
  // either from a genuine prior call with this operation id or a concurrent
  // request that won a race on this exact key. Inspect its real state
  // before deciding what to tell the caller.
  const existing = await db.creditReservation.findUnique({ where: { id: result.reservationId } });
  if (!existing) {
    // Defensive: the row vanished between the reserve call and this lookup.
    // Nothing safe to resume or report -- surface it as a hard error rather
    // than silently reserving a second time under the same key (which would
    // just hit the same unique-constraint race again).
    throw new Error(`Reservation ${result.reservationId} not found immediately after reserveCredits returned it`);
  }

  if (existing.status === "released") {
    return { status: "failed", reservationId: existing.id };
  }

  if (existing.status === "captured") {
    return { status: "already-completed", reservationId: existing.id, jobId: existing.jobId };
  }

  // status === "reserved"
  if (existing.jobId) {
    return { status: "in-flight", reservationId: existing.id, jobId: existing.jobId };
  }
  return { status: "recoverable", reservationId: existing.id };
}

/** Looks up the project id behind an already-linked job -- used by routes
 * to return the existing project instead of creating a duplicate one when
 * reserveGenerationCredits reports "in-flight" or "already-completed". */
export async function getProjectIdForJob(jobId: string): Promise<string | null> {
  const job = await db.job.findUnique({ where: { id: jobId }, select: { projectId: true } });
  return job?.projectId ?? null;
}
