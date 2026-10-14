"use client";

import { memo, useId, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowUpRight,
  ChevronRight,
  Globe,
  Mail,
  MapPin,
  Package,
  Phone,
  Plus,
  StickyNote,
  UserRound,
} from "lucide-react";
import { CompanyRow, ContactRow } from "@/lib/validations";
import { initials, normalizeWebsite, telHref } from "@/lib/utils";
import { ContactAvatarStack } from "./contact-avatar";
import { MAX_AVATARS, pluralizeContacts } from "./contact-shared";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import IconButtonBlock from "../layout/icon-button-block";

/** Сколько категорий показываем чипами, остальные сворачиваем в «+N». */
const VISIBLE_CATEGORIES = 2;

const areCategoriesEqual = (
  a: string[] | undefined | null,
  b: string[] | undefined | null,
): boolean => {
  if (a === b) return true;
  if (!a || !b) return !a?.length && !b?.length;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
};

interface CompanyCardProps {
  company: CompanyRow;
  /** Слаг организации — из него собирается ссылка в библиотеку материалов. */
  orgSlug: string;
  /**
   * Сколько материалов этой компании лежит в библиотеке. `undefined` — число
   * неизвестно (запрос не удался): бейджа нет, но кнопка работает.
   */
  materialCount?: number;
  managers: ContactRow[];
  /** Открывает панель контактов (группа, а не конкретный человек). */
  onOpenContacts: (companyId: string) => void;
  onEditCompany: (id: string) => void;
  onRemoveCompany: (id: string) => void;
}

export const CompanyCard = memo(
  function CompanyCard({
    company,
    orgSlug,
    materialCount,
    managers,
    onOpenContacts,
    onEditCompany,
    onRemoveCompany,
  }: CompanyCardProps) {
    const [showDeleteDialog, setShowDeleteDialog] = useState(false);

    const titleId = useId();
    const contactRowLabel = `Контакты компании ${company.name}`;

    /**
     * Библиотека материалов с фильтром по этой компании. Фильтр — по компании
     * (`company`), а не по бренду: бренд материала и его поставщик в библиотеке
     * разведены на два разных контрола.
     */
    const materialsHref = `/${orgSlug}/materials?company=${encodeURIComponent(
      company.id,
    )}`;

    /**
     * Подпись компактной кнопки: видимого текста у неё нет — только «куб» и
     * число, поэтому смысл несут доступное имя и подсказка при наведении.
     * Одна и та же строка идёт в оба места: расходиться им незачем.
     */
    const materialsLabel =
      typeof materialCount === "number"
        ? `Материалы поставщика ${company.name}: ${materialCount}, открыть в библиотеке`
        : `Материалы поставщика ${company.name}, открыть в библиотеке`;

    const website = useMemo(
      () => normalizeWebsite(company.website),
      [company.website],
    );

    const websiteHref = website?.href;
    const websiteLabel = website?.label;

    const handleConfirmDelete = () => {
      setShowDeleteDialog(false);
      onRemoveCompany(company.id);
    };

    const categories = useMemo(
      () =>
        Array.isArray(company.category)
          ? Array.from(new Set(company.category.filter(Boolean)))
          : [],
      [company.category],
    );

    const shownCategories = categories.slice(0, VISIBLE_CATEGORIES);
    const restCategories = categories.length - shownCategories.length;

    const firstManager = managers[0];
    const otherManagers = Math.max(managers.length - 1, 0);

    return (
      <>
        <article
          aria-labelledby={titleId}
          style={{
            contentVisibility: "auto",
            containIntrinsicSize: "0 220px",
          }}
          className="group @container flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-bg-card transition-colors hover:border-border-muted"
        >
          {/* Зона 1: логотип-якорь, название, категории, действия */}
          <header className="flex items-start gap-3 p-4">
            {company.logo_url ? (
              <div className="relative size-17 shrink-0 overflow-hidden rounded-lg border border-border-subtle bg-bg-card2">
                <Image
                  src={company.logo_url}
                  alt=""
                  fill
                  sizes="50px"
                  className="object-contain"
                />
              </div>
            ) : (
              <div
                aria-hidden
                className="flex size-17 shrink-0 items-center justify-center rounded-lg bg-bg-brand font-serif text-base text-fg-brand"
              >
                {initials(company.name)}
              </div>
            )}

            <div className="min-w-0 flex-1">
              {/* Ровно 2 строки: иначе карточки с коротким и длинным названием
                  разъезжаются по высоте и ломают выравнивание в строке сетки. */}
              <h3
                id={titleId}
                className="line-clamp-2 h-10 wrap-break-word font-serif text-base font-semibold leading-snug text-fg-body"
              >
                {company.name}
              </h3>

              {shownCategories.length > 0 || restCategories > 0 ? (
                <div className="mt-1.5 flex items-center gap-1.5">
                  {shownCategories.map((cat) => (
                    <span
                      key={cat}
                      className="min-w-0 truncate rounded-full border border-fg-brand/50 bg-bg-brand/30 px-2 py-0.5 text-xs font-medium text-fg-brand"
                    >
                      {cat}
                    </span>
                  ))}
                  {restCategories > 0 && (
                    <span
                      className="shrink-0 rounded-full border border-border bg-bg-card2 px-2 py-0.5 text-xs font-medium text-fg-muted"
                      title={categories.join(", ")}
                    >
                      +{restCategories}
                    </span>
                  )}
                </div>
              ) : null}
            </div>

            <IconButtonBlock
              onClick={() => onEditCompany(company.id)}
              onDelete={() => setShowDeleteDialog(true)}
            />
          </header>

          {/* Зона 2: строка-слот контактов — всегда одна строка независимо от
              количества людей, поэтому высота сетки не меняется. Слева контакты
              (действие внутри страницы), справа компактный переход в библиотеку:
              два разных действия разведены вертикальной чертой и не читаются как
              одно, а стрелка ↗ вместо шеврона говорит «уйду в другой раздел». */}
          <div className="flex min-h-14 items-stretch border-t border-border-subtle">
            <button
              type="button"
              onClick={() => onOpenContacts(company.id)}
              aria-label={contactRowLabel}
              aria-haspopup="dialog"
              className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 px-4 py-2 text-left transition-colors hover:bg-bg-card2"
            >
              {managers.length > 0 ? (
                <>
                  <ContactAvatarStack
                    contacts={managers}
                    size="xs"
                    max={MAX_AVATARS}
                  />
                  <span className="min-w-0 flex-1 truncate text-sm text-fg-body">
                    {firstManager?.name}
                    {otherManagers > 0 && (
                      <span className="text-fg-muted"> +{otherManagers}</span>
                    )}
                  </span>
                </>
              ) : (
                <>
                  <span
                    aria-hidden
                    className="flex size-7 shrink-0 items-center justify-center rounded-full border border-dashed border-border-dash text-fg-icon"
                  >
                    <Plus className="size-3.5" />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm text-fg-muted">
                    Добавить контакт
                  </span>
                </>
              )}
              <ChevronRight className="size-4 shrink-0 text-fg-icon" />
            </button>

            {/* Материалов нет — нет и кнопки: кликабельный элемент, ведущий на
                пустой результат, хуже его отсутствия, и высоту он не занимает.
                Неизвестное число (счётчик не посчитался) кнопку не отменяет:
                путь в библиотеку нужен и тогда, числа просто нет. */}
            {(materialCount === undefined || materialCount > 0) && (
              <Link
                href={materialsHref}
                aria-label={materialsLabel}
                title={materialsLabel}
                className="flex shrink-0 items-center gap-2 border-l border-border-subtle px-3 py-2 text-sm text-fg-body transition-colors hover:bg-bg-card2"
              >
                <Package className="size-4 shrink-0 text-fg-icon" />
                {typeof materialCount === "number" && (
                  <span className="shrink-0 font-medium tabular-nums">
                    {materialCount}
                  </span>
                )}
                <ArrowUpRight className="size-4 shrink-0 text-fg-icon" />
              </Link>
            )}
          </div>

          {/* Зона 3: реквизиты и превью заметки. Блок растягивается на остаток
              высоты карточки: в сетке карточки выравниваются по самой высокой, и
              без растяжения остаток уходил бы в зазор НАД блоком — его верхняя
              граница отрывалась от строки контактов. Прижата к низу при этом
              только заметка: реквизиты остаются вплотную к своей границе. */}
          <div className="flex flex-1 flex-col">
            <div className="grid grid-cols-1 gap-x-6 gap-y-1 border-t border-border-subtle px-4 py-3 text-xs text-fg-muted @[24rem]:grid-cols-2">
              {company.address ? (
                <span
                  className="flex min-w-0 items-center gap-1.5"
                  title={company.address}
                >
                  <MapPin className="size-3.5 shrink-0 text-fg-icon" />
                  <span className="truncate">{company.address}</span>
                </span>
              ) : (
                <span className="flex min-w-0 items-center gap-1.5">
                  <MapPin className="size-3.5 shrink-0 text-fg-icon" />
                  <span className="truncate">Адрес не указан</span>
                </span>
              )}

              {company.phone ? (
                <a
                  href={telHref(company.phone)}
                  title={company.phone}
                  className="flex min-w-0 items-center gap-1.5 font-mono tabular-nums transition-colors hover:text-fg"
                >
                  <Phone className="size-3.5 shrink-0 text-fg-icon" />
                  <span className="truncate">{company.phone}</span>
                </a>
              ) : (
                <span className="flex min-w-0 items-center gap-1.5">
                  <Phone className="size-3.5 shrink-0 text-fg-icon" />
                  <span className="truncate">Телефон не указан</span>
                </span>
              )}

              {company.email ? (
                <a
                  href={`mailto:${company.email}`}
                  title={company.email}
                  className="flex min-w-0 items-center gap-1.5 transition-colors hover:text-fg"
                >
                  <Mail className="size-3.5 shrink-0 text-fg-icon" />
                  <span className="truncate">{company.email}</span>
                </a>
              ) : null}

              {websiteHref && websiteLabel ? (
                <a
                  href={websiteHref}
                  target="_blank"
                  rel="noreferrer"
                  title={websiteLabel}
                  className="flex min-w-0 items-center gap-1.5 transition-colors hover:text-fg"
                >
                  <Globe className="size-3.5 shrink-0 text-fg-icon" />
                  <span className="truncate">{websiteLabel}</span>
                </a>
              ) : null}
            </div>

            {/* Превью заметки в одну строку: полный текст — в панели контактов.
                Строка резервируется всегда, чтобы высота не зависела от наличия,
                а `mt-auto` держит её у нижнего края растянутого блока. */}
            <p className="mt-auto flex min-h-9 items-center gap-1.5 border-t border-border-subtle px-4 text-xs text-fg-muted">
              {company.note ? (
                <>
                  <StickyNote className="size-3.5 shrink-0 text-fg-icon" />
                  <span className="truncate" title={company.note}>
                    {company.note}
                  </span>
                </>
              ) : (
                <>
                  <UserRound className="size-3.5 shrink-0 text-fg-icon" />
                  <span className="truncate">
                    {managers.length > 0
                      ? `${pluralizeContacts(managers.length)} · открыть контакты`
                      : "Контакты не добавлены"}
                  </span>
                </>
              )}
            </p>
          </div>
        </article>

        <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Удалить компанию «{company.name}»?
              </AlertDialogTitle>
              <AlertDialogDescription>
                {managers.length > 0
                  ? `Компания будет удалена. Её контакты (${pluralizeContacts(managers.length)}) ` +
                    `останутся в справочнике как независимые специалисты. Материалы этого поставщика сохранятся.`
                  : "Компания будет удалена. Материалы этого поставщика сохранятся."}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Отмена</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleConfirmDelete}
                className="bg-destructive text-white hover:bg-destructive/80"
              >
                Удалить
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </>
    );
  },
  (prevProps, nextProps) => {
    // Ссылка в библиотеку и её число зависят не от компании, а от окружения.
    if (prevProps.orgSlug !== nextProps.orgSlug) return false;
    if (prevProps.materialCount !== nextProps.materialCount) return false;

    if (prevProps.company !== nextProps.company) {
      // Сравниваем по ключевым свойствам компании
      if (
        prevProps.company.id !== nextProps.company.id ||
        prevProps.company.name !== nextProps.company.name ||
        prevProps.company.address !== nextProps.company.address ||
        prevProps.company.phone !== nextProps.company.phone ||
        prevProps.company.email !== nextProps.company.email ||
        prevProps.company.website !== nextProps.company.website ||
        prevProps.company.note !== nextProps.company.note ||
        prevProps.company.logo_url !== nextProps.company.logo_url ||
        !areCategoriesEqual(
          prevProps.company.category,
          nextProps.company.category,
        )
      ) {
        return false;
      }
    }

    // Проверяем список менеджеров
    if (prevProps.managers !== nextProps.managers) {
      if (prevProps.managers.length !== nextProps.managers.length) return false;
      for (let i = 0; i < prevProps.managers.length; i++) {
        if (prevProps.managers[i] !== nextProps.managers[i]) return false;
      }
    }

    return true;
  },
);
