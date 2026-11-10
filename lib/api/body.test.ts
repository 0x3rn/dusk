// lib/api/body.test.ts
import { describe, expect, it } from "vitest";
import { readJsonBody } from "./body";
import { ValidationError } from "../auth/security";

const post = (body: BodyInit | null, headers: Record<string, string> = {}) =>
  new Request("http://localhost/x", { method: "POST", body, headers });

describe("readJsonBody", () => {
  it("parses valid JSON", async () => {
    expect(await readJsonBody(post(JSON.stringify({ a: 1 })))).toEqual({ a: 1 });
  });

  it("turns malformed JSON into a ValidationError (400), not a crash", async () => {
    await expect(readJsonBody(post("{not json"))).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects an empty body and a missing body", async () => {
    await expect(readJsonBody(post(""))).rejects.toBeInstanceOf(ValidationError);
    await expect(readJsonBody(post(null))).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects a body over the cap even when Content-Length is missing", async () => {
    const big = JSON.stringify({ x: "a".repeat(2000) });
    await expect(readJsonBody(post(big), 1000)).rejects.toThrow("too large");
  });

  it("rejects early when Content-Length already declares an oversized body", async () => {
    await expect(readJsonBody(post("{}", { "content-length": "999999999" }))).rejects.toThrow("too large");
  });
});
