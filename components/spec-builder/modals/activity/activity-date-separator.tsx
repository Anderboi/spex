"use client";

import { Marker, MarkerContent } from "@/components/ui/marker";

/**
 * Разделитель дней в ленте: «Сегодня», «Вчера», «25 сентября».
 *
 * Отдельный компонент, а не часть карточки записи: разделитель принадлежит
 * ленте, а не записи, и его появление целиком решает `buildActivityFeed`.
 */
export default function ActivityDateSeparator({ label }: { label: string }) {
  return (
    <Marker variant="separator" className="py-2">
      <MarkerContent className="font-mono text-[10.5px] tracking-[0.08em] uppercase">
        {label}
      </MarkerContent>
    </Marker>
  );
}
