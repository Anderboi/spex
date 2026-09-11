import { Skeleton } from "@/components/ui/skeleton";

/** Высота карточки компании: три зоны, как в `CompanyCard`. */
function CompanyCardSkeleton() {
  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-border bg-bg-card">
      {/* Зона 1: логотип, название в две строки, категории */}
      <div className="flex items-start gap-3 p-4">
        <Skeleton className="size-12.5 shrink-0 rounded-lg" />
        <div className="min-w-0 flex-1">
          <div className="h-10 space-y-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
          <div className="mt-1.5 flex gap-1.5">
            <Skeleton className="h-5 w-20 rounded-full" />
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
        </div>
      </div>

      {/* Зона 2: строка-слот контактов */}
      <div className="flex min-h-14 items-center gap-2.5 border-t border-border-subtle px-4 py-2">
        <Skeleton className="size-7 shrink-0 rounded-full" />
        <Skeleton className="h-4 w-32" />
      </div>

      {/* Зона 3: реквизиты и превью заметки */}
      <div className="mt-auto">
        <div className="grid grid-cols-1 gap-x-6 gap-y-1 border-t border-border-subtle px-4 py-3 @[24rem]:grid-cols-2">
          <Skeleton className="h-3.5 w-40" />
          <Skeleton className="h-3.5 w-32" />
          <Skeleton className="h-3.5 w-36" />
          <Skeleton className="h-3.5 w-28" />
        </div>
        <div className="flex min-h-9 items-center border-t border-border-subtle px-4">
          <Skeleton className="h-3.5 w-2/5" />
        </div>
      </div>
    </div>
  );
}

/**
 * Скелет страницы контактов: повторяет раскладку реального списка (сетка
 * трёхзонных карточек), чтобы при загрузке данных не было скачка высоты.
 */
export function ContactsSkeleton() {
  return (
    <div
      className="animate-pulse"
      role="status"
      aria-busy="true"
      aria-label="Загрузка справочника"
    >
      {/* Тулбар: поиск и сортировка */}
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Skeleton className="h-10 min-w-60 flex-1 rounded-lg" />
        <Skeleton className="h-10 w-44 rounded-lg" />
      </div>

      {/* Категории-чипы */}
      <div className="mt-4 mb-4 flex gap-2">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-7 w-24 shrink-0 rounded-full" />
        ))}
      </div>

      {/* Вкладки */}
      <div className="mb-4 flex gap-1 border-b border-border">
        <Skeleton className="-mb-px h-11 w-32 rounded-none" />
        <Skeleton className="-mb-px h-11 w-36 rounded-none" />
      </div>

      {/* Сетка карточек: те же брейкпоинты, что у реального списка */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {Array.from({ length: 4 }, (_, i) => (
          <CompanyCardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}
