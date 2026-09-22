import { describe, expect, it } from "vitest";
import { updateProfileSchema } from "./validations";

/**
 * Контракт имени пользователя. Схема используется дважды — формой профиля и
 * server action `updateProfile`, — поэтому проверяем именно её: расхождение
 * между UI и сервером здесь означало бы либо «кнопка активна, но сохранение
 * падает», либо запись пустого имени в public.users.name.
 */
describe("updateProfileSchema", () => {
  it("принимает обычное имя", () => {
    const parsed = updateProfileSchema.safeParse({ name: "Анна Лебедева" });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.name).toBe("Анна Лебедева");
  });

  it("обрезает пробелы по краям", () => {
    const parsed = updateProfileSchema.safeParse({ name: "  Анна  " });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.name).toBe("Анна");
  });

  it("отклоняет пустую строку", () => {
    expect(updateProfileSchema.safeParse({ name: "" }).success).toBe(false);
  });

  it("отклоняет строку из одних пробелов", () => {
    expect(updateProfileSchema.safeParse({ name: "   " }).success).toBe(false);
  });

  it("принимает имя длиной 80 и отклоняет 81 символ", () => {
    expect(updateProfileSchema.safeParse({ name: "я".repeat(80) }).success).toBe(
      true,
    );
    expect(updateProfileSchema.safeParse({ name: "я".repeat(81) }).success).toBe(
      false,
    );
  });

  it("считает длину после обрезки пробелов", () => {
    const parsed = updateProfileSchema.safeParse({
      name: `  ${"я".repeat(80)}  `,
    });
    expect(parsed.success).toBe(true);
  });

  it("принимает только имя: роль, чужой user_id и email отбрасываются", () => {
    // Профиль — единственное, что может менять наблюдатель (viewer): действие
    // определяет пользователя по сессии и пишет одно поле. Лишние ключи схема
    // отбрасывает, поэтому ни подменить пользователя, ни выдать себе роль
    // через форму нельзя.
    const parsed = updateProfileSchema.safeParse({
      name: "Анна",
      role: "owner",
      userId: "00000000-0000-0000-0000-000000000000",
      email: "another@studio.ru",
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data).toEqual({ name: "Анна" });
  });
});
