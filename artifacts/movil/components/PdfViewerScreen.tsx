import React from "react";
import { Text, View } from "react-native";

// Metro resolves the native and web implementations for supported targets.
// This fallback keeps static type tooling and other platforms safe.
export default function PdfViewerScreen() {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }}>
      <Text>La vista previa de PDF no está disponible en esta plataforma.</Text>
    </View>
  );
}
