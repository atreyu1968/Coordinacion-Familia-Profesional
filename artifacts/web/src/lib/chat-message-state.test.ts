import { describe, expect, it } from "vitest";
import {
  deleteChatMessageForEveryone as deleteWebMessage,
  hideChatMessage as hideWebMessage,
  restoreChatMessage as restoreWebMessage,
} from "./chat-message-state";
import {
  deleteChatMessageForEveryone as deleteMobileMessage,
  hideChatMessage as hideMobileMessage,
  restoreChatMessage as restoreMobileMessage,
} from "../../../movil/lib/chat-message-state";

type TestMessage = {
  id: number;
  groupId: number;
  senderId: number;
  createdAt: string;
  content: string;
  deleted: boolean;
  attachmentName: string | null;
  attachmentUrl: string | null;
  reactions: { emoji: string }[];
};

const first: TestMessage = {
  id: 1,
  groupId: 42,
  senderId: 7,
  createdAt: "2026-10-24T10:00:00.000Z",
  content: "primer mensaje",
  deleted: false,
  attachmentName: null,
  attachmentUrl: null,
  reactions: [],
};
const target: TestMessage = {
  ...first,
  id: 2,
  content: "contenido privado que debe desaparecer",
  createdAt: "2026-10-24T10:01:00.000Z",
};

function runMessageListAssertions(
  hide: typeof hideWebMessage,
  restore: typeof restoreWebMessage,
  deleteForEveryone: typeof deleteWebMessage,
  newestFirst: boolean,
) {
  const chronological = newestFirst ? [target, first] : [first, target];
  const hidden = hide(chronological, [], target, newestFirst);
  expect(hidden.messages.map((message) => message.id)).toEqual([1]);
  expect(hidden.hiddenMessages).toEqual([target]);

  const restored = restore(
    hidden.messages,
    hidden.hiddenMessages,
    target,
    newestFirst,
  );
  expect(restored.messages.map((message) => message.id)).toEqual(
    chronological.map((message) => message.id),
  );
  expect(restored.hiddenMessages).toEqual([]);

  const tombstone = {
    ...target,
    deleted: true,
    content: "contenido privado que debe desaparecer",
    attachmentName: "informe-privado.pdf",
    attachmentUrl: "/api/private-attachment",
    reactions: [{ emoji: "❤️" }],
  };
  const deletedVisible = deleteForEveryone(
    restored.messages,
    restored.hiddenMessages,
    tombstone,
  );
  const visibleTombstone = deletedVisible.messages.find(
    (message) => message.id === target.id,
  );
  expect(visibleTombstone).toMatchObject({
    deleted: true,
    content: "",
    attachmentName: null,
    attachmentUrl: null,
    reactions: [],
  });
  expect(deletedVisible.hiddenMessages).toEqual([]);

  // A message already hidden by this user remains out of the conversation
  // when a deletion-for-everyone event arrives, but its trash entry becomes a
  // redacted tombstone immediately.
  const hiddenBeforeDelete = hide(chronological, [], target, newestFirst);
  const deletedWhileHidden = deleteForEveryone(
    hiddenBeforeDelete.messages,
    hiddenBeforeDelete.hiddenMessages,
    tombstone,
  );
  expect(deletedWhileHidden.messages.map((message) => message.id)).toEqual([1]);
  expect(deletedWhileHidden.hiddenMessages).toHaveLength(1);
  expect(deletedWhileHidden.hiddenMessages[0]).toMatchObject({
    id: target.id,
    deleted: true,
    content: "",
    attachmentName: null,
    attachmentUrl: null,
    reactions: [],
  });
  expect(
    JSON.stringify([
      deletedWhileHidden.messages,
      deletedWhileHidden.hiddenMessages,
    ]),
  ).not.toContain("contenido privado");
}

describe("web chat message lists", () => {
  it("updates the conversation and hidden-message list for hide, restore, and deletion", () => {
    runMessageListAssertions(
      hideWebMessage,
      restoreWebMessage,
      deleteWebMessage,
      false,
    );
  });
});

describe("mobile chat message lists", () => {
  it("updates the conversation and hidden-message list for hide, restore, and deletion", () => {
    runMessageListAssertions(
      hideMobileMessage,
      restoreMobileMessage,
      deleteMobileMessage,
      true,
    );
  });
});
