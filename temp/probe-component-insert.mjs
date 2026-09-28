// Разовая проверка модели состава: можно ли добавить две одинаковые строки
// (уникальности нет?) и как ведут себя FK/CHECK при некорректной вставке.
//
// Запуск: node temp/probe-component-insert.mjs
//
// Все созданные строки удаляются за собой.
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")];
    }),
);

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;

async function rest(path, init = {}) {
  const res = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

const pgCode = (body) => (body && typeof body === "object" ? body.code : null);

const results = [];
function check(name, condition, detail = "") {
  results.push(Boolean(condition));
  console.log(
    `${condition ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`,
  );
}

const created = [];

function insert(row) {
  return rest("spec_item_components", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify([row]),
  });
}

let items = [];

try {
  const res = await rest(
    "spec_items?select=id,org_id,project_id&deleted_at=is.null&limit=2",
  );
  items = res.body ?? [];
  if (items.length === 0) throw new Error("в spec_items нет ни одной позиции");

  const item = items[0];
  const other = items[1] ?? item;

  const base = {
    org_id: item.org_id,
    spec_item_id: item.id,
    kind: "component",
    name: "Проба: одинаковые строки",
    cost: 10,
    position: 9999,
  };

  // 1. Две одинаковые строки: уникальности по (spec_item_id, name) нет.
  const first = await insert(base);
  if (first.status < 300) created.push(first.body[0].id);
  const second = await insert(base);
  if (second.status < 300) created.push(second.body[0].id);

  check(
    "две одинаковые строки состава вставляются (уникальности нет)",
    first.status < 300 && second.status < 300,
    `status=${first.status}/${second.status}`,
  );
  check(
    "повторная вставка даёт отдельные строки с разными id",
    first.body?.[0]?.id !== second.body?.[0]?.id,
  );

  // 2. Нарушение CHECK: ссылка без ref_spec_item_id.
  const badCheck = await insert({
    ...base,
    name: "Проба: битый CHECK",
    kind: "spec_ref",
    ref_spec_item_id: null,
  });
  if (badCheck.status < 300) created.push(badCheck.body[0].id);
  check(
    "ссылка без ref_spec_item_id отклоняется CHECK",
    pgCode(badCheck.body) === "23514",
    `code=${pgCode(badCheck.body)}`,
  );

  // 3. Нарушение FK: несуществующая позиция-владелец.
  const badFk = await insert({
    ...base,
    name: "Проба: битый FK",
    spec_item_id: "00000000-0000-0000-0000-000000000000",
  });
  if (badFk.status < 300) created.push(badFk.body[0].id);
  check(
    "чужая/несуществующая позиция отклоняется FK",
    pgCode(badFk.body) === "23503",
    `code=${pgCode(badFk.body)}`,
  );

  // 4. Ссылка на существующую позицию проекта вставляется.
  const ref = await insert({
    ...base,
    name: "spec_ref",
    kind: "spec_ref",
    ref_spec_item_id: other.id,
    position: 9998,
  });
  if (ref.status < 300) created.push(ref.body[0].id);
  check(
    "ссылка на существующую позицию вставляется",
    ref.status < 300,
    `status=${ref.status} code=${pgCode(ref.body)}`,
  );
} catch (error) {
  check("проба выполнена без исключений", false, String(error));
} finally {
  for (const id of created) {
    await rest(`spec_item_components?id=eq.${id}`, { method: "DELETE" });
  }

  const left = await rest(
    "spec_item_components?select=id&name=like.*Проба*",
  );
  const leftRefs = await rest(
    "spec_item_components?select=id&name=eq.spec_ref&position=in.(9998,9999)",
  );
  console.log(
    `уборка: временных строк не осталось (Проба: ${left.body?.length ?? "?"}, spec_ref: ${leftRefs.body?.length ?? "?"})`,
  );

  const failed = results.filter((ok) => !ok).length;
  console.log(
    `\nитог: ${results.length - failed}/${results.length} проверок пройдено`,
  );
  process.exitCode = failed === 0 ? 0 : 1;
}
