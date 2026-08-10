import ContactsView from "@/components/contacts/contacts-view";
import { getContactsData } from "@/lib/queries";
import { Suspense } from "react";

export default async function ContactsPage() {
  const { companies, contacts } = await getContactsData();

  // Разделяем контакты компании и независимые контакты
  const independentContacts = contacts.filter((c) => !c.id);

  return (
    <Suspense fallback={<div>Загрузка...</div>}>
      <ContactsView initialCompanies={companies} initialContacts={contacts} />
    </Suspense>
  );
}
