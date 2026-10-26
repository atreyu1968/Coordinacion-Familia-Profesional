import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const query = vi.hoisted(() => ({
  data: [] as Array<{ id: number; title: string; description: string; status: string; lessonCount: number }>,
  isLoading: false, isError: false, isRefetching: false, refetch: vi.fn(),
}));
vi.mock("@workspace/api-client-react", () => ({
  useListLmsCourses: () => query,
  getListLmsCoursesQueryKey: () => ["/api/lms/courses"],
}));

vi.mock("react-native", async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(),
  StyleSheet: { create: (styles: Record<string, unknown>) => styles },
  ActivityIndicator: () => <div role="status">Cargando cursos</div>,
  FlatList: ({ data, renderItem, ListHeaderComponent, ListEmptyComponent }: {
    data: typeof query.data;
    renderItem: (props: { item: typeof query.data[number] }) => React.ReactNode;
    ListHeaderComponent: React.ReactNode;
    ListEmptyComponent: React.ReactNode;
  }) => <div>{ListHeaderComponent}{data.length
    ? data.map((item) => <React.Fragment key={item.id}>{renderItem({ item })}</React.Fragment>)
    : ListEmptyComponent}</div>,
}));
vi.mock("../../../movil/components/LmsCourseCover", () => ({
  LmsCourseCover: () => <div data-testid="course-cover" />,
}));
vi.mock("../../../movil/components/AppHeader", () => ({
  AppHeader: () => <header>Cursos autodirigidos</header>,
}));
vi.mock("../../../movil/hooks/useColors", () => ({
  useColors: () => ({ background: "#fff", foreground: "#111", card: "#fff", border: "#ddd", mutedForeground: "#666" }),
}));
afterEach(cleanup);
beforeEach(() => {
  query.data = [];
  query.isLoading = false;
  query.isError = false;
  query.refetch.mockClear();
});

// Runtime imports keep Expo's private @/ aliases out of web's TS project.
it.each([["catálogo", "../../../movil/app/lms.tsx"], ["enlace directo al curso", "../../../movil/app/lms/[id].tsx"]] as const)(
  "mantiene el aviso y bloquea la realización al acceder a %s desde móvil/PWA",
  async (_name, routePath) => {
    const { default: Route } = await vi.importActual<{ default: React.ComponentType }>(routePath);
    render(<Route />);
    expect(screen.getByText("Disponible en la aplicación web")).toBeTruthy();
    expect(screen.getByText(/Para realizar los cursos, accede a la aplicación web desde un ordenador/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Abrir curso|Siguiente|Completar|Comenzar/i })).toBeNull();
    expect(document.querySelector("iframe, video, input")).toBeNull();
  },
);

async function renderCatalog() {
  const { default: Route } = await vi.importActual<{ default: React.ComponentType }>("../../../movil/app/lms.tsx");
  return render(<Route />);
}

it("muestra cursos publicados con descripción y lecciones sin permitir realizarlos", async () => {
  query.data = [
    { id: 1, title: "Gestión administrativa", description: "Descripción del curso", lessonCount: 6, status: "published" },
    { id: 2, title: "Curso sin publicar", description: "", lessonCount: 1, status: "draft" },
  ];
  await renderCatalog();
  expect(screen.getByText("Gestión administrativa")).toBeTruthy();
  expect(screen.getByText("Descripción del curso")).toBeTruthy();
  expect(screen.getByText("6 lecciones · Solo en la web")).toBeTruthy();
  expect(screen.queryByText("Curso sin publicar")).toBeNull();
  expect(screen.queryByRole("button", { name: /Abrir curso|Comenzar|Continuar/i })).toBeNull();
  expect(document.querySelector("iframe, video, input")).toBeNull();
});

it("muestra un estado vacío si no hay cursos disponibles", async () => {
  await renderCatalog();
  expect(screen.getByText("Todavía no hay cursos disponibles.")).toBeTruthy();
});

it("muestra la carga y permite reintentar si falla la consulta", async () => {
  query.isLoading = true;
  const view = await renderCatalog();
  expect(screen.getByRole("status")).toBeTruthy();
  expect(screen.queryByText("Todavía no hay cursos disponibles.")).toBeNull();
  query.isLoading = false;
  query.isError = true;
  view.rerender(React.createElement(
    (await vi.importActual<{ default: React.ComponentType }>("../../../movil/app/lms.tsx")).default,
  ));
  expect(screen.getByText("No se pudo actualizar el catálogo de cursos.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Reintentar cargar cursos" }));
  expect(query.refetch).toHaveBeenCalledTimes(1);
});
