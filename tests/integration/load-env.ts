// tests/integration/load-env.ts
// Must be the FIRST import of helpers.ts. Importing @prisma/client makes Prisma auto-load the
// production URL from .env, and Next's loader never overrides a variable that is already set.
// Under NODE_ENV=test Next also skips .env.local, so load as "development" to get the dev branch.
import { loadEnvConfig } from "@next/env";

const env = process.env as Record<string, string | undefined>;
const saved = env.NODE_ENV;
env.NODE_ENV = "development";
loadEnvConfig(process.cwd(), true);
env.NODE_ENV = saved;
