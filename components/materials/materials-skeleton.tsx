export function MaterialsSkeleton() {
  return (
    <div className="animate-pulse pt-[clamp(28px,5vw,48px)]">
      <div className="flex justify-end gap-2">
        <div className="h-11 w-48 rounded-lg bg-muted" />
        <div className="h-11 w-44 rounded-lg bg-muted" />
      </div>
      <div className="mt-4 h-10 w-full rounded-lg bg-muted" />
      <div className="mt-4 flex gap-2">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="h-8 w-24 shrink-0 rounded-full bg-muted" />
        ))}
      </div>
      <div className="mt-4 h-11 w-64 border-b border-border" />
      <div className="mt-4 flex flex-col gap-4">
        {Array.from({ length: 3 }, (_, i) => (
          <div
            key={i}
            className="h-44 rounded-xl border border-border bg-card"
          />
        ))}
      </div>
    </div>
  );
}
