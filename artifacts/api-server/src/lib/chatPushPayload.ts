export function buildChatPushPayload(senderName: string, groupId: number) {
  return {
    title: "Nuevo mensaje",
    body: `${senderName} te ha enviado un mensaje.`,
    data: { type: "message", groupId },
  };
}