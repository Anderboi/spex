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
import { rehostImage } from "@/lib/material-import/image";
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
 * Наружу уходит только то, что можно показывать: сам черновик и служебные
 * признаки. Внутренности конвейера (адреса, коды отказа, слой LLM, ключи)
 * остаются на сервере — в лог пишется техническая причина, в ответ идёт
 * человеческая формулировка.
 *
 * `draft` — НЕдоверенные данные с внешнего сайта. Они предназначены только для
 * заполнения формы и обязательно проходят через `materialSchema` при сохранении.
 */
export type MaterialImportResult = {
  draft: MaterialImportDraft;
  /**
   * Ключ этого результата импорта. Уникален для каждой попытки: повторный
   * импорт той же ссылки после правок обязан сбросить форму заново, поэтому
   * ключ не может быть самим URL.
   */
  draftKey: string;
  /**
   * Понятные предупреждения конвейера: что не удалось определить, что осталось
   * пустым, что не перенеслось. Тексты уже человеческие — внутренние коды в них
   * не попадают.
   */
  warnings: string[];
  /** Признак успешного перехостинга изображения (для предупреждений в форме). */
  imageRehosted: boolean;
  /** Какие слои конвейера отработали — для отладки и служебных сообщений. */
  layers: { deterministic: boolean; jina: boolean; ai: boolean };
};

/**
 * Импортирует страницу товара и возвращает черновик материала.
 *
 * Права проверяются до выхода в сеть: импорт создаёт исходящий запрос от имени
 * сервера, поэтому пользователь без права создавать материалы не должен иметь
 * возможности использовать его как прокси.
 *
 * Экшен НИЧЕГО не пишет в базу: сохранение делает прежний `upsertMaterial`
 * после явного нажатия Save в форме.
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

  // Перехостинг подключаем здесь, а не внутри конвейера: конвейер не должен
  // знать про Supabase и остаётся проверяемым в unit-тестах.
  const result = await runImportPipeline(parsed.data.url, {
    orgId: ctx.orgId,
    rehostImage,
  });

  if (!result.ok) {
    const described = describeImportFailure(
      result.failure.code,
      result.failure.status,
    );
    // Техническая причина — только в серверный лог.
    if (result.failure.detail) {
      console.error("[importMaterialFromUrl]", result.failure.code, result.failure.detail);
    }
    return fail(`${described.message}. ${described.hint}`, "IMPORT_FAILED");
  }

  return ok({
    draft: result.draft,
    // `crypto.randomUUID()` доступен и в серверном рантайме Node.
    draftKey: `import-${crypto.randomUUID()}`,
    warnings: result.warnings,
    imageRehosted: result.imageRehosted,
    layers: result.layers,
  });
}
