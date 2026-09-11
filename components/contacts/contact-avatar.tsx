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

/**
 * Обводка для перекрывающихся аватаров в стеке. Задаём цвет напрямую через
 * `--tw-ring-color`: обводка должна совпадать с фоном того контейнера, в котором
 * лежит стек, иначе перекрытие выглядит грязно.
 */
const RINGS = {
  none: "",
  card: "[--tw-ring-color:var(--color-bg-card)]",
  white: "[--tw-ring-color:var(--color-bg-white)]",
  plain: "[--tw-ring-color:var(--color-bg)]",
} as const;

interface ContactAvatarProps {
  name: string;
  avatarUrl?: string | null;
  size?: ContactAvatarSize;
  /** Обводка для перекрывающихся аватаров в стеке. */
  ring?: keyof typeof RINGS;
  className?: string;
}

/**
 * Круглый аватар контакта с монограммой-фолбэком.
 * Общий для независимых специалистов, строки контактов в карточке и панели контактов.
 */
export function ContactAvatar({
  name,
  avatarUrl,
  size = "sm",
  ring = "none",
  className,
}: ContactAvatarProps) {
  const sizeClass = cn(
    SIZES[size],
    ring !== "none" && "ring-2",
    RINGS[ring],
    className,
  );

  if (avatarUrl) {
    return (
      <Avatar size="sm" className={cn("shrink-0", sizeClass)}>
        <AvatarImage src={avatarUrl} alt="" className="object-cover" />
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

interface ContactAvatarStackProps {
  contacts: { id: string; name: string; avatar_url?: string | null }[];
  size?: ContactAvatarSize;
  ring?: keyof typeof RINGS;
  /** Сколько аватаров показать до сворачивания в «+N». */
  max?: number;
  className?: string;
}

/**
 * Перекрывающиеся аватары контактов: 1 контакт — один аватар,
 * несколько — стек до `max` штук и бейдж «+N».
 */
export function ContactAvatarStack({
  contacts,
  size = "2xs",
  ring = "card",
  max = 3,
  className,
}: ContactAvatarStackProps) {
  if (contacts.length === 0) return null;

  const shown = contacts.slice(0, max);
  const rest = contacts.length - shown.length;

  return (
    <div className={cn("flex -space-x-1.5", className)}>
      {shown.map((contact) => (
        <ContactAvatar
          key={contact.id}
          name={contact.name}
          avatarUrl={contact.avatar_url}
          size={size}
          ring={ring}
        />
      ))}
      {rest > 0 && (
        <span
          className={cn(
            "flex items-center justify-center rounded-full bg-bg-brand2 font-medium text-fg-muted",
            ring !== "none" && "ring-2",
            RINGS[ring],
            SIZES[size],
          )}
        >
          +{rest}
        </span>
      )}
    </div>
  );
}
