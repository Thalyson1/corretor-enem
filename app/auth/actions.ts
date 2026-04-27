"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { AuthFormState } from "@/app/auth/form-state";

export async function signInAction(
  _prevState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return {
      error: "Preencha e-mail e senha para entrar.",
      success: null,
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    console.error("signInAction failed", {
      email,
      message: error.message,
      status: error.status,
      code: error.code,
      name: error.name,
    });
    return {
      error: "Não foi possível entrar. Verifique suas credenciais.",
      success: null,
    };
  }

  redirect("/");
}

export async function signUpAction(
  _prevState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const fullName = String(formData.get("full_name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const schoolName = String(formData.get("school_name") ?? "").trim();
  const classGroup = String(formData.get("class_group") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!fullName || !email || !schoolName || !classGroup || !password) {
    return {
      error: "Preencha nome, e-mail, escola, turma e senha para criar sua conta.",
      success: null,
    };
  }

  if (password.length < 6) {
    return {
      error: "Use uma senha com pelo menos 6 caracteres.",
      success: null,
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name: fullName,
        school_name: schoolName,
        class_group: classGroup,
      },
    },
  });

  if (error) {
    console.error("signUpAction failed", {
      email,
      fullName,
      schoolName,
      classGroup,
      message: error.message,
      status: error.status,
      code: error.code,
      name: error.name,
    });
    return {
      error: "Não foi possível criar a conta. Tente outro e-mail ou tente novamente.",
      success: null,
    };
  }

  return {
    error: null,
    success:
      "Conta criada com sucesso. Se a confirmação por e-mail estiver ativa, verifique sua caixa de entrada antes de entrar.",
  };
}

export async function signOutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
