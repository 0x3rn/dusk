// lib/notifications/templates.test.ts
import { describe, expect, it } from "vitest";
import { escapeHtml, renderEmail, renderSms, safeUrl } from "./templates";

describe("notification templates", () => {
  it("renders the action link in both text and html", () => {
    const m = renderEmail("CHECKIN_REMINDER", {
      actionUrl: "https://dusk.app/checkin/abc123",
      recipientName: "Ada",
    });
    expect(m.subject).toBe("Dusk check-in reminder");
    expect(m.text).toContain("Hello Ada,");
    expect(m.text).toContain("https://dusk.app/checkin/abc123");
    expect(m.html).toContain('href="https://dusk.app/checkin/abc123"');
  });

  it("escapes html in names so a hostile name cannot inject markup", () => {
    const m = renderEmail("CHECKIN_REMINDER", {
      actionUrl: "https://dusk.app/x",
      recipientName: '<script>alert("x")</script>',
    });
    expect(m.html).not.toContain("<script>");
    expect(m.html).toContain("&lt;script&gt;");
  });

  it.each([
    ["javascript:alert(1)"],
    ["data:text/html,<b>x</b>"],
    ["not a url"],
    [42],
    [undefined],
  ])("drops an unsafe or invalid link: %j", (bad) => {
    expect(safeUrl(bad)).toBeNull();
    const m = renderEmail("RELEASE_PACKAGE_READY", { actionUrl: bad });
    expect(m.html).not.toContain("<a ");
    expect(m.text).not.toContain("javascript:");
  });

  it("escapes quotes inside an otherwise valid link", () => {
    const m = renderEmail("CHECKIN_REMINDER", { actionUrl: 'https://dusk.app/x?a="b"' });
    expect(m.html).not.toContain('"b"');
  });

  it("covers every template key with a subject", () => {
    for (const key of [
      "CHECKIN_REMINDER",
      "MISSED_CHECKIN_ESCALATION",
      "BENEFICIARY_INVITATION",
      "TRUSTED_VERIFIER_CHALLENGE",
      "RELEASE_PACKAGE_READY",
      "SECURITY_ALERT",
    ] as const) {
      expect(renderEmail(key, {}).subject.length).toBeGreaterThan(5);
    }
  });

  it("SMS never contains a token link", () => {
    const sms = renderSms("MISSED_CHECKIN_ESCALATION", "https://dusk.app/");
    expect(sms).toContain("https://dusk.app/dashboard");
    expect(sms).not.toMatch(/checkin\/|verify\/|unlock\//);
  });

  it("escapeHtml handles all special characters", () => {
    expect(escapeHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
  });
});
