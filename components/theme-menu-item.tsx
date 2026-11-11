"use client";

import * as React from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

import { cn } from "@/lib/utils";

/**
 * The one place a person chooses light, dark or the device setting. It lives inside menus
 * (dashboard sidebar and drawer, home page mobile menu) and in page footers, never as a lone
 * icon in a top bar. Options are real radio buttons, so Tab, arrow keys and Space work with no
 * extra code, and the focus ring is drawn on the visible label.
 */

const OPTIONS = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "system", label: "System", Icon: Monitor },
] as const;

type ThemeChoice = (typeof OPTIONS)[number]["value"];

function isThemeChoice(value: string | undefined): value is ThemeChoice {
  return OPTIONS.some((option) => option.value === value);
}

const subscribeToNothing = () => () => {};

/** False while the server renders and during hydration, true afterwards, so nothing mismatches. */
function useIsMounted(): boolean {
  return React.useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false
  );
}

interface ThemeMenuItemProps {
  /** "stacked" puts the label above the choices (menus). "inline" puts it beside them (footers). */
  layout?: "stacked" | "inline";
  /** Icons beside the words. Turn off where the control is narrow, such as the 248px sidebar. */
  showIcons?: boolean;
  className?: string;
}

export function ThemeMenuItem({ layout = "stacked", showIcons = true, className }: ThemeMenuItemProps) {
  const { theme, setTheme } = useTheme();
  const mounted = useIsMounted();
  const groupName = React.useId();
  const labelId = `${groupName}-label`;
  // Until the saved choice is known, show nothing as selected instead of guessing.
  const selected = mounted && isThemeChoice(theme) ? theme : undefined;

  return (
    <div
      data-testid="theme-menu-item"
      className={cn(
        layout === "inline"
          ? "flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4"
          : "flex flex-col gap-2",
        className
      )}
    >
      <span
        id={labelId}
        className="text-xs font-semibold uppercase tracking-[0.08em] text-foreground-secondary px-0.5 sm:px-0"
      >
        Appearance
      </span>
      <div
        role="radiogroup"
        aria-labelledby={labelId}
        className={cn(
          "grid grid-cols-3 gap-1 rounded-[10px] border border-border bg-canvas p-1",
          layout === "inline" && "sm:min-w-[15rem]"
        )}
      >
        {OPTIONS.map(({ value, label, Icon }) => (
          <label key={value} className="relative block min-w-0 cursor-pointer">
            <input
              type="radio"
              name={groupName}
              value={value}
              checked={selected === value}
              onChange={() => setTheme(value)}
              className="peer sr-only"
            />
            <span
              className={cn(
                "flex min-h-11 items-center justify-center gap-1.5 rounded-[7px] px-2 text-[13px] font-medium",
                "text-foreground-secondary transition-colors hover:bg-hover hover:text-foreground",
                "peer-checked:bg-accent-surface peer-checked:text-accent-text peer-checked:font-semibold",
                "peer-focus-visible:ring-2 peer-focus-visible:ring-brand",
                "md:pointer-fine:min-h-9"
              )}
            >
              {showIcons ? <Icon className="size-3.5 shrink-0" aria-hidden="true" /> : null}
              <span>{label}</span>
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}
