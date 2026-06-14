import type {
  Center,
  Province,
  TrainingOffer,
  Invitation,
  Module,
  Group,
  Resource,
  GdcanResource,
  Survey,
  Event,
  EventAccreditation,
  EventSpace,
  CalendarEntry,
  AnnualReport,
  Announcement,
  Notification,
  AppFeedback,
  Meeting,
  AcademicYear,
  TeacherYearConfirmation,
} from "@workspace/db";

export function toProvince(row: Province) {
  return { id: row.id, name: row.name, code: row.code ?? undefined };
}

export function toCenter(row: Center) {
  return {
    id: row.id,
    name: row.name,
    code: row.code ?? undefined,
    provinceId: row.provinceId,
    islandId: row.islandId,
    municipalityId: row.municipalityId,
    address: row.address,
    latitude: row.latitude,
    longitude: row.longitude,
    phone: row.phone,
    email: row.email,
    website: row.website,
    nature: row.nature ?? undefined,
    centerType: row.centerType ?? undefined,
    families: row.families ?? [],
  };
}

export function toTrainingOffer(row: TrainingOffer) {
  return {
    id: row.id,
    centerId: row.centerId,
    cycleId: row.cycleId ?? null,
    cycleName: row.cycleName,
    level: row.level ?? undefined,
    shift: row.shift,
    schoolYear: row.schoolYear ?? null,
  };
}

export function toAcademicYear(row: AcademicYear) {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toTeacherYearConfirmation(
  row: TeacherYearConfirmation & { teacherName?: string | null },
) {
  return {
    id: row.id,
    teacherId: row.teacherId,
    teacherName: row.teacherName ?? undefined,
    schoolYear: row.schoolYear,
    status: row.status,
    centerId: row.centerId ?? null,
    deadline: row.deadline.toISOString(),
    confirmedAt: row.confirmedAt ? row.confirmedAt.toISOString() : null,
  };
}

export function toCycle(
  row: { id: number; name: string; code: string | null; level: string | null },
  extra?: { moduleCount?: number },
) {
  return {
    id: row.id,
    name: row.name,
    code: row.code ?? null,
    level: row.level ?? null,
    ...(extra?.moduleCount != null ? { moduleCount: extra.moduleCount } : {}),
  };
}

export function toModule(
  row: Module,
  extra?: {
    memberCount?: number;
    coordinatorId?: number | null;
    coordinatorName?: string | null;
    enrolled?: boolean;
    myRole?: string | null;
  },
) {
  return {
    id: row.id,
    code: row.code ?? undefined,
    name: row.name,
    cycleName: row.cycleName,
    cycleId: row.cycleId ?? null,
    centerId: row.centerId,
    ...(extra
      ? {
          memberCount: extra.memberCount,
          coordinatorId: extra.coordinatorId ?? null,
          coordinatorName: extra.coordinatorName ?? null,
          enrolled: extra.enrolled,
          myRole: extra.myRole ?? null,
        }
      : {}),
  };
}

export function toModuleMember(row: {
  id: number;
  moduleId: number;
  userId: number;
  userName?: string | null;
  email?: string | null;
  role: string;
  createdAt: Date;
}) {
  return {
    id: row.id,
    moduleId: row.moduleId,
    userId: row.userId,
    userName: row.userName ?? null,
    email: row.email ?? null,
    role: row.role,
    createdAt: row.createdAt,
  };
}

export function toGroup(row: Group) {
  return {
    id: row.id,
    centerId: row.centerId,
    name: row.name,
    cycleName: row.cycleName,
    schoolYear: row.schoolYear,
  };
}

export function toTeachingAssignment(row: {
  id: number;
  teacherId: number;
  teacherName?: string | null;
  moduleId: number;
  moduleName?: string | null;
  groupId: number | null;
  centerId: number;
  schoolYear: string | null;
}) {
  return {
    id: row.id,
    teacherId: row.teacherId,
    teacherName: row.teacherName ?? null,
    moduleId: row.moduleId,
    moduleName: row.moduleName ?? null,
    groupId: row.groupId,
    centerId: row.centerId,
    schoolYear: row.schoolYear,
  };
}

export function toResource(row: {
  id: number;
  title: string;
  description: string | null;
  type: string;
  fileUrl: string | null;
  authorId: number | null;
  authorName?: string | null;
  originalAuthorName: string | null;
  moduleId: number | null;
  centerId: number | null;
  createdAt: Date;
}) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    type: row.type,
    fileUrl: row.fileUrl,
    authorId: row.authorId,
    authorName: row.authorName ?? null,
    originalAuthorName: row.originalAuthorName,
    moduleId: row.moduleId,
    centerId: row.centerId,
    createdAt: row.createdAt,
  };
}

export function toCompanyAlert(row: {
  id: number;
  companyName: string;
  sector: string | null;
  location: string | null;
  positions: number | null;
  description: string | null;
  contact: string | null;
  provinceId: number | null;
  createdById: number | null;
  createdByName?: string | null;
  createdAt: Date;
}) {
  return {
    id: row.id,
    companyName: row.companyName,
    sector: row.sector,
    location: row.location,
    positions: row.positions,
    description: row.description,
    contact: row.contact,
    provinceId: row.provinceId,
    createdById: row.createdById,
    createdByName: row.createdByName ?? null,
    createdAt: row.createdAt,
  };
}

export function toGdcanResource(row: GdcanResource) {
  return {
    id: row.id,
    title: row.title,
    type: row.type,
    url: row.url,
    content: row.content,
  };
}

export function toSurvey(row: Survey) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    type: row.type as "survey" | "vote",
    anonymous: row.anonymous,
    status: row.status as "draft" | "open" | "closed",
    provinceId: row.provinceId,
    audienceType: row.audienceType as
      | "all"
      | "province"
      | "island"
      | "center"
      | "module"
      | "users",
    audienceIds: row.audienceIds ?? [],
    opensAt: row.opensAt,
    closesAt: row.closesAt,
    createdAt: row.createdAt,
  };
}

export function toEvent(row: Event) {
  return {
    id: row.id,
    name: row.name,
    type: row.type as "canarias_skills" | "jornada" | "other",
    description: row.description,
    location: row.location,
    provinceId: row.provinceId,
    startAt: row.startAt,
    endAt: row.endAt,
    status: row.status,
    createdAt: row.createdAt,
  };
}

export function toAccreditation(row: EventAccreditation) {
  return {
    id: row.id,
    eventId: row.eventId,
    holderName: row.holderName,
    holderEmail: row.holderEmail,
    role: row.role as "participant" | "jury" | "authority" | "staff",
    qrToken: row.qrToken,
    sentAt: row.sentAt,
    checkedInAt: row.checkedInAt,
  };
}

export function toEventSpace(row: EventSpace) {
  return {
    id: row.id,
    eventId: row.eventId,
    name: row.name,
    capacity: row.capacity,
    resources: row.resources ?? [],
  };
}

export function toEventStaff(row: {
  id: number;
  eventId: number;
  userId: number;
  userName?: string | null;
  task: string | null;
  role: string | null;
  shiftStart: Date | null;
  shiftEnd: Date | null;
}) {
  return {
    id: row.id,
    eventId: row.eventId,
    userId: row.userId,
    userName: row.userName ?? null,
    task: row.task,
    role: row.role,
    shiftStart: row.shiftStart,
    shiftEnd: row.shiftEnd,
  };
}

export function toCalendarEntry(row: CalendarEntry) {
  return {
    id: row.id,
    title: row.title,
    type: row.type ?? undefined,
    date: row.date,
    endDate: row.endDate,
    provinceId: row.provinceId,
    description: row.description,
    meetingId: null,
    roomName: null,
  };
}

export function toAnnualReport(row: AnnualReport) {
  return {
    id: row.id,
    schoolYear: row.schoolYear,
    provinceId: row.provinceId,
    content: row.content,
    status: row.status,
    generatedAt: row.generatedAt,
  };
}

export function toChatGroup(row: {
  id: number;
  name: string;
  type: string;
  provinceId: number | null;
  centerId: number | null;
  moduleId?: number | null;
  lastMessageAt: Date | null;
  unreadCount?: number;
}) {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    provinceId: row.provinceId,
    centerId: row.centerId,
    moduleId: row.moduleId ?? null,
    lastMessageAt: row.lastMessageAt,
    unreadCount: row.unreadCount ?? 0,
  };
}

export function toMessage(row: {
  id: number;
  groupId: number | null;
  senderId: number;
  senderName?: string | null;
  recipientId: number | null;
  content: string;
  createdAt: Date;
}) {
  return {
    id: row.id,
    groupId: row.groupId,
    senderId: row.senderId,
    senderName: row.senderName ?? null,
    recipientId: row.recipientId,
    content: row.content,
    createdAt: row.createdAt,
  };
}

export function toAnnouncement(
  row: Announcement & {
    authorName?: string | null;
    moduleName?: string | null;
    audienceLabel?: string | null;
    attachments?: {
      id: number;
      fileName: string;
      contentType?: string | null;
      size?: number | null;
    }[];
  },
) {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    authorId: row.authorId,
    authorName: row.authorName ?? null,
    moduleId: row.moduleId ?? null,
    moduleName: row.moduleName ?? null,
    audienceType: row.audienceType,
    audienceIds: row.audienceIds ?? [],
    audienceLabel: row.audienceLabel ?? null,
    attachments: (row.attachments ?? []).map((a) => ({
      id: a.id,
      fileName: a.fileName,
      contentType: a.contentType ?? null,
      size: a.size ?? null,
    })),
    createdAt: row.createdAt,
  };
}

export function toNotification(row: Notification) {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    type: row.type,
    readAt: row.readAt,
    createdAt: row.createdAt,
  };
}

export function toFeedback(row: AppFeedback & { userName?: string | null }) {
  return {
    id: row.id,
    userId: row.userId,
    userName: row.userName ?? null,
    type: row.type as "suggestion" | "incident",
    subject: row.subject,
    message: row.message,
    status: row.status as "open" | "reviewed" | "resolved",
    createdAt: row.createdAt,
  };
}

export function toMeeting(
  row: Meeting & {
    hostName?: string | null;
    moduleName?: string | null;
    audienceLabel?: string | null;
  },
) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    roomName: row.roomName,
    hostId: row.hostId,
    hostName: row.hostName ?? null,
    moduleId: row.moduleId ?? null,
    moduleName: row.moduleName ?? null,
    audienceType: row.audienceType,
    audienceIds: row.audienceIds ?? [],
    audienceLabel: row.audienceLabel ?? null,
    scheduledAt: row.scheduledAt,
    createdAt: row.createdAt,
  };
}

export function toInvitation(row: Invitation) {
  return {
    id: row.id,
    code: row.code,
    email: row.email,
    role: row.role,
    provinceId: row.provinceId,
    centerId: row.centerId,
    status: row.status,
    expiresAt: row.expiresAt,
    usedAt: row.usedAt,
    createdAt: row.createdAt,
  };
}

export function toForumModule(row: {
  id: number;
  code: string | null;
  name: string;
  cycleName: string | null;
  centerId: number | null;
  threadCount: number;
  unreadCount: number;
}) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    cycleName: row.cycleName,
    centerId: row.centerId,
    threadCount: row.threadCount,
    unreadCount: row.unreadCount,
  };
}

export function toForumThread(row: {
  id: number;
  moduleId: number;
  moduleName?: string | null;
  cycleName?: string | null;
  centerId: number | null;
  title: string;
  authorId: number | null;
  authorName?: string | null;
  postCount: number;
  unreadCount: number;
  pinnedAt?: Date | null;
  editedAt?: Date | null;
  createdAt: Date;
  lastPostAt: Date;
}) {
  return {
    id: row.id,
    moduleId: row.moduleId,
    moduleName: row.moduleName ?? null,
    cycleName: row.cycleName ?? null,
    centerId: row.centerId,
    title: row.title,
    authorId: row.authorId,
    authorName: row.authorName ?? null,
    postCount: row.postCount,
    unreadCount: row.unreadCount,
    pinnedAt: row.pinnedAt ?? null,
    editedAt: row.editedAt ?? null,
    createdAt: row.createdAt,
    lastPostAt: row.lastPostAt,
  };
}

export function toForumPost(row: {
  id: number;
  threadId: number;
  authorId: number | null;
  authorName?: string | null;
  content: string;
  editedAt?: Date | null;
  createdAt: Date;
}) {
  return {
    id: row.id,
    threadId: row.threadId,
    authorId: row.authorId,
    authorName: row.authorName ?? null,
    content: row.content,
    editedAt: row.editedAt ?? null,
    createdAt: row.createdAt,
  };
}
