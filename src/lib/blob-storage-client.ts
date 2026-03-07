export type SignedBlobUploadResult = {
  blobId: string;
  provider: string;
  fileName: string;
  contentType: string;
  byteLength: number;
  createdAt: string;
  downloadUrl: string;
  expiresAt: string;
};

export async function uploadBlobForSignedDownload(
  blob: Blob,
  fileName: string,
): Promise<SignedBlobUploadResult> {
  const uploadFile = new File([blob], fileName, {
    type: blob.type || "application/octet-stream",
  });
  const formData = new FormData();
  formData.append("file", uploadFile);
  formData.append("fileName", fileName);

  const response = await fetch("/api/blob/upload", {
    method: "POST",
    body: formData,
  });
  const payload = (await response.json().catch(() => ({}))) as Partial<SignedBlobUploadResult> & {
    error?: string;
  };
  if (!response.ok) {
    throw new Error(payload.error || "외부 저장소 업로드 실패");
  }
  if (!payload.downloadUrl || !payload.blobId) {
    throw new Error("외부 저장소 응답이 올바르지 않습니다.");
  }
  return payload as SignedBlobUploadResult;
}
