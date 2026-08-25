export function getPublicAppOrigin(requestUrl: string): string {
  const configured = process.env.NEXTAUTH_URL?.trim();
  const url = new URL(configured || requestUrl);
  return url.origin;
}
