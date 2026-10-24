import { Button } from "@/components/ui/button";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { EyeOff, Trash2 } from "lucide-react";

export type HiddenChatMessage = {
  id: number;
  content: string;
  deleted?: boolean;
  attachmentName?: string | null;
  createdAt: string | Date;
};

export function ChatMessageVisibilityMenuItems({
  onHide,
  onDelete,
}: {
  onHide: () => void;
  onDelete: () => void;
}) {
  return (
    <>
      <DropdownMenuItem onClick={onHide}>
        <EyeOff className="mr-2 h-4 w-4" /> Ocultar solo para mí
      </DropdownMenuItem>
      <DropdownMenuItem
        onClick={onDelete}
        className="text-destructive focus:text-destructive"
      >
        <Trash2 className="mr-2 h-4 w-4" /> Eliminar para todos
      </DropdownMenuItem>
    </>
  );
}

export function HiddenChatMessageRow({
  message,
  subtitle,
  disabled = false,
  onRestore,
}: {
  message: HiddenChatMessage;
  subtitle: string;
  disabled?: boolean;
  onRestore: () => void;
}) {
  return (
    <li className="flex items-center gap-3 rounded-md border p-3">
      <div className="min-w-0 flex-1">
        <p className={`break-words text-sm ${message.deleted ? "italic text-muted-foreground" : ""}`}>
          {message.deleted
            ? "Mensaje eliminado para todos"
            : message.content ||
              (message.attachmentName
                ? `Archivo adjunto · ${message.attachmentName}`
                : "Archivo adjunto")}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {subtitle}
        </p>
      </div>
      {!message.deleted && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled}
          onClick={onRestore}
        >
          Restaurar
        </Button>
      )}
    </li>
  );
}
