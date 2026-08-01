import { staticFile } from "remotion";

/** Media URLs can be either an absolute URL (remote storage in production) or a
 * root-relative local path (./public/media fallback in dev) — resolve either to
 * something Remotion's <Img>/<Video>/<Audio> components can load directly. */
export function resolveSource(source: string): string {
  if (/^https?:\/\//.test(source)) return source;
  return staticFile(source.replace(/^\//, ""));
}
