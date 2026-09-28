// Разовая проверка: возвращает ли PostgREST удалённую строку при
// `Prefer: return=representation` (на этом строится снимок для истории —
// и в удалении варианта, и в удалении строк состава).
//
// Запуск: node temp/probe-delete-representation.mjs
//
// Строка создаётся и удаляется в рамках пробы.
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

const results = [];
function check(name, condition, detail = "") {
  results.push(Boolean(condition));
  console.log(
    `${condition ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`,
  );
}

let createdId = null;

try {
  const items = await rest(
    "spec_items?select=id,org_id&deleted_at=is.null&limit=1",
  );
  const item = items.body?.[0];
  if (!item) throw new Error("в spec_items нет ни одной позиции");

  const inserted = await rest("spec_item_components", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify([
      {
        org_id: item.org_id,
        spec_item_id: item.id,
        kind: "component",
        name: "Проба: представление удаления",
        position: 9997,
      },
    ]),
  });
  createdId = inserted.body?.[0]?.id ?? null;
  check("строка состава создана", inserted.status < 300 && !!createdId);

  // 1. DELETE без representation: тела нет (как в текущем коде).
  const noRep = await rest(
    `spec_item_components?id=eq.${createdId}&select=id`,
    { method: "DELETE", headers: { Prefer: "return=minimal" } },
  );
  check(
    "return=minimal тела не отдаёт",
    noRep.status < 300 && (noRep.body === null || noRep.body === ""),
    `status=${noRep.status} body=${JSON.stringify(noRep.body)}`,
  );

  // 2. Повторная вставка и DELETE с representation — так работает снимок.
  const again = await rest("spec_item_components", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify([
      {
        org_id: item.org_id,
        spec_item_id: item.id,
        kind: "component",
        name: "Проба: представление удаления",
        position: 9996,
      },
    ]),
  });
  createdId = again.body?.[0]?.id ?? null;

  const withRep = await rest(
    `spec_item_components?id=eq.${createdId}&select=id,kind,name,ref_spec_item_id`,
    { method: "DELETE", headers: { Prefer: "return=representation" } },
  );
  const row = Array.isArray(withRep.body) ? withRep.body[0] : null;
  createdId = row?.id ?? createdId;

  check(
    "DELETE с representation отдаёт удалённую строку",
    withRep.status < 300 && !!row,
    `status=${withRep.status} body=${JSON.stringify(withRep.body)}`,
  );
  check(
    "в отданной строке есть нужные для снимка поля",
    row?.kind === "component" && row?.name === "Проба: представление удаления",
    `kind=${row?.kind} name=${row?.name}`,
  );

  // 3. Повторное удаление той же строки: 0 строк в ответе.
  const twice = await rest(
    `spec_item_components?id=eq.${createdId}&select=id`,
    { method: "DELETE", headers: { Prefer: "return=representation" } },
  );
  check(
    "повторное удаление отдаёт пустой массив",
    twice.status < 300 && Array.isArray(twice.body) && twice.body.length === 0,
    `status=${twice.status} body=${JSON.stringify(twice.body)}`,
  );
} catch (error) {
  check("проба выполнена без исключений", false, String(error));
} finally {
  if (createdId) {
    await rest(`spec_item_components?id=eq.${createdId}`, { method: "DELETE" });
  }
  const left = await rest(
    "spec_item_components?select=id&name=like.*Проба: представление*",
  );
  console.log(
    `уборка: временных строк не осталось (${left.body?.length ?? "?"})`,
  );

  const failed = results.filter((ok) => !ok).length;
  console.log(
    `\nитог: ${results.length - failed}/${results.length} проверок пройдено`,
  );
  process.exitCode = failed === 0 ? 0 : 1;
}
