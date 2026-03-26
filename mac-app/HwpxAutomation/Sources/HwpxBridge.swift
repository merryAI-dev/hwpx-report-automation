import Foundation

/// hwpx-core.js Node subprocess와 JSON stdin/stdout으로 통신하는 브리지.
///
/// 데이터 흐름:
///   Swift → stdin(JSON) → node hwpx-core.js → stdout(JSON) → Swift
///
/// 지원 커맨드:
///   extract: { command: "extract", filePath: "..." }
///     → { keys: ["TITLE", "NAME", ...] }
///
///   fill: { command: "fill", filePath: "...", data: { TITLE: "...", ... } }
///     → { outputPath: "/tmp/result.hwpx" }
final class HwpxBridge {
    static let shared = HwpxBridge()
    private init() {}

    // mac-app/Resources/hwpx-core.js 경로
    private var coreScriptURL: URL? {
        Bundle.main.url(forResource: "hwpx-core", withExtension: "js", subdirectory: "Resources")
    }

    enum BridgeError: LocalizedError {
        case scriptNotFound
        case nodeNotFound
        case processError(String)
        case decodingError(String)

        var errorDescription: String? {
            switch self {
            case .scriptNotFound: return "hwpx-core.js를 찾을 수 없어요. 빌드 스크립트를 먼저 실행해주세요."
            case .nodeNotFound: return "Node.js가 설치되어 있지 않아요. https://nodejs.org 에서 설치해주세요."
            case .processError(let msg): return "실행 오류: \(msg)"
            case .decodingError(let msg): return "응답 파싱 오류: \(msg)"
            }
        }
    }

    func extract(fileURL: URL, completion: @escaping (Result<[String], Error>) -> Void) {
        let input: [String: Any] = ["command": "extract", "filePath": fileURL.path]
        run(input: input) { result in
            switch result {
            case .success(let json):
                if let keys = json["keys"] as? [String] {
                    completion(.success(keys))
                } else {
                    completion(.failure(BridgeError.decodingError("keys 필드 없음")))
                }
            case .failure(let error):
                completion(.failure(error))
            }
        }
    }

    func fill(fileURL: URL, data: [String: String], completion: @escaping (Result<URL, Error>) -> Void) {
        let input: [String: Any] = ["command": "fill", "filePath": fileURL.path, "data": data]
        run(input: input) { result in
            switch result {
            case .success(let json):
                if let path = json["outputPath"] as? String {
                    completion(.success(URL(fileURLWithPath: path)))
                } else {
                    completion(.failure(BridgeError.decodingError("outputPath 필드 없음")))
                }
            case .failure(let error):
                completion(.failure(error))
            }
        }
    }

    // MARK: - Private

    private func run(input: [String: Any], completion: @escaping (Result<[String: Any], Error>) -> Void) {
        guard let scriptURL = coreScriptURL else {
            completion(.failure(BridgeError.scriptNotFound))
            return
        }

        // node 경로 탐색 (nvm 등 고려)
        let nodePath = findNode()
        guard !nodePath.isEmpty else {
            completion(.failure(BridgeError.nodeNotFound))
            return
        }

        DispatchQueue.global(qos: .userInitiated).async {
            do {
                let inputData = try JSONSerialization.data(withJSONObject: input)

                let process = Process()
                process.executableURL = URL(fileURLWithPath: nodePath)
                process.arguments = [scriptURL.path]

                let stdinPipe = Pipe()
                let stdoutPipe = Pipe()
                let stderrPipe = Pipe()
                process.standardInput = stdinPipe
                process.standardOutput = stdoutPipe
                process.standardError = stderrPipe

                try process.run()
                stdinPipe.fileHandleForWriting.write(inputData)
                stdinPipe.fileHandleForWriting.closeFile()
                process.waitUntilExit()

                let outputData = stdoutPipe.fileHandleForReading.readDataToEndOfFile()
                if process.terminationStatus != 0 {
                    let errMsg = String(data: stderrPipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? "알 수 없는 오류"
                    completion(.failure(BridgeError.processError(errMsg)))
                    return
                }

                guard let json = try JSONSerialization.jsonObject(with: outputData) as? [String: Any] else {
                    completion(.failure(BridgeError.decodingError("JSON 파싱 실패")))
                    return
                }
                completion(.success(json))
            } catch {
                completion(.failure(error))
            }
        }
    }

    private func findNode() -> String {
        let candidates = [
            "/usr/local/bin/node",
            "/opt/homebrew/bin/node",
            "/usr/bin/node",
            "\(NSHomeDirectory())/.nvm/versions/node/\(nvmCurrentVersion())/bin/node",
        ]
        return candidates.first { FileManager.default.fileExists(atPath: $0) } ?? ""
    }

    private func nvmCurrentVersion() -> String {
        let aliasPath = "\(NSHomeDirectory())/.nvm/alias/default"
        return (try? String(contentsOfFile: aliasPath, encoding: .utf8))?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    }
}
