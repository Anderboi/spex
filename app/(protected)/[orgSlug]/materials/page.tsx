import { getCounterparties, getMaterials } from "@/lib/queries";
import { SearchSortBar } from "@/components/layout/search-sort-bar";
import { MaterialsClient } from "@/components/materials/materials-client";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { MaterialsSkeleton } from "@/components/materials/materials-skeleton";

type Props = {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<{
    q?: string;
    sort?: string;
    action?: string;
    id?: string;
  }>;
};

export const metadata = { title: "Материалы" };

export default async function MaterialsLibraryPage({
  params,
  searchParams,
}: Props) {
  const { orgSlug } = await params;
  return (
    <>
      <PageHeader
        title="Библиотека материалов"
        description="Сохраненные позиции и образцы для быстрого добавления в проекты"
      >
        <Button
          nativeButton={false}
          render={
            <Link
              className="flex flex-row items-center gap-2"
              href={`/${orgSlug}/materials?action=create`}
            />
          }
          className="h-10 bg-fg"
        >
          <Plus className="size-4" /> Добавить в библиотеку
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

  const [materials, counterparties] = await Promise.all([
    getMaterials(orgSlug, { search: sp.q }),
    getCounterparties(orgSlug),
  ]);

  return (
    <>
      <SearchSortBar
        placeholder="Поиск по материалам, артикулам, брендам…"
        sortOptions={[
          { label: "По названию (А-Я)", value: "name_asc" },
          { label: "По цене (сначала дешевле)", value: "price_asc" },
          { label: "По цене (сначала дороже)", value: "price_desc" },
        ]}
      />

      <MaterialsClient
        orgSlug={orgSlug}
        initialMaterials={materials}
        companies={counterparties.companies}
        contacts={counterparties.contacts}
        searchParams={sp}
      />
    </>
  );
}
