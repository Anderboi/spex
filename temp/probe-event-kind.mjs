// Разовая проверка ограничения kind: принимает ли БД указанный тип события
// и по-прежнему ли отвергает неизвестный.
//
// Запуск: node temp/probe-event-kind.mjs <kind>
// Пример:  node temp/probe-event-kind.mjs variant_added
//
// Строки создаются и удаляются за собой.
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
const kind = process.argv[2];

if (!kind) {
  console.log("укажите kind: node temp/probe-event-kind.mjs <kind>");
  process.exitCode = 1;
  process.exit();
}

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

async function insertEvent(value) {
  return rest("spec_item_events", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify([
      { org_id: orgId, spec_item_id: specItemId, kind: value },
    ]),
  });
}

let orgId = null;
let specItemId = null;

try {
  const item = await rest(
    "spec_items?select=id,org_id&deleted_at=is.null&limit=1",
  );
  if (!item.body?.[0]) throw new Error("в spec_items нет ни одной позиции");
  specItemId = item.body[0].id;
  orgId = item.body[0].org_id;

  const accepted = await insertEvent(kind);
  if (accepted.status < 300) created.push(accepted.body[0].id);
  check(
    `CHECK принимает ${kind}`,
    accepted.status < 300,
    `status=${accepted.status} code=${pgCode(accepted.body)}`,
  );

  const rejected = await insertEvent("not_a_real_kind");
  if (rejected.status < 300) created.push(rejected.body[0].id);
  check(
    "CHECK по-прежнему отвергает неизвестный kind",
    pgCode(rejected.body) === "23514",
    `code=${pgCode(rejected.body)}`,
  );
} catch (error) {
  check("проба выполнена без исключений", false, String(error));
} finally {
  for (const id of created) {
    await rest(`spec_item_events?id=eq.${id}`, { method: "DELETE" });
  }

  const left = await rest(
    `spec_item_events?select=id&kind=eq.${kind}&actor_name_snapshot=is.null`,
  );
  console.log(
    `уборка: временных строк не осталось (${kind} без автора в таблице: ${left.body?.length ?? "?"})`,
  );

  const failed = results.filter((ok) => !ok).length;
  console.log(`\nитог: ${results.length - failed}/${results.length} проверок пройдено`);
  process.exitCode = failed === 0 ? 0 : 1;
}
