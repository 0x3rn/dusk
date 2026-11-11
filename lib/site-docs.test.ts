// lib/site-docs.test.ts
// Guards the public help, privacy and terms text: nothing about a payment provider we do not use,
// no claim the product cannot keep, every owner to-do is a recognisable placeholder, and the
// promises about data (retention, deletion, helpers) are all still there.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { RETENTION_MONTHS } from "./engine/retention";
import { LEGAL_SCOPE_AND_ESTATE_DISCLAIMER } from "./security/http-hardening";
import {
  COMPANY_NAME_PLACEHOLDER,
  CONTACT_EMAIL_PLACEHOLDER,
  GOVERNING_LAW_PLACEHOLDER,
  LEGAL_LAST_UPDATED,
  MINIMUM_AGE_PLACEHOLDER,
  REFUND_POLICY_PLACEHOLDER,
  SITE_DOCS,
} from "./site-docs";

function htmlOf(key: string): string {
  return renderToStaticMarkup(SITE_DOCS[key].body);
}

function textOf(key: string): string {
  return htmlOf(key)
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

const ALL_KEYS = Object.keys(SITE_DOCS);
const PLACEHOLDER_TOKEN = /^\[[A-Z][A-Z0-9 /&-]* TO BE ADDED\]$/;

describe("every document", () => {
  it("has the four pages we publish", () => {
    expect(ALL_KEYS.sort()).toEqual(["help-center", "privacy-policy", "security-disclosures", "terms-of-service"]);
  });

  it.each(ALL_KEYS)("%s never mentions Stripe, or any other payment company we do not use", (key) => {
    const text = `${SITE_DOCS[key].title} ${textOf(key)}`;
    expect(text).not.toMatch(/stripe|paypal|braintree|paddle/i);
  });

  it.each(ALL_KEYS)("%s makes none of the claims we cannot keep", (key) => {
    const text = textOf(key);
    const forbidden: RegExp[] = [
      /reminds? you by email or sms/i, // owners cannot enter their own phone number
      /military[- ]grade/i,
      /unbreakable|100% secure|hack[- ]proof/i,
      /guarantee[sd]?\s+(delivery|release|that)/i,
      /no delete button/i, // self-serve deletion exists now
      /instantly deleted?/i,
      /Dusk Technologies/, // the legal name is still a placeholder
    ];
    for (const pattern of forbidden) expect(text, String(pattern)).not.toMatch(pattern);
  });

  it.each(ALL_KEYS)("%s uses only recognisable placeholder tokens", (key) => {
    const tokens = textOf(key).match(/\[[^\]]*\]/g) ?? [];
    for (const token of tokens) expect(token, `unexpected bracket text in ${key}`).toMatch(PLACEHOLDER_TOKEN);
  });

  it.each(ALL_KEYS)("%s has no h1 in its body and no sub-heading before the first heading", (key) => {
    const html = htmlOf(key);
    expect(html).not.toMatch(/<h1/);
    const firstH2 = html.indexOf("<h2");
    const firstH3 = html.indexOf("<h3");
    if (firstH3 !== -1) expect(firstH2).toBeGreaterThanOrEqual(0);
    if (firstH3 !== -1) expect(firstH2).toBeLessThan(firstH3);
  });
});

describe("placeholder constants", () => {
  it("are all recognisable TO BE ADDED tokens", () => {
    for (const token of [
      CONTACT_EMAIL_PLACEHOLDER,
      COMPANY_NAME_PLACEHOLDER,
      REFUND_POLICY_PLACEHOLDER,
      GOVERNING_LAW_PLACEHOLDER,
      MINIMUM_AGE_PLACEHOLDER,
    ]) {
      expect(token).toMatch(PLACEHOLDER_TOKEN);
    }
  });

  it("are the exact text the owner asked for", () => {
    expect(CONTACT_EMAIL_PLACEHOLDER).toBe("[CONTACT EMAIL TO BE ADDED]");
    expect(COMPANY_NAME_PLACEHOLDER).toBe("[COMPANY / LEGAL NAME TO BE ADDED]");
    expect(REFUND_POLICY_PLACEHOLDER).toBe("[REFUND POLICY TO BE ADDED]");
    expect(GOVERNING_LAW_PLACEHOLDER).toBe("[GOVERNING LAW TO BE ADDED]");
  });

  it("each appear on the pages that need them", () => {
    for (const key of ["privacy-policy", "terms-of-service"]) {
      expect(textOf(key)).toContain(CONTACT_EMAIL_PLACEHOLDER);
      expect(textOf(key)).toContain(COMPANY_NAME_PLACEHOLDER);
    }
    expect(textOf("terms-of-service")).toContain(REFUND_POLICY_PLACEHOLDER);
    expect(textOf("terms-of-service")).toContain(GOVERNING_LAW_PLACEHOLDER);
    expect(textOf("terms-of-service")).toContain(MINIMUM_AGE_PLACEHOLDER);
    expect(textOf("help-center")).toContain(CONTACT_EMAIL_PLACEHOLDER);
  });
});

describe("last updated", () => {
  it("is 11 November 2026 on the privacy policy and the terms", () => {
    expect(LEGAL_LAST_UPDATED).toBe("11 November 2026");
    expect(SITE_DOCS["privacy-policy"].lastUpdated).toBe(LEGAL_LAST_UPDATED);
    expect(SITE_DOCS["terms-of-service"].lastUpdated).toBe(LEGAL_LAST_UPDATED);
  });
});

describe("privacy policy", () => {
  const text = textOf("privacy-policy");

  it("lists every company that helps us run Dusk, each with a purpose", () => {
    const helpers = text.slice(text.indexOf("Who helps us run Dusk"), text.indexOf("How long we keep your information"));
    for (const name of ["Neon", "Vercel", "Lemon Squeezy", "Resend", "Twilio", "Sentry", "Cloudflare"]) {
      expect(helpers, name).toContain(name);
    }
    expect(helpers).toMatch(/Dusk never sees your card number/);
    expect(helpers).toMatch(/seller of record/);
    expect(helpers).toMatch(/only when a phone number is on file/i);
    expect(helpers).toMatch(/carries no personal data/);
  });

  it("states the retention schedule, with the same 12 months the purge uses", () => {
    expect(RETENTION_MONTHS).toBe(12);
    const section = text.slice(text.indexOf("How long we keep your information"), text.indexOf("How to delete your data"));
    expect(section).toMatch(/while your account is active/i);
    expect(section).toMatch(/Security, activity and message records/);
    expect(section).toMatch(/once they are 12 months old/);
    expect(section).toMatch(/12 months after the release/);
    expect(section).toMatch(/tax law/i);
    expect(section).toMatch(/backups age out within 30 days/i);
    expect(section).toMatch(/within 30 days of your request/);
  });

  it("says what happens at once when you delete, and what ages out of backups", () => {
    const section = text.slice(text.indexOf("How long we keep your information"), text.indexOf("How to delete your data"));
    expect(section).toMatch(/When you delete your account Deleted straight away from our live systems/);
    expect(section).toMatch(/Copies in our database backups are removed as the backups age out, within 30 days/);
    expect(section).toMatch(/We don't restore a deleted account from a backup/);
  });

  it("is honest about the payment record that stays after deletion", () => {
    expect(text).toMatch(/After you delete your account, we keep one payment record/);
    expect(text).toMatch(/never your card/);
    expect(text).toMatch(/no longer connects to any account/);
  });

  it("explains deletion: in Settings with an emailed code, or by email when you can't sign in, 7 and 30 days, no unlocking needed", () => {
    const section = text.slice(text.indexOf("How to delete your data"), text.indexOf("Your other choices"));
    expect(section).toMatch(/open Settings, and choose Delete account/);
    expect(section).toMatch(/emails a 6-digit code/);
    expect(section).toMatch(/type your email to confirm/);
    expect(section).toMatch(/The deletion happens straight away/);
    expect(section).toMatch(/signed out on every device/);
    expect(section).toMatch(/If you can't sign in/);
    expect(section).toContain(CONTACT_EMAIL_PLACEHOLDER);
    expect(section).toMatch(/from the email address on your account/);
    expect(section).toMatch(/within 7 days/);
    expect(section).toMatch(/within 30 days/);
    expect(section).toMatch(/don't need to unlock it first/);
    expect(section).toMatch(/destroyed/);
    expect(section).toMatch(/people who have not opened theirs yet lose access/);
  });

  it("links the deletion section by anchor", () => {
    expect(htmlOf("privacy-policy")).toContain('id="delete-your-data"');
    expect(htmlOf("help-center")).toContain('href="/privacy#delete-your-data"');
  });
});

describe("terms of service", () => {
  const text = textOf("terms-of-service");

  it("says Dusk is not a legal will, matching the wording used elsewhere in the product", () => {
    expect(LEGAL_SCOPE_AND_ESTATE_DISCLAIMER.notALegalWillHeadline).toMatch(/NOT a legal will/);
    expect(text).toMatch(/not a legal will/i);
    expect(text).toMatch(/does not transfer ownership/i);
  });

  it("explains that Lifetime means the life of the service, not the owner's life", () => {
    expect(text).toMatch(/for as long as the service\s+exists/i);
    expect(text).toMatch(/not your lifetime/i);
    expect(text).toMatch(/Lemon Squeezy/);
    expect(htmlOf("terms-of-service")).toContain('id="lifetime-purchase"');
  });

  it("says you can delete your account yourself, and what that does to a release", () => {
    expect(text).toMatch(/You can delete your account yourself at any time: sign in, open Settings, and choose Delete account/);
    expect(text).toMatch(/If you can't sign in, you can ask us by email/);
    expect(text).toMatch(/deleting your account stops it/);
  });

  it("covers lost keys, acceptable use, release limits, changes and governing law", () => {
    expect(text).toMatch(/can't recover a lost\s+master passphrase or a lost recovery code/i);
    expect(text).toMatch(/What you may not do/);
    expect(text).toMatch(/How a release works, and its limits/);
    expect(text).toMatch(/can't check whether you are alive/i);
    expect(text).toMatch(/Changes to these terms/);
    expect(text).toMatch(/Which law applies/);
  });
});

describe("help center", () => {
  const text = textOf("help-center");

  it("does not promise reminders by SMS to the account owner", () => {
    expect(text).not.toMatch(/email or SMS/i);
    expect(text).toMatch(/Your own reminders come by email only/);
    expect(text).toMatch(/only to a person\s+you added with a phone number/i);
  });

  it("explains password reset and change in the words other pages will use", () => {
    expect(text).toMatch(/Use Forgot password on the sign-in page, or Change password in Settings\. Either one emails you a code/);
  });

  it("explains self-serve deletion and keeps the email route for people who cannot sign in", () => {
    expect(text).toMatch(/How do I delete my account\?/);
    expect(text).toMatch(/open Settings, and use the Delete account section/);
    expect(text).toMatch(/deleted straight away/);
    expect(text).toMatch(/If you can't sign in, email us at \[CONTACT EMAIL TO BE ADDED\]/);
    expect(text).not.toMatch(/no delete button/i);
  });

  it("covers a code that does not arrive, and invitations", () => {
    expect(text).toMatch(/What if the email code does not arrive\?/);
    expect(text).toMatch(/spam or junk/i);
    expect(text).toMatch(/resend/i);
    expect(text).toMatch(/People only take part after they accept your\s+invitation/);
  });
});
