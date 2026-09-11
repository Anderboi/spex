"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { initials, cn } from "@/lib/utils";

/** Размеры аватара контакта. */
const SIZES = {
  "2xs": "size-6 text-[9px]",
  xs: "size-7 text-[10px]",
  sm: "size-9 text-xs",
  md: "size-11 text-sm",
} as const;

export type ContactAvatarSize = keyof typeof SIZES;

interface ContactAvatarProps {
  name: string;
  avatarUrl?: string | null;
  size?: ContactAvatarSize;
  className?: string;
}

/**
 * Круглый аватар контакта с монограммой-фолбэком.
 * Общий для независимых специалистов, менеджеров компаний и «рельсы» контактов.
 */
export function ContactAvatar({
  name,
  avatarUrl,
  size = "sm",
  className,
}: ContactAvatarProps) {
  const sizeClass = cn(SIZES[size], className);

  if (avatarUrl) {
    return (
      <Avatar size="sm" className={cn("shrink-0", sizeClass)}>
        <AvatarImage src={avatarUrl} alt={name} className="object-cover" />
        <AvatarFallback className="bg-bg-brand2 text-fg-body">
          {initials(name)}
        </AvatarFallback>
      </Avatar>
    );
  }

  return (
    <div
      aria-hidden
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full bg-bg-brand2 font-medium text-fg-body",
        sizeClass,
      )}
    >
      {initials(name)}
    </div>
  );
}
