/**
 * Persistence layer types.
 *
 * These mirror the Prisma models but are decoupled from the generated
 * types so the rest of the app doesn't depend on Prisma internals.
 */

export type DocumentRecord = {
  id: string;
  name: string;
  sizeBytes: number;
  createdAt: string; // ISO
  updatedAt: string; // ISO
};

export type DocumentDetail = DocumentRecord & {
  hwpxBlob: ArrayBuffer;
  docJson: string;
  segments: string;
  extraSegmentsMap: string;
};

export type DocumentVersion = {
  id: string;
  documentId: string;
  docJson: string;
  label: string;
  createdAt: string; // ISO
};

export type CreateDocumentInput = {
  name: string;
  hwpxBlob: ArrayBuffer;
  docJson: string;
  segments: string;
  extraSegmentsMap?: string;
};

export type UpdateDocumentInput = {
  name?: string;
  docJson?: string;
  segments?: string;
  extraSegmentsMap?: string;
  /** When provided, a new version is created with this label */
  versionLabel?: string;
};
