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
      "CONTACT_INVITATION",
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

describe("contact invitation email", () => {
  const base = { actionUrl: "https://dusk.app/invite/abc", recipientName: "Sam", ownerName: "Grace Hopper", expiresInDays: 14 };

  it("tells a beneficiary they would receive items, and names the owner", () => {
    const m = renderEmail("CONTACT_INVITATION", { ...base, isBeneficiary: true, isTrustedVerifier: false });
    expect(m.subject).toBe("Grace Hopper has asked you to be a beneficiary on Dusk");
    expect(m.text).toContain("you would receive the items Grace Hopper chooses for you");
    expect(m.text).not.toContain("trusted verifier");
    expect(m.text).toContain("https://dusk.app/invite/abc");
  });

  it("tells a trusted verifier they only confirm what they know and cannot see items", () => {
    const m = renderEmail("CONTACT_INVITATION", { ...base, isBeneficiary: false, isTrustedVerifier: true });
    expect(m.subject).toBe("Grace Hopper has asked you to be a trusted verifier on Dusk");
    expect(m.text).toContain("help confirm that Grace Hopper is okay");
    expect(m.text).toContain("cannot see anything they have stored");
    expect(m.text).not.toContain("would receive the items");
  });

  it("explains both roles when a person has both", () => {
    const m = renderEmail("CONTACT_INVITATION", { ...base, isBeneficiary: true, isTrustedVerifier: true });
    expect(m.subject).toContain("a beneficiary and a trusted verifier");
    expect(m.text).toContain("As a beneficiary");
    expect(m.text).toContain("As a trusted verifier");
  });

  it("says what accepting means, how to decline, and that the link works once for 14 days", () => {
    const m = renderEmail("CONTACT_INVITATION", { ...base, isBeneficiary: true, isTrustedVerifier: false });
    expect(m.text).toContain("does not give you access to anything today");
    expect(m.text).toContain("ignore this email");
    expect(m.text).toContain("Decline");
    expect(m.text).toContain("works once and stops working after 14 days");
  });

  it("never reveals an email address and falls back to a neutral name when the owner has none", () => {
    const m = renderEmail("CONTACT_INVITATION", { actionUrl: base.actionUrl, isBeneficiary: true, isTrustedVerifier: false });
    expect(m.subject).toBe("Someone you know has asked you to be a beneficiary on Dusk");
    expect(m.text).not.toMatch(/@/);
  });

  it("escapes a hostile owner name in the html and keeps the subject on one line", () => {
    const m = renderEmail("CONTACT_INVITATION", {
      ...base,
      ownerName: 'Eve <script>alert("x")</script>\r\nBcc: victim@example.com',
      isBeneficiary: true,
      isTrustedVerifier: false,
    });
    expect(m.html).not.toContain("<script>");
    expect(m.html).toContain("&lt;script&gt;");
    expect(m.subject).not.toMatch(/[\r\n]/);
    expect(m.html).not.toContain("<a href=\"javascript");
  });

  it("drops an unsafe link instead of printing it", () => {
    const m = renderEmail("CONTACT_INVITATION", { ...base, actionUrl: "javascript:alert(1)", isBeneficiary: true, isTrustedVerifier: false });
    expect(m.html).not.toContain("<a ");
    expect(m.text).not.toContain("javascript:");
  });

  it("treats the role flags as data: only a real true counts", () => {
    const m = renderEmail("CONTACT_INVITATION", { ...base, isBeneficiary: "true", isTrustedVerifier: 1 });
    // Falls back to the safest, narrowest wording.
    expect(m.subject).toContain("a beneficiary");
    expect(m.text).not.toContain("As a trusted verifier");
  });
});
