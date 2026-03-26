import SwiftUI

struct EmptyStateView: View {
    let onPickFile: () -> Void

    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "doc.badge.arrow.up")
                .font(.system(size: 48))
                .foregroundStyle(.tertiary)
            Text("HWPX 파일을 열어주세요")
                .font(.title3)
                .foregroundStyle(.secondary)
            Text("왼쪽에서 파일을 선택하거나 아래 버튼을 눌러요")
                .font(.caption)
                .foregroundStyle(.tertiary)
            Button("HWPX 파일 열기", action: onPickFile)
                .buttonStyle(.borderedProminent)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
