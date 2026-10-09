import { describe, expect, it } from "vitest";
import {
  canMutatePayment,
  canRecordPayment,
  isForeignPayment,
} from "./payment-permissions";

/**
 * Права на оплату как UI-гейт: правило проверяется без React и без БД.
 *
 * Цель — зафиксировать матрицу, а не реализацию: `viewer` не вносит и не правит
 * даже свою запись, `member` правит только свою, чужие записи — `owner`/`admin`.
 * То же правило проверяет сервер (`actions/spec-item-payments.ts`), и здесь оно
 * читается как контракт интерфейса.
 */

const AUTHOR = "user-1";
const OTHER = "user-2";

describe("canRecordPayment", () => {
  it("вносить может любой член, кроме наблюдателя", () => {
    expect(canRecordPayment({ role: "owner" })).toBe(true);
    expect(canRecordPayment({ role: "admin" })).toBe(true);
    expect(canRecordPayment({ role: "member" })).toBe(true);
    expect(canRecordPayment({ role: "viewer" })).toBe(false);
  });

  it("вне организации права нет", () => {
    expect(canRecordPayment({ role: null })).toBe(false);
  });
});

describe("canMutatePayment", () => {
  it("автор правит свою запись", () => {
    expect(
      canMutatePayment({ role: "member", userId: AUTHOR, createdBy: AUTHOR }),
    ).toBe(true);
  });

  it("участник не правит чужую запись", () => {
    expect(
      canMutatePayment({ role: "member", userId: AUTHOR, createdBy: OTHER }),
    ).toBe(false);
  });

  it("владелец и администратор правят чужую запись", () => {
    for (const role of ["owner", "admin"] as const) {
      expect(canMutatePayment({ role, userId: AUTHOR, createdBy: OTHER })).toBe(
        true,
      );
    }
  });

  it("наблюдатель не правит даже свою запись", () => {
    // Граница та же, что у `canMutateRecord`: авторство не даёт права записи
    // роли, у которой его нет. Иначе понижение до viewer оставило бы доступ.
    expect(
      canMutatePayment({ role: "viewer", userId: AUTHOR, createdBy: AUTHOR }),
    ).toBe(false);
  });

  it("запись без автора правит только администратор", () => {
    expect(
      canMutatePayment({ role: "member", userId: AUTHOR, createdBy: null }),
    ).toBe(false);
    expect(
      canMutatePayment({ role: "admin", userId: AUTHOR, createdBy: null }),
    ).toBe(true);
  });
});

describe("isForeignPayment", () => {
  it("чужая запись отличается от своей", () => {
    expect(isForeignPayment({ userId: AUTHOR, createdBy: OTHER })).toBe(true);
    expect(isForeignPayment({ userId: AUTHOR, createdBy: AUTHOR })).toBe(false);
  });

  it("запись без автора чужой не считается: владельца, который её защищает, нет", () => {
    expect(isForeignPayment({ userId: AUTHOR, createdBy: null })).toBe(false);
  });
});
