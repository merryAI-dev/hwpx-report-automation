import SwiftUI

struct FileListView: View {
    @Binding var recentFiles: [URL]
    @Binding var selectedFile: URL?
    let onPickFile: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // 헤더
            HStack {
                Text("최근 파일")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                Spacer()
            }
            .background(.bar)

            Divider()

            // 파일 목록
            if recentFiles.isEmpty {
                VStack(spacing: 8) {
                    Image(systemName: "doc.badge.plus")
                        .font(.system(size: 28))
                        .foregroundStyle(.tertiary)
                    Text("HWPX 파일을 열어요")
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                List(recentFiles, id: \.self, selection: $selectedFile) { url in
                    HStack(spacing: 8) {
                        Image(systemName: "doc.text")
                            .foregroundStyle(.accent)
                        Text(url.lastPathComponent)
                            .lineLimit(1)
                            .truncationMode(.middle)
                            .font(.system(size: 13))
                    }
                    .padding(.vertical, 2)
                }
                .listStyle(.sidebar)
            }

            Divider()

            // 파일 열기 버튼
            Button(action: onPickFile) {
                Label("HWPX 파일 열기", systemImage: "plus")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderless)
            .padding(10)
        }
    }
}
