"use client";

import {
  ArrowLeftRight,
  BadgeCheck,
  CircleDollarSign,
  Eraser,
  FilePlus2,
  GitBranch,
  Hash,
  Layers,
  PackageMinus,
  PackagePlus,
  Pencil,
  RotateCcw,
  Ruler,
  SquareCheck,
  SquarePen,
  Trash2,
  Truck,
  Wand2,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";

import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker";
import ActivityChanges from "./activity-changes";
import ActivityMeta from "./activity-meta";
import {
  activityBatchSize,
  formatActivityBatch,
  formatActivityEvent,
  type ActivityIcon,
} from "@/lib/spec/activity-format";
import type { HistoryEntry } from "@/lib/spec/history-types";

/**
 * Иконка каждого вида события.
 *
 * Словарь явный и полный: `ActivityIcon` — закрытое объединение всех 21 вида,
 * поэтому забытую иконку поймает компилятор, а не пользователь. Выбирать иконку
 * «по смыслу текста» здесь нечего — смысл уже определён в форматтере.
 */
const EVENT_ICON: Record<ActivityIcon, LucideIcon> = {
  created: FilePlus2,
  wand: Wand2,
  eraser: Eraser,
  trash: Trash2,
  restore: RotateCcw,
  hash: Hash,
  // Смена статуса — «отметка», исполнение услуги — «подтверждение»: разные
  // действия не должны выглядеть одной и той же иконкой.
  status: SquareCheck,
  price: CircleDollarSign,
  quantity: Ruler,
  supplier: Truck,
  details: SquarePen,
  parent: GitBranch,
  variantAdd: Layers,
  variantSwitch: ArrowLeftRight,
  variantEdit: Pencil,
  variantRemove: X,
  componentAdd: PackagePlus,
  componentRemove: PackageMinus,
  serviceAdd: Wrench,
  serviceDone: BadgeCheck,
  serviceRemove: X,
};

type EventEntry = Extract<HistoryEntry, { source: "event" }>;

/**
 * Системное событие — компактная строка `Marker`.
 *
 * Заметно тише комментария: одна строка текста, иконка вместо аватара, детали
 * (марка и название) — вторичным цветом. Таблица изменений появляется только у
 * `details_changed` и `variant_updated`.
 */
export default function ActivityEvent({ record }: { record: EventEntry }) {
  const presentation = formatActivityEvent(record);
  // Запись неизвестного вида (например, из более новой версии приложения)
  // пропускается: догадка о смысле события хуже, чем его отсутствие.
  if (!presentation) return null;

  const Icon = EVENT_ICON[presentation.icon];
  const batchSize = activityBatchSize(record);

  return (
    <Marker>
      <MarkerIcon className="mt-0.5 text-fg-muted">
        <Icon />
      </MarkerIcon>

      {/*
        `MarkerContent` — это `span`, поэтому внутренняя разметка собрана из
        `div`-ов, но сами они не вложены в строчный контекст как блочные: у
        `span` здесь `flex`, и строки раскладывает он.
      */}
      <MarkerContent className="flex flex-col gap-1.5">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-[13px] text-fg">{presentation.title}</span>

            {batchSize !== null && (
              <span className="shrink-0 rounded-full border border-border-muted bg-bg-card2 px-2 py-0.5 font-mono text-[10px] tracking-[0.04em] text-fg-muted">
                {formatActivityBatch(batchSize)}
              </span>
            )}
          </div>

          {presentation.detail && (
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-[12.5px] text-fg-secondary">
              {presentation.detail.code && (
                <span className="shrink-0 font-mono text-fg-muted">
                  {presentation.detail.code}
                </span>
              )}
              <span className="min-w-0 wrap-break-word">
                {presentation.detail.name}
              </span>
            </div>
          )}

          {presentation.changes && (
            <ActivityChanges changes={presentation.changes} />
          )}

          <ActivityMeta actor={record.actor} createdAt={record.createdAt} />
      </MarkerContent>
    </Marker>
  );
}
