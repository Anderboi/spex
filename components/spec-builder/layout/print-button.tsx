"use client";

export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded-xl bg-bg-accent px-6 py-3 text-[14px] font-semibold text-bg"
    >
      Распечатать или сохранить в PDF
    </button>
  );
}
