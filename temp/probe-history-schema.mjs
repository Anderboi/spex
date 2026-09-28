// Разовая проверка схемы «Обсуждение и история» на живых таблицах.
// Создаём временные строки и удаляем их за собой (в finally), чтобы не
// оставлять мусор в БД. Запуск: node temp/probe-history-schema.mjs
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
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/** Запрос к PostgREST под указанным ключом (service role по умолчанию). */
async function rest(path, init = {}, key = serviceKey) {
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

const insert = (table, rows, key = serviceKey) =>
  rest(
    table,
    {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(rows),
    },
    key,
  );

const remove = (table, filter, key = serviceKey) =>
  rest(`${table}?${filter}`, { method: "DELETE" }, key);

const patch = (table, filter, values, key = serviceKey) =>
  rest(
    `${table}?${filter}`,
    { method: "PATCH", body: JSON.stringify(values) },
    key,
  );

/** Код ошибки Postgres из тела ответа PostgREST. */
const pgCode = (body) => (body && typeof body === "object" ? body.code : null);

const results = [];
function check(name, condition, detail = "") {
  results.push({ name, ok: Boolean(condition) });
  console.log(
    `${condition ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`,
  );
}

// Строки, созданные пробой: удаляются в finally.
const createdEvents = [];
const createdComments = [];

try {
  // ── опора: реальная позиция, к которой можно привязаться ──────────────
  const item = await rest(
    "spec_items?select=id,org_id&deleted_at=is.null&limit=1",
  );
  if (!item.body?.[0]) throw new Error("в spec_items нет ни одной позиции");
  const specItemId = item.body[0].id;
  const orgId = item.body[0].org_id;
  console.log(`опора: spec_item=${specItemId} org=${orgId}\n`);

  // ── 1. таблицы существуют и читаются под service role ─────────────────
  const eventsRead = await rest("spec_item_events?select=id&limit=1");
  check(
    "spec_item_events существует и читается",
    eventsRead.status === 200,
    `status=${eventsRead.status}`,
  );

  const commentsRead = await rest("spec_item_comments?select=id&limit=1");
  check(
    "spec_item_comments существует и читается",
    commentsRead.status === 200,
    `status=${commentsRead.status}`,
  );

  // ── 2. FK на spec_items ───────────────────────────────────────────────
  const badFk = await insert("spec_item_events", [
    {
      org_id: orgId,
      spec_item_id: "00000000-0000-0000-0000-000000000000",
      kind: "created",
    },
  ]);
  check(
    "FK spec_item_id → spec_items отклоняет несуществующую позицию",
    pgCode(badFk.body) === "23503",
    `code=${pgCode(badFk.body)}`,
  );
  // Если ограничение не сработало — строка всё же создалась, уберём её.
  if (badFk.status < 300) createdEvents.push(...badFk.body.map((r) => r.id));

  // ── 3. CHECK на kind ──────────────────────────────────────────────────
  const badKind = await insert("spec_item_events", [
    { org_id: orgId, spec_item_id: specItemId, kind: "not_a_real_kind" },
  ]);
  check(
    "CHECK kind отклоняет неизвестный тип события",
    pgCode(badKind.body) === "23514",
    `code=${pgCode(badKind.body)}`,
  );
  if (badKind.status < 300) createdEvents.push(...badKind.body.map((r) => r.id));

  // ── 4. запись события под service role ────────────────────────────────
  const okEvent = await insert("spec_item_events", [
    {
      org_id: orgId,
      spec_item_id: specItemId,
      kind: "created",
      actor_name_snapshot: "probe",
      payload: { origin: "probe" },
    },
  ]);
  check(
    "валидное событие записывается под service role",
    okEvent.status < 300 && okEvent.body?.[0]?.id,
    `status=${okEvent.status}`,
  );
  if (okEvent.body?.[0]?.id) createdEvents.push(okEvent.body[0].id);

  const payloadRoundTrip = okEvent.body?.[0]?.payload;
  check(
    "payload сохраняется как jsonb-объект",
    payloadRoundTrip && payloadRoundTrip.origin === "probe",
    JSON.stringify(payloadRoundTrip),
  );

  const defaults = okEvent.body?.[0];
  check(
    "created_at заполняется по умолчанию",
    Boolean(defaults?.created_at),
    String(defaults?.created_at),
  );

  // ── 5. RLS: анонимный доступ ──────────────────────────────────────────
  const anonRead = await rest("spec_item_events?select=id", {}, anonKey);
  const anonRows = Array.isArray(anonRead.body) ? anonRead.body.length : null;
  check(
    "RLS: аноним не видит события",
    anonRead.status !== 200 || anonRows === 0,
    `status=${anonRead.status} rows=${anonRows}`,
  );

  const anonInsert = await insert(
    "spec_item_events",
    [{ org_id: orgId, spec_item_id: specItemId, kind: "created" }],
    anonKey,
  );
  check(
    "RLS: аноним не может писать события (append-only)",
    anonInsert.status >= 400,
    `status=${anonInsert.status} code=${pgCode(anonInsert.body)}`,
  );
  if (anonInsert.status < 300)
    createdEvents.push(...anonInsert.body.map((r) => r.id));

  // service role видит созданную строку — RLS его не ограничивает
  const serviceSees = await rest(
    `spec_item_events?select=id&id=eq.${createdEvents[0] ?? "none"}`,
  );
  check(
    "service role читает событие (RLS не ломает server-side доступ)",
    serviceSees.status === 200 && serviceSees.body?.length === 1,
    `rows=${serviceSees.body?.length}`,
  );

  // ── 6. CHECK на body и мягкое удаление комментариев ───────────────────
  const blankBody = await insert("spec_item_comments", [
    {
      org_id: orgId,
      spec_item_id: specItemId,
      body: "   ",
      author_name_snapshot: "probe",
    },
  ]);
  check(
    "CHECK body отклоняет комментарий из пробелов",
    pgCode(blankBody.body) === "23514",
    `code=${pgCode(blankBody.body)}`,
  );
  if (blankBody.status < 300)
    createdComments.push(...blankBody.body.map((r) => r.id));

  const root = await insert("spec_item_comments", [
    {
      org_id: orgId,
      spec_item_id: specItemId,
      body: "probe root",
      author_name_snapshot: "probe",
    },
  ]);
  check(
    "корневой комментарий создаётся",
    root.status < 300 && root.body?.[0]?.id,
    `status=${root.status}`,
  );
  const rootId = root.body?.[0]?.id;
  if (rootId) createdComments.push(rootId);

  const reply = await insert("spec_item_comments", [
    {
      org_id: orgId,
      spec_item_id: specItemId,
      parent_id: rootId,
      root_id: rootId,
      body: "probe reply",
      author_name_snapshot: "probe",
    },
  ]);
  check(
    "ответ на комментарий создаётся (parent_id/root_id)",
    reply.status < 300 && reply.body?.[0]?.id,
    `status=${reply.status}`,
  );
  const replyId = reply.body?.[0]?.id;

  // ── 7. RLS: аноним не правит и не удаляет чужой комментарий ───────────
  // PATCH/DELETE под RLS возвращают 204/[] и когда строка просто не найдена,
  // поэтому судим не по коду ответа, а по фактическому состоянию строки.
  const victim = await insert("spec_item_comments", [
    {
      org_id: orgId,
      spec_item_id: specItemId,
      body: "probe victim",
      author_name_snapshot: "probe",
    },
  ]);
  const victimId = victim.body?.[0]?.id;
  if (victimId) createdComments.push(victimId);

  if (victimId) {
    await rest(
      `spec_item_comments?id=eq.${victimId}`,
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ body: "hacked" }),
      },
      anonKey,
    );
    const afterPatch = await rest(
      `spec_item_comments?select=body&id=eq.${victimId}`,
    );
    check(
      "RLS: аноним не может изменить комментарий",
      afterPatch.body?.[0]?.body === "probe victim",
      `body=${afterPatch.body?.[0]?.body}`,
    );

    await remove("spec_item_comments", `id=eq.${victimId}`, anonKey);
    const afterDelete = await rest(
      `spec_item_comments?select=id&id=eq.${victimId}`,
    );
    check(
      "RLS: аноним не может удалить комментарий",
      afterDelete.body?.length === 1,
      `rows=${afterDelete.body?.length}`,
    );
  }

  // ── 8. каскад: удаление корня уносит ответ ────────────────────────────
  if (rootId && replyId) {
    await remove("spec_item_comments", `id=eq.${rootId}`);
    const orphan = await rest(
      `spec_item_comments?select=id&id=eq.${replyId}`,
    );
    check(
      "ON DELETE CASCADE: ответ удаляется вместе с родителем",
      orphan.body?.length === 0,
      `rows=${orphan.body?.length}`,
    );
    // корень уже удалён — не пытаемся удалить его повторно
    const idx = createdComments.indexOf(rootId);
    if (idx >= 0) createdComments.splice(idx, 1);
    const idx2 = createdComments.indexOf(replyId);
    if (idx2 >= 0) createdComments.splice(idx2, 1);
  }

  const anonComments = await rest("spec_item_comments?select=id", {}, anonKey);
  const anonCommentRows = Array.isArray(anonComments.body)
    ? anonComments.body.length
    : null;
  check(
    "RLS: аноним не видит комментарии",
    anonComments.status !== 200 || anonCommentRows === 0,
    `status=${anonComments.status} rows=${anonCommentRows}`,
  );
} catch (error) {
  check("проба выполнена без исключений", false, String(error));
} finally {
  // ── уборка: удаляем всё, что создали ──────────────────────────────────
  for (const id of createdComments) {
    await remove("spec_item_comments", `id=eq.${id}`);
  }
  for (const id of createdEvents) {
    await remove("spec_item_events", `id=eq.${id}`);
  }

  const leftEvents = await rest("spec_item_events?select=id&actor_name_snapshot=eq.probe");
  const leftComments = await rest(
    "spec_item_comments?select=id&author_name_snapshot=eq.probe",
  );
  check(
    "уборка: временных строк не осталось",
    leftEvents.body?.length === 0 && leftComments.body?.length === 0,
    `events=${leftEvents.body?.length} comments=${leftComments.body?.length}`,
  );

  const failed = results.filter((r) => !r.ok).length;
  console.log(
    `\nитог: ${results.length - failed}/${results.length} проверок пройдено`,
  );
  process.exit(failed === 0 ? 0 : 1);
}
