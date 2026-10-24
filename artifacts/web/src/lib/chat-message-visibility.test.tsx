import React, { useState } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
  ChatMessageVisibilityMenuItems,
  HiddenChatMessageRow,
} from "@/components/chat-message-visibility";
import {
  deleteChatMessageForEveryone,
  hideChatMessage,
  restoreChatMessage,
} from "./chat-message-state";
import { confirmChatMessageDeletion } from "./chat-message-confirmation";
import type { HiddenChatMessage } from "@/components/chat-message-visibility";

import {
  ChatMessageVisibilityActions,
  HiddenChatMessageRow as MobileHiddenChatMessageRow,
} from "../../../movil/components/ChatMessageVisibility";
import {
  deleteChatMessageForEveryone as deleteMobileMessage,
  hideChatMessage as hideMobileMessage,
  restoreChatMessage as restoreMobileMessage,
} from "../../../movil/lib/chat-message-state";
import { requestChatMessageDeletionConfirmation } from "../../../movil/lib/chat-message-confirmation";
import { alertMock } from "../test/react-native-mock";

function NativeView({
  children,
  testID,
}: {
  children?: React.ReactNode;
  testID?: string;
}) {
  return <div data-testid={testID}>{children}</div>;
}

function NativeText({ children }: { children?: React.ReactNode }) {
  return <span>{children}</span>;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

type TestMessage = HiddenChatMessage & { senderId: number };

const baseline: TestMessage = {
  id: 1,
  senderId: 4,
  createdAt: "2026-10-24T10:00:00.000Z",
  content: "Mensaje anterior",
};
const target: TestMessage = {
  id: 2,
  senderId: 4,
  createdAt: "2026-10-24T10:01:00.000Z",
  content: "Contenido para ocultar",
};

function WebHarness() {
  const [messages, setMessages] = useState<TestMessage[]>([baseline, target]);
  const [hiddenMessages, setHiddenMessages] = useState<TestMessage[]>([]);
  const hiddenMessage = (message: TestMessage) => {
    setMessages((previous) =>
      hideChatMessage(previous, [], message, false).messages,
    );
    setHiddenMessages((previous) =>
      hideChatMessage([], previous, message, false).hiddenMessages,
    );
  };
  const restoredMessage = (message: TestMessage) => {
    setMessages((previous) =>
      restoreChatMessage(previous, [], message, false).messages,
    );
    setHiddenMessages((previous) =>
      restoreChatMessage([], previous, message, false).hiddenMessages,
    );
  };
  const deletedMessage = (message: TestMessage) => {
    setMessages((previous) =>
      deleteChatMessageForEveryone(previous, [], {
        ...message,
        deleted: true,
        content: "",
      }).messages,
    );
    setHiddenMessages((previous) =>
      deleteChatMessageForEveryone(previous, [], {
        ...message,
        deleted: true,
        content: "",
      }).hiddenMessages,
    );
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button">Más acciones</button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <ChatMessageVisibilityMenuItems
            onHide={() => hiddenMessage(target)}
            onDelete={() =>
              confirmChatMessageDeletion(window.confirm.bind(window), () =>
                deletedMessage(target),
              )
            }
          />
        </DropdownMenuContent>
      </DropdownMenu>
      <div data-testid="conversation">
        {messages.map((message) => (
          <p key={message.id}>
            {message.deleted ? "Mensaje eliminado para todos" : message.content}
          </p>
        ))}
      </div>
      <ul data-testid="hidden-list">
        {hiddenMessages.map((message) => (
          <HiddenChatMessageRow
            key={message.id}
            message={message}
            subtitle="Conversación de prueba"
            onRestore={() => restoredMessage(message)}
          />
        ))}
      </ul>
    </>
  );
}

function MobileHarness() {
  const [messages, setMessages] = useState<TestMessage[]>([baseline, target]);
  const [hiddenMessages, setHiddenMessages] = useState<TestMessage[]>([]);
  const [activeConfirmation, setActiveConfirmation] = useState<{
    title: string;
    body: string;
  } | null>(null);
  const hiddenMessage = (message: TestMessage) => {
    setMessages((previous) =>
      hideMobileMessage(previous, [], message, true).messages,
    );
    setHiddenMessages((previous) =>
      hideMobileMessage([], previous, message, true).hiddenMessages,
    );
  };
  const restoredMessage = (message: TestMessage) => {
    setMessages((previous) =>
      restoreMobileMessage(previous, [], message, true).messages,
    );
    setHiddenMessages((previous) =>
      restoreMobileMessage([], previous, message, true).hiddenMessages,
    );
  };
  const deletedMessage = (message: TestMessage) => {
    const tombstone = { ...message, deleted: true, content: "" };
    setMessages((previous) =>
      deleteMobileMessage(previous, [], tombstone).messages,
    );
    setHiddenMessages((previous) =>
      deleteMobileMessage([], previous, tombstone).hiddenMessages,
    );
  };
  const showDeleteConfirmation = () => {
    requestChatMessageDeletionConfirmation(
      (title, body, buttons) => {
        setActiveConfirmation({ title, body });
        alertMock(title, body, buttons);
      },
      () => deletedMessage(target),
    );
  };

  return (
    <>
      <NativeView>
        <ChatMessageVisibilityActions
          onHide={() => hiddenMessage(target)}
          onDelete={showDeleteConfirmation}
          itemStyle={undefined}
          textStyle={undefined}
          destructiveColor="#aa0000"
        />
      </NativeView>
      <NativeView testID="conversation">
        {messages.map((message) => (
          <NativeText key={message.id}>
            {message.deleted ? "Mensaje eliminado para todos" : message.content}
          </NativeText>
        ))}
      </NativeView>
      <NativeView testID="hidden-list">
        {hiddenMessages.map((message) => (
          <MobileHiddenChatMessageRow
            key={message.id}
            message={message}
            subtitle="Conversación de prueba"
            foregroundColor="#111111"
            mutedColor="#666666"
            primaryColor="#0055aa"
            borderColor="#dddddd"
            onRestore={() => restoredMessage(message)}
          />
        ))}
      </NativeView>
      {activeConfirmation ? (
        <NativeText>{activeConfirmation.title}</NativeText>
      ) : null}
    </>
  );
}

function expectListState(conversation: string, hidden: string) {
  expect(screen.getByTestId("conversation").textContent).toBe(conversation);
  expect(screen.getByTestId("hidden-list").textContent).toBe(hidden);
}

describe("chat message visibility controls", () => {
  it("web: hides, restores, and deletes from the rendered conversation controls", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<WebHarness />);

    fireEvent.pointerDown(screen.getByRole("button", { name: "Más acciones" }), {
      button: 0,
      ctrlKey: false,
      pointerType: "mouse",
    });
    fireEvent.click(screen.getByRole("menuitem", { name: "Ocultar solo para mí" }));
    expectListState("Mensaje anterior", "Contenido para ocultarConversación de pruebaRestaurar");

    fireEvent.click(screen.getByRole("button", { name: "Restaurar" }));
    expectListState("Mensaje anteriorContenido para ocultar", "");

    fireEvent.pointerDown(screen.getByRole("button", { name: "Más acciones" }), {
      button: 0,
      ctrlKey: false,
      pointerType: "mouse",
    });
    fireEvent.click(screen.getByRole("menuitem", { name: "Eliminar para todos" }));
    expect(confirm).toHaveBeenCalledWith(
      "Se sustituirá este mensaje por «Mensaje eliminado» para todas las personas de la conversación. ¿Continuar?",
    );
    expectListState("Mensaje anteriorMensaje eliminado para todos", "");
  });

  it("web: shows tombstone wording for a message that was already hidden", () => {
    function HiddenTombstoneHarness() {
      const tombstone = { ...target, deleted: true, content: "" };
      return (
        <>
          <div data-testid="conversation">Mensaje anterior</div>
          <ul data-testid="hidden-list">
            <HiddenChatMessageRow
              message={tombstone}
              subtitle="Conversación de prueba"
              onRestore={() => {}}
            />
          </ul>
        </>
      );
    }

    render(<HiddenTombstoneHarness />);
    expectListState("Mensaje anterior", "Mensaje eliminado para todosConversación de prueba");
    expect(within(screen.getByTestId("hidden-list")).queryByRole("button", { name: "Restaurar" })).toBeNull();
  });

  it("mobile: hides, restores, and deletes from the rendered chat controls", () => {
    alertMock.mockClear();
    render(<MobileHarness />);

    fireEvent.click(screen.getByRole("button", { name: "Ocultar solo para mí" }));
    expectListState("Mensaje anterior", "Contenido para ocultarConversación de pruebaRestaurar");

    fireEvent.click(screen.getByRole("button", { name: "Restaurar mensaje" }));
    expectListState("Contenido para ocultarMensaje anterior", "");

    fireEvent.click(screen.getByRole("button", { name: "Eliminar para todos" }));
    expect(alertMock).toHaveBeenCalledOnce();
    const [title, body, buttons] = alertMock.mock.calls[0];
    expect(title).toBe("Eliminar para todos");
    expect(body).toContain("«Mensaje eliminado»");
    act(() => buttons?.find((button) => button.text === "Eliminar")?.onPress?.());
    expectListState("Mensaje eliminado para todosMensaje anterior", "");
  });

  it("mobile: shows tombstone wording for a message that was already hidden", () => {
    const tombstone = { ...target, deleted: true, content: "" };
    render(
      <>
        <NativeView testID="conversation">
          <NativeText>Mensaje anterior</NativeText>
        </NativeView>
        <NativeView testID="hidden-list">
          <MobileHiddenChatMessageRow
            message={tombstone}
            subtitle="Conversación de prueba"
            foregroundColor="#111111"
            mutedColor="#666666"
            primaryColor="#0055aa"
            borderColor="#dddddd"
            onRestore={() => {}}
          />
        </NativeView>
      </>,
    );
    expectListState("Mensaje anterior", "Mensaje eliminado para todosConversación de prueba");
    expect(screen.queryByRole("button", { name: "Restaurar mensaje" })).toBeNull();
  });
});
