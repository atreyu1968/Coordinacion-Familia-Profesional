export type ChatMessageStateItem = {
  id: number;
  createdAt: string | Date;
  deleted?: boolean;
};

export type ChatMessageLists<T> = {
  messages: T[];
  hiddenMessages: T[];
};

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

export function hideChatMessage<T extends ChatMessageStateItem>(
  messages: T[],
  hiddenMessages: T[],
  message: T,
  newestFirst = false,
): ChatMessageLists<T> {
  return {
    messages: messages.filter((candidate) => candidate.id !== message.id),
    hiddenMessages: message.deleted
      ? hiddenMessages
      : upsertMessage(hiddenMessages, message, newestFirst),
  };
}

export function restoreChatMessage<T extends ChatMessageStateItem>(
  messages: T[],
  hiddenMessages: T[],
  message: T,
  newestFirst = false,
): ChatMessageLists<T> {
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
