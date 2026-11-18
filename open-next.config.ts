// open-next.config.ts
// Settings for @opennextjs/cloudflare, which turns the Next.js build into a Cloudflare Worker.
// Every Dusk page is rendered per request and nothing uses ISR, so no cache storage is configured.
import { defineCloudflareConfig } from "@opennextjs/cloudflare";

export default defineCloudflareConfig({});
