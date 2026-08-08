import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { CatalogItem, PREFIX_MAP, SpecItem } from './types';
import { BRAND_SITES } from './constants';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// export const plural = (n: number, one: string, few: string, many: string) => {
//   const v = n % 100;
//   if (v >= 11 && v <= 19) return many;
//   const d = v % 10;
//   if (d === 1) return one;
//   if (d >= 2 && d <= 4) return few;
//   return many;
// };

export function plural(
  n: number,
  one: string,
  few: string,
  many: string,
): string {
  const a = n % 10,
    b = n % 100;
  if (a === 1 && b !== 11) return one;
  if (a >= 2 && a <= 4 && !(b >= 12 && b <= 14)) return few;
  return many;
}

export const fmtRub = (n: number) =>
  n.toLocaleString("ru-RU").replace(/,/g, "\u2009") + " ₽";

export const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  
export function fmt(n: number | string): string {
  return Number(n || 0).toLocaleString("ru-RU");
}

export function prefixFor(type: string): string {
  return PREFIX_MAP[type] || "М";
}

export function nextCode(items: SpecItem[], type: string): string {
  const n = items.filter((it) => it.type === type).length + 1;
  return prefixFor(type) + "-" + String(n).padStart(2, "0");
}

export function brandSite(brand: string): string {
  return (
    BRAND_SITES[brand] ||
    "https://www.google.com/search?q=" +
      encodeURIComponent((brand || "") + " официальный сайт")
  );
}

export function statusMeta(s: string, accent: string) {
  if (s === "Подобрано")
    return {
      dot: accent,
      bg: `color-mix(in srgb, ${accent} 15%, #f3efe7)`,
      fg: accent,
      bd: `color-mix(in srgb, ${accent} 38%, #f3efe7)`,
      bar: accent,
    };
  const M: Record<
    string,
    { dot: string; bg: string; fg: string; bd: string; bar: string }
  > = {
    "Не выбрано": {
      dot: "#c79a35",
      bg: "#f6e6c5",
      fg: "#936713",
      bd: "#e8d29c",
      bar: "#d8b65a",
    },
    Согласовано: {
      dot: "#1b1a17",
      bg: "#1b1a17",
      fg: "#f3efe7",
      bd: "#1b1a17",
      bar: "#1b1a17",
    },
    Приобретено: {
      dot: "#3f6b80",
      bg: "#e7eef3",
      fg: "#365a6b",
      bd: "#cbdbe5",
      bar: "#3f6b80",
    },
    Доставлено: {
      dot: "#5f7a3f",
      bg: "#e7efe0",
      fg: "#4d6633",
      bd: "#d0e0c3",
      bar: "#5f7a3f",
    },
    Заменить: {
      dot: "#bf5345",
      bg: "#f7e7e3",
      fg: "#a23b2e",
      bd: "#ecccc4",
      bar: "#bf5345",
    },
    Черновик: {
      dot: "#bcb7ab",
      bg: "#efe9dc",
      fg: "#9a958a",
      bd: "#e2dccd",
      bar: "#bcb7ab",
    },
  };
  return M[s] || M["Черновик"];
}



export function catKey(c: CatalogItem): string {
  return c.article || c.brand + "|" + c.name;
}

export function availMeta(a: string): string {
  const M: Record<string, string> = {
    "В наличии": "#5f7a3f",
    "Под заказ": "#3f6b80",
    "Нет в наличии": "#bf5345",
    Уточняется: "#c79a35",
  };
  return M[a] || "#c79a35";
}

export function guessMap(n: string): string {
  const s = n.toLowerCase();
  if (/normal|_nrm|_n[\._]/.test(s)) return "Normal";
  if (/rough|_rgh/.test(s)) return "Roughness";
  if (/disp|height|_dsp/.test(s)) return "Displacement";
  if (/metal|_mtl/.test(s)) return "Metallic";
  if (/_ao|occlusion/.test(s)) return "AO";
  if (/bump/.test(s)) return "Bump";
  if (/gloss/.test(s)) return "Gloss";
  if (/alpha|opacity|mask/.test(s)) return "Opacity";
  return "Diffuse / Albedo";
}

export function extOf(n: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(n || "");
  return m ? m[1].toUpperCase() : "FILE";
}

export function humanSize(b: number): string {
  if (!b) return "—";
  if (b < 1024) return b + " B";
  if (b < 1048576) return (b / 1024).toFixed(0) + " KB";
  return (b / 1048576).toFixed(1) + " MB";
}

export function prefixOf(code: string) {
  return String(code || "").split("-")[0];
}
export function numOf(code: string) {
  return parseInt(String(code || "").split("-")[1], 10) || 0;
}

export function renumberAfter(
  arr: SpecItem[],
  prefix: string,
  removedNum: number,
): SpecItem[] {
  return arr.map((it) => {
    if (prefixOf(it.code) !== prefix) return it;
    const n = numOf(it.code);
    if (n > removedNum)
      return { ...it, code: prefix + "-" + String(n - 1).padStart(2, "0") };
    return it;
  });
}

export function renumberSequential(arr: SpecItem[]): SpecItem[] {
  const byPrefix: Record<string, SpecItem[]> = {};
  arr.forEach((it) => {
    const p = prefixOf(it.code);
    (byPrefix[p] = byPrefix[p] || []).push(it);
  });
  const map: Record<string, string> = {};
  Object.keys(byPrefix).forEach((p) => {
    byPrefix[p]
      .slice()
      .sort((a, b) => numOf(a.code) - numOf(b.code))
      .forEach((it, i) => {
        map[it.id] = p + "-" + String(i + 1).padStart(2, "0");
      });
  });
  return arr.map((it) => (map[it.id] ? { ...it, code: map[it.id] } : it));
}

export function exportCSV(items: SpecItem[], showToast: (msg: string) => void) {
  const head = [
    "Код",
    "Наименование",
    "Бренд",
    "Тип",
    "Спецификация",
    "Кол-во",
    "Ед.",
    "Цена/шт, ₽",
    "Итого, ₽",
    "Статус",
  ];
  const esc = (v: any) => {
    v = String(v == null ? "" : v);
    return /[";\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  };
  const lines = [head.join(";")];
  items.forEach((it) => {
    lines.push(
      [
        it.code,
        it.name,
        it.brand,
        it.type,
        it.spec,
        it.qty,
        it.unit,
        it.price,
        it.qty * it.price,
        it.status,
      ]
        .map(esc)
        .join(";"),
    );
  });
  const grand = items.reduce((s, it) => s + it.qty * it.price, 0);
  lines.push("", "ИТОГО;;;;;;;" + grand + ";");
  const csv = "\uFEFF" + lines.join("\r\n");
  try {
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "Спецификация.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    showToast("CSV выгружен · откроется в Excel");
  } catch {
    showToast("Не удалось выгрузить");
  }
}

export function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0]?.toUpperCase())
    .join("");
}
