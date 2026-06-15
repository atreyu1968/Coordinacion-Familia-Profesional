import { useSearchParams } from "wouter";

export function useModuleParam(): number | null {
  const [searchParams] = useSearchParams();
  const raw = searchParams.get("module");
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}
