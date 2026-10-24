export function chatMemberNameColor(role: string | null | undefined): string {
  if (role === "coordinator") return "text-violet-700 dark:text-violet-300";
  if (role === "department_head") return "text-emerald-700 dark:text-emerald-300";
  return "text-blue-700 dark:text-blue-300";
}

export function chatMemberAvatarColor(role: string | null | undefined): string {
  if (role === "coordinator") return `${chatMemberNameColor(role)} bg-violet-100 dark:bg-violet-950`;
  if (role === "department_head") return `${chatMemberNameColor(role)} bg-emerald-100 dark:bg-emerald-950`;
  return `${chatMemberNameColor(role)} bg-blue-100 dark:bg-blue-950`;
}
