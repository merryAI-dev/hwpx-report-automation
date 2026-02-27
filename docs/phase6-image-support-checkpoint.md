# Phase 6 Checkpoint: HWPX Image Support (Design + Lessons)

## 1. Problem Statement
현재 에디터는 텍스트/표 중심 라운드트립은 강화됐지만, 이미지는 실제 HWPX 객체로 저장되지 않는다.

사용자 관점에서의 핵심 증상:
- 에디터에서 이미지 관련 작업을 해도 한컴(Hancom Office)에서 열면 보이지 않거나 반영되지 않음.
- 결과적으로 편집기가 "실문서 편집기"가 아니라 "복붙 메모장"처럼 보이는 구간이 생김.

이 PR의 목적은 "코드 분기" 자체가 아니라, 다음 구현 단계가 흔들리지 않도록 문제/원인/우선순위/검증 기준을 명확히 고정하는 것이다.

## 2. Why This Matters Now
- 최종 소비자는 HWPX를 한컴 소프트웨어에서 확인한다.
- 내부 JSON 상태가 아니라, 한컴에서 실제 렌더되는 결과가 진짜 품질 기준이다.
- 이미지 미지원은 기능 누락 1건이 아니라 문서 신뢰성 전체를 떨어뜨리는 결함이다.

## 3. Verified Current State (Code Reality)
확인 기준 브랜치: `pr/phase5-hancom-fidelity` → 분기 `pr/phase6-image-support`.

이미지 관련 현재 상태:
- 슬래시 커맨드에는 `image-placeholder`가 있으나 실제로는 텍스트(`[이미지 자리]`) 삽입에 가깝다.
- 에디터 확장(`createEditorExtensions`)에 `@tiptap/extension-image`가 아직 없다.
- HWPX 저장 경로(`applyProseMirrorDocToHwpx`)는 문단(`<hp:p>`) 중심 조립이며 이미지 객체(`hp:pic` 등) 생성 로직이 없다.
- 호환성 경고는 존재하고, unsupported node/mark를 탐지한다(관측성은 개선됨).

샘플 데이터 기반 한계:
- 로컬 fixture/base 파일에는 `hp:pic`, `binaryItemIDRef`, `BinData` 실샘플이 없다.
- 즉, "기존 예제 복제" 방식이 아니라 "명시적 스키마/실문서 대조" 방식이 필요하다.

## 4. Lessons from Trial-and-Error
이번까지의 시행착오에서 얻은 교훈:

1. 경고 추가만으로는 사용자 문제를 해결하지 못한다.
- unsupported 경고는 유용하지만, 저장 결과가 한컴에서 보이지 않으면 체감 품질은 0에 수렴한다.

2. 문단 스냅샷 라운드트립만으로 객체 계층은 복원되지 않는다.
- 현재 파이프라인은 para/run/mark에 최적화돼 있고, 이미지 같은 객체 계층은 별도 트랙이 필요하다.

3. "에디터에서 보임"과 "한컴에서 보임"은 별개의 성공 조건이다.
- 브라우저 렌더 성공 후에도 HWPX 패키징/참조 연결이 틀리면 최종 뷰어에서 실패한다.

4. 이미지 기능은 단일 파일 수정이 아니라 패키지 단위 기능이다.
- section XML 삽입 + BinData 추가 + manifest/content 참조 일관성이 동시에 맞아야 한다.

## 5. Phase 6 Scope (What We Will Build)
### In Scope
1. 에디터에서 이미지 노드 삽입/표시/기본 편집.
2. 저장 시 HWPX 패키지 내 바이너리(`BinData`) 삽입.
3. section XML에 이미지 객체 컨트롤 삽입.
4. 한컴에서 실제 표시되는지 수동 검증 루프 확립.

### Out of Scope (이번 단계)
1. 도형(Shape) 객체 완전 지원.
2. 고급 이미지 레이아웃(텍스트 감싸기 모든 케이스).
3. 모든 오피스 포맷 간 완전 동형 변환.

## 6. Architecture Delta (Planned)
### 6.1 Editor Layer
- `@tiptap/extension-image` 도입.
- 툴바/슬래시/붙여넣기에서 이미지 삽입 경로 통합.
- 이미지 노드 attrs 표준화(예: `src`, `alt`, `width`, `height`, `imageMeta`).

### 6.2 Export Layer (Core)
- 이미지 노드 수집기 추가.
- 바이너리 페이로드를 `BinData/*`로 기록.
- `Contents/content.hpf` / `META-INF/manifest.xml` 참조 보강.
- section XML에 이미지 객체 블록 삽입(문단 기반 삽입 규칙과 충돌하지 않도록 순서 정의).

### 6.3 Model Layer
- 현재 `HwpxDocumentModel`이 para 중심이므로, 이미지 anchor 정보 추적 방식 추가 검토.
- 최소 버전은 "문서 순서 기준 이미지 삽입"으로 시작하고, 이후 정밀 anchor로 확장.

## 7. Risks and Mitigations
Risk 1: 한컴 전용 XML 규칙 미세 차이로 미표시 발생
- Mitigation: 생성 HWPX를 한컴에서 직접 열어 스냅샷 기반 회귀 검증.

Risk 2: 패키지 참조 불일치(manifest/content vs actual entry)
- Mitigation: 저장 직후 zip 엔트리/참조 무결성 자동 검사 추가.

Risk 3: 텍스트/표 저장 안정성 회귀
- Mitigation: 기존 `save-scenarios`/`roundtrip` 테스트군 유지 + 이미지 케이스만 증분 추가.

## 8. Acceptance Criteria
아래 조건을 모두 만족해야 "이미지 지원 1차 완료"로 본다.

1. 에디터에 삽입한 이미지가 저장 후 재오픈 시 유지된다.
2. 저장된 HWPX를 한컴에서 열었을 때 이미지가 보인다.
3. 텍스트/표 기존 라운드트립 테스트가 깨지지 않는다.
4. 이미지가 unsupported warning으로만 끝나지 않고 실제 export path를 탄다.

## 9. Execution Plan (1-5)
1. Baseline instrumentation
- 이미지 노드 카운트/저장 경로 로그/무결성 점검 추가.

2. Editor insertion pipeline
- extension + toolbar/slash/paste 통합.

3. HWPX packaging pipeline
- BinData 작성 + 참조 연결 + section 객체 삽입.

4. Validation harness
- 자동 테스트 + 수동 한컴 검증 체크리스트.

5. Hardening and rollback guard
- 실패 시 degrade 전략(명확 경고 + 데이터 손실 최소화) 포함.

## 10. Deliverable Role of This PR
이 PR은 단순 "브랜치 분기"가 아니라 다음을 고정하는 체크포인트다.
- 문제 정의
- 실패 원인
- 구현 범위
- 검증 기준

즉, 이후 코드 PR들이 같은 품질 기준(한컴 표시/저장 실효성)으로 수렴하도록 만드는 기준 문서 역할을 한다.
