import { Fragment } from "react";

export interface Crumb {
  label: string;
  mono?: boolean;
  onClick?: () => void;
}

/** The bar across the top: where you are, and the way back. */
export function TopBar({ trail }: { trail: Crumb[] }) {
  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b border-border bg-background/90 px-6 backdrop-blur">
      <span
        className="flex size-6 items-center justify-center bg-primary font-display text-[10px] font-medium text-primary-foreground"
        aria-hidden="true"
      >
        A5
      </span>
      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-2">
        {trail.map((crumb, i) => (
          <Fragment key={crumb.label}>
            {i > 0 && <span className="text-muted-foreground/50">/</span>}
            {crumb.onClick ? (
              <button
                type="button"
                onClick={crumb.onClick}
                className="text-muted-foreground transition-colors hover:text-foreground"
              >
                {crumb.label}
              </button>
            ) : (
              <span className={crumb.mono ? "truncate font-mono text-xs" : "font-medium"} aria-current="page">
                {crumb.label}
              </span>
            )}
          </Fragment>
        ))}
      </nav>
    </header>
  );
}
