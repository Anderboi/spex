// Разовая проверка: полная цепочка удаления организации (создаём и удаляем за собой).
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
const headers = {
  apikey: key,
  Authorization: `Bearer ${key}`,
  "Content-Type": "application/json",
};

async function rest(path, init = {}) {
  const res = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: { ...headers, ...(init.headers ?? {}) },
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

const results = [];
function check(name, condition, detail = "") {
  results.push({ name, ok: Boolean(condition) });
  console.log(`${condition ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
}

const DELETED_BEFORE_SPEC_ITEMS = [
  "public_links",
  "service_operations",
  "spec_item_components",
];

const TAG = `del-test-${Date.now()}`;
let orgId = null;
let userId = null;

/** Тот же порядок, что в actions/organization.ts::deleteOrganizationData. */
async function deleteOrgSpecItems() {
  for (let pass = 0; pass < 200; pass++) {
    const { body: rows } = await rest(
      `spec_items?org_id=eq.${orgId}&select=id,parent_id`,
    );
    if (!rows?.length) return true;
    const referenced = new Set(rows.map((r) => r.parent_id).filter(Boolean));
    const leaves = rows.map((r) => r.id).filter((id) => !referenced.has(id));
    if (!leaves.length) return false;
    await rest(`spec_items?org_id=eq.${orgId}&id=in.(${leaves.join(",")})`, {
      method: "DELETE",
    });
  }
  return false;
}

try {
  // пользователь + организация + команда + приглашение
  const user = await rest("users", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ email: `${TAG}@example.invalid`, name: TAG }),
  });
  userId = user.body[0].id;

  const orgs = await rest("organizations", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ name: TAG, slug: TAG, created_by: userId }),
  });
  orgId = orgs.body[0].id;

  await rest("organization_members", {
    method: "POST",
    body: JSON.stringify({ org_id: orgId, user_id: userId, role: "owner" }),
  });
  await rest("organization_invites", {
    method: "POST",
    body: JSON.stringify({
      org_id: orgId,
      email: `invitee-${TAG}@example.invalid`,
      role: "member",
      invited_by: userId,
      token: `tok-${TAG}`,
    }),
  });

  // компания/контакт/материал/проект
  const company = await rest("companies", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ org_id: orgId, name: "Тестовая компания", category: [] }),
  });
  const companyId = company.body[0].id;

  const project = await rest("projects", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ org_id: orgId, title: "Тестовый проект" }),
  });
  const projectId = project.body[0].id;

  // дерево позиций: корень → ребёнок → внук
  const root = await rest("spec_items", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      org_id: orgId,
      project_id: projectId,
      name: "Корень",
      code: "TST-01",
      type: "Прочее",
      unit: "шт",
      qty: 1,
      price: 100,
    }),
  });
  const rootId = root.body?.[0]?.id;
  check("позиция спецификации создана", Boolean(rootId), JSON.stringify(root.body).slice(0, 200));

  const child = await rest("spec_items", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      org_id: orgId,
      project_id: projectId,
      parent_id: rootId,
      name: "Ребёнок",
      code: "TST-02",
      type: "Прочее",
      unit: "шт",
      qty: 1,
      price: 50,
    }),
  });
  const childId = child.body?.[0]?.id;

  await rest("spec_item_variants", {
    method: "POST",
    body: JSON.stringify({
      org_id: orgId,
      spec_item_id: rootId,
      name: "Вариант",
      position: 0,
    }),
  });

  await rest("spec_item_components", {
    method: "POST",
    body: JSON.stringify({
      org_id: orgId,
      spec_item_id: rootId,
      kind: "component",
      name: "Состав",
      qty: 1,
    }),
  });

  // отдельная позиция, на которую ссылается состав (kind = spec_ref):
  // именно она проверяет FK ref_spec_item_id ON DELETE RESTRICT
  const refItem = await rest("spec_items", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      org_id: orgId,
      project_id: projectId,
      name: "На которую ссылаются",
      code: "TST-03",
      type: "Прочее",
      unit: "шт",
      qty: 1,
      price: 10,
    }),
  });
  const refItemId = refItem.body?.[0]?.id;

  const refComponent = await rest("spec_item_components", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      org_id: orgId,
      spec_item_id: rootId,
      kind: "spec_ref",
      ref_spec_item_id: refItemId,
      name: "Ссылка на позицию",
    }),
  });
  if (refComponent.status >= 300) {
    console.log("  предупреждение: spec_ref не создан", JSON.stringify(refComponent.body).slice(0, 200));
  }

  // блокирующие таблицы
  await rest("service_operations", {
    method: "POST",
    body: JSON.stringify({
      org_id: orgId,
      project_id: projectId,
      type: "delivery",
      amount: 1000,
    }),
  });
  await rest("public_links", {
    method: "POST",
    body: JSON.stringify({
      token: crypto.randomUUID(),
      org_id: orgId,
      project_id: projectId,
      type: "spec",
      expires_at: new Date(Date.now() + 86400000).toISOString(),
    }),
  });

  // ── проверка: прямой DELETE организации падает на FK ──────────────────
  const naive = await rest(`organizations?id=eq.${orgId}`, { method: "DELETE" });
  check(
    "прямое удаление организации падает на FK (каскада не хватает)",
    naive.status >= 400,
    `status=${naive.status} ${JSON.stringify(naive.body).slice(0, 160)}`,
  );

  // ── проверка: удаление spec_items до components падает на RESTRICT ────
  const badOrder = await rest(`spec_items?id=eq.${rootId}`, { method: "DELETE" });
  check(
    "spec_items до components удалить нельзя (RESTRICT)",
    badOrder.status >= 400,
    `status=${badOrder.status} ${JSON.stringify(badOrder.body).slice(0, 160)}`,
  );

  const badOrderRef = await rest(`spec_items?id=eq.${refItemId}`, {
    method: "DELETE",
  });
  check(
    "позиция, на которую ссылается состав, защищена FK ref_spec_item_id",
    badOrderRef.status >= 400,
    `status=${badOrderRef.status} ${JSON.stringify(badOrderRef.body).slice(0, 160)}`,
  );

  // ── правильный порядок ────────────────────────────────────────────────
  for (const table of DELETED_BEFORE_SPEC_ITEMS) {
    const r = await rest(`${table}?org_id=eq.${orgId}`, { method: "DELETE" });
    if (r.status >= 300) console.log(`  предупреждение: ${table} → ${r.status}`);
  }

  check("дерево spec_items удалено волнами", await deleteOrgSpecItems());

  const delOrg = await rest(`organizations?id=eq.${orgId}`, { method: "DELETE" });
  check("организация удалена", delOrg.status < 300, `status=${delOrg.status}`);

  // ── проверка, что ничего не осталось ──────────────────────────────────
  for (const table of [
    "organization_members",
    "organization_invites",
    "projects",
    "spec_items",
    "spec_item_variants",
    "spec_item_components",
    "service_operations",
    "public_links",
    "materials",
    "contacts",
    "companies",
  ]) {
    const { body } = await rest(`${table}?org_id=eq.${orgId}&select=org_id`);
    check(`не осталось строк в ${table}`, Array.isArray(body) && body.length === 0, `len=${body?.length}`);
  }

  const userAfter = await rest(`users?id=eq.${userId}&select=id,active_org_id`);
  check(
    "пользователь не удалён вместе с организацией",
    userAfter.body?.length === 1,
    JSON.stringify(userAfter.body),
  );
} catch (error) {
  console.error("ОШИБКА ПРОГОНА:", error);
  results.push({ name: "прогон без исключений", ok: false });
} finally {
  if (orgId) {
    for (const table of [
      ...DELETED_BEFORE_SPEC_ITEMS,
      "spec_item_variants",
      "spec_items",
      "projects",
      "organization_invites",
      "organization_members",
      "materials",
      "contacts",
      "companies",
    ]) {
      await rest(`${table}?org_id=eq.${orgId}`, { method: "DELETE" });
    }
    await rest(`organizations?id=eq.${orgId}`, { method: "DELETE" });
  }
  if (userId) await rest(`users?id=eq.${userId}`, { method: "DELETE" });
  const leftover = await rest(`organizations?slug=eq.${TAG}&select=id`);
  console.log("осталось тестовых организаций:", leftover.body?.length ?? "?");
}

const failed = results.filter((r) => !r.ok);
console.log(`\nИТОГО: ${results.length - failed.length}/${results.length} проверок пройдено`);
if (failed.length) console.log("ПРОВАЛЫ:", failed.map((f) => f.name).join("; "));
process.exit(failed.length ? 1 : 0);
