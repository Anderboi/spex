import {
  getCounterparties,
  getMaterialBrands,
  getMaterialsPage,
} from "@/lib/queries";
import { MaterialsToolbar } from "@/components/materials/materials-toolbar";
import { MaterialsClient } from "@/components/materials/materials-client";
import { MaterialsCreateButton } from "@/components/materials/materials-create-button";
import { MaterialsPagination } from "@/components/materials/materials-pagination";
import { PageHeader } from "@/components/layout/page-header";
import { Suspense } from "react";
import { MaterialsSkeleton } from "@/components/materials/materials-skeleton";
import { parseMaterialsFilters } from "@/lib/materials/filters";

type Props = {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export const metadata = { title: "Материалы" };

export default async function MaterialsLibraryPage({
  params,
  searchParams,
}: Props) {
  const { orgSlug } = await params;

  return (
    <>
      <PageHeader title="Библиотека материалов">
        {/* Диалоги открываются по URL (?action=create) — кнопка клиентская:
            серверному `<Link>` пришлось бы перерисовывать страницу целиком
            (см. MaterialsCreateButton). */}
        <MaterialsCreateButton />
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

  // Список проектов для диалога «В проект» страница не грузит: открытие диалога
  // больше не перерисовывает её на сервере, и данные спрашивает сам диалог
  // (`listMaterialProjectTargets`). Обычный заход в библиотеку не платит за
  // выборку, которой может и не понадобиться.
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
