import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const APP_URL = (process.env.NEXTAUTH_URL ?? "http://localhost:3000").replace(/\/$/, "");

interface ApiError {
  error?: string;
}

/** Every tool below is a thin wrapper around Clipforge's own public HTTP
 * API, authenticated with the same API key the MCP client connected with --
 * not a separate internal code path. Keeps this module fully decoupled
 * from render-pipeline internals; the API surface it depends on is exactly
 * what any other API client would use. */
async function callApi<T>(apiKey: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${APP_URL}${path}`, {
    ...init,
    headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${apiKey}` },
  });
  const data = (await res.json().catch(() => ({}))) as T & ApiError;
  if (!res.ok) {
    throw new Error(data.error ?? `Clipforge API request failed with status ${res.status}`);
  }
  return data;
}

function errorContent(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return { content: [{ type: "text" as const, text: `Error: ${message}` }], isError: true };
}

export function buildMcpServer(apiKey: string): McpServer {
  const server = new McpServer({ name: "clipforge-mcp-server", version: "1.0.0" });

  server.registerTool(
    "clipforge_generate_script_video",
    {
      title: "Generate a script-to-video short",
      description: `Turns a topic, script, or article into a finished vertical short: Clipforge writes a spoken-word script, generates a voiceover, picks matching b-roll, adds word-by-word captions, and renders one video. This starts a render job -- it does not wait for it to finish. Call clipforge_get_project_status with the returned project_id to check progress and get the final video URL once it's ready (renders typically take 1-2 minutes).

Args:
  - topic (string, required): The topic, script, or article text to turn into a video (3-4000 characters).
  - language (string, optional): ISO-ish language code for the script and voiceover, e.g. "en", "es", "fr", "de", "hi", "ja". Defaults to "en" if omitted or unrecognized.
  - aspect_ratio (string, optional): One of "9:16" (TikTok/Reels/Shorts, default), "1:1" (Instagram feed), or "16:9" (YouTube). Non-default ratios require the Business plan.

Returns: { project_id, status } -- status will be "queued".

Costs credits on your Clipforge account (charged immediately on call, same as generating from the dashboard).`,
      inputSchema: {
        topic: z.string().min(3).max(4000).describe("The topic, script, or article text to turn into a video"),
        language: z.string().optional().describe('Language code, e.g. "en", "es", "fr" -- defaults to English'),
        aspect_ratio: z.enum(["9:16", "1:1", "16:9"]).optional().describe("Output aspect ratio -- 1:1 and 16:9 require the Business plan"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ topic, language, aspect_ratio }) => {
      try {
        const form = new FormData();
        form.set("topic", topic);
        if (language) form.set("language", language);
        if (aspect_ratio) form.set("aspectRatio", aspect_ratio);

        // Each tool call is one intentional generation action (idempotentHint
        // is deliberately false above), so a fresh operation id is minted
        // every invocation -- the server-side idempotency this key drives is
        // about protecting a SINGLE call's own retries (see
        // lib/pricing/generation-idempotency.ts), not about deduping across
        // separate tool calls.
        const data = await callApi<{ projectId: string }>(apiKey, "/api/projects/script", {
          method: "POST",
          headers: { "Idempotency-Key": crypto.randomUUID() },
          body: form,
        });
        const output = { project_id: data.projectId, status: "queued" };
        return {
          content: [{ type: "text", text: `Started rendering "${topic.slice(0, 60)}" -- project ${data.projectId} is queued. Check clipforge_get_project_status to follow progress.` }],
          structuredContent: output,
        };
      } catch (error) {
        return errorContent(error);
      }
    }
  );

  server.registerTool(
    "clipforge_get_project_status",
    {
      title: "Get a Clipforge project's render status",
      description: `Checks the status of a project previously created with clipforge_generate_script_video (or any Clipforge project).

Args:
  - project_id (string, required): The project ID returned when the render was started.

Returns:
  {
    "id": string,
    "status": "queued" | "processing" | "ready" | "failed",
    "progress": number,       // 0-100, only meaningful while queued/processing
    "video_url": string|null, // set once status is "ready"
    "error_message": string|null // set if status is "failed"
  }`,
      inputSchema: {
        project_id: z.string().min(1).describe("The project ID to check"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ project_id }) => {
      try {
        const data = await callApi<{
          status: string;
          videoUrl: string | null;
          errorMessage: string | null;
          job: { progress: number } | null;
        }>(apiKey, `/api/projects/${encodeURIComponent(project_id)}`);

        const output = {
          id: project_id,
          status: data.status,
          progress: data.job?.progress ?? (data.status === "ready" ? 100 : 0),
          video_url: data.videoUrl,
          error_message: data.errorMessage,
        };
        return {
          content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
          structuredContent: output,
        };
      } catch (error) {
        return errorContent(error);
      }
    }
  );

  server.registerTool(
    "clipforge_list_projects",
    {
      title: "List recent Clipforge projects",
      description: `Lists your most recent Clipforge projects (script-to-video, repurpose, and UGC ad projects), newest first.

Args:
  - limit (number, optional): Maximum number of projects to return, 1-50 (default 20).

Returns: { projects: [{ id, type, title, status, video_url, created_at }] }`,
      inputSchema: {
        limit: z.number().int().min(1).max(50).default(20).describe("Maximum number of projects to return"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ limit }) => {
      try {
        const data = await callApi<{
          projects: { id: string; type: string; title: string; status: string; videoUrl: string | null; createdAt: string }[];
        }>(apiKey, `/api/projects?limit=${limit}`);

        const output = {
          projects: data.projects.map((p) => ({
            id: p.id,
            type: p.type,
            title: p.title,
            status: p.status,
            video_url: p.videoUrl,
            created_at: p.createdAt,
          })),
        };
        const lines = [`Found ${output.projects.length} project(s):`, ""];
        for (const p of output.projects) {
          lines.push(`- [${p.status}] ${p.title} (${p.type}, ${p.id})`);
        }
        return {
          content: [{ type: "text", text: lines.join("\n") }],
          structuredContent: output,
        };
      } catch (error) {
        return errorContent(error);
      }
    }
  );

  server.registerTool(
    "clipforge_get_credit_balance",
    {
      title: "Get Clipforge credit balance and plan",
      description: `Checks the current account's credit balance and subscription plan. Useful before starting a render to confirm there are enough credits.

Returns: { email, credits, plan }`,
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async () => {
      try {
        const data = await callApi<{ email: string; credits: number; plan: string }>(apiKey, "/api/me");
        return {
          content: [{ type: "text", text: `${data.email}: ${data.credits} credits on the ${data.plan} plan.` }],
          structuredContent: data,
        };
      } catch (error) {
        return errorContent(error);
      }
    }
  );

  return server;
}
