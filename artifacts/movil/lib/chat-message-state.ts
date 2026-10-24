export type ChatMessageStateItem = {
  id: number;
  createdAt: string | Date;
  deleted?: boolean;
};

export type ChatMessageLists<T> = {
  messages: T[];
  hiddenMessages: T[];
};

export type ChatMessageActionGuard = {
  begin: (messageId: number) => number;
  isCurrent: (messageId: number, version: number) => boolean;
  markDeleted: (messageId: number) => void;
  isDeleted: (messageId: number) => boolean;
};

export function createChatMessageActionGuard(): ChatMessageActionGuard {
  let nextVersion = 0;
  const latestVersions = new Map<number, number>();
  const deletedIds = new Set<number>();

  return {
    begin(messageId) {
      const version = ++nextVersion;
      latestVersions.set(messageId, version);
      return version;
    },
    isCurrent(messageId, version) {
      return !deletedIds.has(messageId) && latestVersions.get(messageId) === version;
    },
    markDeleted(messageId) {
      deletedIds.add(messageId);
      latestVersions.set(messageId, ++nextVersion);
    },
    isDeleted(messageId) {
      return deletedIds.has(messageId);
    },
  };
}

export async function runChatMessageAction<TResult>(
  request: () => Promise<TResult>,
  onSuccess: (result: TResult) => void | Promise<void>,
): Promise<TResult> {
  const result = await request();
  await onSuccess(result);
  return result;
}

function sortMessages<T extends ChatMessageStateItem>(
  messages: T[],
  newestFirst: boolean,
): T[] {
  return [...messages].sort((a, b) => {
    const difference =
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    return newestFirst ? -difference : difference;
  });
}

function upsertMessage<T extends ChatMessageStateItem>(
  messages: T[],
  message: T,
  newestFirst: boolean,
): T[] {
  return sortMessages(
    [...messages.filter((candidate) => candidate.id !== message.id), message],
    newestFirst,
  );
}

function tombstone<T extends ChatMessageStateItem>(message: T): T {
  if (!message.deleted) return message;
  return {
    ...message,
    content: "",
    attachmentPath: null,
    attachmentUrl: null,
    attachmentName: null,
    attachmentType: null,
    attachmentSize: null,
    editedAt: null,
    replyToContent: null,
    replyToSenderName: null,
    forwardedFrom: null,
    reactions: [],
  } as T;
}

export function mergeChatMessageUpdates<T extends ChatMessageStateItem>(
  current: T[],
  incoming: T[],
  newestFirst = false,
  isDeleted?: (messageId: number) => boolean,
): T[] {
  const byId = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) {
    const existing = byId.get(message.id);
    if (existing?.deleted) {
      byId.set(message.id, tombstone(existing));
      continue;
    }
    if (isDeleted?.(message.id) && !message.deleted) continue;
    byId.set(message.id, message.deleted ? tombstone(message) : message);
  }
  return sortMessages(Array.from(byId.values()), newestFirst);
}

function existingTombstone<T extends ChatMessageStateItem>(
  messages: T[],
  hiddenMessages: T[],
  messageId: number,
): ChatMessageLists<T> | undefined {
  const hiddenTombstone = hiddenMessages.find(
    (candidate) => candidate.id === messageId && candidate.deleted,
  );
  const visibleTombstone = messages.find(
    (candidate) => candidate.id === messageId && candidate.deleted,
  );
  const deletedMessage = hiddenTombstone ?? visibleTombstone;
  if (!deletedMessage) return undefined;

  if (hiddenTombstone) {
    return {
      messages: messages.filter((candidate) => candidate.id !== messageId),
      hiddenMessages: [
        ...hiddenMessages.filter((candidate) => candidate.id !== messageId),
        tombstone(hiddenTombstone),
      ],
    };
  }
  return {
    messages: [
      ...messages.filter((candidate) => candidate.id !== messageId),
      tombstone(deletedMessage),
    ],
    hiddenMessages: hiddenMessages.filter(
      (candidate) => candidate.id !== messageId,
    ),
  };
}

export function hideChatMessage<T extends ChatMessageStateItem>(
  messages: T[],
  hiddenMessages: T[],
  message: T,
  newestFirst = true,
): ChatMessageLists<T> {
  const deleted = existingTombstone(messages, hiddenMessages, message.id);
  if (deleted) return deleted;
  if (message.deleted) return { messages, hiddenMessages };
  return {
    messages: messages.filter((candidate) => candidate.id !== message.id),
    hiddenMessages: upsertMessage(hiddenMessages, message, newestFirst),
  };
}

export function restoreChatMessage<T extends ChatMessageStateItem>(
  messages: T[],
  hiddenMessages: T[],
  message: T,
  newestFirst = true,
): ChatMessageLists<T> {
  const deleted = existingTombstone(messages, hiddenMessages, message.id);
  if (deleted) return deleted;
  if (message.deleted) return { messages, hiddenMessages };
  return {
    messages: upsertMessage(messages, message, newestFirst),
    hiddenMessages: hiddenMessages.filter(
      (candidate) => candidate.id !== message.id,
    ),
  };
}

export function deleteChatMessageForEveryone<T extends ChatMessageStateItem>(
  messages: T[],
  hiddenMessages: T[],
  message: T,
): ChatMessageLists<T> {
  const deletedMessage = tombstone(message);
  return {
    messages: messages.map((candidate) =>
      candidate.id === message.id ? deletedMessage : candidate,
    ),
    hiddenMessages: hiddenMessages.map((candidate) =>
      candidate.id === message.id ? deletedMessage : candidate,
    ),
  };
}
