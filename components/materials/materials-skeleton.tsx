import { Skeleton } from "@/components/ui/skeleton";

/**
 * Скелетон карточки материала: те же зоны, что у `MaterialCard` — превью
 * фиксированной высоты, бейдж категории поверх, блок текста (бренд, две строки
 * названия, тип, артикул с поставщиком) и нижняя строка с ценой.
 */
function MaterialCardSkeleton() {
  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-border bg-bg-card">
      <div className="relative h-40 shrink-0 bg-bg-brand2">
        <Skeleton className="absolute top-2.5 left-2.5 h-5 w-24 rounded" />
      </div>

      <div className="flex flex-1 flex-col justify-between gap-3 p-4">
        <div className="space-y-1.5">
          <Skeleton className="h-3 w-16" />
          <div className="h-9 space-y-1">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
          <div className="space-y-1">
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-2/3" />
          </div>
          <div className="flex gap-3 pt-0.5">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-3 w-16" />
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border pt-2">
          <Skeleton className="h-3.5 w-20" />
          <Skeleton className="h-8 w-24 rounded-md" />
        </div>
      </div>
    </div>
  );
}

/**
 * Скелет страницы материалов: повторяет раскладку реального экрана — строку
 * тулбара (поиск + три селекта), ряд категорий и сетку карточек с теми же
 * брейкпоинтами, чтобы при загрузке данных не было скачка высоты.
 */
export function MaterialsSkeleton() {
  return (
    <div
      className="animate-pulse"
      role="status"
      aria-busy="true"
      aria-label="Загрузка библиотеки материалов"
    >
      {/* Тулбар: поиск, производитель, статус, сортировка */}
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Skeleton className="h-10 min-w-60 flex-1 rounded-lg" />
        <Skeleton className="h-10 w-40 rounded-lg" />
        <Skeleton className="h-10 w-36 rounded-lg" />
        <Skeleton className="h-10 w-40 rounded-lg" />
      </div>

      {/* Категории: селект на мобиле, чипсы на десктопе */}
      <div className="mt-3 mb-4">
        <Skeleton className="h-10 w-full rounded-lg sm:hidden" />
        <div className="hidden gap-2 sm:flex">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-8 w-24 shrink-0 rounded-full" />
          ))}
        </div>
      </div>

      {/* Сетка карточек: те же брейкпоинты, что у реального списка */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <MaterialCardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}
