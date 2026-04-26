"use client";

import { useActionState } from "react";
import {
  initialAuthFormState,
  signInAction,
  type AuthFormState,
} from "@/app/auth/actions";

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
  const [state, formAction, pending] = useActionState<AuthFormState, FormData>(
    signInAction,
    initialAuthFormState,
  );
  const statusMessage = getStatusMessage(status);

  return (
    <form action={formAction} className="space-y-5">
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
          autoComplete="current-password"
          required
          className="w-full rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3 text-slate-900 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
          placeholder="Sua senha"
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

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "Entrando..." : "Entrar no corretor"}
      </button>
    </form>
  );
}
