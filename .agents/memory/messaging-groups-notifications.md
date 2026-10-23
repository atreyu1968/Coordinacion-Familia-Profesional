---
name: Messaging groups and mobile notifications
description: User requirements for voluntary groups and mobile activity notices.
---

Los usuarios deben poder crear grupos nuevos y salir de ellos. Los avisos de eventos y los anuncios del Tablón deben llegar también al móvil.

**Why:** El usuario lo pidió expresamente.

**How to apply:** Offer group creation and confirmed departure in web and mobile, using the same active-user contact directory with teaching center names. A departed member must lose message access and delivery. Explain before confirming that an empty group's history may be removed.

Keep voluntary group departure separate from module groups: automatic module participation follows teaching assignments.

**Why:** Otherwise the next assignment synchronization would immediately re-add a person who left, contradicting the automatic participation rule.

**How to apply:** Do not offer independent departure from automatic module groups; direct the user to their teaching assignments instead.

Mobile notices must cover creation, updates and cancellation of calendar events, plus invitations to voluntary groups and group activity, within the recipient's permitted audience.

**Why:** The user emphasized notifications for all events on mobile, not only their creation.

**How to apply:** Preserve in-app notices and use both configured push channels. Do not promise device delivery without notification permission and a working device subscription or native push credentials.

For a user's own messages, support both hiding only from that user's view and deleting for everyone. Hiding a conversation affects only that user's list; preserve the membership and history for everyone else.

**Why:** The user explicitly chose both message deletion options and hiding conversations only for themselves.

**How to apply:** Keep private message hides scoped to the caller. Do not hard-delete shared history or remove group membership when hiding a conversation; new activity or reopening a direct chat may make it visible again to the caller.
