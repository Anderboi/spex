// Разовая проверка RLS-safe RPC на временных данных (создаём и удаляем за собой).
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

const rpc = (fn, args) =>
  rest(`rpc/${fn}`, { method: "POST", body: JSON.stringify(args) });

let orgId = null;
const created = { userA: null, userB: null, userC: null };
const results = [];

function check(name, condition, detail = "") {
  results.push({ name, ok: Boolean(condition), detail });
  console.log(`${condition ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
}

try {
  const tag = Date.now();
  for (const [slot, suffix] of [
    ["userA", "a"],
    ["userB", "b"],
    ["userC", "c"],
  ]) {
    const ins = await rest("users", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        email: `role-test-${suffix}-${tag}@example.invalid`,
        name: `Role Test ${suffix.toUpperCase()}`,
      }),
    });
    created[slot] = ins.body?.[0]?.id ?? null;
    if (!created[slot]) throw new Error("не удалось создать тестового пользователя: " + ins.status);
  }
  const { userA, userB, userC } = created;

  const created_org = await rpc("create_organization", {
    p_user_id: userA,
    p_name: `role-test-${tag}`,
    p_slug_base: `role-test-${tag}`,
  });
  orgId = created_org.body?.[0]?.org_id ?? null;
  if (!orgId) throw new Error("create_organization: " + JSON.stringify(created_org));
  check("create_organization назначает owner", true);

  await rest("organization_members", {
    method: "POST",
    body: JSON.stringify([
      { org_id: orgId, user_id: userB, role: "member" },
      { org_id: orgId, user_id: userC, role: "admin" },
    ]),
  });

  // ── инвариант: второй owner невозможен ────────────────────────────────
  const dup = await rest("organization_members", {
    method: "POST",
    body: JSON.stringify({ org_id: orgId, user_id: userB, role: "owner" }),
  });
  check("второй owner отклонён БД", dup.status >= 400, `status=${dup.status}`);

  // ── переименование ────────────────────────────────────────────────────
  const byMember = await rpc("update_organization_name", {
    p_org_id: orgId,
    p_actor_id: userB,
    p_name: "Подмена",
  });
  check(
    "member не может переименовать",
    String(byMember.body?.message ?? "").includes("FORBIDDEN"),
    byMember.body?.message,
  );

  const byAdmin = await rpc("update_organization_name", {
    p_org_id: orgId,
    p_actor_id: userC,
    p_name: "Подмена",
  });
  check(
    "admin не может переименовать",
    String(byAdmin.body?.message ?? "").includes("FORBIDDEN"),
    byAdmin.body?.message,
  );

  const byOwner = await rpc("update_organization_name", {
    p_org_id: orgId,
    p_actor_id: userA,
    p_name: "  Переименовано  ",
  });
  check("owner переименовывает", byOwner.status < 300 && byOwner.body === "Переименовано", JSON.stringify(byOwner.body));

  const emptyName = await rpc("update_organization_name", {
    p_org_id: orgId,
    p_actor_id: userA,
    p_name: "   ",
  });
  check(
    "пустое имя отклонено",
    String(emptyName.body?.message ?? "").includes("EMPTY_NAME"),
    emptyName.body?.message,
  );

  // ── передача владения ─────────────────────────────────────────────────
  const transferByMember = await rpc("transfer_organization_ownership", {
    p_org_id: orgId,
    p_actor_id: userB,
    p_target_name: "Role Test A",
  });
  check(
    "member не может передать владение",
    String(transferByMember.body?.message ?? "").includes("FORBIDDEN"),
    transferByMember.body?.message,
  );

  const transferByAdmin = await rpc("transfer_organization_ownership", {
    p_org_id: orgId,
    p_actor_id: userC,
    p_target_name: "Role Test A",
  });
  check(
    "admin не может передать владение",
    String(transferByAdmin.body?.message ?? "").includes("FORBIDDEN"),
    transferByAdmin.body?.message,
  );

  const nonMember = await rpc("transfer_organization_ownership", {
    p_org_id: orgId,
    p_actor_id: crypto.randomUUID(),
    p_target_name: "Role Test A",
  });
  check(
    "посторонний не может передать владение",
    String(nonMember.body?.message ?? "").includes("NOT_A_MEMBER"),
    nonMember.body?.message,
  );

  const toSelf = await rpc("transfer_organization_ownership", {
    p_org_id: orgId,
    p_actor_id: userA,
    p_target_name: "Role Test A",
  });
  check(
    "передача самому себе не проходит",
    String(toSelf.body?.message ?? "").includes("TARGET_NOT_FOUND"),
    toSelf.body?.message,
  );

  const wrongName = await rpc("transfer_organization_ownership", {
    p_org_id: orgId,
    p_actor_id: userA,
    p_target_name: "Совсем другое имя",
  });
  check(
    "имя получателя проверяется",
    String(wrongName.body?.message ?? "").includes("TARGET_NOT_FOUND"),
    wrongName.body?.message,
  );

  const membersBefore = await rest(
    `organization_members?org_id=eq.${orgId}&select=user_id,role`,
  );
  console.log("до передачи:", JSON.stringify(membersBefore.body));

  const okTransfer = await rpc("transfer_organization_ownership", {
    p_org_id: orgId,
    p_actor_id: userA,
    p_target_name: "Role Test B",
  });
  check("owner передаёт владение member'у", okTransfer.status < 300, JSON.stringify(okTransfer.body));

  const after = await rest(
    `organization_members?org_id=eq.${orgId}&select=user_id,role`,
  );
  const roleOf = (id) => after.body.find((m) => m.user_id === id)?.role;
  const ownerCount = after.body.filter((m) => m.role === "owner").length;

  check("старый owner стал admin", roleOf(userA) === "admin", roleOf(userA));
  check("новый owner стал owner", roleOf(userB) === "owner", roleOf(userB));
  check("владелец ровно один", ownerCount === 1, String(ownerCount));

  // ── обычная смена роли: owner недоступен ─────────────────────────────
  // Демонстрируем, что БД не мешает прямому UPDATE: именно поэтому операция
  // закрыта в server action (`canUpdateMemberRole`) и не выведена в RLS.
  const demoteOwner = await rest(
    `organization_members?org_id=eq.${orgId}&user_id=eq.${userB}`,
    { method: "PATCH", body: JSON.stringify({ role: "member" }) },
  );
  check(
    "прямой UPDATE владельца возможен на уровне БД → нужен гейт в server action",
    demoteOwner.status < 300,
    `status=${demoteOwner.status}`,
  );

  // возвращаем как было: userB снова owner (userA остался admin после передачи)
  const restore = await rest(
    `organization_members?org_id=eq.${orgId}&user_id=eq.${userB}`,
    { method: "PATCH", body: JSON.stringify({ role: "owner" }) },
  );
  check("состояние восстановлено", restore.status < 300, `status=${restore.status}`);

  const finalState = await rest(
    `organization_members?org_id=eq.${orgId}&select=user_id,role`,
  );
  console.log("итоговое состояние:", JSON.stringify(finalState.body));
  check(
    "в организации снова ровно один owner",
    finalState.body.filter((m) => m.role === "owner").length === 1,
  );
} catch (error) {
  console.error("ОШИБКА ПРОГОНА:", error);
  results.push({ name: "прогон без исключений", ok: false, detail: String(error) });
} finally {
  if (orgId) {
    for (const table of [
      "public_links",
      "service_operations",
      "spec_item_components",
      "spec_items",
      "projects",
      "materials",
      "contacts",
      "companies",
      "organization_invites",
      "organization_members",
    ]) {
      await rest(`${table}?org_id=eq.${orgId}`, { method: "DELETE" });
    }
    await rest(`organizations?id=eq.${orgId}`, { method: "DELETE" });
  }
  for (const id of Object.values(created)) {
    if (id) await rest(`users?id=eq.${id}`, { method: "DELETE" });
  }
  const leftover = await rest(
    `organizations?slug=like.role-test-*&select=id`,
  );
  console.log("осталось тестовых организаций:", leftover.body?.length ?? "?");
}

const failed = results.filter((r) => !r.ok);
console.log(`\nИТОГО: ${results.length - failed.length}/${results.length} проверок пройдено`);
process.exit(failed.length ? 1 : 0);
