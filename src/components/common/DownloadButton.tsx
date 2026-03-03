"use client";

type DownloadButtonProps = {
  onGenerate: () => void;
  disabled?: boolean;
  downloadUrl: string;
  downloadName: string;
};

export function DownloadButton({
  onGenerate,
  disabled,
  downloadUrl,
  downloadName,
}: DownloadButtonProps) {
  return (
    <div className="download-wrap">
      <button type="button" className="btn primary" onClick={onGenerate} disabled={disabled}>
        HWPX 내보내기
      </button>
      {downloadUrl ? (
        <a className="download-link" href={downloadUrl} download={downloadName}>
          {downloadName} 다운로드
        </a>
      ) : null}
    </div>
  );
}

