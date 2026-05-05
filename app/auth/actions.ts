"use server";

import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { AuthFormState } from "@/app/auth/form-state";

function getSignUpErrorMessage(error: {
  code?: string;
  status?: number;
  message: string;
}) {
  if (error.code === "over_email_send_rate_limit" || error.status === 429) {
    return "O projeto atingiu o limite de envios de e-mail do cadastro. Aguarde alguns minutos e tente de novo. Se o problema continuar, peça para a escola liberar sua conta.";
  }

  if (error.code === "user_already_exists") {
    return "Já existe uma conta com esse e-mail. Tente entrar com sua senha.";
  }

  return "Não foi possível criar a conta. Tente outro e-mail ou tente novamente.";
}

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

  const userMetadata = {
    full_name: fullName,
    school_name: schoolName,
    class_group: classGroup,
  };
  const supabase = await createClient();
<<<<<<< HEAD
  const adminSupabase = createAdminClient();

  if (adminSupabase) {
    const { error } = await adminSupabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: userMetadata,
    });

    if (error) {
      console.error("signUpAction admin createUser failed", {
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
        error: getSignUpErrorMessage(error),
        success: null,
      };
    }

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError) {
      console.error("signUpAction signIn after admin createUser failed", {
        email,
        message: signInError.message,
        status: signInError.status,
        code: signInError.code,
        name: signInError.name,
      });
      return {
        error: null,
        success: "Conta criada com sucesso. Entre com seu e-mail e senha para continuar.",
      };
    }

    redirect("/");
  }

=======
>>>>>>> 431a316e15c21a0777dc62ff38666b62684cd681
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: userMetadata,
    },
  });

  if (error) {
    if (error.code === "over_email_send_rate_limit" || error.status === 429) {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (!signInError) {
        redirect("/");
      }
    }

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
      error: getSignUpErrorMessage(error),
      success: null,
    };
  }

  if (data.session) {
    redirect("/");
  }

  return {
    error: null,
<<<<<<< HEAD
    success:
      "Conta criada com sucesso. Se a confirmação por e-mail estiver ativa no projeto, verifique sua caixa de entrada antes de entrar.",
=======
    success: "Conta criada com sucesso. Agora você já pode entrar.",
>>>>>>> 431a316e15c21a0777dc62ff38666b62684cd681
  };
}

export async function signOutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
