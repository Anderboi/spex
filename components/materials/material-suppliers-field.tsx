"use client";

import { useMemo } from "react";
import { Plus, Star, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  CompanyPicker,
  type CompanyOption,
  type ContactOption,
} from "@/components/layout/company-picker";
import { cn, fmt } from "@/lib/utils";
import {
  cheapestMaterialSupplier,
  normalizeMaterialSuppliers,
  type MaterialSupplierDraft,
} from "@/lib/materials/suppliers";

/**
 * Поставщики материала — список строк вместо одного поля «Поставщик».
 *
 * Один и тот же материал продаётся в нескольких компаниях, и цена у каждой своя,
 * поэтому у строки есть компания, её менеджер, цена и ссылка на страницу товара.
 * Первая строка — **основной** поставщик: именно его компания и цена уезжают в
 * позицию спецификации и в карточку библиотеки. Порядок задаёт пользователь
 * кнопкой «Сделать основным», а не сортировка по цене: «дешевле всех» — подсказка
 * для выбора, а не решение за пользователя.
 *
 * Список намеренно не нормализуется на месте: только что добавленная строка ещё
 * без компании, и нормализация (`normalizeMaterialSuppliers`) выбросила бы её
 * прямо из-под курсора. Чистит набор диалог перед сохранением — там же, где
 * собирает payload.
 */
export function MaterialSuppliersField({
  orgSlug,
  companies,
  contacts = [],
  value,
  onChange,
  onCompanyCreated,
  defaults,
}: {
  orgSlug: string;
  companies: CompanyOption[];
  contacts?: ContactOption[];
  value: MaterialSupplierDraft[];
  onChange: (next: MaterialSupplierDraft[]) => void;
  /** Компания заведена прямо из строки — родитель обновляет свой справочник. */
  onCompanyCreated?: (company: CompanyOption) => void;
  /**
   * Собственные цена и ссылка материала. Пока поставщиков нет, именно они и
   * являются его ценой, поэтому первая добавленная строка их наследует.
   */
  defaults: { price: number; productUrl: string | null };
}) {
  /**
   * Подсказка «дешевле всех»: считается по заполненным строкам, а не по всему
   * списку, — пустые строки в счёте не участвуют.
   */
  const cheapest = useMemo(
    () => cheapestMaterialSupplier(normalizeMaterialSuppliers(value)),
    [value],
  );

  const replace = (index: number, patch: Partial<MaterialSupplierDraft>) => {
    onChange(value.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  const add = () => {
    onChange([
      ...value,
      {
        // Первая строка наследует собственную цену и ссылку материала: пока
        // поставщиков не было, они и были его ценой, и терять их при первом же
        // добавлении компании незачем.
        company_id: null,
        contact_id: null,
        price: value.length === 0 ? defaults.price : 0,
        product_url: value.length === 0 ? defaults.productUrl : null,
      },
    ]);
  };

  const remove = (index: number) => {
    onChange(value.filter((_, i) => i !== index));
  };

  /** Сделать строку основной — она переезжает в начало списка. */
  const makePrimary = (index: number) => {
    if (index === 0) return;
    const next = [...value];
    const [row] = next.splice(index, 1);
    onChange([row, ...next]);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">
          Поставщики
          {value.length > 0 && (
            <span className="ml-2 font-mono text-[11px] font-normal text-fg-muted">
              {value.length}
            </span>
          )}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={add}
        >
          <Plus className="size-3.5" /> Добавить поставщика
        </Button>
      </div>

      {value.length === 0 && (
        <p className="rounded-lg border border-dashed border-border-muted px-3 py-2.5 text-[12.5px] text-fg-muted">
          Поставщик не указан: цена и ссылка материала сейчас его собственные.
          Как только появится компания, они переедут в её строку — у каждой
          компании цена своя.
        </p>
      )}

      {value.map((row, index) => {
        const isPrimary = index === 0;
        const isCheapest =
          cheapest?.unique === true &&
          cheapest.row.company_id === row.company_id &&
          Boolean(row.company_id);

        return (
          <div
            // Ключ по компании: строки переставляются («сделать основным»), и
            // ключ по индексу заставил бы React переиспользовать введённые
            // значения соседней строки. У новой строки компании ещё нет —
            // ключ по индексу нужен только до первого выбора.
            key={row.company_id ?? `new-${index}`}
            className={cn(
              "flex flex-col gap-2 rounded-lg border bg-bg-card p-3",
              isPrimary ? "border-fg/40" : "border-border-muted",
            )}
          >
            <div className="flex flex-wrap items-center gap-2">
              {isPrimary ? (
                <span className="flex items-center gap-1 rounded-md bg-fg px-1.5 py-0.5 text-[10px] font-semibold text-bg">
                  <Star className="size-3" /> Основной
                </span>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 gap-1 px-1.5 text-[11px] text-fg-muted"
                  onClick={() => makePrimary(index)}
                >
                  <Star className="size-3" /> Сделать основным
                </Button>
              )}

              {isCheapest && (
                <span className="rounded-md bg-bg-green/90 px-1.5 py-0.5 text-[10px] font-semibold text-bg">
                  Дешевле всех
                </span>
              )}

              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="ml-auto shrink-0 text-fg-muted hover:text-fg-red"
                aria-label={
                  isPrimary
                    ? "Убрать поставщика"
                    : `Убрать поставщика ${index + 1}`
                }
                onClick={() => remove(index)}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>

            <CompanyPicker
              orgSlug={orgSlug}
              // Компании других строк в выборе не предлагаются: одна компания —
              // одна строка на материал (то же обещает уникальный индекс в БД).
              companies={companies.filter(
                (c) =>
                  !value.some(
                    (other, i) => i !== index && other.company_id === c.id,
                  ),
              )}
              contacts={contacts}
              value={row.company_id}
              contactValue={row.contact_id}
              onChange={({ companyId, contactId }) =>
                replace(index, { company_id: companyId, contact_id: contactId })
              }
              onCompanyCreated={onCompanyCreated}
              placeholder="Выберите компанию..."
              searchPlaceholder="Поиск компании или менеджера..."
              emptyText="Ничего не найдено — можно создать компанию."
              clearLabel="Без компании"
            />

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <label className="flex flex-col gap-1">
                <span className="font-mono text-[11px] text-fg-muted">
                  Цена у компании, ₽
                </span>
                {/* Без `min`/`step`: поле не зарегистрировано в форме материала,
                    и родная проверка браузера перехватила бы отправку раньше
                    zod — с подсказкой на английском вместо внятного текста.
                    Отрицательную цену отклоняет `materialSupplierSchema`. */}
                <Input
                  type="number"
                  placeholder="0"
                  value={row.price === 0 ? "" : row.price}
                  onChange={(e) =>
                    replace(index, { price: e.target.valueAsNumber || 0 })
                  }
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="font-mono text-[11px] text-fg-muted">
                  Ссылка на товар
                </span>
                {/* `type="text"`, а не `url`: ссылку часто пишут без схемы
                    («kerama.ua/x»), и родная проверка браузера не должна
                    запрещать сохранение материала. */}
                <Input
                  type="text"
                  placeholder="https://example.com"
                  value={row.product_url ?? ""}
                  onChange={(e) =>
                    replace(index, {
                      product_url: e.target.value === "" ? null : e.target.value,
                    })
                  }
                />
              </label>
            </div>

            {row.price > 0 && isPrimary && (
              <p className="text-[11px] text-fg-muted">
                Цена материала: {fmt(row.price)} ₽ — её получит позиция при
                добавлении в проект.
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
