import { redirect } from "next/navigation";
import { LoginForm } from "@/app/login/login-form";
import { getSession } from "@/lib/auth";

type LoginPageProps = {
  searchParams?: Promise<{
    status?: string;
  }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const session = await getSession();

  if (session?.user && params?.status !== "inactive") {
    redirect("/");
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_#1e293b,_#020617_55%)] px-4 py-10 text-white sm:px-6 lg:px-8">
      <div className="mx-auto grid min-h-[calc(100vh-5rem)] max-w-6xl gap-8 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
        <section className="space-y-6">
          <div className="inline-flex rounded-full border border-white/15 bg-white/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.28em] text-slate-200">
            Plataforma escolar
          </div>
          <div className="space-y-4">
            <h1 className="max-w-3xl text-4xl font-black tracking-tight text-white sm:text-5xl">
              Corretor ENEM com histórico, evolução e acesso por perfil.
            </h1>
            <p className="max-w-2xl text-base leading-8 text-slate-300 sm:text-lg">
              Entre com sua conta para corrigir redações, acompanhar progresso e
              organizar o desempenho da turma em um ambiente seguro.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
              <div className="text-sm font-semibold text-indigo-300">Aluno</div>
              <p className="mt-2 text-sm leading-6 text-slate-300">
                Área individual para escrever, corrigir e acompanhar notas.
              </p>
            </div>
            <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
              <div className="text-sm font-semibold text-emerald-300">
                Professora
              </div>
              <p className="mt-2 text-sm leading-6 text-slate-300">
                Mais capacidade de uso e visão ampliada da evolução dos alunos.
              </p>
            </div>
            <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
              <div className="text-sm font-semibold text-amber-300">Gestão</div>
              <p className="mt-2 text-sm leading-6 text-slate-300">
                Base pronta para permissões, limites e auditoria de uso.
              </p>
            </div>
          </div>
        </section>

        <section className="rounded-[32px] border border-white/10 bg-white p-6 text-slate-900 shadow-2xl shadow-slate-950/30 sm:p-8">
          <div className="mb-6 space-y-2">
            <div className="text-sm font-semibold uppercase tracking-[0.2em] text-indigo-600">
              Acesso
            </div>
            <h2 className="text-3xl font-bold tracking-tight text-slate-950">
              Entrar ou criar conta
            </h2>
            <p className="text-sm leading-6 text-slate-600">
              Cada novo cadastro entra como estudante por padrão. Depois, se
              necessário, a escola pode promover a conta para professora ou admin.
            </p>
          </div>

          <LoginForm status={params?.status} />
        </section>
      </div>
    </main>
  );
}
