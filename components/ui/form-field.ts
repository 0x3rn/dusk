// Shared class names for plain form controls, so every form in the app looks and behaves the same.
// Focus colour comes from the global :focus-visible rule in app/globals.css.

export const fieldLabelClass = "block text-sm font-medium text-foreground mb-1.5";

export const fieldHintClass = "block text-[13px] text-foreground-secondary mt-1.5";

export const fieldInputClass =
  "w-full h-11 px-3.5 rounded-[8px] border border-input bg-background text-[15px] text-foreground " +
  "placeholder:text-foreground-muted transition-colors disabled:opacity-60 " +
  "aria-[invalid=true]:border-[var(--danger-fg)]";

export const fieldTextareaClass =
  "w-full p-3 rounded-[8px] border border-input bg-background text-[15px] text-foreground " +
  "placeholder:text-foreground-muted transition-colors resize-y " +
  "aria-[invalid=true]:border-[var(--danger-fg)]";

export const buttonPrimaryClass =
  "inline-flex items-center justify-center gap-2 h-11 px-5 rounded-[8px] bg-brand text-on-brand " +
  "text-[15px] font-semibold hover:bg-brand-hover transition-colors disabled:opacity-60 disabled:cursor-not-allowed";

export const buttonSecondaryClass =
  "inline-flex items-center justify-center gap-2 h-11 px-4 rounded-[8px] border border-border bg-elevated " +
  "text-foreground text-[15px] font-medium hover:bg-hover transition-colors disabled:opacity-60 disabled:cursor-not-allowed";

export const buttonDangerClass =
  "inline-flex items-center justify-center gap-2 h-11 px-4 rounded-[8px] bg-[var(--danger-fg)] " +
  "text-[var(--danger-bg)] text-[15px] font-semibold hover:opacity-90 transition-opacity disabled:opacity-60";
