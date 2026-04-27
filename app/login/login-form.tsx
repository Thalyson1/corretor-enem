"use client";

import { useActionState, useState } from "react";
import { signInAction, signUpAction } from "@/app/auth/actions";
import {
  initialAuthFormState,
  type AuthFormState,
} from "@/app/auth/form-state";

type LoginFormProps = {
  status?: string;
};

function getStatusMessage(status?: string) {
  if (status === "inactive") {
    return "Sua conta está inativa no momento. Fale com a coordenação ou com a professora responsável.";
  }

  return null;
}

export function LoginForm({ status }: LoginFormProps) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [signInState, signInFormAction, signInPending] = useActionState<
    AuthFormState,
    FormData
  >(signInAction, initialAuthFormState);
  const [signUpState, signUpFormAction, signUpPending] = useActionState<
    AuthFormState,
    FormData
  >(signUpAction, initialAuthFormState);
  const statusMessage = getStatusMessage(status);
  const state = mode === "signin" ? signInState : signUpState;
  const formAction = mode === "signin" ? signInFormAction : signUpFormAction;
  const pending = mode === "signin" ? signInPending : signUpPending;

  return (
    <form action={formAction} className="space-y-5">
      <div className="grid grid-cols-2 gap-2 rounded-2xl bg-slate-100 p-1">
        <button
          type="button"
          onClick={() => setMode("signin")}
          className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
            mode === "signin"
              ? "bg-white text-slate-950 shadow-sm"
              : "text-slate-600 hover:text-slate-900"
          }`}
        >
          Entrar
        </button>
        <button
          type="button"
          onClick={() => setMode("signup")}
          className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
            mode === "signup"
              ? "bg-white text-slate-950 shadow-sm"
              : "text-slate-600 hover:text-slate-900"
          }`}
        >
          Criar conta
        </button>
      </div>

      {mode === "signup" ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <label
              htmlFor="full_name"
              className="block text-sm font-semibold text-slate-800"
            >
              Nome completo
            </label>
            <input
              id="full_name"
              name="full_name"
              type="text"
              autoComplete="name"
              required
              className="w-full rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3 text-slate-900 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
              placeholder="Seu nome"
            />
          </div>

          <div className="space-y-2">
            <label
              htmlFor="school_name"
              className="block text-sm font-semibold text-slate-800"
            >
              Escola
            </label>
            <input
              id="school_name"
              name="school_name"
              type="text"
              autoComplete="organization"
              required
              className="w-full rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3 text-slate-900 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
              placeholder="Nome da escola"
            />
          </div>

          <div className="space-y-2">
            <label
              htmlFor="class_group"
              className="block text-sm font-semibold text-slate-800"
            >
              Turma
            </label>
            <input
              id="class_group"
              name="class_group"
              type="text"
              autoComplete="off"
              required
              className="w-full rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3 text-slate-900 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
              placeholder="Ex.: 3º Ano A"
            />
          </div>
        </div>
      ) : null}

      <div className="space-y-2">
        <label htmlFor="email" className="block text-sm font-semibold text-slate-800">
          E-mail
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          className="w-full rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3 text-slate-900 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
          placeholder="voce@escola.com"
        />
      </div>

      <div className="space-y-2">
        <label
          htmlFor="password"
          className="block text-sm font-semibold text-slate-800"
        >
          Senha
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete={mode === "signin" ? "current-password" : "new-password"}
          required
          className="w-full rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3 text-slate-900 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
          placeholder={mode === "signin" ? "Sua senha" : "Crie uma senha"}
        />
      </div>

      {statusMessage ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {statusMessage}
        </div>
      ) : null}

      {state.error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {state.error}
        </div>
      ) : null}

      {state.success ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {state.success}
        </div>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending
          ? mode === "signin"
            ? "Entrando..."
            : "Criando conta..."
          : mode === "signin"
            ? "Entrar no corretor"
            : "Criar conta de estudante"}
      </button>
    </form>
  );
}
