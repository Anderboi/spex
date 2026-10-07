import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Конфиг интеграционных тестов: ЖИВАЯ БД и ЖИВОЙ Storage linked-проекта.
 *
 * ── Почему отдельно от unit-тестов ─────────────────────────────────────────
 *
 * `vitest.config.mts` описывает unit-прогон (`npm test`). Здесь — только то,
 * что требует настоящих сервисов и поэтому НЕ должно попадать в обычный прогон
 * и в CI без окружения: запросы к БД проекта и запись объектов в Storage.
 * Запуск осознанный и вручную:
 *
 *   npx vitest run --config vitest.integration.config.mts
 *
 * Учётные данные берутся из `.env.local` самим тестом (`process.loadEnvFile`),
 * а не подставляются конфигом: конфиг не должен знать про секреты.
 *
 * Алиас `@/` описан так же, как в `vitest.config.mts`, — конфиги независимы,
 * чтобы случайный запуск unit-конфига не захватил интеграционный файл, и
 * наоборот.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
  test: {
    // Живая сеть: прогон дольше юнит-теста, но всё равно ограничен.
    environment: "node",
    include: ["integration/**/*.int.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // Интеграционные тесты пишут в одну и ту же строку БД, поэтому идут
    // последовательно в одном воркере: параллельный запуск ломал бы
    // предположения о состоянии (и плодил бы мусор).
    fileParallelism: false,
    maxWorkers: 1,
  },
});
