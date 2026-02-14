import Foundation

/// URLSession-based Server-Sent Events client
/// Uses SSEParser for line-by-line parsing of chunked HTTP responses
final class SSEClient: NSObject, @unchecked Sendable {
    private let url: URL
    private let headers: [String: String]
    private var task: URLSessionDataTask?
    private let parser = SSEParser()

    private var onEvent: ((SSEParser.Message) -> Void)?
    private var onError: ((Error) -> Void)?
    private var onOpen: (() -> Void)?

    private lazy var session: URLSession = {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = TimeInterval(Int.max)
        config.timeoutIntervalForResource = TimeInterval(Int.max)
        return URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }()

    init(url: URL, headers: [String: String] = [:]) {
        self.url = url
        self.headers = headers
        super.init()
    }

    func connect(
        onEvent: @escaping (SSEParser.Message) -> Void,
        onError: ((Error) -> Void)? = nil,
        onOpen: (() -> Void)? = nil
    ) {
        self.onEvent = onEvent
        self.onError = onError
        self.onOpen = onOpen

        var request = URLRequest(url: url)
        request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        request.setValue("no-cache", forHTTPHeaderField: "Cache-Control")

        for (key, value) in headers {
            request.setValue(value, forHTTPHeaderField: key)
        }

        if let lastID = parser.lastEventID {
            request.setValue(lastID, forHTTPHeaderField: "Last-Event-ID")
        }

        task = session.dataTask(with: request)
        task?.resume()
    }

    func disconnect() {
        task?.cancel()
        task = nil
        parser.reset()
    }
}

// MARK: - URLSessionDataDelegate

extension SSEClient: URLSessionDataDelegate {
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse, completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        if let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) {
            onOpen?()
        }
        completionHandler(.allow)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        guard let chunk = String(data: data, encoding: .utf8) else { return }
        let messages = parser.feed(chunk)
        for message in messages {
            onEvent?(message)
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        if let error {
            onError?(error)
        }
    }
}

// MARK: - AsyncSequence wrapper

extension SSEClient {
    /// Provides an AsyncStream of SSE messages
    func events() -> AsyncStream<SSEParser.Message> {
        AsyncStream { continuation in
            connect(
                onEvent: { message in
                    continuation.yield(message)
                },
                onError: { _ in
                    continuation.finish()
                },
                onOpen: nil
            )
            continuation.onTermination = { @Sendable _ in
                self.disconnect()
            }
        }
    }
}
