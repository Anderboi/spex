"use client";

import { useState } from "react";
import { RotateCcw, SlidersHorizontal } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { FilterField } from "@/components/layout/filter-field";
import { DEFAULT_CONTACTS_SORT } from "@/lib/contacts/filters";
import { useContactsUrl } from "./use-contacts-url";
import { ContactsSort } from "./contacts-sort";

/**
 * Сортировка каталога контактов в нижней шторке (`< sm`).
 *
 * На телефоне в тулбаре остаётся один ряд: свёрнутый поиск, категория и кнопка
 * шторки. Сортировка меняется реже фильтра и уезжает сюда — триггеры «Все
 * категории» и «Сначала новые» в одну строку с иконкой поиска не помещаются.
 *
 * Категории в шторке нет: её контрол стоит в ряду тулбара и виден всегда, а
 * второй селект того же фильтра в шторке только путал бы (прежняя разметка
 * поля «Категория» оставлена закомментированной ниже).
 *
 * Изменения применяются сразу (состояние в URL), «Готово» просто закрывает
 * шторку — как в шторках материалов и спецификации.
 */
export function ContactsFilterSheet() {
  const [open, setOpen] = useState(false);
  const searchParams = useSearchParams();
  const { update } = useContactsUrl();

  const category = searchParams.get("category");
  const sort = searchParams.get("sort");
  const activeCount =
    Number(Boolean(category)) +
    Number(Boolean(sort && sort !== DEFAULT_CONTACTS_SORT));

  return (
    <>
      <Button
        variant="outline"
        className="h-10 shrink-0 gap-2 px-3"
        aria-label={
          activeCount > 0
            ? `Фильтры, активно ${activeCount}`
            : "Фильтры и сортировка"
        }
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <SlidersHorizontal className="size-4" />
        {activeCount > 0 && (
          <span className="flex size-5 items-center justify-center rounded-full bg-bg-accent text-[11px] font-medium text-bg">
            {activeCount}
          </span>
        )}
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="bottom"
          className="max-h-[85svh] gap-0 overflow-y-auto border-t border-border bg-bg-card p-0"
        >
          <SheetHeader className="border-b border-border-subtle p-4 pr-12">
            <SheetTitle>Фильтры и сортировка</SheetTitle>
          </SheetHeader>

          <div className="flex flex-col gap-4 p-4">
            {/* Поле «Категория» скрыто: тот же фильтр уже стоит в ряду тулбара.
                Разметка оставлена на случай возврата категории в шторку —
                вместе с ней нужно вернуть импорты `ALL_CATEGORIES`, `TYPE_ORDER`
                и `TypeSelectMobile`.
            <FilterField label="Категория">
              <TypeSelectMobile
                value={category ?? ALL_CATEGORIES}
                items={TYPE_ORDER}
                onChange={(next) =>
                  update({ category: next === ALL_CATEGORIES ? null : next })
                }
              />
            </FilterField>
            */}
            <FilterField label="Сортировка">
              {/* `containerClassName="flex"` перебивает `hidden sm:flex` обёртки,
                  рассчитанной на тулбар, — иначе на телефоне селект был бы скрыт. */}
              <ContactsSort
                isMobile={false}
                side="top"
                containerClassName="flex"
                className="w-full"
              />
            </FilterField>
          </div>

          <SheetFooter className="flex-row gap-2 border-t border-border-subtle p-4">
            <Button
              size="lg"
              variant="outline"
              className="flex-1"
              onClick={() =>
                update({ category: null, sort: DEFAULT_CONTACTS_SORT })
              }
              disabled={activeCount === 0}
            >
              <RotateCcw className="mr-2 size-4" /> Сбросить
            </Button>
            <Button size="lg" className="flex-1" onClick={() => setOpen(false)}>
              Готово
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}
