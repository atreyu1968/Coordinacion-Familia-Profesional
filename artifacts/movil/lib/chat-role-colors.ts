type ChatPalette = { chatCoordinator: string; chatDepartmentHead: string; chatMember: string };

export function chatMemberColor(role: string | null | undefined, colors: ChatPalette): string {
  if (role === "coordinator") return colors.chatCoordinator;
  if (role === "department_head") return colors.chatDepartmentHead;
  return colors.chatMember;
}
