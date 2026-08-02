import fs from "node:fs/promises";
import path from "node:path";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

interface S3Config {
  bucket: string;
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
}

function getS3Config(): S3Config | null {
  const bucket = process.env.STORAGE_BUCKET;
  const endpoint = process.env.STORAGE_ENDPOINT;
  const accessKeyId = process.env.STORAGE_ACCESS_KEY_ID;
  const secretAccessKey = process.env.STORAGE_SECRET_ACCESS_KEY;

  if (bucket && endpoint && accessKeyId && secretAccessKey) {
    return { bucket, endpoint, accessKeyId, secretAccessKey };
  }
  return null;
}

let cachedClient: S3Client | null = null;

function getS3Client(config: S3Config): S3Client {
  if (!cachedClient) {
    cachedClient = new S3Client({
      region: "auto",
      endpoint: config.endpoint,
      // R2's TLS setup doesn't play well with the SDK's default virtual-hosted-style
      // addressing (bucket.endpoint) — path-style (endpoint/bucket) avoids handshake failures.
      forcePathStyle: true,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    });
  }
  return cachedClient;
}

function getAppBaseUrl(): string {
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
