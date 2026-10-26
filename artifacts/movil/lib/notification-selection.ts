import { useLocalSearchParams } from "expo-router";

export function useNoticeId(param = "aviso"): number | null {
  const params = useLocalSearchParams<Record<string, string | string[]>>();
  const raw = params[param];
  return typeof raw === "string" && /^[1-9]\d*$/.test(raw) && Number(raw) <= 2147483647 ? Number(raw) : null;
}

/** Only narrows the authorized result set. Never bypasses resource API permissions. */
export function useNoticeItems<T>(items: T[], key: keyof T = "id" as keyof T): T[] {
  const id = useNoticeId();
  return id == null ? items : items.filter((item) => item[key] === id);
}
