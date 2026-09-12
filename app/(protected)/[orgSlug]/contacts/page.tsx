import { ContactsSkeleton } from "@/components/contacts/contacts-skeleton";
import { ContactsToolbar } from "@/components/contacts/contacts-toolbar";
import { ContactsList } from "@/components/contacts/contacts-list";
import { ContactsPagination } from "@/components/contacts/contacts-pagination";
import { ContactsHeaderActions } from "@/components/contacts/contacts-header-actions";
import { PageHeader } from "@/components/layout/page-header";
import { parseContactsFilters } from "@/lib/contacts/filters";
import { getContactsDirectory } from "@/lib/queries";
import { Suspense } from "react";

type Props = {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export const metadata = { title: "Контакты" };

export default async function ContactsPage({ params, searchParams }: Props) {
  const { orgSlug } = await params;

  return (
    <>
      <PageHeader title="Контакты">
        <ContactsHeaderActions />
      </PageHeader>
      <Suspense fallback={<ContactsSkeleton />}>
        <ContactsData orgSlug={orgSlug} searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function ContactsData({
  orgSlug,
  searchParams,
}: {
  orgSlug: string;
  searchParams: Props["searchParams"];
}) {
  const sp = await searchParams;
  const filters = parseContactsFilters(sp);

  const {
    companies,
    independentContacts,
    managers,
    companiesCount,
    independentCount,
    pageCount,
    independentPageCount,
  } = await getContactsDirectory(orgSlug, filters);

  // Зажимаем страницу по границам активной вкладки. Номер мог остаться от другой
  // вкладки (например `?page=4` после перехода на специалистов с одной страницей):
  // тогда список пуст, а пагинация при `pageCount = 1` скрыта — тупик без выхода.
  //
  // Оговорка: запрос уже выполнен с исходным номером, поэтому такая выборка
  // приходит пустой (лишний дешёвый `range` по индексу). Считать точные границы
  // до выборки можно только отдельным count-запросом — это лишний round trip на
  // каждый рендер страницы, что для редкого случая не оправдано. Зажим нужен
  // ради консистентности того, что видит пользователь.
  const activePageCount =
    filters.tab === "companies" ? pageCount : independentPageCount;
  if (filters.page > activePageCount) filters.page = activePageCount;

  return (
    <>
      <ContactsToolbar />

      <ContactsList
        orgSlug={orgSlug}
        companies={companies}
        independentContacts={independentContacts}
        managers={managers}
        companiesCount={companiesCount}
        independentCount={independentCount}
        tab={filters.tab}
        page={filters.page}
      />

      {/* Пагинация вне suspense-границы списка: при клиентской навигации она не
          размонтируется и не мигает. Объём страниц читает сама из своих пропсов. */}
      <ContactsPagination
        pageCount={pageCount}
        independentPageCount={independentPageCount}
      />
    </>
  );
}
