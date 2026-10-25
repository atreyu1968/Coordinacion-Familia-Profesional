import React from "react";
import { Alert, Text, type StyleProp, type TextStyle } from "react-native";
import { openBrowserLink } from "@/lib/browser-link";

type LinkSegment = { text: string; href?: string };

function splitLinks(text: string): LinkSegment[] {
  const segments: LinkSegment[] = [];
  const pattern =
    /https?:\/\/[^\s<>"'`]+|www\.[^\s<>"'`]+|(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:com|org|net|edu|gov|mil|int|es|uk|eu|cat|info|biz|app|dev|io|co|online|site|tech|ai|me|us|de|fr|it|ca|au|nz|jp|in|mx|br|pt|ch|be|nl|se|no|dk|fi|ie|gr|ru|cn|tv|news|store|cloud|digital|global|agency|school|museum|travel|coop|pro|name|xyz|world|wiki|email|blog|academy|solutions|social|group|services|works|design|company|systems|live|center|health|law|finance|support|technology|foundation|network)(?::\d+)?(?:\/[^\s<>"'`]*)?/gi;
  let cursor = 0;

  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    const raw = match[0];
    const hasProtocol = /^https?:\/\//i.test(raw);
    const hasWww = /^www\./i.test(raw);
    if (start > 0 && /[\w@]/.test(text[start - 1])) continue;
    let urlLength = raw.length;
    while (urlLength > 0 && /[.,!?;:]/.test(raw[urlLength - 1])) urlLength--;
    for (const [open, close] of [["(", ")"], ["[", "]"], ["{", "}"]]) {
      while (
        urlLength > 0 &&
        raw[urlLength - 1] === close &&
        raw.slice(0, urlLength).split(close).length >
          raw.slice(0, urlLength).split(open).length
      ) {
        urlLength--;
      }
    }

    if (!urlLength) continue;
    if (start > cursor) segments.push({ text: text.slice(cursor, start) });
    const url = raw.slice(0, urlLength);
    segments.push({
      text: url,
      href: hasProtocol ? url : `https://${url}`,
    });
    cursor = start + urlLength;
  }

  if (cursor < text.length) segments.push({ text: text.slice(cursor) });
  return segments.length ? segments : [{ text }];
}

async function openLink(href: string) {
  try {
    await openBrowserLink(href);
  } catch {
    Alert.alert(
      "No se pudo abrir el enlace",
      "Comprueba que el dispositivo tenga un navegador disponible.",
    );
  }
}

export function AutoLinkText({
  text,
  style,
  selectable,
}: {
  text: string | null | undefined;
  style?: StyleProp<TextStyle>;
  selectable?: boolean;
}) {
  return (
    <Text style={style} selectable={selectable}>
      {splitLinks(text ?? "").map((segment, index) =>
        segment.href ? (
          <Text
            key={index}
            accessibilityRole="link"
            onPress={(event) => {
              event.stopPropagation();
              void openLink(segment.href!);
            }}
            style={{ textDecorationLine: "underline" }}
          >
            {segment.text}
          </Text>
        ) : (
          <React.Fragment key={index}>{segment.text}</React.Fragment>
        ),
      )}
    </Text>
  );
}
