import Foundation
import Network

private let discoveryPort: UInt16 = 4011

final class DiscoveryListener {
	private var listener: NWListener?
	private let queue = DispatchQueue(label: "com.sidelink.helper.discovery", qos: .utility)

	var onPayload: ((DiscoveryBroadcastDTO) -> Void)?

	func start() {
		guard listener == nil, let port = NWEndpoint.Port(rawValue: discoveryPort) else {
			return
		}

		do {
			let newListener = try NWListener(using: .udp, on: port)
			newListener.newConnectionHandler = { [weak self] connection in
				self?.handle(connection: connection)
			}
			newListener.start(queue: queue)
			listener = newListener
		} catch {
			// Discovery is best-effort; pairing still works via manual URL input.
		}
	}

	func stop() {
		listener?.cancel()
		listener = nil
	}

	private func handle(connection: NWConnection) {
		connection.start(queue: queue)
		receive(on: connection)
	}

	private func receive(on connection: NWConnection) {
		connection.receiveMessage { [weak self] data, _, _, error in
			if let data, !data.isEmpty {
				self?.decode(data: data)
			}

			if error == nil {
				self?.receive(on: connection)
			} else {
				connection.cancel()
			}
		}
	}

	private func decode(data: Data) {
		guard let payload = try? JSONDecoder().decode(DiscoveryBroadcastDTO.self, from: data)
		else {
			return
		}

		let isSidelinkBroadcast = payload.type == "sidelink-discovery" || payload.service == "sidelink"
		guard isSidelinkBroadcast else {
			return
		}
		onPayload?(payload)
	}
}

typealias ServerDiscovery = DiscoveryListener
