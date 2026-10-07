// Read-only проверка живого состояния: таблица файлов, Storage, RLS-контур.
// Ничего не создаёт, не меняет и не удаляет.
// Запуск: node temp/probe-files-state.mjs
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

async function rest(path, key = serviceKey, extraHeaders = {}) {
  const res = await fetch(`${url}/rest/v1/${path}`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...extraHeaders,
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

function report(label, result, compact = true) {
  const body =
    typeof result.body === "string"
      ? result.body
      : JSON.stringify(result.body);
  const shown = compact ? body?.slice(0, 700) : body;
  console.log(`\n### ${label}\nstatus=${result.status}\n${shown}`);
}

/* 1. Существует ли таблица spec_item_files (через PostgREST). */
report("spec_item_files select", await rest("spec_item_files?select=id&limit=1"));

/* 2. Все колонки, которые видит PostgREST. */
report(
  "spec_item_files все колонки",
  await rest("spec_item_files?select=*&limit=1"),
);

/* 3. Какие колонки реально приходят в строке (структура ответа). */
const rows = await rest("spec_item_files?select=*&limit=1");
if (Array.isArray(rows.body) && rows.body.length > 0) {
  console.log("\n### колонки из ответа\n", Object.keys(rows.body[0]).sort().join(", "));
} else {
  console.log("\n### колонки из ответа\n(строк нет — колонки не определить)");
}

/* 4. Контрольная таблица: контур Data API работает. */
report("projects limit 1", await rest("projects?select=id,name&limit=1"));

/* 5. Есть ли spec_items, к которым можно привязать файл (кандидаты). */
report(
  "spec_items кандидаты",
  await rest("spec_items?select=id,project_id,org_id&is_placeholder=eq.false&limit=3"),
);

/* 6. RLS-контур: anon без токена. Для таблицы с включённым RLS и без
      anon-политики Supabase отдаёт пустой массив, а не ошибку прав. */
report(
  "spec_item_files под anon",
  await rest("spec_item_files?select=id&limit=1", anonKey),
);

/* 7. Storage: приватный bucket не отдаёт объект без подписи. */
for (const bucket of ["spec-item-files", "material-images"]) {
  const res = await fetch(`${url}/storage/v1/object/public/${bucket}/__probe__`);
  console.log(
    `\n### public URL bucket=${bucket}\nstatus=${res.status}\n${(await res.text()).slice(0, 300)}`,
  );
}

/* 8. Storage API: листинг корня приватного bucket'а под service role.
      Подтверждает существование bucket'а (не его настройки). */
for (const bucket of ["spec-item-files", "material-images"]) {
  const res = await fetch(`${url}/storage/v1/object/list/${bucket}`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ prefix: "", limit: 1 }),
  });
  const text = await res.text();
  console.log(
    `\n### storage list bucket=${bucket}\nstatus=${res.status}\n${text.slice(0, 400)}`,
  );
}

/* 9. Настройки bucket'а через Storage API под service role. */
for (const bucket of ["spec-item-files", "material-images"]) {
  const res = await fetch(`${url}/storage/v1/bucket/${bucket}`, {
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    },
  });
  const text = await res.text();
  console.log(
    `\n### bucket info ${bucket}\nstatus=${res.status}\n${text.slice(0, 900)}`,
  );
}

/* 10. Policies Storage: через Data API недоступны, но проверяем, отвечает ли
       PostgREST по схеме storage (ожидаемо — нет: схема не экспонирована). */
report("storage.objects (ожидаемо недоступно)", await rest("objects?select=id&limit=1"));

console.log("\n--- probe done ---");
