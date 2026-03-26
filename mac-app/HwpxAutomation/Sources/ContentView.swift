import SwiftUI
import UniformTypeIdentifiers

struct ContentView: View {
    @State private var recentFiles: [URL] = []
    @State private var selectedFile: URL? = nil
    @State private var placeholders: [String: String] = [:]
    @State private var isLoading = false
    @State private var errorMessage: String? = nil

    var body: some View {
        NavigationSplitView {
            // 좌측: 최근 파일 목록
            FileListView(
                recentFiles: $recentFiles,
                selectedFile: $selectedFile,
                onPickFile: pickFile
            )
            .frame(minWidth: 200, idealWidth: 220)
        } detail: {
            // 우측: 플레이스홀더 폼 에디터
            if let file = selectedFile {
                FormEditorView(
                    file: file,
                    placeholders: $placeholders,
                    isLoading: $isLoading,
                    errorMessage: $errorMessage,
                    onGenerate: generateFile
                )
            } else {
                EmptyStateView(onPickFile: pickFile)
            }
        }
        .frame(minWidth: 700, minHeight: 480)
    }

    private func pickFile() {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [UTType(filenameExtension: "hwpx") ?? .data]
        panel.allowsMultipleSelection = false
        panel.canChooseDirectories = false
        if panel.runModal() == .OK, let url = panel.url {
            selectedFile = url
            if !recentFiles.contains(url) {
                recentFiles.insert(url, at: 0)
                if recentFiles.count > 10 { recentFiles.removeLast() }
            }
            loadPlaceholders(from: url)
        }
    }

    private func loadPlaceholders(from url: URL) {
        isLoading = true
        errorMessage = nil
        placeholders = [:]
        HwpxBridge.shared.extract(fileURL: url) { result in
            DispatchQueue.main.async {
                isLoading = false
                switch result {
                case .success(let keys):
                    placeholders = Dictionary(uniqueKeysWithValues: keys.map { ($0, "") })
                case .failure(let error):
                    errorMessage = error.localizedDescription
                }
            }
        }
    }

    private func generateFile() {
        guard let file = selectedFile else { return }
        isLoading = true
        errorMessage = nil
        HwpxBridge.shared.fill(fileURL: file, data: placeholders) { result in
            DispatchQueue.main.async {
                isLoading = false
                switch result {
                case .success(let outputURL):
                    NSWorkspace.shared.activateFileViewerSelecting([outputURL])
                case .failure(let error):
                    errorMessage = error.localizedDescription
                }
            }
        }
    }
}
