import fs from "node:fs/promises";
import path from "node:path";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

interface S3Config {
  bucket: string;
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicUrlBase: string;
}

function getS3Config(): S3Config | null {
  const bucket = process.env.STORAGE_BUCKET;
  const endpoint = process.env.STORAGE_ENDPOINT;
  const accessKeyId = process.env.STORAGE_ACCESS_KEY_ID;
  const secretAccessKey = process.env.STORAGE_SECRET_ACCESS_KEY;
  const publicUrlBase = process.env.STORAGE_PUBLIC_URL;

  if (bucket && endpoint && accessKeyId && secretAccessKey && publicUrlBase) {
    return { bucket, endpoint, accessKeyId, secretAccessKey, publicUrlBase };
  }
  return null;
}

let cachedClient: S3Client | null = null;

function getS3Client(config: S3Config): S3Client {
  if (!cachedClient) {
    cachedClient = new S3Client({
      region: "auto",
      endpoint: config.endpoint,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    });
  }
  return cachedClient;
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
 * otherwise falls back to writing into ./public/media for local dev. Returns the
 * final public URL — an absolute https URL in production, a root-relative path locally. */
export async function uploadBuffer(buffer: Buffer, key: string, contentType: string): Promise<string> {
  const config = getS3Config();
  if (!config) return uploadToLocalPublicDir(buffer, key);

  const client = getS3Client(config);
  await client.send(new PutObjectCommand({ Bucket: config.bucket, Key: key, Body: buffer, ContentType: contentType }));
  return `${config.publicUrlBase.replace(/\/$/, "")}/${key}`;
}

/** Same as uploadBuffer, but reads the buffer from a local file path first —
 * for uploading a file Remotion (or another tool) already rendered to local disk. */
export async function uploadLocalFile(localFilePath: string, key: string, contentType: string): Promise<string> {
  const buffer = await fs.readFile(localFilePath);
  return uploadBuffer(buffer, key, contentType);
}
