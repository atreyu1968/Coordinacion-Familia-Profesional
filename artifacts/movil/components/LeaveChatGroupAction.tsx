import React, { useState } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import { useLeaveChatGroup, getListChatGroupsQueryKey, type ChatGroup } from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";

export function LeaveChatGroupAction({ group, onLeft }: { group?: ChatGroup; onLeft: () => void }) {
  const colors = useColors();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const leave = useLeaveChatGroup();
  const queryClient = useQueryClient();
  if (!group || group.type === "direct" || group.moduleId != null) return null;
  return (
    <>
      <Pressable accessibilityRole="button" accessibilityLabel="Salir del grupo" hitSlop={10} onPress={() => { setError(""); setOpen(true); }}>
        <Feather name="log-out" size={22} color="#ffffff" />
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => { if (!leave.isPending) setOpen(false); }}>
        <View style={{ flex: 1, justifyContent: "center", padding: 24, backgroundColor: "rgba(0,0,0,0.5)" }}>
          <View style={{ padding: 20, borderRadius: 16, gap: 16, backgroundColor: colors.card }}>
            <Text style={{ color: colors.foreground, fontSize: 18, fontWeight: "600" }}>Salir de {group.name}</Text>
            <Text style={{ color: colors.mutedForeground }}>Dejarás de recibir mensajes y perderás acceso a esta conversación. Si no quedan miembros, el grupo y su historial se eliminarán.</Text>
            {error ? <Text style={{ color: colors.destructive }}>{error}</Text> : null}
            <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 24 }}>
              <Pressable disabled={leave.isPending} onPress={() => setOpen(false)}><Text style={{ paddingVertical: 10, color: colors.foreground }}>Cancelar</Text></Pressable>
              <Pressable disabled={leave.isPending} onPress={() => leave.mutate({ id: group.id }, {
                onSuccess: () => {
                  queryClient.setQueryData<ChatGroup[]>(getListChatGroupsQueryKey(), (previous = []) => previous.filter((chat) => chat.id !== group.id));
                  void queryClient.invalidateQueries({ queryKey: getListChatGroupsQueryKey() });
                  setOpen(false);
                  onLeft();
                },
                onError: () => setError("No se pudo salir del grupo. Inténtalo de nuevo."),
              })}><Text style={{ paddingVertical: 10, color: colors.destructive }}>{leave.isPending ? "Saliendo…" : "Salir del grupo"}</Text></Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}
