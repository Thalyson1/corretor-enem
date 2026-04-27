"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";

function parseOptionalNumber(value: FormDataEntryValue | null) {
  const parsed = String(value ?? "").trim();
  if (!parsed) {
    return null;
  }

  const number = Number(parsed);
  return Number.isFinite(number) ? number : null;
}

export async function updateUserAccessAction(formData: FormData) {
  await requireRole(["admin"]);

  const profileId = String(formData.get("profile_id") ?? "");
  const role = String(formData.get("role") ?? "student");
  const isActive = String(formData.get("is_active") ?? "true") === "true";
  const classGroup = String(formData.get("class_group") ?? "").trim() || null;
  const schoolName = String(formData.get("school_name") ?? "").trim() || null;
  const weeklySavedOverride = parseOptionalNumber(
    formData.get("weekly_saved_essays_override"),
  );
  const weeklyCorrectionsOverride = parseOptionalNumber(
    formData.get("weekly_corrections_override"),
  );

  if (!profileId) {
    return;
  }

  const supabase = await createClient();
  await supabase
    .from("profiles")
    .update({
      role,
      is_active: isActive,
      class_group: classGroup,
      school_name: schoolName,
      weekly_saved_essays_override: weeklySavedOverride,
      weekly_corrections_override: weeklyCorrectionsOverride,
    })
    .eq("id", profileId);

  revalidatePath("/admin");
  revalidatePath("/teacher");
  revalidatePath("/");
}

export async function updateGlobalLimitsAction(formData: FormData) {
  await requireRole(["admin"]);

  const role = String(formData.get("role") ?? "student");
  const weeklySaved = Number(formData.get("weekly_saved_essays") ?? 0);
  const weeklyCorrections = Number(formData.get("weekly_corrections") ?? 0);

  const supabase = await createClient();
  await supabase
    .from("usage_limits")
    .update({
      weekly_saved_essays: weeklySaved,
      weekly_corrections: weeklyCorrections,
    })
    .eq("role", role);

  revalidatePath("/admin");
  revalidatePath("/teacher");
  revalidatePath("/");
}
