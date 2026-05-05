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

const NO_SCHOOL_OPTION = "Nenhuma escola / não sou aluno";
const NO_CLASS_GROUP_OPTION = "Nenhuma turma / não sou aluno";

const SCHOOL_OPTIONS = [
  "ECIT Dr. Silva Mariz",
  "Outra Escola",
  NO_SCHOOL_OPTION,
] as const;

const CLASS_GROUP_OPTIONS = [
  "1° A",
  "1° B",
  "1° C",
  "2° A",
  "2° B",
  "2° C",
  "3° A",
  "3° B",
  "3° C",
  NO_CLASS_GROUP_OPTION,
] as const;

function getStatusMessage(status?: string) {
  if (status === "inactive") {
    return "Sua conta está inativa no momento. Fale com a coordenação ou com o professor responsável.";
  }

  return null;
}

export function LoginForm({ status }: LoginFormProps) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [selectedSchool, setSelectedSchool] = useState("");
  const [selectedClassGroup, setSelectedClassGroup] = useState("");
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
  const schoolHasNoClassGroup = selectedSchool === NO_SCHOOL_OPTION;

  function handleSchoolChange(nextSchool: string) {
    setSelectedSchool(nextSchool);

    if (nextSchool === NO_SCHOOL_OPTION) {
      setSelectedClassGroup(NO_CLASS_GROUP_OPTION);
      return;
    }

    setSelectedClassGroup("");
  }

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
            <select
              id="school_name"
              name="school_name"
              required
              value={selectedSchool}
              onChange={(event) => handleSchoolChange(event.target.value)}
              className="w-full rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3 text-slate-900 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
            >
              <option value="" disabled>
                Selecione a escola
              </option>
              {SCHOOL_OPTIONS.map((schoolOption) => (
                <option key={schoolOption} value={schoolOption}>
                  {schoolOption}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label
              htmlFor="class_group"
              className="block text-sm font-semibold text-slate-800"
            >
              Turma
            </label>
            <select
              id="class_group"
              name="class_group"
              required
              value={selectedClassGroup}
              onChange={(event) => setSelectedClassGroup(event.target.value)}
              disabled={schoolHasNoClassGroup}
              className="w-full rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3 text-slate-900 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
            >
              <option value="" disabled>
                Selecione a turma
              </option>
              {CLASS_GROUP_OPTIONS.map((classGroupOption) => (
                <option key={classGroupOption} value={classGroupOption}>
                  {classGroupOption}
                </option>
              ))}
            </select>
            {schoolHasNoClassGroup ? (
              <p className="text-xs text-slate-500">
                Ao escolher nenhuma escola, a turma é marcada automaticamente como nenhuma turma.
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="space-y-2">
        <label
          htmlFor="email"
          className="block text-sm font-semibold text-slate-800"
        >
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
