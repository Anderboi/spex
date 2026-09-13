import { getCounterparties, getMaterialBrands, getMaterialsPage } from "@/lib/queries";
import { MaterialsToolbar } from "@/components/materials/materials-toolbar";
import { MaterialsClient } from "@/components/materials/materials-client";
import { MaterialsPagination } from "@/components/materials/materials-pagination";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { MaterialsSkeleton } from "@/components/materials/materials-skeleton";
import { parseMaterialsFilters } from "@/lib/materials/filters";
import { withSearchParams } from "@/lib/query-string";

type Props = {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export const metadata = { title: "Материалы" };

export default async function MaterialsLibraryPage({
  params,
  searchParams,
}: Props) {
  const [{ orgSlug }, sp] = await Promise.all([params, searchParams]);
  // Открытие диалога — через URL (?action=create), существующие фильтры
  // и пагинация при этом сохраняются.
  const createHref = withSearchParams(`/${orgSlug}/materials`, sp, {
    action: "create",
  });
  return (
    <>
      <PageHeader
        title="Библиотека материалов"
        // description="Сохраненные позиции и образцы для быстрого добавления в проекты"
      >
        <Button
          nativeButton={false}
          render={
            <Link
              className="flex flex-row items-center gap-2"
              href={createHref}
            />
          }
          className="h-10 bg-fg"
        >
          <Plus className="size-4" /> Добавить
        </Button>
      </PageHeader>
      <Suspense fallback={<MaterialsSkeleton />}>
        <MaterialsData orgSlug={orgSlug} searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function MaterialsData({
  orgSlug,
  searchParams,
}: {
  orgSlug: string;
  searchParams: Props["searchParams"];
}) {
  const sp = await searchParams;
  const filters = parseMaterialsFilters(sp);

  const [{ items, pageCount }, counterparties, brands] = await Promise.all([
    getMaterialsPage(orgSlug, filters),
    getCounterparties(orgSlug),
    getMaterialBrands(orgSlug),
  ]);

  // Номер страницы мог остаться от другой выборки (`?page=9` после смены
  // категории): выборка приходит пустой, а пагинация зажата до реального
  // диапазона — тупик без выхода. Повторяем запрос уже с последней страницей:
  // лишний round trip случается только в этом редком случае.
  let materials = items;
  if (items.length === 0 && filters.page > pageCount) {
    filters.page = pageCount;
    materials = (await getMaterialsPage(orgSlug, filters)).items;
  }

  return (
    <>
      <MaterialsToolbar brands={brands} />

      <MaterialsClient
        orgSlug={orgSlug}
        initialMaterials={materials}
        companies={counterparties.companies}
        contacts={counterparties.contacts}
      />

      <MaterialsPagination pageCount={pageCount} />
    </>
  );
}
