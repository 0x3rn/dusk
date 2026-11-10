// lib/api/body.ts
// Reads a JSON request body safely. `req.json()` throws a bare SyntaxError on bad input (a 500
// for the caller) and has no size limit, so every mutating route reads its body through here.
import { ValidationError } from "../auth/security";

/** Largest body any Dusk JSON route accepts. Encrypted vault items are the biggest legitimate payload. */
export const MAX_JSON_BODY_BYTES = 3 * 1024 * 1024;

export async function readJsonBody(req: Request, maxBytes = MAX_JSON_BODY_BYTES): Promise<unknown> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new ValidationError("Request body is too large.");
  }

  // Read the stream with a running cap, because Content-Length can be absent or untrue.
  const reader = req.body?.getReader();
  if (!reader) throw new ValidationError("Request body must be JSON.");
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new ValidationError("Request body is too large.");
    }
    chunks.push(value);
  }

  const text = new TextDecoder().decode(Buffer.concat(chunks));
  try {
    return JSON.parse(text);
  } catch {
    throw new ValidationError("Request body must be valid JSON.");
  }
}
