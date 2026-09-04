import { PackageSearch, Plus } from 'lucide-react';

function EmptyProject({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="mt-8 rounded-2xl border border-dashed border-border-muted py-20 text-center">
      <PackageSearch className="mx-auto size-10 text-fg-muted" />
      <p className="mt-4 font-heading text-lg font-semibold">
        Спецификация пуста
      </p>
      <p className="mx-auto mt-1.5 max-w-md text-pretty text-[14px] text-fg-muted">
        Добавьте материалы из библиотеки или заведите пустые марки — заполните
        их, когда определитесь с подбором.
      </p>
      <button
        type="button"
        onClick={onAdd}
        className="mt-5 inline-flex h-10 items-center gap-2 rounded-xl bg-bg-accent px-5 text-[14px] font-semibold text-bg"
      >
        <Plus className="size-4" /> Добавить позиции
      </button>
    </div>
  );
}

export default EmptyProject;