import { ContactsSkeleton } from '@/components/contacts/contacts-skeleton';
import ContactsView from "@/components/contacts/contacts-view";
import { PageHeader } from '@/components/layout/page-header';
import { getContactsData } from "@/lib/queries";
import { Suspense } from 'react';

export default  function ContactsPage() {

  return (
    <>
      <PageHeader
        title="Контакты"
        description="Компании, поставщики и представители. Управляйте справочником и
          привязывайте их к позициям спецификации"
      ></PageHeader>
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
