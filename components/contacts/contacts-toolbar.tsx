import { ContactsSearch } from "./contacts-search";
import { ContactsSort } from "./contacts-sort";
import TypeChipsSection from "../spec-builder/type-chips-section";

export function ContactsToolbar() {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <ContactsSearch className="min-w-60 flex-1" />
        <ContactsSort />
      </div>
      <TypeChipsSection className="mb-4" />
    </div>
  );
}
