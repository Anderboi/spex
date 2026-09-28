// Разовая проверка удаления сервисной операции:
//   * отдаёт ли DELETE удалённую строку операции (снимок для истории);
//   * отдаёт ли DELETE удалённые связки их spec_item_id (снимок списка позиций);
//   * уносит ли каскад FK связки вместе с операцией;
//   * повторное удаление и удаление несуществующей операции — пустой ответ;
//   * не меняются ли при удалении статусы связанных позиций.
//
// Запуск: node temp/probe-service-operation-delete.mjs
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

const results = [];
function check(name, condition, detail = "") {
  results.push(Boolean(condition));
  console.log(
    `${condition ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`,
  );
}

const createdOps = [];

async function insertOp(project, name) {
  const res = await rest("service_operations", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify([
      {
        org_id: project.org_id,
        project_id: project.id,
        type: "service",
        name,
        amount: 1234,
        completed: false,
      },
    ]),
  });
  if (res.status < 300) createdOps.push(res.body[0].id);
  return res.body?.[0]?.id ?? null;
}

async function insertLinks(opId, itemIds) {
  return rest("service_operation_items", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(
      itemIds.map((spec_item_id) => ({ operation_id: opId, spec_item_id })),
    ),
  });
}

try {
  const items = await rest(
    "spec_items?select=id,org_id,project_id,status,updated_at&deleted_at=is.null&limit=2",
  );
  const [item1, item2] = items.body ?? [];
  if (!item1) throw new Error("в spec_items нет ни одной позиции");
  const project = { id: item1.project_id, org_id: item1.org_id };

  // ── A. Каскад: операция удаляется без явного удаления связок ──────────
  const opA = await insertOp(project, "Проба: каскад связок");
  await insertLinks(opA, [item1.id, item2?.id ?? item1.id]);

  const beforeLinks = await rest(
    `service_operation_items?select=spec_item_id&operation_id=eq.${opA}`,
  );
  check(
    "связки созданы",
    (beforeLinks.body?.length ?? 0) === (item2 ? 2 : 1),
    `links=${beforeLinks.body?.length}`,
  );

  const deletedA = await rest(
    `service_operations?id=eq.${opA}&select=id,type,name,amount`,
    { method: "DELETE", headers: { Prefer: "return=representation" } },
  );
  const removedA = Array.isArray(deletedA.body) ? deletedA.body[0] : null;
  check(
    "DELETE операции отдаёт удалённую строку со снимком",
    deletedA.status < 300 &&
      removedA?.id === opA &&
      removedA?.type === "service" &&
      removedA?.amount === 1234,
    JSON.stringify(removedA),
  );

  const afterLinks = await rest(
    `service_operation_items?select=spec_item_id&operation_id=eq.${opA}`,
  );
  check(
    "связки уехали каскадом вместе с операцией",
    (afterLinks.body?.length ?? -1) === 0,
    `links=${afterLinks.body?.length}`,
  );

  // Повторное удаление и удаление несуществующей операции.
  const twice = await rest(
    `service_operations?id=eq.${opA}&select=id`,
    { method: "DELETE", headers: { Prefer: "return=representation" } },
  );
  check(
    "повторное удаление отдаёт пустой массив",
    twice.status < 300 && Array.isArray(twice.body) && twice.body.length === 0,
    `body=${JSON.stringify(twice.body)}`,
  );

  const foreign = await rest(
    "service_operations?id=eq.00000000-0000-0000-0000-000000000000&select=id",
    { method: "DELETE", headers: { Prefer: "return=representation" } },
  );
  check(
    "несуществующая операция отдаёт пустой массив",
    foreign.status < 300 && Array.isArray(foreign.body) && foreign.body.length === 0,
    `body=${JSON.stringify(foreign.body)}`,
  );

  // ── B. Снимок связок: удаление связок отдаёт их spec_item_id ──────────
  const opB = await insertOp(project, "Проба: снимок связок");
  await insertLinks(opB, [item1.id]);

  const deletedLinks = await rest(
    `service_operation_items?operation_id=eq.${opB}&select=spec_item_id`,
    { method: "DELETE", headers: { Prefer: "return=representation" } },
  );
  const linkIds = (deletedLinks.body ?? []).map((r) => r.spec_item_id);
  check(
    "удаление связок отдаёт их spec_item_id для снимка",
    deletedLinks.status < 300 && linkIds.includes(item1.id),
    `ids=${JSON.stringify(linkIds)}`,
  );

  const opBStillThere = await rest(
    `service_operations?select=id,completed&id=eq.${opB}`,
  );
  check(
    "связки удаляются раньше операции: сама операция на месте",
    opBStillThere.body?.[0]?.id === opB,
  );

  // ── C. Удаление не меняет связанные позиции ───────────────────────────
  const itemAfter = await rest(
    `spec_items?select=status,updated_at&id=eq.${item1.id}`,
  );
  check(
    "статус и updated_at связанной позиции не изменились",
    itemAfter.body?.[0]?.status === item1.status &&
      itemAfter.body?.[0]?.updated_at === item1.updated_at,
    `было ${item1.status}/${item1.updated_at}, стало ${itemAfter.body?.[0]?.status}/${itemAfter.body?.[0]?.updated_at}`,
  );
} catch (error) {
  check("проба выполнена без исключений", false, String(error));
} finally {
  for (const id of createdOps) {
    await rest(`service_operations?id=eq.${id}`, { method: "DELETE" });
  }
  const left = await rest(
    "service_operations?select=id&name=like.*Проба: каскад связок*",
  );
  const leftLinks = await rest("service_operation_items?select=operation_id");
  console.log(
    `уборка: временных операций не осталось (${left.body?.length ?? "?"}); связок в таблице: ${leftLinks.body?.length ?? "?"}`,
  );

  const failed = results.filter((ok) => !ok).length;
  console.log(
    `\nитог: ${results.length - failed}/${results.length} проверок пройдено`,
  );
  process.exitCode = failed === 0 ? 0 : 1;
}
