import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type UserRole = "student" | "teacher" | "admin";

export type UserProfile = {
  id: string;
  email: string | null;
  full_name: string | null;
  role: UserRole;
  is_active: boolean;
  school_name: string | null;
  class_group: string | null;
  weekly_saved_essays_override: number | null;
  weekly_corrections_override: number | null;
};

export const getSession = cache(async () => {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  return session;
});

export const getCurrentUserProfile = cache(async () => {
  const session = await getSession();

  if (!session?.user) {
    return null;
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select(
      "id, email, full_name, role, is_active, school_name, class_group, weekly_saved_essays_override, weekly_corrections_override",
    )
    .eq("id", session.user.id)
    .single();

  if (error) {
    return null;
  }

  return data as UserProfile;
});

export async function requireAuth() {
  const session = await getSession();

  if (!session?.user) {
    redirect("/login");
  }

  const profile = await getCurrentUserProfile();

  if (!profile?.is_active) {
    redirect("/login?status=inactive");
  }

  return {
    session,
    profile,
  };
}

export async function requireRole(allowedRoles: UserRole[]) {
  const auth = await requireAuth();

  if (!allowedRoles.includes(auth.profile.role)) {
    redirect("/");
  }

  return auth;
}
