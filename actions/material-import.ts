"use server";

/**
 * Server action импорта материала по URL.
 *
 * Модуль намеренно отделён от `actions/materials.ts`: тот отвечает за обычный
 * CRUD библиотеки, а здесь живёт единственная операция — «прочитать внешнюю
 * страницу и вернуть черновик». Смешивать их значило бы тащить сетевой
 * скрапинг в модуль, который сейчас предсказуемо быстрый и полностью локальный.
 *
 * Ключевое свойство: **этот экшен ничего не пишет в базу.** Он только читает
 * внешнюю страницу и возвращает `MaterialImportDraft`, который превращается в
 * initial values существующей формы. Сохранение выполняет прежний
 * `upsertMaterial` — единственный путь записи в `materials`.
 *
 * Директива `"use server"` одновременно служит маркером «только сервер»: модуль
 * использует `node:dns` и серверные ключи, и в клиентский бандл он попасть не
 * может по построению.
 */

import { z } from "zod";
import { ok, fail, type ActionResult } from "@/lib/action-result";
import { requireOrgBySlug } from "@/lib/auth/session";
import { can } from "@/lib/permissions";
import { describeImportFailure } from "@/lib/material-import/failure-messages";
import { runImportPipeline } from "@/lib/material-import/pipeline";
import { MAX_URL_LENGTH } from "@/lib/material-import/guards";
import type { MaterialImportDraft } from "@/lib/material-import/draft";

/**
 * Схема входа. Проверяем только форму строки: настоящая политика адресов
 * (протокол, порт, приватные диапазоны, DNS) живёт в `guards.ts`, потому что
 * она требует сети и потому что её нужно применять ещё и к редиректам.
 *
 * Схема не экспортируется: в файле с `"use server"` экспортировать можно только
 * асинхронные функции — всё остальное Next считает ошибкой сборки.
 */
const materialImportRequestSchema = z.object({
  url: z
    .string()
    .trim()
    .min(1, "Вставьте ссылку на страницу товара")
    .max(MAX_URL_LENGTH, "Ссылка слишком длинная"),
});

export type MaterialImportRequest = z.infer<typeof materialImportRequestSchema>;

/**
 * Результат импорта для клиента.
 *
 * `draft` — НЕдоверенные данные с внешнего сайта. Они предназначены только для
 * заполнения формы и обязательно проходят через `materialSchema` при сохранении.
 */
export type MaterialImportResult = {
  draft: MaterialImportDraft;
  /** Что стоит проверить руками (спорный вариант, отсутствующие поля). */
  warnings: string[];
  /** Какие слои конвейера отработали — для отладки и будущего UI. */
  layers: { deterministic: boolean; jina: boolean; ai: boolean };
};

/**
 * Импортирует страницу товара и возвращает черновик материала.
 *
 * Права проверяются до выхода в сеть: импорт создаёт исходящий запрос от имени
 * сервера, поэтому пользователь без права создавать материалы не должен иметь
 * возможности использовать его как прокси.
 */
export async function importMaterialFromUrl(
  orgSlug: string,
  input: MaterialImportRequest,
): Promise<ActionResult<MaterialImportResult>> {
  const parsed = materialImportRequestSchema.safeParse(input);
  if (!parsed.success) {
    return fail(
      parsed.error.issues[0]?.message ?? "Некорректная ссылка",
      "INVALID_INPUT",
    );
  }

  const ctx = await requireOrgBySlug(orgSlug);
  if (!can(ctx.role, "record:create")) {
    return fail("Недостаточно прав для импорта материала", "FORBIDDEN");
  }

  const result = await runImportPipeline(parsed.data.url);

  if (!result.ok) {
    const described = describeImportFailure(
      result.failure.code,
      result.failure.status,
    );
    if (result.failure.detail) {
      console.error("[importMaterialFromUrl]", result.failure.code, result.failure.detail);
    }
    return fail(`${described.message}. ${described.hint}`, "IMPORT_FAILED");
  }

  return ok({
    draft: result.draft,
    warnings: result.warnings,
    layers: result.layers,
  });
}
