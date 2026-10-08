import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Конфиг Vitest для unit-тестов проекта.
 *
 * ── Зачем он появился ──────────────────────────────────────────────────────
 *
 * До этого конфига не было вовсе, и тесты запускались только на CLI-опциях
 * (`--pool=threads --environment happy-dom --exclude 'scripts/**'` в
 * `package.json`). Все тесты при этом импортировали код ОТНОСИТЕЛЬНЫМИ путями
 * (`./file-content`, `../validations`), потому что алиас `@/` из `tsconfig.json`
 * Vitest без конфига не знает — в проекте он настроен только для сборщика Next.
 *
 * Server actions живут под `@/`: они импортируют `@/lib/...` и `next/cache`,
 * поэтому протестировать их без описания алиаса невозможно. Алиас повторяет
 * `compilerOptions.paths` из `tsconfig.json` (`"@/*": ["./*"]`) — второго
 * источника истины не появляется: если пути в tsconfig изменятся, править
 * придётся оба места, и это отмечено здесь явно.
 *
 * ── Что намеренно НЕ перенесено из CLI ─────────────────────────────────────
 *
 * Окружение и исключение `scripts/**` остаются в `package.json`, потому что
 * отдельные запуски (`npx vitest run <файл>`) задают их флагами. Оставленные
 * здесь значения повторяют CLI, а не заменяют его: поведение `npm test` от
 * появления конфига не меняется.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
      /**
       * `server-only` есть только внутри сборки Next: пакета нет в
       * `node_modules`, и Vitest не может его разрешить. Без алиаса любой тест,
       * который транзитивно доходит до `lib/auth/session.ts` или
       * `lib/db/guard.ts` (например, через тип `SpecBuilderContext`), падает на
       * импорте. Заглушка — пустой модуль: ограничение «только сервер»
       * относится к сборке, а не к поведению кода.
       */
      "server-only": fileURLToPath(
        new URL("./tests/stubs/server-only.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "happy-dom",
    /**
     * `integration/**` исключён намеренно: интеграционные тесты пишут в живую БД
     * и Storage, у них свой конфиг (`vitest.integration.config.mts`) и запуск
     * только вручную. Без этой строки список `exclude` из конфига
     * ПЕРЕОПРЕДЕЛЯЕТ CLI-опцию `--exclude` из `package.json`, и живой тест
     * попадал бы в обычный прогон `npm test`.
     */
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "scripts/**",
      "integration/**",
    ],
  },
});
