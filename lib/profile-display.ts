export function getDisplayName(
  fullName: string | null | undefined,
  email: string | null | undefined,
) {
  const normalizedName = fullName?.trim();

  if (normalizedName) {
    return normalizedName;
  }

  const emailPrefix = email?.split("@")[0]?.trim();

  if (!emailPrefix) {
    return "Usuário";
  }

  return emailPrefix
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}
