import { z } from "../schema-validator";
import type { Rect } from "./pixels";

export const PUBLICATION_SOURCE_KINDS = [
  "unspecified",
  "ecl",
  "overlay",
  "white-light",
  "ponceau",
  "long-exposure",
] as const;
export type PublicationSourceKind = (typeof PUBLICATION_SOURCE_KINDS)[number];

/** Presentation geometry is independent of measurement regions and revisions. */
export interface PublicationRow {
  id: string;
  imageId: string;
  panel: string;
  label: string;
  molecularWeight: string;
  crop: Rect;
}
export interface PublicationSettings {
  title: string;
  widthMm: number;
  rows: PublicationRow[];
  sources: { imageId: string; kind: PublicationSourceKind }[];
}

const id = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9_-]+$/);
const coordinate = z.number().int().min(0).max(100000);
export const publicationSchema = z
  .object({
    title: z.string().max(200),
    widthMm: z.number().min(80).max(200),
    rows: z
      .array(
        z
          .object({
            id,
            imageId: id,
            panel: z.string().max(8),
            label: z.string().max(100),
            molecularWeight: z.string().max(40),
            crop: z
              .object({
                x: coordinate,
                y: coordinate,
                width: coordinate.min(1),
                height: coordinate.min(1),
              })
              .strict(),
          })
          .strict(),
      )
      .max(24),
    sources: z
      .array(
        z
          .object({
            imageId: id,
            kind: z.enum(PUBLICATION_SOURCE_KINDS),
          })
          .strict(),
      )
      .max(48),
  })
  .strict();

export function validatePublicationSettings(
  value: unknown,
  images: { id: string; width: number; height: number }[],
): PublicationSettings {
  const settings = publicationSchema.parse(value);
  const known = new Map(images.map((image) => [image.id, image]));
  if (
    new Set(settings.rows.map((row) => row.id)).size !== settings.rows.length ||
    new Set(settings.sources.map((source) => source.imageId)).size !==
      settings.sources.length
  )
    throw new Error("Duplicate publication entry / 图版或来源记录重复");
  for (const source of settings.sources)
    if (!known.has(source.imageId))
      throw new Error(
        "Publication references a missing original / 图版引用的原图不存在",
      );
  for (const row of settings.rows) {
    const image = known.get(row.imageId);
    if (!image)
      throw new Error(
        "Publication references a missing original / 图版引用的原图不存在",
      );
    if (
      row.crop.x + row.crop.width > image.width ||
      row.crop.y + row.crop.height > image.height
    )
      throw new Error(
        "Publication crop exceeds the original / 图版裁剪超出原图",
      );
  }
  return settings;
}
