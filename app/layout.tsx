import type { Metadata } from "next";
import { headers } from "next/headers";
import { Inter } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import { ActiveScrollManager } from "@/components/active-scroll-manager";
import { CSP_NONCE_HEADER } from "@/lib/security/csp";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Dusk | Digital estate vault",
  description: "Dusk is an encrypted vault for your passwords, documents and final wishes, with a careful, step-by-step release process for the people you choose.",
  icons: {
    icon: "/icon.svg",
    shortcut: "/icon.svg",
    apple: "/icon.svg",
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Reading the per-request nonce set by proxy.ts also makes every page render on demand, which
  // is what lets Next.js stamp the nonce on its scripts (a prebuilt page has no request).
  const nonce = (await headers()).get(CSP_NONCE_HEADER) ?? undefined;

  return (
    <html
      lang="en"
      className={`${inter.className} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <ThemeProvider
          attribute={["class", "data-theme"]}
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
          nonce={nonce}
        >
          <ActiveScrollManager />
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}

