# Lease Fencing Audit

## Executive Summary

**Status:** INCOMPLETE. Critical mutations unprotected against stale workers.

A stale worker can still:
- Update job progress after losing lease
- Update project metadata (title, script, voiceoverUrl, captions, scenes)
- Update project status to "processing"
- Create duplicate cost records
- Fail/refund jobs without lease verification in error path

Only the final transaction (job done + project ready + capture) is currently protected.

---

## Detailed Audit by Runner and Mutation

### script-runner.ts

| Line | Operation | Code | Job.id | Status=processing | workerId | attemptToken | Lease verified | Protected | Risk |
|------|-----------|------|--------|------|---------|---------|--|--|--|
| 35 | Job progress | `job.update({status: "processing", progress: 5})` | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | Stale worker updates processing flag and progress |
| 36 | Project status | `project.update({status: "processing"})` | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | Stale worker marks project processing |
| 19 (54, 57, 60, 85, 99) | Job progress (setJobProgress) | `job.update({progress, log})` | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | Stale worker logs progress updates |
| 74-83 | Project metadata | `project.update({title, script, voiceover, captions, scenes})` | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | Stale worker overwrites rendering results |
| 112-123 | Job done (FENCED) | `job.updateMany({where: {id, status, workerId, attemptToken}, data: {status: "done"}})` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | Protected by updateMany WHERE clause |
| 119 | Project ready (FENCED) | `project.update({status: "ready", videoUrl})` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | Protected by transaction containing fenced job update |
| 121 | Credit capture (FENCED) | `captureReservationInTx(tx, reservationId)` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | Protected by transaction containing fenced job update |
| 129-144 | Cost record | `upsertCostRecord({jobId, ...credits=CHARGED})` | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | **CRITICAL**: Outside transaction, stale worker creates duplicate cost record |
| 146 | Activity record | `recordActivity(userId)` | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | Low risk: read-only activity log |
| 167-169 | Error transaction | `tx.project.update({status: "failed"})` + `tx.job.update({status: "failed"})` + `releaseReservationInTx()` | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | **CRITICAL**: Stale worker can fail job and release credits in error path |
| 194-195 | Legacy error | `project.update()` + `job.update()` + `refundCredits()` | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | **CRITICAL**: No lease check before legacy refund |
| 203-208 | Error cost record | `upsertCostRecord({creditsRefunded})` | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | **CRITICAL**: Stale worker records refund cost record |

### repurpose-runner.ts

| Line | Operation | Code | Job.id | Status=processing | workerId | attemptToken | Protected | Risk |
|------|-----------|------|--------|------|---------|---------|--|--|
| 68 | Job status | `job.update({status: "processing"})` | ✓ | ✗ | ✗ | ✗ | ✗ | Stale worker updates processing flag |
| 69 | Project status | `project.update({status: "processing"})` | ✓ | ✗ | ✗ | ✗ | ✗ | Stale worker marks processing |
| 130 | Job progress | `setJobProgress()` | ✓ | ✗ | ✗ | ✗ | ✗ | Stale worker logs progress (multiple calls) |
| 84 | Project script | `project.update({script: transcript})` | ✓ | ✗ | ✗ | ✗ | ✗ | Stale worker overwrites project data |
| 156 | Clip video | `clip.update({status: "ready", videoUrl})` | ✓ | ✗ | ✗ | ✗ | ✗ | Stale worker marks clips ready (no clip-level lease) |
| 176-180 | Job done (FENCED) | `job.updateMany({where: {...}})` + `project.update({status: "ready"})` + capture | ✓ | ✓ | ✓ | ✓ | ✓ | Protected |
| 185-192 | Cost record | `upsertCostRecord()` | ✓ | ✗ | ✗ | ✗ | ✗ | **CRITICAL**: Duplicate records possible |
| 205-207 | Error transaction | `project.update({status: "failed"})` + `job.update({status: "failed"})` + `releaseReservationInTx()` | ✓ | ✗ | ✗ | ✗ | ✗ | **CRITICAL**: Stale worker fails job and refunds |
| 226-230 | Error cost record | `upsertCostRecord({creditsRefunded})` | ✓ | ✗ | ✗ | ✗ | ✗ | **CRITICAL**: Stale worker records refund |

### ugc-runner.ts

Same pattern as script-runner.ts. All three runners have identical protection gaps.

---

## Critical Findings

### 1. Intermediate mutations not fenced (lines 35-83, equivalent in other runners)

A stale worker who has lost its lease can still:
- Update job progress
- Update job log
- Update project.status to "processing"
- Overwrite project.title, project.script, project.voiceoverUrl, project.captionsJson, project.scenesJson

**Impact:** Project state can be corrupted by concurrent stale and winning workers.

**Example scenario:**
1. Worker A claims Job J, gets attemptToken A
2. Worker A updates Project.title = "A's Script"
3. Worker A's lease expires
4. Worker B claims Job J, gets attemptToken B
5. Worker B updates Project.title = "B's Script"
6. Worker A (stale) updates Project.title = "A's Script" ← **stale write overwrites winner**
7. Final project has wrong title, wrong rendering results

### 2. Cost record creation not fenced (line 129-144)

Cost record is created OUTSIDE the success transaction using `upsertCostRecord()` with hardcoded `creditsCharged: CREDITS_PER_VIDEO`.

**Impact:** Stale worker creates a duplicate cost record after the winning worker's record.

**Example scenario:**
1. Worker A completes successfully, creates cost record with creditsCharged=10
2. Worker B eventually also succeeds (shouldn't happen, but defensive)
3. Worker A (now stale) creates another cost record with creditsCharged=10 (idempotency key based on jobId)
4. **Duplicate charges for one job**

**Note:** The idempotency key is `jobId`, so on retry it's idempotent. But if Worker B has a different jobId or the upsert key is missing, we get duplicates.

### 3. Error path not fenced (lines 165-200)

When an error occurs (e.g., render fails), the error handler immediately:
- Updates job.status to "failed"
- Updates project.status to "failed"
- Calls releaseReservationInTx() to refund credits

All WITHOUT verifying the lease is still held.

**Impact:** Stale worker can mark job failed and refund credits even after losing lease.

**Example scenario:**
1. Worker A is processing, lease expires
2. Worker B claims and starts processing Job J
3. Worker A encounters an error and executes error handler
4. Error handler updates Job.status = "failed" (NO LEASE CHECK)
5. Error handler calls releaseReservationInTx() (NO LEASE CHECK)
6. Credits are refunded to stale Worker A's state
7. Worker B completes but Job is already "failed"
8. Credits possibly refunded twice (A + legacy path)

### 4. Provider calls and media uploads not checkpointed

The runners call:
- generateScript(), generateAdScript()
- synthesizeVoiceover(), cloneVoice()
- pickBrollScenes()
- transcribeVideo()
- planHighlightsFromTranscript()
- renderScriptVideo(), renderRepurposeClip()
- B2 uploads (implicit in render, TTS, voice clone)

None of these have lease-loss checkpoints. A stale worker can:
- Continue provider work after losing lease
- Upload media to B2 after lease lost
- Charge provider costs and bandwidth

---

## Media Output Safety

Currently:
- Script render uploads to `media/{userId}/{projectId}/final.mp4`
- Repurpose clips upload to `media/{userId}/{projectId}/clip-{clipId}.mp4`
- UGC render uploads to `media/{userId}/{projectId}/final.mp4`

**No attempt-scoping.** If Worker A and Worker B both upload to the same final.mp4 key:
- The last writer wins (usually Worker B, but not guaranteed)
- A's output could briefly be visible as "active"
- No cleanup of A's object if B wins

**Impact:** Potential cross-job output contamination in multi-tenant environment (if jobs share keys, which they don't). More likely: bandwidth waste from both workers uploading, B2 storage pollution.

---

## Idempotency and Retries

### upsertCostRecord()

**Current behavior:** Idempotent on jobId.

If a job is retried:
- First attempt creates cost record (or updates if exists)
- Retry reads same cost record
- No double charging **if idempotency key is jobId**

**Risk:** If key changes or implementation changes, duplicates are possible.

**Evidence needed:** Verify actual idempotency key in upsertCostRecord implementation.

---

## Transaction Boundaries

### Success Path (Protected)

```sql
BEGIN;
  UPDATE job SET status='done', ... WHERE id=? AND status='processing' AND workerId=? AND attemptToken=?;
  UPDATE project SET status='ready', videoUrl=? WHERE id=?;
  UPDATE creditReservation SET status='captured' WHERE id=? AND status='reserved';
COMMIT; -- atomically succeed or fail
```

✓ Lease checked before any writes.
✓ All three writes commit together or roll back together.

### Error Path (UNPROTECTED)

```sql
BEGIN;
  UPDATE project SET status='failed' WHERE id=?;
  UPDATE job SET status='failed' WHERE id=?;
  UPDATE creditReservation SET status='released' WHERE id=?;
  UPDATE user SET credits = credits + ? WHERE id=?;
  INSERT INTO creditLedgerEntry ...;
COMMIT; -- no lease check before transaction
```

✗ No lease check before any writes.
✗ Stale worker can finalize failures.

---

## Summary of Required Fixes

### Priority 1 (CRITICAL: Prevent data corruption and double charges)

1. **Fence error path:** Verify lease before transaction in error handler
2. **Fence intermediate updates:** Verify attemptToken before updateJobStage, progress, project metadata
3. **Move cost record inside transaction:** Ensure creditsCharged and jobId are captured atomically
4. **Fence media uploads:** Prevent stale worker uploads using attempt-scoped temporary keys

### Priority 2 (HIGH: Defensive robustness)

1. **Explicit lease-loss detection:** renewLease() should return ownership status, not silent no-op
2. **Add checkpoints:** Before expensive provider calls, before rendering, before uploads
3. **Idempotency:** Ensure cost record truly uses jobId as key or add attemptToken to key
4. **Cleanup:** Remove attempt-scoped media if stale worker loses lease

### Priority 3 (MEDIUM: Evidence and testing)

1. **Integration tests:** Prove stale worker mutations are rejected
2. **Race tests:** Concurrent claim, lease expiry, re-claim scenarios
3. **Cost record audit:** Verify no duplicate charges in production scenario

---

## Scoring Summary

**Current Lease Fencing Score: 20% (Foundation only)**

| Category | Score | Reason |
|----------|-------|--------|
| Job mutations | 50% | Only completion fenced; progress/status unprotected |
| Project mutations | 0% | No fencing on metadata or status updates |
| Credit operations | 50% | Capture fenced in success path; release unprotected in error path |
| Media publication | 0% | No attempt-scoping; no stale-worker prevention |
| Cost records | 0% | Outside transaction; no lease check |
| Error handling | 0% | No lease verification before error finalization |
| Checkpoints | 0% | No heartbeat checks before expensive operations |

**Verdict: NOT PRODUCTION-SAFE. Proceed to strengthening phase.**
