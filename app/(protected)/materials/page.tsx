import { getCounterparties, getMaterials } from "@/lib/queries";
import { SearchSortBar } from "@/components/layout/search-sort-bar";
import { MaterialsClient } from "@/components/materials/materials-client";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { MaterialsSkeleton } from "@/components/materials/materials-skeleton";

interface MaterialsPageProps {
  searchParams: Promise<{
    q?: string;
    sort?: string;
    action?: string;
    id?: string;
  }>;
}

export default async function MaterialsLibraryPage({
  searchParams,
}: MaterialsPageProps) {
  return (
    <>
      <PageHeader
        title="Библиотека материалов"
        description="Сохраненные позиции и образцы для быстрого добавления в проекты"
      >
        <Button className="h-10 bg-fg">
          <Link
            className="flex flex-row items-center gap-2"
            href="/materials?action=create"
          >
            <Plus className="size-4" /> Добавить в библиотеку
          </Link>
        </Button>
      </PageHeader>
      <Suspense fallback={<MaterialsSkeleton />}>
        <MaterialsData searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function MaterialsData({ searchParams }: MaterialsPageProps) {
  const resolvedParams = await searchParams;

  const [materials, counterparties] = await Promise.all([
    getMaterials(),
    getCounterparties(),
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
        initialMaterials={materials ?? []}
        companies={counterparties.companies}
        contacts={counterparties.contacts}
        searchParams={resolvedParams}
      />
    </>
  );
}
