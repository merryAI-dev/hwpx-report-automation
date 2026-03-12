"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DOCUMENT_TEMPLATES, type DocumentTemplate } from "@/lib/editor/document-templates";
import type { RecentFileSnapshotMeta } from "@/lib/recent-files";
import styles from "./DocumentStartWizard.module.css";

export type StartWizardMethod = "blank" | "upload" | "recent" | "template";
export type PreviewStatus = "idle" | "loading" | "ready" | "error" | "unavailable";

type DocumentStartWizardProps = {
  hasDocument: boolean;
  initialMethod?: StartWizardMethod | null;
  recentSnapshots: RecentFileSnapshotMeta[];
  isBusy: boolean;
  status: string;
  previewStatus: PreviewStatus;
  onClose?: () => void;
  onPickFile: (file: File) => void;
  onLoadRecentSnapshot: (id: string) => void;
  onStartBlank: () => void;
  onStartFromTemplate: (template: DocumentTemplate) => void;
};

type WizardStep = "method" | "detail" | "processing";

const METHOD_META: Record<StartWizardMethod, { title: string; eyebrow: string; description: string }> = {
  blank: {
    title: "빈 문서로 시작",
    eyebrow: "Step 2",
    description: "저장 가능한 HWPX 기반 빈 문서를 바로 열고, 필요한 경우 AI preset만 선택해서 시작합니다.",
  },
  upload: {
    title: "파일을 업로드",
    eyebrow: "Step 2",
    description: "HWP, HWPX, DOCX, PPTX를 가져오면 구조 파싱과 AI 분석이 자동으로 이어집니다.",
  },
  recent: {
    title: "최근 작업 불러오기",
    eyebrow: "Step 2",
    description: "최근 스냅샷에서 이어서 작업합니다. 로컬 저장소에 있는 문서만 표시됩니다.",
  },
  template: {
    title: "템플릿으로 시작",
    eyebrow: "Step 2",
    description: "문서 목적에 맞는 초안 구조와 AI preset을 한 번에 세팅합니다.",
  },
};

function formatRecentTime(savedAt: number): string {
  return new Date(savedAt).toLocaleString("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatFileSize(size: number): string {
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)}MB`;
  if (size >= 1024) return `${Math.round(size / 1024)}KB`;
  return `${size}B`;
}

function getPreviewBadgeText(previewStatus: PreviewStatus): string {
  switch (previewStatus) {
    case "loading":
      return "미리보기 준비 중";
    case "ready":
      return "미리보기 사용 가능";
    case "error":
      return "미리보기 연결 실패";
    case "unavailable":
      return "미리보기 미지원";
    default:
      return "미리보기 대기";
  }
}

export function DocumentStartWizard({
  hasDocument,
  initialMethod = null,
  recentSnapshots,
  isBusy,
  status,
  previewStatus,
  onClose,
  onPickFile,
  onLoadRecentSnapshot,
  onStartBlank,
  onStartFromTemplate,
}: DocumentStartWizardProps) {
  const [step, setStep] = useState<WizardStep>(initialMethod ? "detail" : "method");
  const [method, setMethod] = useState<StartWizardMethod | null>(initialMethod);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setMethod(initialMethod);
    setStep(isBusy ? "processing" : initialMethod ? "detail" : "method");
  }, [initialMethod, isBusy]);

  useEffect(() => {
    if (isBusy) {
      setStep("processing");
    }
  }, [isBusy]);

  const selectMethod = useCallback((next: StartWizardMethod) => {
    setMethod(next);
    setStep("detail");
  }, []);

  const processingItems = useMemo(
    () => [
      {
        label: "문서 구조 파싱",
        state: isBusy ? "current" : "done",
      },
      {
        label: "문서 분석 및 outline 생성",
        state: isBusy ? "current" : "done",
      },
      {
        label: getPreviewBadgeText(previewStatus),
        state:
          previewStatus === "ready" || previewStatus === "unavailable"
            ? "done"
            : previewStatus === "error"
              ? "error"
              : "current",
      },
    ],
    [isBusy, previewStatus],
  );

  const handleDroppedFile = useCallback(
    (file: File | null | undefined) => {
      if (!file) return;
      onPickFile(file);
    },
    [onPickFile],
  );

  const renderDetailPanel = () => {
    if (!method) return null;

    if (method === "blank") {
      return (
        <div className={styles.detailStack}>
          <div className={styles.primaryCard}>
            <p className={styles.cardEyebrow}>{METHOD_META.blank.eyebrow}</p>
            <h3 className={styles.cardTitle}>{METHOD_META.blank.title}</h3>
            <p className={styles.cardDescription}>{METHOD_META.blank.description}</p>
            <ul className={styles.bulletList}>
              <li>저장 가능한 HWPX 모델을 바로 생성합니다.</li>
              <li>문서 개요와 AI 패널은 빈 상태로 시작합니다.</li>
              <li>필요하면 나중에 템플릿 구조를 직접 추가할 수 있습니다.</li>
            </ul>
            <div className={styles.actionRow}>
              <button type="button" className={styles.secondaryButton} onClick={() => setStep("method")}>
                이전
              </button>
              <button type="button" className={styles.primaryButton} onClick={onStartBlank}>
                빈 문서 열기
              </button>
            </div>
          </div>
        </div>
      );
    }

    if (method === "upload") {
      return (
        <div className={styles.detailStack}>
          <div
            className={`${styles.dropZone} ${dragActive ? styles.dropZoneActive : ""}`}
            onDragOver={(event) => {
              event.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragActive(false);
              handleDroppedFile(event.dataTransfer.files?.[0]);
            }}
            onClick={() => fileInputRef.current?.click()}
          >
            <span className={styles.dropIcon}>문서</span>
            <strong>파일을 끌어놓거나 클릭해서 업로드</strong>
            <p>HWP, HWPX, DOCX, PPTX를 바로 불러올 수 있습니다.</p>
            <div className={styles.formatRow}>
              <span>HWPX</span>
              <span>DOCX</span>
              <span>PPTX</span>
              <span>HWP</span>
            </div>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".hwp,.hwpx,.docx,.pptx"
            className={styles.hiddenInput}
            onChange={(event) => {
              handleDroppedFile(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
          <div className={styles.actionRow}>
            <button type="button" className={styles.secondaryButton} onClick={() => setStep("method")}>
              이전
            </button>
          </div>
        </div>
      );
    }

    if (method === "recent") {
      return (
        <div className={styles.detailStack}>
          <div className={styles.primaryCard}>
            <p className={styles.cardEyebrow}>{METHOD_META.recent.eyebrow}</p>
            <h3 className={styles.cardTitle}>{METHOD_META.recent.title}</h3>
            <p className={styles.cardDescription}>{METHOD_META.recent.description}</p>
            {recentSnapshots.length ? (
              <div className={styles.recentList}>
                {recentSnapshots.slice(0, 6).map((snapshot) => (
                  <button
                    key={snapshot.id}
                    type="button"
                    className={styles.recentItem}
                    onClick={() => onLoadRecentSnapshot(snapshot.id)}
                  >
                    <span className={styles.recentName}>{snapshot.name}</span>
                    <span className={styles.recentMeta}>
                      {snapshot.kind} · {formatRecentTime(snapshot.savedAt)} · {formatFileSize(snapshot.size)}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <div className={styles.emptyCard}>
                <strong>최근 스냅샷이 없습니다.</strong>
                <p>첫 문서를 열면 여기에서 바로 이어서 작업할 수 있습니다.</p>
              </div>
            )}
            <div className={styles.actionRow}>
              <button type="button" className={styles.secondaryButton} onClick={() => setStep("method")}>
                이전
              </button>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className={styles.detailStack}>
        <div className={styles.primaryCard}>
          <p className={styles.cardEyebrow}>{METHOD_META.template.eyebrow}</p>
          <h3 className={styles.cardTitle}>{METHOD_META.template.title}</h3>
          <p className={styles.cardDescription}>{METHOD_META.template.description}</p>
          <div className={styles.templateGrid}>
            {DOCUMENT_TEMPLATES.map((template) => (
              <button
                key={template.id}
                type="button"
                className={styles.templateCard}
                onClick={() => onStartFromTemplate(template)}
              >
                <span className={styles.templateIcon}>{template.icon}</span>
                <div className={styles.templateBody}>
                  <strong>{template.name}</strong>
                  <p>{template.description}</p>
                  <span className={styles.templateMeta}>{template.defaultPreset}</span>
                </div>
              </button>
            ))}
          </div>
          <div className={styles.actionRow}>
            <button type="button" className={styles.secondaryButton} onClick={() => setStep("method")}>
              이전
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className={`${styles.shell} ${hasDocument ? styles.shellOverlay : ""}`}>
      <div className={styles.panel}>
        <div className={styles.header}>
          <div>
            <p className={styles.eyebrow}>Workspace Wizard</p>
            <h2 className={styles.title}>문서를 어떻게 시작할지 먼저 정합니다</h2>
            <p className={styles.subtitle}>
              업로드, 템플릿, 최근 작업, 빈 문서 중 하나를 골라서 바로 편집 환경으로 이어집니다.
            </p>
          </div>
          {onClose ? (
            <button type="button" className={styles.closeButton} onClick={onClose}>
              닫기
            </button>
          ) : null}
        </div>

        <div className={styles.stepRail}>
          <span className={`${styles.stepChip} ${step === "method" ? styles.stepChipActive : ""}`}>1. 시작 방식</span>
          <span className={`${styles.stepChip} ${step === "detail" ? styles.stepChipActive : ""}`}>2. 세부 선택</span>
          <span className={`${styles.stepChip} ${step === "processing" ? styles.stepChipActive : ""}`}>3. 문서 준비</span>
        </div>

        <div className={styles.body}>
          <section className={styles.main}>
            {step === "method" ? (
              <div className={styles.methodGrid}>
                <button type="button" className={styles.methodCard} onClick={() => selectMethod("upload")}>
                  <span className={styles.methodTag}>파일 가져오기</span>
                  <strong>기존 문서 업로드</strong>
                  <p>HWP/HWPX/DOCX/PPTX를 불러와서 구조를 분석합니다.</p>
                </button>
                <button type="button" className={styles.methodCard} onClick={() => selectMethod("template")}>
                  <span className={styles.methodTag}>빠른 초안</span>
                  <strong>템플릿으로 시작</strong>
                  <p>문서 유형에 맞는 초안 구조와 AI preset을 같이 세팅합니다.</p>
                </button>
                <button type="button" className={styles.methodCard} onClick={() => selectMethod("recent")}>
                  <span className={styles.methodTag}>이어쓰기</span>
                  <strong>최근 작업 열기</strong>
                  <p>로컬 스냅샷에서 최근 문서를 바로 이어서 편집합니다.</p>
                </button>
                <button type="button" className={styles.methodCard} onClick={() => selectMethod("blank")}>
                  <span className={styles.methodTag}>직접 작성</span>
                  <strong>빈 문서로 시작</strong>
                  <p>저장 가능한 새 HWPX 문서를 생성하고 바로 입력을 시작합니다.</p>
                </button>
              </div>
            ) : step === "processing" ? (
              <div className={styles.processingCard}>
                <div className={styles.processingSpinner} />
                <div>
                  <p className={styles.cardEyebrow}>Step 3</p>
                  <h3 className={styles.cardTitle}>문서를 준비하는 중입니다</h3>
                  <p className={styles.cardDescription}>{status}</p>
                </div>
                <div className={styles.processingList}>
                  {processingItems.map((item) => (
                    <div
                      key={item.label}
                      className={`${styles.processingItem} ${
                        item.state === "done"
                          ? styles.processingItemDone
                          : item.state === "error"
                            ? styles.processingItemError
                            : styles.processingItemCurrent
                      }`}
                    >
                      <span className={styles.processingDot} />
                      <span>{item.label}</span>
                    </div>
                  ))}
                </div>
                {!isBusy ? (
                  <div className={styles.actionRow}>
                    <button type="button" className={styles.secondaryButton} onClick={() => setStep(method ? "detail" : "method")}>
                      다른 방식 선택
                    </button>
                  </div>
                ) : null}
              </div>
            ) : (
              renderDetailPanel()
            )}
          </section>

          <aside className={styles.aside}>
            <div className={styles.asideCard}>
              <p className={styles.cardEyebrow}>작업 흐름</p>
              <h3 className={styles.asideTitle}>지금 UX에서 줄이는 마찰</h3>
              <ul className={styles.bulletList}>
                <li>문서가 없는 상태의 빈 종이 화면 대신 명확한 시작 선택지를 제공합니다.</li>
                <li>업로드 후 바로 outline, AI 분석, preview 준비 상태를 같은 컨텍스트에서 보여줍니다.</li>
                <li>template/onboarding query 진입도 메인 편집기 안에서 자연스럽게 이어집니다.</li>
              </ul>
            </div>
            <div className={styles.asideCard}>
              <p className={styles.cardEyebrow}>현재 상태</p>
              <h3 className={styles.asideTitle}>{method ? METHOD_META[method].title : "시작 방식을 선택하세요"}</h3>
              <p className={styles.asideBody}>
                {method ? METHOD_META[method].description : "첫 단계에서 작업 경로를 선택하면 다음 화면이 그 경로에 맞게 바뀝니다."}
              </p>
              <div className={styles.previewBadgeRow}>
                <span className={`${styles.previewBadge} ${styles[`previewBadge${previewStatus[0].toUpperCase()}${previewStatus.slice(1)}`]}`}>
                  {getPreviewBadgeText(previewStatus)}
                </span>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
