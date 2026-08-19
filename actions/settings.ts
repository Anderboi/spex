"use server";

import { requireAuth } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { createOrganizationSchema } from '@/lib/validations';
import { revalidatePath } from "next/cache";

export async function createOrganization(input: {
  name: string;
}): Promise<
  { success: true; slug: string } | { success: false; error: string }
> {
  const parsed = createOrganizationSchema.safeParse(input);

  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  const { userId, user } = await requireAuth();
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .rpc("create_organization", {
      p_user_id: userId,
      p_name: parsed.data.name,
      p_slug_base: user.name ?? null,
    })
    .maybeSingle();

  if (error || !data) {
    console.error("[createOrganization]", error?.message, error?.details);
    return { success: false, error: "Не удалось создать организацию" };
  }

  revalidatePath("/", "layout");
  return { success: true, slug: (data as { org_slug: string }).org_slug };
}

