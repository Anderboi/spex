"use client";

import { useSearchParams } from "next/navigation";
import { ContactsSort } from "./contacts-sort";
import { ContactsFilterSheet } from "./contacts-filter-sheet";
import TypeChipsSection from "../spec-builder/layout/type-chips-section";
import { TypeSelectMobile } from "../spec-builder/layout/type-select-mobile";
import { SearchBlock } from "../layout/search-block";
import { useContactsUrl } from "./use-contacts-url";
import { ALL_CATEGORIES, TYPE_ORDER } from "@/lib/constants";

/**
 * Тулбар каталога контактов.
 *
 * `sm+` — как раньше: строка поиска с сортировкой и ряд чипсов категорий.
 *
 * `< sm` — один ряд: свёрнутый поиск, категория и кнопка шторки (ряд рисует сам
 * `SearchBlock` — он же убирает соседей, пока развёрнуто поле). Три контрола в
 * одну строку на телефоне не помещаются, поэтому строка поиска разворачивается
 * по тапу, а сортировка переезжает в шторку. Категория остаётся снаружи: это
 * основной разрез каталога, и прятать её за лишний тап незачем.
 *
 * Категория живёт в мобильном ряду, поэтому ряд чипсов на `< sm` не рендерится
 * вовсе (`hidden sm:flex`): иначе мобильный селект `TypeChipsSection` давал бы
 * второй контрол категории отдельной строкой.
 */
export function ContactsToolbar() {
  const searchParams = useSearchParams();
  const { update } = useContactsUrl();

  const category = searchParams.get("category") ?? ALL_CATEGORIES;

  const mobileRow = (
    <>
      {/* `sm:hidden` — мобильный экземпляр категории: на `sm+` её показывает ряд
          чипсов ниже, и два селекта категории в разметке дублировали бы контрол
          и `aria-label` для скринридера. */}
      <TypeSelectMobile
        value={category}
        items={TYPE_ORDER}
        onChange={(next) =>
          update({ category: next === ALL_CATEGORIES ? null : next })
        }
        className="min-w-0 flex-1 sm:hidden"
      />
      <ContactsFilterSheet />
    </>
  );

  return (
    <div className="space-y-3">
      <div className="mt-2 flex flex-wrap items-center gap-3 sm:mt-5">
        <SearchBlock
          useSearchUrl={useContactsUrl}
          placeholder="Поиск по названию, категории, имени..."
          collapsible
          expandedContent={mobileRow}
        />
        <ContactsSort isMobile={false} />
      </div>
      {/* Чипсы категорий — только на `sm+`: на телефоне категория уже стоит в
          ряду выше, и второй её контрол занял бы ещё одну строку. */}
      <div className="mb-4 hidden gap-2 sm:flex">
        <TypeChipsSection />
      </div>
    </div>
  );
}
