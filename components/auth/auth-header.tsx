// components/auth/auth-header.tsx
// The page title and one plain sentence under it, centred above the form.
import type { Ref } from "react";

export function AuthHeader({
  title,
  intro,
  headingRef,
}: {
  title: string;
  intro: string;
  /** Pass a ref when the page moves focus to the title after a step change. */
  headingRef?: Ref<HTMLHeadingElement>;
}) {
  return (
    <div className="mb-8 text-center">
      <h1
        ref={headingRef}
        tabIndex={headingRef ? -1 : undefined}
        className="mb-2 text-2xl font-bold tracking-tight text-foreground outline-none"
      >
        {title}
      </h1>
      <p className="text-pretty text-sm text-foreground-secondary">{intro}</p>
    </div>
  );
}
