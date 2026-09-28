// Разовая проверка read-layer'а на живом PostgREST — тем же клиентом, что и
// модуль (supabase-js), чтобы проверялся фактический wire-формат:
//   * принимается ли `.or(...)` с курсором (postgrest-js сам оборачивает его
//     в скобки);
//   * совпадает ли порядок `created_at desc, id desc` с ожиданием read-layer,
//     в том числе внутри группы одинаковых created_at;
//   * не даёт ли постраничное чтение дублей и пропусков;
//   * считает ли проекция `parent_id` удалённые ответы.
//
// Запуск: node temp/probe-history-read.mjs
//
// Все созданные строки удаляются за собой; схема не меняется.
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

const results = [];
function check(name, condition, detail = "") {
  results.push(Boolean(condition));
  console.log(
    `${condition ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`,
  );
}

const LATE = "2026-01-01T00:00:00.000001+00:00";
const SAME = "2026-01-01T00:00:00.000000+00:00";
const EARLY = "2025-12-31T23:59:59.999999+00:00";

const ids = {
  late: "11111111-1111-4111-8111-000000000001",
  tieC: "11111111-1111-4111-8111-00000000000c",
  tieB: "11111111-1111-4111-8111-00000000000b",
  tieA: "11111111-1111-4111-8111-00000000000a",
  comment: "22222222-2222-4222-8222-000000000001",
  reply: "22222222-2222-4222-8222-000000000002",
  deletedReply: "22222222-2222-4222-8222-000000000003",
};

const EVENT_COLUMNS =
  "id, org_id, spec_item_id, kind, actor_id, actor_name_snapshot, payload, created_at";
const COMMENT_COLUMNS =
  "id, org_id, spec_item_id, parent_id, root_id, author_id, author_name_snapshot, body, created_at, edited_at, deleted_at";

let orgId = null;
let itemId = null;

/** Все фиксированные id пробы: уборка по ним идемпотентна. */
const PROBE_EVENT_IDS = [ids.late, ids.tieC, ids.tieB, ids.tieA];
const PROBE_COMMENT_IDS = [ids.comment, ids.reply, ids.deletedReply];

/**
 * Уборка по фиксированным id — до и после прогона.
 *
 * Проба может быть прервана (или упасть до finally), поэтому «убрать то, что
 * создали» недостаточно: удаляем весь известный набор и проверяем, что его не
 * осталось.
 */
async function cleanupRows() {
  await db.from("spec_item_events").delete().in("id", PROBE_EVENT_IDS);
  await db.from("spec_item_comments").delete().in("id", PROBE_COMMENT_IDS);

  const events = await db
    .from("spec_item_events")
    .select("id")
    .in("id", PROBE_EVENT_IDS);
  const comments = await db
    .from("spec_item_comments")
    .select("id")
    .in("id", PROBE_COMMENT_IDS);

  return {
    events: events.data?.length ?? -1,
    comments: comments.data?.length ?? -1,
  };
}

/** Курсор — ровно как в history-read.ts. */
const cursorFilter = (before) =>
  `created_at.lt."${before.createdAt}",and(created_at.eq."${before.createdAt}",id.lt."${before.id}")`;

async function queryEvents(before, limit) {
  const base = db
    .from("spec_item_events")
    .select(EVENT_COLUMNS)
    .eq("org_id", orgId)
    .eq("spec_item_id", itemId);
  const scoped = before ? base.or(cursorFilter(before)) : base;
  return scoped
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit);
}

async function queryComments(before, limit) {
  const base = db
    .from("spec_item_comments")
    .select(COMMENT_COLUMNS)
    .eq("org_id", orgId)
    .eq("spec_item_id", itemId);
  const scoped = before ? base.or(cursorFilter(before)) : base;
  return scoped
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit);
}

/** Как в read-layer: сначала свежие, при равенстве — старший id. */
function sortRows(rows) {
  return [...rows].sort((a, b) => {
    if (a.created_at !== b.created_at) return a.created_at < b.created_at ? 1 : -1;
    if (a.id !== b.id) return a.id < b.id ? 1 : -1;
    return 0;
  });
}
try {
  // Следы прерванного прогона убираем до вставки: id фиксированы, поэтому
  // повторный запуск безопасен.
  const before = await cleanupRows();
  console.log(
    `перед прогоном: пробных событий ${before.events}, комментариев ${before.comments}`,
  );

  const itemRes = await db
    .from("spec_items")
    .select("id, org_id")
    .is("deleted_at", null)
    .limit(1)
    .maybeSingle();
  if (!itemRes.data) throw new Error("в spec_items нет ни одной позиции");
  itemId = itemRes.data.id;
  orgId = itemRes.data.org_id;

  // ── подготовка: события и комментарии с управляемым created_at ──────────
  const eventRows = [
    { id: ids.late, created_at: LATE },
    { id: ids.tieC, created_at: SAME },
    { id: ids.tieB, created_at: SAME },
    { id: ids.tieA, created_at: SAME },
  ].map((row) => ({
    id: row.id,
    org_id: orgId,
    spec_item_id: itemId,
    kind: "created",
    payload: { code: "ПРОБА", name: row.id.slice(-2) },
    created_at: row.created_at,
  }));

  const eventsInsert = await db
    .from("spec_item_events")
    .insert(eventRows)
    .select("id");

  const commentRows = [
    {
      id: ids.comment,
      org_id: orgId,
      spec_item_id: itemId,
      body: "корень пробы",
      created_at: SAME,
    },
    {
      id: ids.reply,
      org_id: orgId,
      spec_item_id: itemId,
      parent_id: ids.comment,
      root_id: ids.comment,
      body: "ответ пробы",
      created_at: EARLY,
    },
    {
      id: ids.deletedReply,
      org_id: orgId,
      spec_item_id: itemId,
      parent_id: ids.comment,
      root_id: ids.comment,
      body: "удалённый ответ пробы",
      created_at: EARLY,
      deleted_at: EARLY,
    },
  ];

  const commentsInsert = await db
    .from("spec_item_comments")
    .insert(commentRows)
    .select("id");

  check(
    "пробные строки созданы",
    !eventsInsert.error && !commentsInsert.error,
    `events=${eventsInsert.error?.message ?? "ok"} comments=${commentsInsert.error?.message ?? "ok"}`,
  );

  // ── 1. Первая страница и порядок ─────────────────────────────────────────
  const firstPage = await queryEvents(null, 3);
  check(
    "первая страница без курсора читается",
    !firstPage.error,
    `error=${firstPage.error?.message ?? "нет"} status=${firstPage.status}`,
  );

  const rows = firstPage.data ?? [];
  const expected = sortRows(eventRows).map((r) => r.id);
  check(
    "порядок из БД совпадает с created_at desc, id desc",
    rows.map((r) => r.id).join(",") === expected.slice(0, rows.length).join(","),
    `получено ${rows.map((r) => r.id.slice(-2)).join(",")}; created_at=${rows.map((r) => r.created_at).join(" | ")}`,
  );

  // ── 2. Вторая страница по курсору ────────────────────────────────────────
  const last = rows[rows.length - 1];
  const secondPage = await queryEvents(
    { createdAt: last.created_at, id: last.id },
    3,
  );
  check(
    "вторая страница с cursor-фильтром читается (or принимается)",
    !secondPage.error,
    `error=${secondPage.error?.message ?? "нет"} status=${secondPage.status}`,
  );

  const secondIds = (secondPage.data ?? []).map((r) => r.id);
  check(
    "вторая страница не повторяет первую",
    secondIds.every((id) => !rows.some((r) => r.id === id)),
    `первая ${rows.map((r) => r.id.slice(-2)).join(",")} / вторая ${secondIds.map((id) => id.slice(-2)).join(",")}`,
  );

  const union = [...rows, ...(secondPage.data ?? [])].map((r) => r.id).sort();
  check(
    "две страницы покрывают все четыре события без пропусков",
    union.join(",") === [...expected].sort().join(","),
    `собрано ${union.length} из ${eventRows.length}`,
  );

  // ── 3. Курсор внутри группы одинаковых created_at ────────────────────────
  // Группа берётся из ОТВЕТА: PostgREST канонизирует timestamptz (убирает
  // незначащие нули), поэтому сравнивать со своей строкой нельзя.
  const groups = new Map();
  for (const row of rows) {
    groups.set(row.created_at, [...(groups.get(row.created_at) ?? []), row.id]);
  }
  const tieGroup = [...groups.entries()].find(([, groupIds]) => groupIds.length > 1);
  check("в ответе есть группа с одинаковым created_at", Boolean(tieGroup));

  if (tieGroup) {
    const [tieAt, tieGroupIds] = tieGroup;
    const tieCursor = { createdAt: tieAt, id: tieGroupIds[tieGroupIds.length - 1] };
    const afterTie = await queryEvents(tieCursor, 5);
    const afterIds = (afterTie.data ?? []).map((r) => r.id);

    check(
      "курсор на одинаковом timestamp продолжает со строго меньшего id",
      !afterTie.error &&
        afterIds.length > 0 &&
        (afterTie.data ?? []).every(
          (r) => r.created_at === tieAt && r.id < tieCursor.id,
        ),
      `error=${afterTie.error?.message ?? "нет"} ids=${afterIds.map((id) => id.slice(-2)).join(",")}`,
    );
    check(
      "продолжение после tie-курсора — это ровно оставшаяся запись",
      afterIds.join(",") === [ids.tieA].join(","),
      `ids=${afterIds.map((id) => id.slice(-2)).join(",")}`,
    );
  }

  // ── 4. Комментарии и проекция для счётчиков ──────────────────────────────
  const commentPage = await queryComments(null, 5);
  check(
    "страница комментариев: все три строки",
    !commentPage.error && (commentPage.data ?? []).length === 3,
    `error=${commentPage.error?.message ?? "нет"} rows=${(commentPage.data ?? []).length}`,
  );

  const countsRes = await db
    .from("spec_item_comments")
    .select("parent_id")
    .eq("org_id", orgId)
    .eq("spec_item_id", itemId)
    .not("parent_id", "is", null);
  const replies = (countsRes.data ?? []).filter(
    (r) => r.parent_id === ids.comment,
  );
  check(
    "проекция parent_id принимает not.is.null и считает удалённый ответ",
    !countsRes.error && replies.length === 2,
    `error=${countsRes.error?.message ?? "нет"} replies=${replies.length}`,
  );

  // ── 5. Изоляция по организации ───────────────────────────────────────────
  const isolated = await db
    .from("spec_item_events")
    .select("id")
    .eq("org_id", "00000000-0000-0000-0000-000000000000")
    .eq("spec_item_id", itemId);
  check(
    "фильтр по чужой организации ничего не отдаёт",
    !isolated.error && (isolated.data ?? []).length === 0,
    `rows=${(isolated.data ?? []).length}`,
  );
} catch (error) {
  check("проба выполнена без исключений", false, String(error));
} finally {
  const left = await cleanupRows();
  console.log(
    `уборка: пробных событий ${left.events}, комментариев ${left.comments}`,
  );

  const failed = results.filter((ok) => !ok).length;
  console.log(
    `\nитог: ${results.length - failed}/${results.length} проверок пройдено`,
  );
  process.exitCode = failed === 0 ? 0 : 1;
}
