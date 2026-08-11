/**
 * Client-side counterpart to lib/pricing/generation-idempotency.ts: decides
 * whether a generation-route response (or the total absence of one, on a
 * network failure) proves it's safe to retire the current Idempotency-Key
 * operation id, or whether it must be retained so a retry reuses the same
 * key instead of risking a second charge.
 *
 * The one case that needs an explicit signal from the server is status 409,
 * which is overloaded in app/api/projects/{script,repurpose,ugc}/route.ts:
 * it means either "this operation is still pending/recoverable" (retain) or
 * "this operation is terminally failed" (clear, a new operation id is
 * required). Rather than parsing the human-readable `error` message, the
 * routes attach a machine-readable `code` for exactly this distinction.
 *
 * Every other outcome is classified by status code alone, per this table:
 *   - 2xx                        -> success (operation resolved)
 *   - 400 / 402 / 403 / 429      -> clear (these all fire BEFORE
 *                                    reserveGenerationCredits is ever
 *                                    called, so no reservation exists under
 *                                    this operation id -- provably safe)
 *   - 409 with code OPERATION_FAILED -> clear (terminal: released)
 *   - 409, any other/no code     -> retain (OPERATION_PENDING or unknown --
 *                                    treat as still-recoverable)
 *   - anything else (5xx, a status this table doesn't know about, or the
 *     fetch never got a response at all) -> retain. We have no proof the
 *     server didn't create a reservation before failing, so the only safe
 *     assumption is that it might have.
 */
export type GenerationRetryOutcome = "success" | "retain" | "clear";

const DEFINITELY_NO_RESERVATION_STATUSES = new Set([400, 402, 403, 429]);

export function classifyGenerationResponse(status: number, code?: string): GenerationRetryOutcome {
  if (status >= 200 && status < 300) return "success";
  if (status === 409) return code === "OPERATION_FAILED" ? "clear" : "retain";
  if (DEFINITELY_NO_RESERVATION_STATUSES.has(status)) return "clear";
  return "retain";
}

/**
 * Owns one generation wizard's operation id across its full retry lifecycle,
 * so the three dashboard pages (script/repurpose/ugc) all go through the
 * exact same decision logic instead of three hand-rolled copies of it.
 *
 * `begin()` mints an id lazily and only once per "live" operation -- calling
 * it again before the operation reaches a clearing event returns the SAME
 * id, which is what makes a re-entrant onSubmit call (a double-click that
 * slips past the `loading` guard) or an explicit retry button collapse onto
 * the same Idempotency-Key server-side.
 */
export class GenerationOperation {
  private id: string | null = null;

  /** Returns the id to send as this request's Idempotency-Key -- the
   * existing one if an operation is still live, or a fresh one otherwise. */
  begin(): string {
    if (!this.id) this.id = crypto.randomUUID();
    return this.id;
  }

  /** Call with the generation route's response status/code once it's known.
   * Clears the id only when classifyGenerationResponse proves it's safe. */
  onResponse(status: number, code?: string): void {
    if (classifyGenerationResponse(status, code) !== "retain") this.id = null;
  }

  /** Call when fetch itself threw (network timeout, connection reset, the
   * response never arrived). Ambiguous by definition -- always retains. */
  onNetworkError(): void {
    // Intentionally a no-op: the id must survive so a retry reuses it.
  }

  /** Call for a failure that is PROVABLY client-side and pre-request (e.g.
   * unreadable file, failed local validation) -- no request was ever sent
   * under this id, so it's always safe to clear. */
  onPreRequestValidationError(): void {
    this.id = null;
  }

  /** The currently-live operation id, if any -- exposed for tests/inspection. */
  get current(): string | null {
    return this.id;
  }
}
