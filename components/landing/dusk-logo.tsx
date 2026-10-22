import React from "react";
import Link from "next/link";

interface DuskSymbolProps extends React.SVGProps<SVGSVGElement> {
  size?: number;
  className?: string;
}

export function DuskSymbol({
  size = 24,
  className = "text-foreground ",
  ...props
}: DuskSymbolProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
      {...props}
    >
      {/* Left Architectural Pillar */}
      <rect x="10" y="10" width="10" height="44" rx="2.5" fill="currentColor" />
      {/* Outer Eclipse 'D' Crescent */}
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M26 10H32C44.1503 10 54 19.8497 54 32C54 44.1503 44.1503 54 32 54H26V44.5H31.5C38.9558 44.5 45 38.4558 45 31C45 23.5442 38.9558 17.5 31.5 17.5H26V10Z"
        fill="currentColor"
      />
      {/* Inner Dusk Horizon Core (#00FFA3) */}
      <circle cx="31" cy="32" r="7.5" fill="var(--brand)" />
    </svg>
  );
}

export function DuskLogo({
  href = "/",
  size = 24,
  showTagline = false,
  className = "",
}: {
  href?: string;
  size?: number;
  showTagline?: boolean;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={`inline-flex items-center gap-2.5 group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand rounded-md transition-opacity hover:opacity-90 ${className}`}
      aria-label="Dusk - Home"
    >
      <div className="flex items-center justify-center shrink-0">
        <DuskSymbol size={size} className="text-foreground" />
      </div>
      <div className="flex flex-col">
        <span className="font-semibold text-lg tracking-tight text-foreground leading-none">
          Dusk
        </span>
        {showTagline && (
          <span className="text-[11px] text-foreground-secondary font-mono tracking-tight mt-1">
            Digital estate vault
          </span>
        )}
      </div>
    </Link>
  );
}
