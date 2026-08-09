import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { buildMcpServer } from "@/lib/mcp/build-server";

export const runtime = "nodejs";

function unauthorized() {
  return new Response(
    JSON.stringify({ error: "Missing or invalid Authorization: Bearer <api-key> header. Create a key at https://forgecut.app/dashboard/settings/api-keys." }),
    { status: 401, headers: { "content-type": "application/json" } }
  );
}

export async function POST(req: Request) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return unauthorized();
  const apiKey = authHeader.slice(7).trim();
  if (!apiKey) return unauthorized();

  // Fresh server + transport per request: this endpoint runs stateless
  // (sessionIdGenerator: undefined), matching the MCP SDK's recommended
  // pattern for scalable remote servers -- no in-memory session state to
  // manage or leak between unrelated callers.
  const server = buildMcpServer(apiKey);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  await server.connect(transport);
  return transport.handleRequest(req);
}
