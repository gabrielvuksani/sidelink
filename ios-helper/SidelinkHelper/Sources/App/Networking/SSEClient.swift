import Foundation

/// Server-Sent-Events client that serialises all mutable state on a single
/// private dispatch queue so the URLSession delegate callbacks — which run off
/// the main actor — never race with `connect()` / `disconnect()` calls from a
/// `@MainActor` view model. Swift 6 strict concurrency flagged the earlier
/// version because `buffer`, `session`, and `task` were mutated by both the
/// delegate queue and whoever called `connect`/`disconnect`.
///
/// Callbacks are typed `@Sendable`: they usually hop back to the main actor on
/// the receiving side (e.g. `Task { @MainActor in … }`), but the closure
/// capture itself must be safe to cross isolation boundaries.
final class SSEClient: NSObject, URLSessionDataDelegate, @unchecked Sendable {
    private let maxBufferBytes = 64 * 1024

    // All access to these properties is serialised on `stateQueue`.
    private let stateQueue = DispatchQueue(label: "com.sidelink.ioshelper.sse", qos: .utility)
    private var session: URLSession?
    private var task: URLSessionDataTask?
    private var buffer = ""

    var onEvent: (@Sendable (String, String) -> Void)?
    var onFailure: (@Sendable (Error) -> Void)?

    func connect(url: URL, headers: [String: String] = [:]) {
        stateQueue.async { [weak self] in
            guard let self else { return }
            self.disconnectLocked()

            let config = URLSessionConfiguration.default
            config.timeoutIntervalForRequest = 60
            config.timeoutIntervalForResource = .infinity

            // Route URLSession delegate callbacks onto the same serial queue so
            // that didReceive / didCompleteWithError can read/write `self.buffer`
            // without an additional lock.
            let queue = OperationQueue()
            queue.underlyingQueue = self.stateQueue
            queue.maxConcurrentOperationCount = 1

            let session = URLSession(configuration: config, delegate: self, delegateQueue: queue)
            self.session = session

            var request = URLRequest(url: url)
            request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
            request.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
            for (key, value) in headers {
                request.setValue(value, forHTTPHeaderField: key)
            }

            let task = session.dataTask(with: request)
            self.task = task
            task.resume()
        }
    }

    func disconnect() {
        stateQueue.async { [weak self] in
            self?.disconnectLocked()
        }
    }

    /// Caller must hold `stateQueue` (i.e. be running on it).
    private func disconnectLocked() {
        task?.cancel()
        task = nil
        session?.invalidateAndCancel()
        session = nil
        buffer = ""
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        // Delegate queue is `stateQueue`, so direct access is safe here.
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

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse, completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        guard let http = response as? HTTPURLResponse else {
            completionHandler(.allow)
            return
        }

        if http.statusCode == 401 {
            completionHandler(.cancel)
            onFailure?(HelperAPIError.unauthorized)
            return
        }

        if !(200 ... 299).contains(http.statusCode) {
            completionHandler(.cancel)
            onFailure?(HelperAPIError.server("Install event stream failed (\(http.statusCode))"))
            return
        }

        completionHandler(.allow)
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        if let error {
            if let urlError = error as? URLError, urlError.code == .cancelled {
                return
            }
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
