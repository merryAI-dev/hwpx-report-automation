"use client";

import { useRef } from "react";
import type { ChangeEvent } from "react";

type FileUploadProps = {
  disabled?: boolean;
  onPickFile: (file: File) => void;
};

export function FileUpload({ disabled, onPickFile }: FileUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const onChange = (event: ChangeEvent<HTMLInputElement>) => {
    const picked = event.target.files?.[0];
    if (!picked) {
      return;
    }
    onPickFile(picked);
    event.target.value = "";
  };

  return (
    <div className="file-upload">
      <input
        ref={inputRef}
        type="file"
        accept=".hwp,.hwpx,.docx,.pptx"
        onChange={onChange}
        disabled={disabled}
        style={{ display: "none" }}
      />
      <button type="button" className="btn" disabled={disabled} onClick={() => inputRef.current?.click()}>
        문서 파일 열기
      </button>
    </div>
  );
}
