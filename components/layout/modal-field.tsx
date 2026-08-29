import { cn } from '@/lib/utils';
import React from 'react'
import { Label } from '../ui/label';

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <Label className="text-[11px] font-mono uppercase tracking-wider w-full text-fg-muted">
        {label}
      </Label>
      {children}
    </div>
  );
}

export default Field;