import { describe, expect, it } from "vitest";
import {
  deleteChatMessageForEveryone as deleteWebMessage,
  hideChatMessage as hideWebMessage,
  restoreChatMessage as restoreWebMessage,
  runChatMessageAction as runWebChatMessageAction,
  type ChatMessageLists,
} from "./chat-message-state";
import {
  deleteChatMessageForEveryone as deleteMobileMessage,
  hideChatMessage as hideMobileMessage,
  restoreChatMessage as restoreMobileMessage,
  runChatMessageAction as runMobileChatMessageAction,
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

type RunChatMessageAction = <TResult>(
  request: () => Promise<TResult>,
  onSuccess: (result: TResult) => void | Promise<void>,
) => Promise<TResult>;

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

async function expectRejectedActionToPreserveState<TResult>(
  runAction: RunChatMessageAction,
  initial: ChatMessageLists<TestMessage>,
  response: TResult,
  commit: (
    state: ChatMessageLists<TestMessage>,
    result: TResult,
  ) => ChatMessageLists<TestMessage>,
) {
  let state = initial;
  let attempts = 0;
  let successfulCommits = 0;

  const request = async (): Promise<TResult> => {
    attempts += 1;
    if (attempts === 1) throw new Error("Request rejected");
    return response;
  };
  const onSuccess = (result: TResult) => {
    successfulCommits += 1;
    state = commit(state, result);
  };

  await expect(runAction(request, onSuccess)).rejects.toThrow("Request rejected");
  expect(state).toEqual(initial);
  expect(successfulCommits).toBe(0);

  await runAction(request, onSuccess);
  expect(attempts).toBe(2);
  expect(successfulCommits).toBe(1);
  expect(state).toEqual(commit(initial, response));
  return state;
}

async function runRejectedActionAssertions(
  runAction: RunChatMessageAction,
  hide: typeof hideWebMessage,
  restore: typeof restoreWebMessage,
  deleteForEveryone: typeof deleteWebMessage,
  newestFirst: boolean,
) {
  const visible = newestFirst ? [target, first] : [first, target];

  await expectRejectedActionToPreserveState(
    runAction,
    { messages: visible, hiddenMessages: [] },
    undefined,
    (state) =>
      hide(state.messages, state.hiddenMessages, target, newestFirst),
  );

  await expectRejectedActionToPreserveState(
    runAction,
    { messages: [first], hiddenMessages: [target] },
    target,
    (state, restored) =>
      restore(state.messages, state.hiddenMessages, restored, newestFirst),
  );

  const tombstone = {
    ...target,
    deleted: true,
    content: "",
    attachmentName: null,
    attachmentUrl: null,
    reactions: [],
  };
  const visibleAfterDelete = await expectRejectedActionToPreserveState(
    runAction,
    { messages: visible, hiddenMessages: [] },
    tombstone,
    (state, deleted) =>
      deleteForEveryone(state.messages, state.hiddenMessages, deleted),
  );
  expect(visibleAfterDelete.messages.find((message) => message.id === target.id))
    .toMatchObject({ deleted: true, content: "" });

  const hiddenAfterDelete = await expectRejectedActionToPreserveState(
    runAction,
    { messages: [first], hiddenMessages: [target] },
    tombstone,
    (state, deleted) =>
      deleteForEveryone(state.messages, state.hiddenMessages, deleted),
  );
  expect(hiddenAfterDelete.hiddenMessages[0]).toMatchObject({
    id: target.id,
    deleted: true,
    content: "",
  });
}

async function expectOverlappingFailureNotToUndoSuccess(
  runAction: RunChatMessageAction,
  hide: typeof hideWebMessage,
  newestFirst: boolean,
) {
  let state: ChatMessageLists<TestMessage> = {
    messages: newestFirst ? [target, first] : [first, target],
    hiddenMessages: [],
  };
  let resolveSuccessfulRequest!: () => void;
  let rejectFailedRequest!: (error: Error) => void;
  const successfulRequest = new Promise<void>((resolve) => {
    resolveSuccessfulRequest = resolve;
  });
  const failedRequest = new Promise<void>((_resolve, reject) => {
    rejectFailedRequest = reject;
  });
  const commitHide = () => {
    state = hide(state.messages, state.hiddenMessages, target, newestFirst);
  };

  const successfulAction = runAction(
    () => successfulRequest,
    commitHide,
  );
  const failedAction = runAction(
    () => failedRequest,
    commitHide,
  );

  resolveSuccessfulRequest();
  await successfulAction;
  expect(state.messages.map((message) => message.id)).toEqual([first.id]);
  expect(state.hiddenMessages).toEqual([target]);

  rejectFailedRequest(new Error("Concurrent request rejected"));
  await expect(failedAction).rejects.toThrow("Concurrent request rejected");
  expect(state.messages.map((message) => message.id)).toEqual([first.id]);
  expect(state.hiddenMessages).toEqual([target]);
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

  it("preserves the message lists after rejected hide, restore, and delete requests, then retries", async () => {
    await runRejectedActionAssertions(
      runWebChatMessageAction,
      hideWebMessage,
      restoreWebMessage,
      deleteWebMessage,
      false,
    );
  });

  it("keeps a successful overlapping action when its peer request fails", async () => {
    await expectOverlappingFailureNotToUndoSuccess(
      runWebChatMessageAction,
      hideWebMessage,
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

  it("preserves the message lists after rejected hide, restore, and delete requests, then retries", async () => {
    await runRejectedActionAssertions(
      runMobileChatMessageAction,
      hideMobileMessage,
      restoreMobileMessage,
      deleteMobileMessage,
      true,
    );
  });

  it("keeps a successful overlapping action when its peer request fails", async () => {
    await expectOverlappingFailureNotToUndoSuccess(
      runMobileChatMessageAction,
      hideMobileMessage,
      true,
    );
  });
});
