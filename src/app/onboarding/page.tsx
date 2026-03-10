"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import styles from "./page.module.css";

type Template = {
  id: string;
  name: string;
  documentType?: string;
  fieldCount?: number;
};

type TemplatesApiResponse = {
  templates?: Template[];
  error?: string;
};

type Step = 1 | 2 | 3;

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templatesError, setTemplatesError] = useState<string | null>(null);

  const fetchTemplates = async () => {
    setTemplatesLoading(true);
    setTemplatesError(null);
    try {
      const response = await fetch("/api/templates", { cache: "no-store" });
      const payload = (await response.json().catch(() => ({}))) as TemplatesApiResponse;
      if (!response.ok) {
        throw new Error(payload.error || "템플릿 목록을 불러오지 못했습니다.");
      }
      setTemplates(payload.templates ?? []);
    } catch (error) {
      setTemplatesError(error instanceof Error ? error.message : "템플릿 로드 실패");
    } finally {
      setTemplatesLoading(false);
    }
  };

  useEffect(() => {
    if (step === 2) {
      void fetchTemplates();
    }
  }, [step]);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link href="/" className={styles.backLink}>
          ← 편집기로 돌아가기
        </Link>
        <h1 className={styles.title}>시작하기</h1>
        <div className={styles.stepIndicator}>
          {([1, 2, 3] as Step[]).map((s) => (
            <div
              key={s}
              className={`${styles.stepDot} ${step === s ? styles.stepDotActive : ""} ${step > s ? styles.stepDotDone : ""}`}
            >
              {s}
            </div>
          ))}
        </div>
      </header>

      <main className={styles.main}>
        {step === 1 && (
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>시작 방법을 선택하세요</h2>
            <div className={styles.cardGrid}>
              <button
                type="button"
                className={styles.optionCard}
                onClick={() => router.push("/")}
              >
                <span className={styles.cardIcon}>📄</span>
                <strong className={styles.cardTitle}>빈 문서로 시작</strong>
                <p className={styles.cardDesc}>새로운 빈 문서에서 바로 작성을 시작합니다.</p>
              </button>

              <button
                type="button"
                className={styles.optionCard}
                onClick={() => setStep(2)}
              >
                <span className={styles.cardIcon}>📋</span>
                <strong className={styles.cardTitle}>템플릿으로 시작</strong>
                <p className={styles.cardDesc}>미리 준비된 템플릿을 선택해 문서를 빠르게 만듭니다.</p>
              </button>

              <button
                type="button"
                className={styles.optionCard}
                onClick={() => router.push("/")}
              >
                <span className={styles.cardIcon}>📂</span>
                <strong className={styles.cardTitle}>파일 불러오기</strong>
                <p className={styles.cardDesc}>HWP, HWPX, DOCX 등 기존 파일을 불러옵니다.</p>
              </button>
            </div>

            <div className={styles.actions}>
              <button
                type="button"
                className={styles.btnSecondary}
                onClick={() => setStep(3)}
              >
                기능 안내 보기
              </button>
            </div>
          </section>
        )}

        {step === 2 && (
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>템플릿을 선택하세요</h2>

            {templatesLoading && (
              <p className={styles.loadingText}>템플릿 목록을 불러오는 중...</p>
            )}
            {templatesError && (
              <p className={styles.errorText}>{templatesError}</p>
            )}
            {!templatesLoading && !templatesError && templates.length === 0 && (
              <p className={styles.emptyText}>사용 가능한 템플릿이 없습니다.</p>
            )}

            {!templatesLoading && templates.length > 0 && (
              <div className={styles.templateGrid}>
                {templates.map((template) => (
                  <button
                    key={template.id}
                    type="button"
                    className={styles.templateCard}
                    onClick={() => router.push(`/?templateId=${template.id}`)}
                  >
                    <strong className={styles.templateName}>{template.name}</strong>
                    {template.documentType && (
                      <span className={styles.templateType}>{template.documentType}</span>
                    )}
                    {template.fieldCount !== undefined && (
                      <span className={styles.templateMeta}>필드 {template.fieldCount}개</span>
                    )}
                  </button>
                ))}
              </div>
            )}

            <div className={styles.actions}>
              <button type="button" className={styles.btnSecondary} onClick={() => setStep(1)}>
                ← 이전
              </button>
              <button type="button" className={styles.btnSecondary} onClick={() => router.push("/?onboarding=template")}>
                건너뛰기
              </button>
            </div>
          </section>
        )}

        {step === 3 && (
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>주요 기능 안내</h2>
            <div className={styles.featureList}>
              <div className={styles.featureItem}>
                <span className={styles.featureIcon}>⌨️</span>
                <div>
                  <strong className={styles.featureTitle}>슬래시 커맨드</strong>
                  <p className={styles.featureDesc}>
                    문서 편집 중 <kbd className={styles.kbd}>#</kbd> 키를 입력하면 서식, 표, AI 명령을 빠르게 삽입할 수 있습니다.
                  </p>
                </div>
              </div>

              <div className={styles.featureItem}>
                <span className={styles.featureIcon}>✨</span>
                <div>
                  <strong className={styles.featureTitle}>AI 인라인 제안</strong>
                  <p className={styles.featureDesc}>
                    텍스트를 드래그로 선택하면 팝업이 나타납니다. 다듬기, 요약, 번역, 확장 등을 즉시 실행할 수 있습니다.
                  </p>
                </div>
              </div>

              <div className={styles.featureItem}>
                <span className={styles.featureIcon}>💾</span>
                <div>
                  <strong className={styles.featureTitle}>다양한 형식으로 저장</strong>
                  <p className={styles.featureDesc}>
                    작성한 문서를 HWPX, DOCX, PDF 형식으로 내보낼 수 있습니다.
                  </p>
                </div>
              </div>

              <div className={styles.featureItem}>
                <span className={styles.featureIcon}>📊</span>
                <div>
                  <strong className={styles.featureTitle}>배치 작업</strong>
                  <p className={styles.featureDesc}>
                    CSV 파일을 업로드하면 여러 문서를 한 번에 일괄 생성할 수 있습니다.
                  </p>
                </div>
              </div>
            </div>

            <div className={styles.actions}>
              <button type="button" className={styles.btnSecondary} onClick={() => setStep(1)}>
                ← 이전
              </button>
              <button
                type="button"
                className={styles.btnPrimary}
                onClick={() => router.push("/")}
              >
                시작하기 →
              </button>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
