// components/auth/auth-shell.tsx
// The frame around the sign-in, create-account and forgot-password pages.
//
// On a computer (1024px and wider) there is no card: the form sits centred on the page. On
// phones and tablets the form keeps its card, as it always had.
import { DuskLogo } from "@/components/landing/dusk-logo";

export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center overflow-x-clip bg-canvas px-4 py-8 transition-colors sm:p-6 lg:bg-background">
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>

      <header className="mb-6 sm:mb-8">
        <DuskLogo size={28} />
      </header>

      <main
        id="main-content"
        tabIndex={-1}
        className="w-full max-w-md rounded-2xl border border-border bg-card p-5 shadow-sm focus:outline-none sm:p-8 lg:rounded-none lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none"
      >
        {children}
      </main>
    </div>
  );
}
