export const WEB_DELETE_MESSAGE_CONFIRMATION =
  "Se sustituirá este mensaje por «Mensaje eliminado» para todas las personas de la conversación. ¿Continuar?";

export function confirmChatMessageDeletion(
  confirmDialog: (message: string) => boolean,
  onConfirm: () => void,
): boolean {
  if (!confirmDialog(WEB_DELETE_MESSAGE_CONFIRMATION)) return false;
  onConfirm();
  return true;
}
