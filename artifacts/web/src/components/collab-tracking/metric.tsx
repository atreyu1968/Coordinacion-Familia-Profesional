import { cn } from "@/lib/utils";

export function Ratio({ label, value, of, hint, testId }: { label: string; value: number; of?: number; hint?: string; testId?: string }) {
  const pct = of && of > 0 ? Math.min(100, (value / of) * 100) : null;
  return (
    <div className="space-y-1" data-testid={testId}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</span>
        <span className="font-mono text-sm tabular-nums">
          {value}
          {of != null && <span className="text-muted-foreground">/{of}</span>}
        </span>
      </div>
      {pct != null && (
        <div className="h-1 rounded-full bg-muted overflow-hidden">
          <div className="h-full bg-primary/70 origin-left" style={{ transform: `scaleX(${pct / 100})` }} />
        </div>
      )}
      {hint && <p className="text-[11px] text-muted-foreground leading-snug">{hint}</p>}
    </div>
  );
}

export function Pill({ tone, children }: { tone: "ok" | "warn" | "muted" | "info"; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
        tone === "ok" && "border-emerald-600/30 bg-emerald-600/10 text-emerald-800 dark:text-emerald-300",
        tone === "warn" && "border-amber-600/30 bg-amber-500/10 text-amber-800 dark:text-amber-300",
        tone === "info" && "border-primary/30 bg-primary/10 text-primary",
        tone === "muted" && "border-border bg-muted text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}
