import SwiftUI

struct FormEditorView: View {
    let file: URL
    @Binding var placeholders: [String: String]
    @Binding var isLoading: Bool
    @Binding var errorMessage: String?
    let onGenerate: () -> Void

    // 키 정렬 (일관된 순서 보장)
    private var sortedKeys: [String] {
        placeholders.keys.sorted()
    }

    var body: some View {
        VStack(spacing: 0) {
            // 파일명 헤더
            HStack {
                Image(systemName: "doc.text.fill")
                    .foregroundStyle(.accent)
                Text(file.lastPathComponent)
                    .font(.headline)
                Spacer()
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 14)
            .background(.bar)

            Divider()

            if isLoading {
                ProgressView("분석 중...")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)

            } else if let error = errorMessage {
                VStack(spacing: 12) {
                    Image(systemName: "exclamationmark.triangle")
                        .font(.system(size: 32))
                        .foregroundStyle(.red)
                    Text(error)
                        .multilineTextAlignment(.center)
                        .foregroundStyle(.secondary)
                }
                .padding(40)
                .frame(maxWidth: .infinity, maxHeight: .infinity)

            } else if placeholders.isEmpty {
                VStack(spacing: 12) {
                    Image(systemName: "checkmark.circle")
                        .font(.system(size: 32))
                        .foregroundStyle(.green)
                    Text("이 템플릿에는 채울 항목이 없어요")
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)

            } else {
                // 폼
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        ForEach(sortedKeys, id: \.self) { key in
                            VStack(alignment: .leading, spacing: 6) {
                                Text(key)
                                    .font(.system(size: 12, weight: .medium))
                                    .foregroundStyle(.secondary)
                                TextField("입력하세요", text: Binding(
                                    get: { placeholders[key] ?? "" },
                                    set: { placeholders[key] = $0 }
                                ))
                                .textFieldStyle(.roundedBorder)
                            }
                        }
                    }
                    .padding(20)
                }

                Divider()

                // 생성 버튼
                HStack {
                    Spacer()
                    Button(action: onGenerate) {
                        Label("HWPX 생성하기", systemImage: "arrow.down.doc")
                            .padding(.horizontal, 8)
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(isLoading)
                    .padding(16)
                }
                .background(.bar)
            }
        }
    }
}
