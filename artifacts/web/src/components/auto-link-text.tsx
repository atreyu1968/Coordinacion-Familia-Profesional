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

export function AutoLinkText({
  text,
  className,
}: {
  text: string | null | undefined;
  className?: string;
}) {
  return (
    <span className={className}>
      {splitLinks(text ?? "").map((segment, index) =>
        segment.href ? (
          <a
            key={index}
            href={segment.href}
            target="_blank"
            rel="noopener noreferrer"
            className="break-all underline underline-offset-2"
          >
            {segment.text}
          </a>
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
    </span>
  );
}
