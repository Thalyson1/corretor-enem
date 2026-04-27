import Link from "next/link";
import type { UserRole } from "@/lib/auth";

type NavLinksProps = {
  role: UserRole;
};

export function NavLinks({ role }: NavLinksProps) {
  return (
    <div className="flex flex-wrap gap-2">
      <Link
        href="/"
        className="rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm font-medium text-white transition hover:bg-white/15"
      >
        Minha área
      </Link>
      {(role === "teacher" || role === "admin") && (
        <Link
          href="/teacher"
          className="rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm font-medium text-white transition hover:bg-white/15"
        >
          Painel da professora
        </Link>
      )}
      {role === "admin" && (
        <Link
          href="/admin"
          className="rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm font-medium text-white transition hover:bg-white/15"
        >
          Administração
        </Link>
      )}
    </div>
  );
}
