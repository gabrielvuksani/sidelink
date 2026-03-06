import Foundation

final class SSEClient: NSObject, URLSessionDataDelegate {
    private let maxBufferBytes = 64 * 1024
    private var session: URLSession?
    private var task: URLSessionDataTask?
    private var buffer = ""

    var onEvent: ((String, String) -> Void)?
    var onFailure: ((Error) -> Void)?

    func connect(url: URL, headers: [String: String] = [:]) {
        disconnect()

        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 60
        config.timeoutIntervalForResource = .infinity

        let queue = OperationQueue()
        queue.maxConcurrentOperationCount = 1

        session = URLSession(configuration: config, delegate: self, delegateQueue: queue)

        var request = URLRequest(url: url)
        request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        request.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        for (key, value) in headers {
            request.setValue(value, forHTTPHeaderField: key)
        }

        task = session?.dataTask(with: request)
        task?.resume()
    }

    func disconnect() {
        task?.cancel()
        task = nil
        session?.invalidateAndCancel()
        session = nil
        buffer = ""
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        guard let chunk = String(data: data, encoding: .utf8), !chunk.isEmpty else {
            return
        }
        buffer.append(chunk)
        if buffer.utf8.count > maxBufferBytes {
            buffer = String(buffer.suffix(maxBufferBytes / 2))
        }

        let events = buffer.components(separatedBy: "\n\n")
        for raw in events.dropLast() {
            parseEvent(raw)
        }
        buffer = events.last ?? ""
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        if let error {
            onFailure?(error)
        }
    }

    private func parseEvent(_ block: String) {
        var eventName = "message"
        var dataLines: [String] = []

        for line in block.split(separator: "\n", omittingEmptySubsequences: false) {
            if line.hasPrefix("event:") {
                eventName = line.dropFirst("event:".count).trimmingCharacters(in: .whitespaces)
            } else if line.hasPrefix("data:") {
                let payload = line.dropFirst("data:".count).trimmingCharacters(in: .whitespaces)
                dataLines.append(payload)
            }
        }

        onEvent?(eventName, dataLines.joined(separator: "\n"))
    }
}
