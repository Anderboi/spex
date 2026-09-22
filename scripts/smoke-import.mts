/**
 * Живой smoke-тест импортёра: настоящий сайт, настоящий DeepSeek.
 *
 * Запускается ТОЛЬКО вручную и никогда не входит в `npm test`: он тратит деньги
 * на API, зависит от доступности внешних сайтов и от их текущей вёрстки.
 *
 * Запуск:
 *   npm run import:smoke                 # три acceptance-URL из постановки
 *   npm run import:smoke -- <url> [url]  # произвольные страницы
 *
 * Требуется `DEEPSEEK_API_KEY` в окружении (`.env.local` подхватывается).
 * Без ключа скрипт отработает на детерминированном слое и честно об этом скажет.
 *
 * Отчёт по каждому URL: черновик целиком, источники значений и результат
 * проверок, специфичных для этого кейса. Скрипт не пишет в Supabase — импортёр
 * этого не умеет по построению.
 */

import { readFileSync } from "node:fs";
import { TYPE_ORDER } from "../lib/constants.ts";
import { createDefaultPageReader, isPageReaderConfigured } from "../lib/material-import/firecrawl.ts";
import { runImportPipeline } from "../lib/material-import/pipeline.ts";
import type { MaterialImportDraft } from "../lib/material-import/draft.ts";

/* ------------------------------------------------------------------ */
/*  Окружение                                                          */
/* ------------------------------------------------------------------ */

/** Читает .env.local вручную: скрипт запускается вне Next. */
function loadEnvLocal(): void {
  let content: string;
  try {
    content = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  } catch {
    return;
  }

  for (const line of content.split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;
    process.env[key] = rawValue.trim().replace(/^["']|["']$/g, "");
  }
}

/* ------------------------------------------------------------------ */
/*  Проверки кейсов                                                    */
/* ------------------------------------------------------------------ */

type Check = {
  name: string;
  run: (draft: MaterialImportDraft) => { ok: boolean; detail: string };
};

/** Артикул не должен оказаться торговым кодом площадки. */
function articleIsNot(retailerId: string): Check {
  return {
    name: `article не равен торговому коду ${retailerId}`,
    run: (draft) => {
      if (draft.article === null) {
        return { ok: true, detail: "article пуст (код площадки отклонён)" };
      }
      const normalised = (value: string) => value.replace(/[\s_\-.]+/g, "").toUpperCase();
      const leaked = normalised(draft.article) === normalised(retailerId);
      return {
        ok: !leaked,
        detail: leaked
          ? `article = ${draft.article} — ЭТО КОД ПЛОЩАДКИ`
          : `article = ${draft.article}`,
      };
    },
  };
}

function hasValue(field: keyof MaterialImportDraft, expected: string): Check {
  return {
    name: `${field} = ${expected}`,
    run: (draft) => {
      const actual = draft[field];
      const ok = typeof actual === "string" && actual.toLowerCase() === expected.toLowerCase();
      return { ok, detail: `фактически: ${actual === null ? "null" : String(actual)}` };
    },
  };
}

function articleMatches(pattern: RegExp): Check {
  return {
    name: `article соответствует ${pattern}`,
    run: (draft) => ({
      ok: draft.article !== null && pattern.test(draft.article),
      detail: `article = ${draft.article ?? "null"}`,
    }),
  };
}

function categoryIn(allowed: readonly string[]): Check {
  return {
    name: `category ∈ TYPE_ORDER`,
    run: (draft) => ({
      ok: draft.category === null || allowed.includes(draft.category),
      detail: `category = ${draft.category ?? "null"}`,
    }),
  };
}

function attrsIncludeAny(keys: readonly string[], min = 1): Check {
  return {
    name: `attrs содержат ≥${min} из: ${keys.slice(0, 4).join(", ")}…`,
    run: (draft) => {
      const present = keys.filter((key) =>
        Object.keys(draft.attrs).some((actual) =>
          actual.replace(/[\s_-]/g, "").toLowerCase().includes(key.replace(/[\s_-]/g, "").toLowerCase()),
        ),
      );
      return {
        ok: present.length >= min,
        detail: `найдено ${present.length}: ${present.join(", ") || "—"}`,
      };
    },
  };
}

/** Варианты не смешаны: ширина и толщина не из разных SKU. */
function variantNotMixed(fromUrl: RegExp): Check {
  return {
    name: "характеристики варианта не смешаны",
    run: (draft) => {
      const width = Object.entries(draft.attrs).find(([key]) => /ширин/i.test(key))?.[1];
      const thickness = Object.entries(draft.attrs).find(([key]) => /толщин/i.test(key))?.[1];
      const selection = Object.entries(draft.attrs).find(([key]) => /селекц/i.test(key))?.[1];

      if (width === undefined && thickness === undefined) {
        return { ok: true, detail: "вариантные характеристики не заполнены (не смешаны)" };
      }

      const combined = `${width ?? ""} ${thickness ?? ""} ${selection ?? ""}`;
      const mismatch = !fromUrl.test(combined);
      return {
        ok: !mismatch,
        detail:
          `ширина=${width ?? "—"} толщина=${thickness ?? "—"} селекция=${selection ?? "—"}` +
          (mismatch ? " — значения не подтверждаются ссылкой" : ""),
      };
    },
  };
}

type Case = {
  title: string;
  url: string;
  expected: string;
  checks: Check[];
};

const CASES: Case[] = [
  {
    title: "Santehnika Online — STWORKI Эстерсунд S31010CR",
    url: "https://santehnika-online.ru/product/smesitel_dlya_rakoviny_stworki_estersund_s31010cr/",
    expected: "STWORKI, артикул S31010CR, торговый код 686224 не в article",
    checks: [
      hasValue("brand", "STWORKI"),
      articleMatches(/S31010CR/i),
      articleIsNot("686224"),
      categoryIn(TYPE_ORDER),
      attrsIncludeAny(["материал", "покрытие", "излив", "управление"], 2),
    ],
  },
  {
    title: "FINEX — инженерная доска Kanna Brushed, SKU 143834",
    url: "https://finex.ru/catalog/inzhenernaya-doska/kanna-brushed/143834/",
    expected: "характеристики именно SKU 143834 либо ничего вариантного",
    checks: [
      hasValue("brand", "FINEX"),
      articleMatches(/143834|Kanna/i),
      variantNotMixed(/13[.,]5|180|select/i),
      attrsIncludeAny(["порода", "толщина", "ширина", "селекция", "дизайн"], 2),
    ],
  },
  {
    title: "Lemana PRO — Systeme Electric Glossa GSL000143",
    url: "https://lemanapro.ru/product/rozetka-systeme-electric-glossa-gsl000143-86710177/",
    expected: "Systeme Electric, артикул GSL000143, код 86710177 не в article",
    checks: [
      hasValue("brand", "Systeme Electric"),
      articleMatches(/GSL000143/i),
      articleIsNot("86710177"),
      attrsIncludeAny(["ток", "напряжение", "цвет", "RAL", "заземление", "монтаж"], 3),
    ],
  },
];

/* ------------------------------------------------------------------ */
/*  Вывод                                                              */
/* ------------------------------------------------------------------ */

const RESET = "\u001b[0m";
const RED = "\u001b[31m";
const GREEN = "\u001b[32m";
const YELLOW = "\u001b[33m";
const DIM = "\u001b[2m";

function heading(text: string): void {
  console.log(`\n${DIM}${"─".repeat(72)}${RESET}\n${text}`);
}

function printDraft(draft: MaterialImportDraft): void {
  console.log(`${DIM}name:      ${RESET}${draft.name ?? "—"}`);
  console.log(`${DIM}brand:     ${RESET}${draft.brand ?? "—"}`);
  console.log(`${DIM}article:   ${RESET}${draft.article ?? "—"}${draft.article ? "" : "  (пусто)"}`);
  console.log(`${DIM}category:  ${RESET}${draft.category ?? "—"}`);
  console.log(`${DIM}product:   ${RESET}${draft.productType ?? "—"}`);
  console.log(
    `${DIM}price:     ${RESET}${draft.price ?? "—"} ${draft.priceCurrency ?? ""}`.trimEnd(),
  );
  console.log(`${DIM}unit:      ${RESET}${draft.unit ?? "—"}`);
  console.log(`${DIM}image:     ${RESET}${draft.imageUrl ? "есть" : "—"}`);
  console.log(`${DIM}url:       ${RESET}${draft.productUrl}`);

  const attrs = Object.entries(draft.attrs);
  console.log(`${DIM}attrs (${attrs.length}):${RESET}`);
  if (attrs.length === 0) console.log("  —");
  for (const [key, value] of attrs) console.log(`  ${key}: ${value}`);

  if (draft.ambiguous.length > 0) {
    console.log(`${DIM}ambiguous:${RESET}`);
    for (const item of draft.ambiguous) {
      const values = item.values.length > 0 ? ` [${item.values.join(" / ")}]` : "";
      console.log(`  ${item.field}${values} (${item.reason})`);
    }
  }

  console.log(`${DIM}sources:   ${RESET}${draft.usedSources.join(", ") || "—"}`);
  console.log(`${DIM}evidence:  ${RESET}${draft.evidence.length} записей`);
}

function printEvidence(draft: MaterialImportDraft): void {
  for (const item of draft.evidence) {
    const value = item.value.length > 60 ? `${item.value.slice(0, 57)}…` : item.value;
    console.log(`  ${item.source.padEnd(8)} ${item.field} = ${value}`);
  }
}

/* ------------------------------------------------------------------ */
/*  Основной проход                                                    */
/* ------------------------------------------------------------------ */

async function main(): Promise<void> {
  loadEnvLocal();

  const args = process.argv.slice(2).filter((arg) => !arg.startsWith("-"));
  const cases: Case[] =
    args.length > 0
      ? args.map((url) => ({
          title: url,
          url,
          expected: "без специфичных проверок",
          checks: [],
        }))
      : CASES;

  const hasKey = Boolean(process.env.DEEPSEEK_API_KEY?.trim());
  const hasReader = isPageReaderConfigured();
  console.log(`Модель: ${process.env.DEEPSEEK_MODEL?.trim() || "deepseek-flash"}`);
  console.log(
    hasKey
      ? "DEEPSEEK_API_KEY найден — слой LLM будет использован."
      : `${YELLOW}DEEPSEEK_API_KEY не найден — работаем только на детерминированном слое.${RESET}`,
  );
  console.log(
    hasReader
      ? "FIRECRAWL_API_KEY найден — fallback-читатель страниц доступен."
      : `${YELLOW}FIRECRAWL_API_KEY не найден — fallback-читатель будет пропущен (SPA-страницы останутся почти пустыми).${RESET}`,
  );
  console.log(`${DIM}Запросы к внешним сайтам идут от вашей машины.${RESET}`);

  let failures = 0;

  for (const testCase of cases) {
    heading(testCase.title);
    console.log(`${DIM}Ожидается: ${testCase.expected}${RESET}`);

    const started = Date.now();
    const result = await runImportPipeline(testCase.url, {
      // Читатель — тот же, что и в проде: Firecrawl как fallback.
      reader: createDefaultPageReader(),
    });
    const elapsed = Date.now() - started;

    if (!result.ok) {
      failures += 1;
      console.log(`${RED}ИМПОРТ НЕ УДАЛСЯ${RESET}: ${result.failure.code}${
        result.failure.status ? ` (HTTP ${result.failure.status})` : ""
      }${result.failure.detail ? ` — ${result.failure.detail}` : ""}`);
      continue;
    }

    console.log(
      `${DIM}слои:${RESET} deterministic=${result.layers.deterministic} reader=${result.layers.reader} ai=${result.layers.ai} ${DIM}(${elapsed} мс)${RESET}`,
    );
    printDraft(result.draft);

    if (result.draft.evidence.length > 0) {
      console.log(`${DIM}evidence:${RESET}`);
      printEvidence(result.draft);
    }

    if (result.warnings.length > 0) {
      console.log(`${YELLOW}предупреждения:${RESET}`);
      for (const warning of result.warnings) console.log(`  • ${warning}`);
    }

    if (testCase.checks.length > 0) {
      console.log(`${DIM}проверки:${RESET}`);
      for (const check of testCase.checks) {
        const outcome = check.run(result.draft);
        if (!outcome.ok) failures += 1;
        const mark = outcome.ok ? `${GREEN}OK  ${RESET}` : `${RED}FAIL${RESET}`;
        console.log(`  ${mark} ${check.name} — ${outcome.detail}`);
      }
    }
  }

  heading(failures === 0 ? `${GREEN}Все проверки пройдены.${RESET}` : `${RED}Провалов: ${failures}${RESET}`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error: unknown) => {
  console.error(`${RED}Скрипт упал:${RESET}`, error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
