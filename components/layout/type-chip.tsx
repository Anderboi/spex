import { cn } from '@/lib/utils';

function TypeChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[12.5px] transition-colors",
        active
          ? "border-fg-brand bg-bg-brand font-semibold"
          : "border-border-muted text-fg-secondary",
      )}
    >
      {label}
      <span className="text-[11px] opacity-60">{count}</span>
    </button>
  );
}

export default TypeChip;