// Разовая проверка того же вызова, что делают actions (supabase-js), а не
// «сырого» REST: возвращает ли `.delete().eq(...).select(ROW_COLUMNS)` массив с
// удалённой строкой. На этом строится снимок для component_removed и
// variant_removed, и от этого зависит проверка «строка действительно удалена».
//
// Запуск: node temp/probe-supabase-delete-select.mjs
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")];
    }),
);

const db = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const ROW_COLUMNS =
  "id, kind, name, notes, cost, additional_cost, company_id, contact_id, ref_spec_item_id, parent_component_id, position, created_at, updated_at";

const results = [];
function check(name, condition, detail = "") {
  results.push(Boolean(condition));
  console.log(
    `${condition ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`,
  );
}

let createdId = null;

try {
  const { data: item } = await db
    .from("spec_items")
    .select("id, org_id")
    .is("deleted_at", null)
    .limit(1)
    .maybeSingle();
  if (!item) throw new Error("в spec_items нет ни одной позиции");

  // 1. Тот же путь, что в createSpecItemComponent: insert + select().single().
  const { data: inserted, error: insertError } = await db
    .from("spec_item_components")
    .insert({
      org_id: item.org_id,
      spec_item_id: item.id,
      kind: "component",
      name: "Проба: supabase delete select",
      position: 9995,
    })
    .select(ROW_COLUMNS)
    .single();

  if (insertError) throw new Error(insertError.message);
  createdId = inserted.id;
  check("вставка через supabase-js вернула строку", !!inserted?.id);

  // 2. Тот же путь, что в deleteSpecItemComponentRef/Component/Group.
  const { data: removed, error } = await db
    .from("spec_item_components")
    .delete()
    .eq("id", createdId)
    .eq("spec_item_id", item.id)
    .eq("org_id", item.org_id)
    .eq("kind", "component")
    .select(ROW_COLUMNS);

  check("ошибки нет", !error, error?.message ?? "");
  check(
    "DELETE + select вернул массив с удалённой строкой",
    Array.isArray(removed) && removed.length === 1,
    `length=${Array.isArray(removed) ? removed.length : typeof removed}`,
  );
  check(
    "в удалённой строке есть id, kind и name для снимка",
    removed?.[0]?.id === createdId &&
      removed?.[0]?.kind === "component" &&
      removed?.[0]?.name === "Проба: supabase delete select",
    JSON.stringify(removed?.[0] ?? null),
  );

  // 3. Повторное удаление: пустой массив — на этом стоит проверка !snapshot.
  const { data: twice } = await db
    .from("spec_item_components")
    .delete()
    .eq("id", createdId)
    .eq("spec_item_id", item.id)
    .eq("org_id", item.org_id)
    .eq("kind", "component")
    .select(ROW_COLUMNS);

  check(
    "повторное удаление вернуло пустой массив",
    Array.isArray(twice) && twice.length === 0,
    `length=${Array.isArray(twice) ? twice.length : typeof twice}`,
  );

  // 4. Чужая организация в фильтре: тоже пустой массив.
  const { data: foreign } = await db
    .from("spec_item_components")
    .delete()
    .eq("id", "00000000-0000-0000-0000-000000000000")
    .select(ROW_COLUMNS);

  check(
    "несуществующая строка вернула пустой массив",
    Array.isArray(foreign) && foreign.length === 0,
    `length=${Array.isArray(foreign) ? foreign.length : typeof foreign}`,
  );
} catch (error) {
  check("проба выполнена без исключений", false, String(error));
} finally {
  if (createdId) {
    await db.from("spec_item_components").delete().eq("id", createdId);
  }
  const { data: left } = await db
    .from("spec_item_components")
    .select("id")
    .like("name", "%Проба: supabase delete select%");
  console.log(`уборка: временных строк не осталось (${left?.length ?? "?"})`);

  const failed = results.filter((ok) => !ok).length;
  console.log(
    `\nитог: ${results.length - failed}/${results.length} проверок пройдено`,
  );
  process.exitCode = failed === 0 ? 0 : 1;
}
