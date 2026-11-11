import React from "react";

export interface SiteDoc {
  category: string;
  title: string;
  /** Shown under the title on legal pages, for example "11 November 2026". */
  lastUpdated?: string;
  body: React.ReactNode;
}

/**
 * Gaps the owner still has to fill in. Each one is a visible `[... TO BE ADDED]` token so nothing
 * is forgotten, and `lib/site-docs.test.ts` fails if any other bracketed token slips in.
 */
export const CONTACT_EMAIL_PLACEHOLDER = "[CONTACT EMAIL TO BE ADDED]";
export const COMPANY_NAME_PLACEHOLDER = "[COMPANY / LEGAL NAME TO BE ADDED]";
export const REFUND_POLICY_PLACEHOLDER = "[REFUND POLICY TO BE ADDED]";
export const GOVERNING_LAW_PLACEHOLDER = "[GOVERNING LAW TO BE ADDED]";
export const MINIMUM_AGE_PLACEHOLDER = "[MINIMUM AGE TO BE ADDED]";

/** Date shown on the privacy policy and terms. Change it whenever either text changes. */
export const LEGAL_LAST_UPDATED = "11 November 2026";

// Same heading style for every document page, so the structure is easy to scan.
function H({ children, id }: { children: React.ReactNode; id?: string }) {
  return (
    <h2 id={id} className="text-lg font-semibold text-foreground pt-4 scroll-mt-24">
      {children}
    </h2>
  );
}

// Question or sub-heading under an H.
function H3({ children }: { children: React.ReactNode }) {
  return <h3 className="text-[16px] font-semibold text-foreground pt-2">{children}</h3>;
}

function UL({ children }: { children: React.ReactNode }) {
  return <ul className="list-disc pl-5 space-y-2 marker:text-foreground-muted">{children}</ul>;
}

// A label with a short explanation under it, used for the helper list and the retention schedule.
function DefList({ items }: { items: ReadonlyArray<{ term: string; text: React.ReactNode }> }) {
  return (
    <dl className="divide-y divide-border border-y border-border">
      {items.map((item) => (
        <div key={item.term} className="py-3 sm:grid sm:grid-cols-[10rem_1fr] sm:gap-6">
          <dt className="font-medium text-foreground">{item.term}</dt>
          <dd className="mt-1 sm:mt-0">{item.text}</dd>
        </div>
      ))}
    </dl>
  );
}

function Placeholder({ children }: { children: string }) {
  return (
    <span className="rounded-[4px] border border-border bg-hover px-1 py-0.5 font-medium text-foreground break-words">
      {children}
    </span>
  );
}

function A({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      className="text-accent-text underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand rounded-sm"
    >
      {children}
    </a>
  );
}

const CONTACT_EMAIL = <Placeholder>{CONTACT_EMAIL_PLACEHOLDER}</Placeholder>;
const COMPANY_NAME = <Placeholder>{COMPANY_NAME_PLACEHOLDER}</Placeholder>;

export const SITE_DOCS: Record<string, SiteDoc> = {
  "help-center": {
    category: "Support",
    title: "Dusk help center",
    body: (
      <div className="space-y-4">
        <H>Check-ins and reminders</H>
        <H3>How do check-ins work?</H3>
        <p>
          You choose how often to check in, for example every 30, 90 or 180 days. Before each check-in is due, Dusk
          emails you a reminder at the email address on your account. The email has a link, and opening it is your
          check-in. When you check in, the timer starts again.
        </p>
        <H3>What happens if I miss a check-in?</H3>
        <p>
          Nothing is sent right away. You get a grace period and more reminders first. If you still don&apos;t check in,
          Dusk asks your trusted verifiers to confirm. Your items are only released after those steps are finished.
          You can stop the process at any time before release by checking in.
        </p>
        <H3>Does Dusk send text messages?</H3>
        <p>
          Your own reminders come by email only. Dusk can send a short text message as a back-up, but only to a person
          you added with a phone number, and only when an email to that person could not be delivered. A text message
          never contains vault information or a private link.
        </p>
        <H3>Can I pause my plan?</H3>
        <p>
          Yes. On the Check-in plan page you can pause reminders and the release process for 30 days, for example while
          you travel. Pausing doesn&apos;t give anyone access to your vault. Checking in again resumes your plan.
        </p>

        <H>Your vault and recovery</H>
        <H3>What is my master passphrase?</H3>
        <p>
          It is the passphrase that locks your vault. It is different from your account password. It never leaves your
          device, so Dusk can&apos;t see it or reset it.
        </p>
        <H3>What if I forget my passphrase?</H3>
        <p>
          Use the recovery code from your recovery kit. Open the Digital vault page and choose to use your recovery
          code. If you have lost both your passphrase and your recovery code, nobody, including Dusk, can open your
          vault.
        </p>

        <H>Your account and password</H>
        <H3>How do I reset or change my password?</H3>
        <p>
          Use Forgot password on the sign-in page, or Change password in Settings. Either one emails you a code. Enter
          the code to choose a new password. This changes your account password only. It does not change your master
          passphrase, and it cannot open your vault.
        </p>
        <H3>What if the email code does not arrive?</H3>
        <UL>
          <li>Wait a few minutes. Email can be slow.</li>
          <li>Check your spam or junk folder, and any other inbox tabs.</li>
          <li>Check that you used the same email address you signed up with.</li>
          <li>Ask for the code again with the resend option on the same page.</li>
        </UL>
        <p>
          If it still doesn&apos;t arrive, contact us at {CONTACT_EMAIL} from the email address on your account.
        </p>
        <H3>How do I delete my account?</H3>
        <p>
          There is no delete button in the app yet. Email us at {CONTACT_EMAIL} from your account email and we will
          confirm within 7 days and finish within 30 days. Deleting your account also stops your plan, so nothing is
          sent to the people you chose. <A href="/privacy#delete-your-data">Read how deletion works</A>.
        </p>

        <H>People you choose</H>
        <H3>What is the difference between a trusted verifier and a beneficiary?</H3>
        <p>
          A trusted verifier confirms whether you are okay, or whether a release is real. A beneficiary receives the
          items you choose for them. They are separate roles. One person can have both, but they don&apos;t have to.
        </p>
        <H3>How do invitations to people work?</H3>
        <p>
          When you add someone, Dusk emails them an invitation. People only take part after they accept your
          invitation. Until they accept, they are not asked to confirm anything and they don&apos;t receive anything.
        </p>
        <H3>How do my beneficiaries get what I gave them?</H3>
        <p>
          When you add a beneficiary, Dusk gives you a private unlock link to send to them yourself. Dusk
          doesn&apos;t keep a copy, so keep track of who has one. After a release is confirmed, Dusk emails them, and
          they use the link you gave them to open only the items you assigned to them.
        </p>

        <H>Cost and the law</H>
        <H3>What does Lifetime mean?</H3>
        <p>
          You pay once and don&apos;t pay again. Lifetime means for as long as Dusk is offered, not for the length of
          your life. <A href="/terms#lifetime-purchase">Read the details in the terms</A>.
        </p>
        <H3>Is Dusk a will?</H3>
        <p>
          No. Dusk delivers access and instructions. It doesn&apos;t transfer legal ownership of anything. Talk to a
          lawyer who handles wills and estates about a will or trust. Dusk works alongside it.
        </p>
        <H3>How do I contact you?</H3>
        <p>Email {CONTACT_EMAIL}. To report a security problem, use the security disclosure page instead.</p>
      </div>
    ),
  },
  "privacy-policy": {
    category: "Legal",
    title: "Privacy policy",
    lastUpdated: LEGAL_LAST_UPDATED,
    body: (
      <div className="space-y-4">
        <p>
          Dusk is built so that we can&apos;t read what you store. This page explains what we do keep, who helps us
          run Dusk, how long we keep your information, and how to ask us to delete it.
        </p>
        <p>
          Dusk is run by {COMPANY_NAME}. In this policy, &quot;we&quot; means that company. You can reach us at{" "}
          {CONTACT_EMAIL}.
        </p>

        <H>What we can&apos;t see</H>
        <p>
          The title and contents of every vault item, and your folder names, are encrypted on your device before they
          are uploaded. Your master passphrase and your recovery code never leave your device. Dusk staff, the
          companies that help us, and our own systems can&apos;t read your vault. Because we can&apos;t read it, we
          can&apos;t hand it over in readable form if someone asks us to.
        </p>

        <H>What we keep, and why</H>
        <UL>
          <li>
            <strong className="text-foreground">Your account.</strong>{" "}Your email address and the name you gave. We use
            them to sign you in and to contact you. Sign-in is run by our sign-in service, and we don&apos;t store your
            password ourselves.
          </li>
          <li>
            <strong className="text-foreground">Your vault, in encrypted form.</strong>{" "}The encrypted items, folder
            names and the encrypted keys that protect them. We can also see that an item exists, its type (such as
            account login or note), when it was added or changed, and which of your people it is assigned to.
          </li>
          <li>
            <strong className="text-foreground">The people you add.</strong>{" "}Each person&apos;s name, email address,
            role (beneficiary, trusted verifier or both), status, and a phone number if you give one. We use them to
            contact those people as part of your plan.
          </li>
          <li>
            <strong className="text-foreground">Your check-in plan.</strong>{" "}How often you check in, your grace period,
            your last check-in, and a history of how the plan has moved through its steps.
          </li>
          <li>
            <strong className="text-foreground">Security and activity records.</strong>{" "}Events such as signing in,
            failed sign-ins, check-ins, and changes to your plan, people or recovery kit. Each record has a time, a
            short description of the device, and a scrambled form of your IP address rather than the address itself. We
            use them to keep accounts safe and to show you what happened.
          </li>
          <li>
            <strong className="text-foreground">Message records.</strong>{" "}For each reminder or notice we send: the
            address it went to, what kind of message it was, when, and whether it was delivered. The message records do
            not contain vault information.
          </li>
          <li>
            <strong className="text-foreground">Payment status.</strong>{" "}Whether you have paid, when, and a reference
            that links your account to your payment. We never see your card number.
          </li>
          <li>
            <strong className="text-foreground">Error reports.</strong>{" "}When something breaks, we receive a technical
            report. Vault data, email addresses and private link codes are removed from it before it leaves our
            servers or your browser.
          </li>
        </UL>

        <H>Cookies and tracking</H>
        <p>
          Dusk uses a cookie to keep you signed in, and your browser remembers your light or dark choice. We
          don&apos;t use advertising or marketing trackers, and we don&apos;t record your screen.
        </p>

        <H>Messages we send</H>
        <p>
          Emails from Dusk can contain a private link, for example to check in or to open a delivery. Text messages are
          short and never contain a private link or vault information. Your own reminders are sent by email. A text
          message is only used as a back-up for a person you added with a phone number, when an email to them could not
          be delivered.
        </p>

        <H id="who-helps-us">Who helps us run Dusk</H>
        <p>
          We use these companies to run Dusk. Each one gets only what it needs for its job, and none of them can read
          your vault.
        </p>
        <DefList
          items={[
            {
              term: "Neon",
              text: "Database and sign-in. Stores your account, your encrypted vault and your records, and runs sign-in and your list of signed-in devices.",
            },
            {
              term: "Vercel",
              text: "Hosting. Runs the Dusk website and app, and may keep standard server logs.",
            },
            {
              term: "Lemon Squeezy",
              text: "Payments. Lemon Squeezy is the seller of record for your purchase, so it handles your card details and sales tax. Dusk never sees your card number.",
            },
            {
              term: "Resend",
              text: "Emails. Sends our emails, so it receives the recipient's email address and the message, which has no vault information.",
            },
            {
              term: "Twilio",
              text: "Text messages. Used only when a phone number is on file, and today that means a number you add for one of your people. It receives that number and a short message.",
            },
            {
              term: "Sentry",
              text: "Error reports. Receives technical reports about faults, with vault data, email addresses and link codes removed first.",
            },
            {
              term: "Trigger.dev",
              text: "Scheduling. Runs the regular check that decides when reminders are due. It carries no personal data.",
            },
          ]}
        />
        <p>
          Some of these companies work in other countries, so your information may be handled outside the country where
          you live.
        </p>

        <H id="how-long-we-keep-it">How long we keep your information</H>
        <DefList
          items={[
            {
              term: "Account and vault",
              text: "Kept while your account is active. This covers your account details, your encrypted vault, your people and your check-in plan.",
            },
            {
              term: "After you ask us to delete",
              text: "Your account, encrypted vault items and people are deleted within 30 days of your request.",
            },
            {
              term: "Security and activity records",
              text: "Kept for up to 12 months, then deleted.",
            },
            {
              term: "Payment records",
              text: "Kept by Lemon Squeezy for as long as tax law requires. We keep only your payment status and reference while your account exists.",
            },
            {
              term: "Backups",
              text: "Database backups age out within 30 days. Our database host keeps a short-lived recovery history, so deleted data can remain in backups until then.",
            },
            {
              term: "Released plans",
              text: "If your plan has been released, we keep the delivery records (what was sent, to whom and when) for 12 months after the release, so we can show it was delivered.",
            },
          ]}
        />

        <H id="delete-your-data">How to delete your data</H>
        <p>
          There is no delete button in the app yet. To delete your data, email {CONTACT_EMAIL} from the email address on
          your account and ask us to delete your account. We use that address to check the request is yours.
        </p>
        <UL>
          <li>We confirm your request within 7 days.</li>
          <li>We finish the deletion within 30 days of your request.</li>
        </UL>
        <p>
          Deleting your account removes your account, your encrypted vault items and folders, your recovery data, your
          people and your check-in plan. Your vault is encrypted and we can&apos;t read it, so you don&apos;t need to
          unlock it first. The encrypted data is destroyed, and neither you nor we can get it back afterwards. We only
          keep what the schedule above says we keep.
        </p>
        <p>
          Deleting your account also ends your check-in plan. Nothing will be released or sent to the people you chose.
          If you want them to have something, give it to them another way first.
        </p>

        <H>Your other choices</H>
        <p>
          You can ask us for a copy of the personal information we hold about you, ask us to correct it, or ask us to
          stop using it. Email {CONTACT_EMAIL} from your account email. We reply within 30 days. You also have the right
          to complain to your local data protection authority.
        </p>

        <H>Changes to this policy</H>
        <p>
          When we change this policy, we update the date at the top. If a change is important, we email you before it
          takes effect.
        </p>

        <H>Who to contact</H>
        <p>
          {COMPANY_NAME}
          <br />
          {CONTACT_EMAIL}
        </p>
      </div>
    ),
  },
  "terms-of-service": {
    category: "Legal",
    title: "Terms of service",
    lastUpdated: LEGAL_LAST_UPDATED,
    body: (
      <div className="space-y-4">
        <p>
          These terms are an agreement between you and {COMPANY_NAME}, the company that runs Dusk. By creating an
          account or buying Dusk, you agree to them. If you don&apos;t agree, please don&apos;t use Dusk.
        </p>

        <H>What Dusk does</H>
        <p>
          Dusk keeps your instructions and login details in an encrypted vault and delivers them to the people you
          choose, using a check-in plan that you set up. Dusk does not give legal, probate, estate-planning or financial
          advice.
        </p>

        <H>Dusk is not a legal will</H>
        <p>
          Dusk is an encrypted vault and delivery system. It is not a legal will, a trust, or a substitute for
          estate planning that meets the law where you live.
        </p>
        <p>
          Dusk does not transfer ownership of property, real estate, bank accounts or other assets. Giving someone
          access to an account or instructions does not give them legal title. That is decided by the laws where you
          live and by a valid will. Please talk to a qualified estate-planning lawyer.
        </p>

        <H>Who can use Dusk</H>
        <p>
          You must be at least <Placeholder>{MINIMUM_AGE_PLACEHOLDER}</Placeholder> years old. You must give accurate
          information when you sign up, and keep your email address up to date, because your reminders go there.
        </p>

        <H id="your-responsibilities">Your account and your vault</H>
        <p>You are responsible for:</p>
        <UL>
          <li>keeping your account password, master passphrase and recovery kit safe, and not sharing them;</li>
          <li>keeping the details of your people up to date, and giving each beneficiary the unlock link;</li>
          <li>deciding who receives what, and what you store;</li>
          <li>checking in, or pausing your plan, when you need to.</li>
        </UL>
        <p>
          Your vault is encrypted on your device and Dusk can&apos;t read it. That means we can&apos;t recover a lost
          master passphrase or a lost recovery code. If you lose both, nobody, including us, can open your vault, and
          what is in it is lost.
        </p>

        <H id="lifetime-purchase">Dusk Lifetime</H>
        <p>
          Dusk Lifetime is a single payment, at the price shown at checkout. You don&apos;t pay a subscription. It gives
          you the core Dusk features, as described on the pricing section of our home page, for as long as the service
          exists.
        </p>
        <p>
          Lifetime means the life of the Dusk service, not your lifetime. It doesn&apos;t pass to anyone else. If we
          decide to close Dusk, we will tell you by email in good time so you can take out what you need.
        </p>
        <p>
          Payments are handled by Lemon Squeezy, which sells Dusk to you as the seller of record. Its terms apply to
          the purchase, and it handles your card details and sales tax. Refunds follow Lemon Squeezy&apos;s refund
          policy, together with ours: <Placeholder>{REFUND_POLICY_PLACEHOLDER}</Placeholder>.
        </p>

        <H>How a release works, and its limits</H>
        <p>
          Dusk follows the steps you set. It reminds you, waits through your grace period, asks your trusted
          verifiers to confirm, and only then lets your beneficiaries open what you gave them. Please know the limits:
        </p>
        <UL>
          <li>
            Dusk can&apos;t check whether you are alive or have died. It only follows your plan and the answers of the
            people you chose.
          </li>
          <li>
            Emails and text messages can be delayed, blocked or filtered as spam. We use outside companies to send
            them and can&apos;t promise delivery.
          </li>
          <li>
            A release can be late or may not happen if reminders go unseen, your people don&apos;t respond, or the
            service is down.
          </li>
          <li>
            A beneficiary can only open what you assigned to them, and needs the unlock link you gave them. We can&apos;t
            open or deliver anything on your behalf in any other way.
          </li>
        </UL>

        <H>What you may not do</H>
        <UL>
          <li>Use Dusk for anything illegal, or to store material you have no right to hold.</li>
          <li>Try to get into another person&apos;s account or vault.</li>
          <li>Attack, overload or probe Dusk, or run automated tools against it without our written permission.</li>
          <li>Use Dusk to harass, mislead or pretend to be someone else.</li>
        </UL>
        <p>
          We can&apos;t see inside your vault, so we rely on you to follow these rules. If you seriously break them, we
          may suspend or close your account, and we will email you first where we can.
        </p>

        <H>Our responsibility</H>
        <p>
          We work hard to keep Dusk running and secure, but we can&apos;t promise it will never be down or have faults.
          As far as the law allows, we are not responsible for losses caused by a lost passphrase or recovery code, by
          messages that did not arrive, by something you stored or assigned, or by services outside our control.
          Nothing in these terms limits rights that the law says cannot be limited.
        </p>

        <H>Ending your account</H>
        <p>
          You can ask us to delete your account at any time. See{" "}
          <A href="/privacy#delete-your-data">how to delete your data</A>. Deleting your account ends your plan and
          your Lifetime purchase, and we can&apos;t restore either.
        </p>

        <H>Changes to these terms</H>
        <p>
          We may update these terms. When we do, we change the date at the top. If a change is important, we email you
          before it takes effect. If you keep using Dusk after that, you accept the new terms. If you don&apos;t agree,
          you can ask us to delete your account.
        </p>

        <H>Which law applies</H>
        <p>
          These terms are governed by the law of <Placeholder>{GOVERNING_LAW_PLACEHOLDER}</Placeholder>.
        </p>

        <H>Contact</H>
        <p>
          {COMPANY_NAME}
          <br />
          {CONTACT_EMAIL}
        </p>
      </div>
    ),
  },
  "security-disclosures": {
    category: "Security",
    title: "Report a security problem",
    body: (
      <div className="space-y-4">
        <p>
          If you have found a security problem in Dusk, we want to hear about it.
        </p>
        <H>How to report it</H>
        <p>
          Send encrypted reports to security@dusk.infrastructure. Include the steps to reproduce the problem, a proof
          of concept, and the environment you tested in.
        </p>
        <H>What to expect from us</H>
        <p>
          We acknowledge valid reports within 24 business hours. Problems that affect your encryption or who can
          access what are fixed first.
        </p>
      </div>
    ),
  },
};
