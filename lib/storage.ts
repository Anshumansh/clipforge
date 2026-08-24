import fs from "node:fs/promises";
import path from "node:path";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

interface S3Config {
  bucket: string;
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
}

function getS3Config(): S3Config | null {
  const bucket = process.env.STORAGE_BUCKET;
  const endpoint = process.env.STORAGE_ENDPOINT;
  const accessKeyId = process.env.STORAGE_ACCESS_KEY_ID;
  const secretAccessKey = process.env.STORAGE_SECRET_ACCESS_KEY;
  // R2 accepts the literal string "auto" for SigV4 region; other S3-compatible
  // providers (e.g. Backblaze B2) require their real region code here instead.
  const region = process.env.STORAGE_REGION || "auto";

  if (bucket && endpoint && accessKeyId && secretAccessKey) {
    return { bucket, endpoint, region, accessKeyId, secretAccessKey };
  }
  return null;
}

let cachedClient: S3Client | null = null;

function getS3Client(config: S3Config): S3Client {
  if (!cachedClient) {
    cachedClient = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      // Path-style (endpoint/bucket) avoids virtual-hosted-style addressing quirks
      // across different S3-compatible providers.
      forcePathStyle: true,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    });
  }
  return cachedClient;
}

export function getAppBaseUrl(): string {
  return (process.env.NEXTAUTH_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

/** True once STORAGE_* env vars are set — otherwise storage falls back to writing
 * into ./public/media, which only works for local development (that disk doesn't
 * survive redeploys or scale past one instance in real hosting). */
export function isRemoteStorageConfigured(): boolean {
  return getS3Config() !== null;
}

async function uploadToLocalPublicDir(buffer: Buffer, key: string): Promise<string> {
  const destPath = path.join(process.cwd(), "public", key);
  await fs.mkdir(path.dirname(destPath), { recursive: true });
  await fs.writeFile(destPath, buffer);
  return `/${key}`;
}

/** Uploads a buffer to S3-compatible storage (Cloudflare R2, S3, etc.) if configured,
 * otherwise falls back to writing into ./public/media for local dev.
 *
 * The bucket is kept private — no "public access" bucket setting required. Instead
 * this returns a URL on our own domain (`/api/media/<key>`) that redirects to a
 * short-lived presigned URL on request. Locally (no remote storage), it returns a
 * root-relative path served directly by Next's static file handling. */
export async function uploadBuffer(buffer: Buffer, key: string, contentType: string): Promise<string> {
  const config = getS3Config();
  if (!config) return uploadToLocalPublicDir(buffer, key);

  const client = getS3Client(config);
  await client.send(new PutObjectCommand({ Bucket: config.bucket, Key: key, Body: buffer, ContentType: contentType }));
  return `${getAppBaseUrl()}/api/media/${key}`;
}

/** Same as uploadBuffer, but reads the buffer from a local file path first —
 * for uploading a file Remotion (or another tool) already rendered to local disk. */
export async function uploadLocalFile(localFilePath: string, key: string, contentType: string): Promise<string> {
  const buffer = await fs.readFile(localFilePath);
  return uploadBuffer(buffer, key, contentType);
}

/** Generates a short-lived signed URL for a private object — used by the
 * /api/media/[...key] proxy route to redirect requests to the real file. */
export async function getPresignedDownloadUrl(key: string, expiresInSeconds = 3600): Promise<string | null> {
  const config = getS3Config();
  if (!config) return null;

  const client = getS3Client(config);
  const command = new GetObjectCommand({ Bucket: config.bucket, Key: key });
  return getSignedUrl(client, command, { expiresIn: expiresInSeconds });
}

/** True if an object exists at this key. Used to make a copy idempotent —
 * checking first means a second call (a redeploy, a second concurrent
 * request) never re-copies or throws on an already-satisfied destination. */
export async function objectExists(key: string): Promise<boolean> {
  const config = getS3Config();
  if (!config) return false;

  const client = getS3Client(config);
  try {
    const head = await client.send(new HeadObjectCommand({ Bucket: config.bucket, Key: key }));
    // A HEAD that "succeeds" against a zero-byte object still counts as
    // missing -- a bad CopyObjectCommand call (a malformed CopySource, an
    // interrupted copy) can leave an empty placeholder at the destination
    // key that would otherwise permanently short-circuit every future
    // self-heal attempt, since existence alone would look satisfied forever.
    return (head.ContentLength ?? 0) > 0;
  } catch {
    return false;
  }
}

/** Copies an object within the same bucket via a real GET + PUT, not
 * CopyObjectCommand -- server-side copy repeatedly produced a destination
 * object that existed (real content-length, no error at any step) but
 * returned 403 on every presigned GET, on this provider specifically, and
 * did so identically both before and after fixing a real CopySource-encoding
 * bug, ruling that fix out as the actual cause. Rather than keep chasing an
 * unobservable provider-side quirk in a command this codebase uses nowhere
 * else, this reuses PutObjectCommand -- the exact call every real upload in
 * this app already goes through and that's known to produce objects real
 * presigned GETs can serve. Used to promote a real generated output into a
 * permanent, account-independent key -- see app/page.tsx's showcase clips,
 * which must not depend on any Project/Job row that a project deletion or
 * the demo-account 24h cleanup could remove out from under a public
 * marketing page. */
export async function copyObject(sourceKey: string, destKey: string): Promise<void> {
  const config = getS3Config();
  if (!config) return;

  const client = getS3Client(config);
  const got = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: sourceKey }));
  if (!got.Body) throw new Error(`copyObject: source ${sourceKey} has no body`);
  const bytes = await got.Body.transformToByteArray();

  await client.send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: destKey,
      Body: bytes,
      ContentType: got.ContentType ?? "video/mp4",
    })
  );
}

/** Cheap connectivity check for /api/health — lists at most 1 key so it
 * verifies auth + reachability without the cost of a real listing. */
export async function checkStorageHealth(): Promise<boolean> {
  const config = getS3Config();
  if (!config) return false;

  const client = getS3Client(config);
  await client.send(new ListObjectsV2Command({ Bucket: config.bucket, MaxKeys: 1 }));
  return true;
}

/** Permanently deletes every stored object under an arbitrary key prefix.
 * No-ops in local dev (no remote storage configured). */
export async function deleteMediaByPrefix(prefix: string): Promise<void> {
  const config = getS3Config();
  if (!config) return;

  const client = getS3Client(config);
  let continuationToken: string | undefined;

  do {
    const listed = await client.send(
      new ListObjectsV2Command({ Bucket: config.bucket, Prefix: prefix, ContinuationToken: continuationToken })
    );
    const keys = (listed.Contents ?? []).map((obj) => obj.Key).filter((k): k is string => !!k);

    if (keys.length > 0) {
      await client.send(
        new DeleteObjectsCommand({ Bucket: config.bucket, Delete: { Objects: keys.map((Key) => ({ Key })) } })
      );
    }

    continuationToken = listed.IsTruncated ? listed.NextContinuationToken : undefined;
  } while (continuationToken);
}

/** Deletes every stored object under a user's media prefix — called on
 * account deletion. Deleting the DB rows that reference these files (via
 * Prisma's onDelete: Cascade) removes the *references*, not the underlying
 * storage objects; without this, "delete my account" would leave every
 * generated video, voiceover, and uploaded voice sample sitting in the
 * bucket indefinitely, which isn't a real deletion for GDPR/CCPA purposes. */
export async function deleteUserMedia(userId: string): Promise<void> {
  await deleteMediaByPrefix(`media/${userId}/`);
}
