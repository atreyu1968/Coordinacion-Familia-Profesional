import { describe, expect, it } from "vitest";
import {
  createChatMessageActionGuard as createWebActionGuard,
  deleteChatMessageForEveryone as deleteWebMessage,
  hideChatMessage as hideWebMessage,
  mergeChatMessageUpdates as mergeWebMessages,
  restoreChatMessage as restoreWebMessage,
  runChatMessageAction as runWebChatMessageAction,
  type ChatMessageLists,
} from "./chat-message-state";
import {
  createChatMessageActionGuard as createMobileActionGuard,
  deleteChatMessageForEveryone as deleteMobileMessage,
  hideChatMessage as hideMobileMessage,
  mergeChatMessageUpdates as mergeMobileMessages,
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

  const staleRestore = restore(
    deletedWhileHidden.messages,
    deletedWhileHidden.hiddenMessages,
    target,
    newestFirst,
  );
  expect(staleRestore.messages.map((message) => message.id)).toEqual([first.id]);
  expect(staleRestore.hiddenMessages[0]).toMatchObject({
    id: target.id,
    deleted: true,
    content: "",
  });
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

async function expectOutOfOrderActionsToKeepServerState(
  runAction: RunChatMessageAction,
  createGuard: typeof createWebActionGuard,
  hide: typeof hideWebMessage,
  restore: typeof restoreWebMessage,
  deleteForEveryone: typeof deleteWebMessage,
  mergeMessages: typeof mergeWebMessages,
  newestFirst: boolean,
) {
  const guard = createGuard();
  const id = target.id;
  let state: ChatMessageLists<TestMessage> = {
    messages: newestFirst ? [target, first] : [first, target],
    hiddenMessages: [],
  };

  let resolveHide!: (message: TestMessage) => void;
  let resolveRestore!: (message: TestMessage) => void;
  const hideResponse = new Promise<TestMessage>((resolve) => {
    resolveHide = resolve;
  });
  const restoreResponse = new Promise<TestMessage>((resolve) => {
    resolveRestore = resolve;
  });
  const serverState: ChatMessageLists<TestMessage> = {
    messages: newestFirst ? [target, first] : [first, target],
    hiddenMessages: [],
  };
  let authoritativeRefreshes = 0;

  const hideVersion = guard.begin(id);
  const hideAction = runAction(() => hideResponse, () => {
    if (!guard.isCurrent(id, hideVersion)) {
      authoritativeRefreshes += 1;
      state = serverState;
      return;
    }
    state = hide(state.messages, state.hiddenMessages, target, newestFirst);
  });
  const restoreVersion = guard.begin(id);
  const restoreAction = runAction(() => restoreResponse, (restored) => {
    if (!guard.isCurrent(id, restoreVersion)) {
      authoritativeRefreshes += 1;
      state = serverState;
      return;
    }
    state = restore(state.messages, state.hiddenMessages, restored, newestFirst);
  });

  resolveRestore(target);
  await restoreAction;
  resolveHide(target);
  await hideAction;

  expect(authoritativeRefreshes).toBe(1);
  expect(state.messages.map((message) => message.id)).toEqual(
    (newestFirst ? [target, first] : [first, target]).map((message) => message.id),
  );
  expect(state.hiddenMessages).toEqual([]);

  // Start hide, restore, then delete; let deletion finish before the older
  // accepted actions. The older responses must neither expose the content nor
  // move the tombstone out of the hidden list.
  state = { messages: [first], hiddenMessages: [target] };
  const deletionGuard = createGuard();
  const oldPrivateResponse = { ...target };
  const deletion = { ...target, deleted: true };
  let resolveOldHide!: (message: TestMessage) => void;
  let resolveOldRestore!: (message: TestMessage) => void;
  let resolveDelete!: (message: TestMessage) => void;
  const oldHideResponse = new Promise<TestMessage>((resolve) => {
    resolveOldHide = resolve;
  });
  const oldRestoreResponse = new Promise<TestMessage>((resolve) => {
    resolveOldRestore = resolve;
  });
  const deleteResponse = new Promise<TestMessage>((resolve) => {
    resolveDelete = resolve;
  });
  const pendingHideVersion = deletionGuard.begin(id);
  const pendingHide = runAction(() => oldHideResponse, () => {
    if (!deletionGuard.isCurrent(id, pendingHideVersion)) {
      state = serverDeletedState;
      return;
    }
    state = hide(state.messages, state.hiddenMessages, oldPrivateResponse, newestFirst);
  });
  const pendingRestoreVersion = deletionGuard.begin(id);
  const pendingRestore = runAction(() => oldRestoreResponse, (restored) => {
    if (!deletionGuard.isCurrent(id, pendingRestoreVersion)) {
      state = serverDeletedState;
      return;
    }
    state = restore(state.messages, state.hiddenMessages, restored, newestFirst);
  });
  const deleteVersion = deletionGuard.begin(id);
  const deleteAction = runAction(() => deleteResponse, (deleted) => {
    if (!deletionGuard.isCurrent(id, deleteVersion)) return;
    deletionGuard.markDeleted(id);
    state = deleteForEveryone(state.messages, state.hiddenMessages, deleted);
  });
  const serverDeletedState = deleteForEveryone(
    [first],
    [target],
    deletion,
  );

  resolveDelete(deletion);
  await deleteAction;
  resolveOldRestore(oldPrivateResponse);
  await pendingRestore;
  resolveOldHide(oldPrivateResponse);
  await pendingHide;

  // Even a stale history/realtime payload cannot replace the redacted copy.
  state.messages = mergeMessages(
    state.messages,
    [oldPrivateResponse],
    newestFirst,
    deletionGuard.isDeleted,
  );

  expect(state.messages.map((message) => message.id)).toEqual([first.id]);
  expect(state.hiddenMessages).toHaveLength(1);
  expect(state.hiddenMessages[0]).toMatchObject({
    id,
    deleted: true,
    content: "",
  });
  expect(JSON.stringify(state)).not.toContain("contenido privado");
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

  it("keeps the latest server state when hide, restore, and delete responses finish out of order", async () => {
    await expectOutOfOrderActionsToKeepServerState(
      runWebChatMessageAction,
      createWebActionGuard,
      hideWebMessage,
      restoreWebMessage,
      deleteWebMessage,
      mergeWebMessages,
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

  it("keeps the latest server state when hide, restore, and delete responses finish out of order", async () => {
    await expectOutOfOrderActionsToKeepServerState(
      runMobileChatMessageAction,
      createMobileActionGuard,
      hideMobileMessage,
      restoreMobileMessage,
      deleteMobileMessage,
      mergeMobileMessages,
      true,
    );
  });
});
