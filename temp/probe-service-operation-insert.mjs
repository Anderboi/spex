// Разовая проверка модели сервисных операций: разрешены ли одинаковые операции,
// какие ограничения ловят некорректную вставку и что даёт повторная связка
// «операция ⇄ позиция».
//
// Запуск: node temp/probe-service-operation-insert.mjs
//
// Все созданные строки удаляются за собой (связки уезжают каскадом по FK).
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

const pgCode = (body) =>
  body && typeof body === "object" && !Array.isArray(body) ? body.code : null;

const results = [];
function check(name, condition, detail = "") {
  results.push(Boolean(condition));
  console.log(
    `${condition ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`,
  );
}

const createdOps = [];
const createdLinks = [];

const insertOp = (row) =>
  rest("service_operations", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify([row]),
  });

const insertLink = (row) =>
  rest("service_operation_items", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify([row]),
  });

try {
  const items = await rest(
    "spec_items?select=id,org_id,project_id&deleted_at=is.null&limit=2",
  );
  const [item1, item2] = items.body ?? [];
  if (!item1) throw new Error("в spec_items нет ни одной позиции");
  const project = { id: item1.project_id, org_id: item1.org_id };

  const base = {
    org_id: project.org_id,
    project_id: project.id,
    type: "service",
    name: "Проба: одна и та же услуга",
    amount: 1000,
    completed: false,
  };

  // 1. Две одинаковые операции: уникальности нет.
  const first = await insertOp(base);
  if (first.status < 300) createdOps.push(first.body[0].id);
  const second = await insertOp(base);
  if (second.status < 300) createdOps.push(second.body[0].id);

  check(
    "две одинаковые операции вставляются (уникальности нет)",
    first.status < 300 && second.status < 300,
    `status=${first.status}/${second.status}`,
  );
  check(
    "повторное создание даёт отдельные операции",
    first.body?.[0]?.id !== second.body?.[0]?.id,
  );

  const opId = first.body?.[0]?.id;

  // 2. Связка «операция ⇄ позиция» уникальна: повтор даёт 23505.
  const link1 = await insertLink({
    operation_id: opId,
    spec_item_id: item1.id,
  });
  if (link1.status < 300) createdLinks.push([opId, item1.id]);
  const linkAgain = await insertLink({
    operation_id: opId,
    spec_item_id: item1.id,
  });
  check(
    "повторная связка той же позиции отклоняется (PK)",
    link1.status < 300 && pgCode(linkAgain.body) === "23505",
    `code=${pgCode(linkAgain.body)}`,
  );

  // 3. Одна позиция может быть в разных операциях.
  const link2 = await insertLink({
    operation_id: second.body?.[0]?.id,
    spec_item_id: item1.id,
  });
  if (link2.status < 300) createdLinks.push([second.body[0].id, item1.id]);
  check(
    "та же позиция в другой операции разрешена",
    link2.status < 300,
    `status=${link2.status} code=${pgCode(link2.body)}`,
  );

  // 4. CHECK: своя услуга без названия.
  const noName = await insertOp({ ...base, name: null });
  if (noName.status < 300) createdOps.push(noName.body[0].id);
  check(
    "своя услуга без названия отклоняется CHECK",
    pgCode(noName.body) === "23514",
    `code=${pgCode(noName.body)}`,
  );

  // 5. CHECK: неизвестный тип.
  const badType = await insertOp({ ...base, type: "bogus" });
  if (badType.status < 300) createdOps.push(badType.body[0].id);
  check(
    "неизвестный тип операции отклоняется CHECK",
    pgCode(badType.body) === "23514",
    `code=${pgCode(badType.body)}`,
  );

  // 6. CHECK: у доставки не может быть своего названия.
  const deliveryNamed = await insertOp({
    ...base,
    type: "delivery",
    name: "Доставка",
  });
  if (deliveryNamed.status < 300) createdOps.push(deliveryNamed.body[0].id);
  check(
    "доставка с собственным названием отклоняется CHECK",
    pgCode(deliveryNamed.body) === "23514",
    `code=${pgCode(deliveryNamed.body)}`,
  );

  // 7. FK: связка с несуществующей операцией.
  const badLink = await insertLink({
    operation_id: "00000000-0000-0000-0000-000000000000",
    spec_item_id: item2?.id ?? item1.id,
  });
  check(
    "связка с несуществующей операцией отклоняется FK",
    pgCode(badLink.body) === "23503",
    `code=${pgCode(badLink.body)}`,
  );
} catch (error) {
  check("проба выполнена без исключений", false, String(error));
} finally {
  for (const [opId, itemId] of createdLinks) {
    await rest(
      `service_operation_items?operation_id=eq.${opId}&spec_item_id=eq.${itemId}`,
      { method: "DELETE" },
    );
  }
  for (const id of createdOps) {
    await rest(`service_operations?id=eq.${id}`, { method: "DELETE" });
  }

  const leftOps = await rest(
    "service_operations?select=id&name=like.*Проба: одна и та же услуга*",
  );
  const leftLinks = await rest("service_operation_items?select=operation_id");
  console.log(
    `уборка: временных операций не осталось (${leftOps.body?.length ?? "?"}); связок в таблице: ${leftLinks.body?.length ?? "?"}`,
  );

  const failed = results.filter((ok) => !ok).length;
  console.log(
    `\nитог: ${results.length - failed}/${results.length} проверок пройдено`,
  );
  process.exitCode = failed === 0 ? 0 : 1;
}
