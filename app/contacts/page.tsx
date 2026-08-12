import { ContactsSkeleton } from '@/components/contacts/contacts-skeleton';
import ContactsView from "@/components/contacts/contacts-view";
import PageTitle from "@/components/layout/page-title";
import { getContactsData } from "@/lib/queries";
import { Suspense } from 'react';

export default  function ContactsPage() {

  return (
    <>
      <header className="pt-[clamp(28px,5vw,48px)]">
        <PageTitle>Контакты</PageTitle>
        <p className="mt-2 text-base font-normal text-fg-secondary text-pretty">
          Компании, поставщики и представители. Управляйте справочником и
          привязывайте их к позициям спецификации.
        </p>
      </header>
      <Suspense fallback={<ContactsSkeleton />}>
        <ContactsData />
      </Suspense>
    </>
  );
}

async function ContactsData() {
  const { companies, contacts } = await getContactsData();
  return (
    <ContactsView initialCompanies={companies} initialContacts={contacts} />
  );
}
