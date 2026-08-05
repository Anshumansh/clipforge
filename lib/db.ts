import { PrismaClient } from "@prisma/client";

const RETRYABLE = /Can't reach database server|Connection terminated|ECONNRESET|ETIMEDOUT/;
const MAX_ATTEMPTS = 3;

// Neon's free tier suspends its compute after a few minutes idle and takes a
// moment to wake back up — the first query after idle time can otherwise
// surface as a hard connection error to the user instead of a brief delay.
function createClient() {
  const client = new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

  return client.$extends({
    query: {
      async $allOperations({ args, query }) {
        for (let attempt = 1; ; attempt++) {
          try {
            return await query(args);
          } catch (err) {
            const retryable = err instanceof Error && RETRYABLE.test(err.message);
            if (!retryable || attempt >= MAX_ATTEMPTS) throw err;
            await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
          }
        }
      },
    },
  });
}

const globalForPrisma = globalThis as unknown as { prisma?: ReturnType<typeof createClient> };

export const db = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
