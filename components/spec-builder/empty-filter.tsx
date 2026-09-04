function EmptyFilter({ onReset }: { onReset: () => void }) {
  return (
    <div className="py-20 text-center">
      <p className="font-heading text-lg font-semibold">Ничего не найдено</p>
      <p className="mt-1.5 text-[14px] text-fg-muted">
        Измените запрос или сбросьте фильтры.
      </p>
      <button
        type="button"
        onClick={onReset}
        className="mt-5 rounded-xl bg-bg-accent px-5 py-2.5 text-[14px] font-semibold text-bg"
      >
        Сбросить фильтры
      </button>
    </div>
  );
}

export default EmptyFilter;