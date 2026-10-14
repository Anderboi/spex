"use client";

import { useSearchParams } from "next/navigation";
import { useMaterialsUrl } from "@/hooks/use-materials-url";
import type { CompanyListItem } from "@/lib/queries";
import {
  FilterSelect,
  type FilterSelectOption,
} from "@/components/layout/filter-select";

const ALL_COMPANIES_LABEL = "Все компании";
/** Компанию удалили, а ссылка с её фильтром осталась: показываем это, не uuid. */
const UNKNOWN_COMPANY_LABEL = "Компания не найдена";

/**
 * Фильтр библиотеки по компании-поставщику.
 *
 * Именно по компании (`materials.company_id`), а не по бренду: сюда приходит
 * карточка компании кнопкой «Перейти к материалам компании», а бренд
 * (`materials.brand`) — отдельный разрез и отдельный контрол
 * (`MaterialsManufacturerFilter`).
 */
export function MaterialsCompanyFilter({
  companies,
  side,
  className,
}: {
  companies: CompanyListItem[];
  side?: "top" | "bottom";
  className?: string;
}) {
  const searchParams = useSearchParams();
  const { update } = useMaterialsUrl();
  const company = searchParams.get("company") ?? "";

  const knownCompany = company
    ? companies.find((c) => c.id === company)
    : undefined;

  /**
   * Активный фильтр из URL может не найтись в списке: компанию удалили, а
   * страница осталась открытой. Значение всё равно надо показать — иначе
   * фильтр не видно и не снять, и библиотека выглядит молча обрезанной.
   */
  const isUnknownCompany = Boolean(company) && !knownCompany;

  const options: FilterSelectOption<string>[] = [
    { label: ALL_COMPANIES_LABEL, value: null },
    ...(isUnknownCompany
      ? [{ label: UNKNOWN_COMPANY_LABEL, value: company }]
      : []),
    ...companies.map((c) => ({ label: c.name, value: c.id })),
  ];

  const hasOptions = companies.length > 0 || isUnknownCompany;

  // Пустой фильтр должен объяснять причину, а не выглядеть «незагруженным»:
  // при пустом списке подпись берётся из placeholder.
  const placeholder = hasOptions ? ALL_COMPANIES_LABEL : "Компании не указаны";

  return (
    <FilterSelect
      ariaLabel="Компания"
      placeholder={placeholder}
      side={side}
      className={className}
      disabled={!hasOptions}
      value={company || null}
      onChange={(value) => update({ company: value })}
      options={hasOptions ? options : []}
    />
  );
}
