import { z } from "zod";
import { CategorySchema } from "./category.js";

export const ATTENDANCE_VALUES = ["public", "invitation_only", "restricted"] as const;
export const AttendanceSchema = z.enum(ATTENDANCE_VALUES);
export type Attendance = z.infer<typeof AttendanceSchema>;

export const NOTICE_STATUS_VALUES = ["published", "cancelled", "removed"] as const;
export const NoticeStatusSchema = z.enum(NOTICE_STATUS_VALUES);
export type NoticeStatus = z.infer<typeof NoticeStatusSchema>;

export const LatitudeSchema = z.coerce.number().min(-90).max(90);
export const LongitudeSchema = z.coerce.number().min(-180).max(180);

export const CreateNoticeBase = z.object({
  categorySlug: z.string().min(1),
  title: z.string().trim().min(3).max(160),
  description: z.string().trim().max(4000).default(""),
  venueName: z.string().trim().min(1).max(160),
  address: z.string().trim().min(1).max(400),
  lat: LatitudeSchema,
  lng: LongitudeSchema,
  startsAt: z.iso.datetime(),
  attendance: AttendanceSchema,
  organizerName: z.string().trim().max(160).optional(),
  organizerContact: z.string().trim().max(160).optional(),
  organizerConsent: z.boolean().default(false),
});

export const CreateNoticeSchema = CreateNoticeBase.refine(
  (v) => !v.organizerContact || v.organizerConsent === true,
  {
    message: "Organizer consent is required before publishing organizer contact details.",
    path: ["organizerConsent"],
  },
);

export type CreateNotice = z.infer<typeof CreateNoticeSchema>;

export const NoticeSchema = z.object({
  publicId: z.string().min(1),
  category: CategorySchema,
  title: z.string(),
  description: z.string(),
  venueName: z.string(),
  address: z.string(),
  lat: z.number(),
  lng: z.number(),
  startsAt: z.iso.datetime(),
  attendance: AttendanceSchema,
  organizerName: z.string().nullable(),
  organizerContact: z.string().nullable(),
  status: NoticeStatusSchema,
  isPast: z.boolean(),
  createdAt: z.iso.datetime(),
});

export type Notice = z.infer<typeof NoticeSchema>;
