export type DeleteConfirmationButton = {
  text: string;
  style?: "cancel" | "destructive";
  onPress?: () => void;
};

export function requestChatMessageDeletionConfirmation(
  showAlert: (
    title: string,
    message: string,
    buttons: DeleteConfirmationButton[],
  ) => void,
  onConfirm: () => void,
): void {
  showAlert(
    "Eliminar para todos",
    "El mensaje se sustituirá por «Mensaje eliminado» para todas las personas de la conversación.",
    [
      { text: "Cancelar", style: "cancel" },
      { text: "Eliminar", style: "destructive", onPress: onConfirm },
    ],
  );
}
