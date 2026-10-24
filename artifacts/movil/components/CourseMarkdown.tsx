import React, { useMemo } from "react";
import { Alert, Linking, ScrollView, View } from "react-native";
import Markdown, { type RenderRules } from "react-native-markdown-display";
import MarkdownIt from "markdown-it";
import { useColors } from "@/hooks/useColors";

const parser = new MarkdownIt({ html: false, linkify: true, breaks: true });
const rules: RenderRules = {
  table: (node, children, _parents, styles) => (
    <ScrollView key={node.key} horizontal showsHorizontalScrollIndicator style={{ flexGrow: 0 }}>
      <View style={[styles.table, { minWidth: 300 }]}>{children}</View>
    </ScrollView>
  ),
};

export function CourseMarkdown({ text }: { text: string }) {
  const colors = useColors();
  const styles = useMemo(() => ({
    body: { color: colors.foreground, fontSize: 14, lineHeight: 25 },
    heading1: { color: colors.foreground, fontSize: 25, lineHeight: 32, fontWeight: "700" as const, marginTop: 18, marginBottom: 10 },
    heading2: { color: colors.foreground, fontSize: 22, lineHeight: 29, fontWeight: "700" as const, marginTop: 16, marginBottom: 8 },
    heading3: { color: colors.foreground, fontSize: 18, lineHeight: 26, fontWeight: "700" as const, marginTop: 14, marginBottom: 6 },
    paragraph: { marginTop: 0, marginBottom: 14 },
    strong: { fontWeight: "700" as const },
    link: { color: colors.primary, textDecorationLine: "underline" as const },
    blockquote: { backgroundColor: colors.card, borderColor: colors.primary, borderLeftWidth: 3, paddingHorizontal: 12 },
    table: { borderColor: colors.border, borderWidth: 1, borderRadius: 6 },
    thead: { backgroundColor: colors.accent },
    tr: { borderColor: colors.border, borderBottomWidth: 1 },
    th: { minWidth: 140, padding: 8 },
    td: { minWidth: 140, padding: 8 },
    code_inline: { color: colors.foreground, backgroundColor: colors.accent },
    code_block: { color: colors.foreground, backgroundColor: colors.accent, borderColor: colors.border },
    fence: { color: colors.foreground, backgroundColor: colors.accent, borderColor: colors.border },
  }), [colors.foreground, colors.primary, colors.card, colors.border, colors.accent]);

  return <Markdown markdownit={parser} style={styles} rules={rules} onLinkPress={(href) => {
    if (!/^(https?:|mailto:|tel:)/i.test(href)) return false;
    void Linking.openURL(href).catch(() => Alert.alert("No se pudo abrir el enlace", "Comprueba tu conexión e inténtalo de nuevo."));
    return false;
  }}>{text}</Markdown>;
}
