import { NextResponse } from "next/server";
import { getShowcaseAsset, isShowcaseName } from "@/lib/showcase-assets";
import { getStoredObject, headStoredObject, type StoredObjectMetadata } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CACHE_CONTROL = "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800";

function metadataHeaders(metadata: StoredObjectMetadata): Headers {
  const headers = new Headers({
    "Accept-Ranges": "bytes",
    "Cache-Control": CACHE_CONTROL,
    "Content-Type": metadata.contentType === "application/octet-stream" ? "video/mp4" : metadata.contentType,
    "Content-Disposition": "inline",
    "X-Content-Type-Options": "nosniff",
  });
  if (metadata.contentLength !== null) headers.set("Content-Length", String(metadata.contentLength));
  if (metadata.etag) headers.set("ETag", metadata.etag);
  if (metadata.lastModified) headers.set("Last-Modified", metadata.lastModified.toUTCString());
  return headers;
}

function resolveName(params: { name: string }): ReturnType<typeof getShowcaseAsset> | null {
  return isShowcaseName(params.name) ? getShowcaseAsset(params.name) : null;
}

export async function HEAD(_req: Request, { params }: { params: { name: string } }) {
  const asset = resolveName(params);
  if (!asset) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const metadata = await headStoredObject(asset.storageKey);
    if (!metadata || metadata.contentLength === 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return new Response(null, { status: 200, headers: metadataHeaders(metadata) });
  } catch (error) {
    console.error(`Showcase HEAD failed for ${asset.name}`, error);
    return NextResponse.json({ error: "Showcase temporarily unavailable" }, { status: 503 });
  }
}

export async function GET(req: Request, { params }: { params: { name: string } }) {
  const asset = resolveName(params);
  if (!asset) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const range = req.headers.get("range")?.trim();
  if (range && !/^bytes=(\d*)-(\d*)$/.test(range)) {
    return new Response(null, { status: 416, headers: { "Accept-Ranges": "bytes" } });
  }

  try {
    const object = await getStoredObject(asset.storageKey, range);
    if (!object || object.contentLength === 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const headers = metadataHeaders(object);
    if (object.contentRange) headers.set("Content-Range", object.contentRange);
    return new Response(object.body as BodyInit, { status: object.status, headers });
  } catch (error) {
    if (error instanceof RangeError) {
      return new Response(null, { status: 416, headers: { "Accept-Ranges": "bytes" } });
    }
    console.error(`Showcase GET failed for ${asset.name}`, error);
    return NextResponse.json({ error: "Showcase temporarily unavailable" }, { status: 503 });
  }
}
