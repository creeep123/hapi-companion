import XCTest
@testable import HAPI_Companion

private final class MobileControllerStub: @unchecked Sendable {
    private let lock = NSLock()
    var saved: MobileRelaySecrets?
    var revision = 0
    var testedSession: String?
    var configuration: MobileRelayConfiguration?
    var configuredReceiverIds: [String] = []
    var activation: MobileRelayActivation?
    var pauses: [Bool] = []
    var removed = false
    var unpaired = false
    var deletedDevice: String?
    var forceConflictRevision: Int?
    var resumed = false
    var healthCode: MobileRelayAttentionCode?
    var failSecretSave = false
    var repaired = false

    func read<T>(_ body: (MobileControllerStub) -> T) -> T { lock.withLock { body(self) } }
    func write(_ body: (MobileControllerStub) -> Void) { lock.withLock { body(self) } }

    var secretAccess: MobileRelaySecretAccess {
        MobileRelaySecretAccess(
            load: { [self] _ in read { $0.saved } },
            save: { [self] _, value in
                if read({ $0.failSecretSave }) { throw URLError(.cannotWriteToFile) }
                write { $0.saved = value }
            },
            delete: { [self] _ in write { $0.saved = nil } }
        )
    }

    var api: MobileRelayAPI {
        MobileRelayAPI(
            pair: { _, _ in MobileRelayPairResponse(managementToken: "management-secret") },
            status: { [self] _, _, requested in read { state in
                MobileRelayStatus(
                    revision: state.revision, enabled: state.activation != nil && (state.pauses.last != true), paused: state.pauses.last == true,
                    activation: requested.flatMap { id in state.activation?.activationId == id ? .init(status: .committed, activationId: id) : nil },
                    health: .init(stream: state.healthCode == nil ? (state.activation == nil ? .stopped : .connected) : .attention, lastAckSeq: 7, latestNtfyAcceptanceAt: 1_788_768_000_000, attentionCode: state.healthCode)
                )
            } },
            configure: { [self] _, _, config, expected in
                if let conflict = read({ $0.forceConflictRevision }) {
                    write { $0.revision = conflict }
                    throw MobileRelayError.conflict(conflict)
                }
                write { state in
                    XCTAssertEqual(expected, state.revision)
                    XCTAssertEqual(config.revision, expected + 1)
                    state.revision = config.revision
                    state.configuration = config
                    state.configuredReceiverIds.append(config.receiverId)
                }
                return config.revision
            },
            test: { [self] _, _, session in write { $0.testedSession = session } },
            activate: { [self] _, _, activation in write { $0.activation = activation } },
            pause: { [self] _, _, paused in write { $0.pauses.append(paused) } },
            repair: { [self] _, _, _ in write { $0.repaired = true; $0.healthCode = nil } },
            resume: { [self] _, _ in write { $0.resumed = true } },
            remove: { [self] _, _ in write { $0.removed = true } },
            unpair: { [self] _, _ in write { $0.unpaired = true } }
        )
    }
}

private final class ActivationReconciliationStub: @unchecked Sendable {
    enum RequestedStatus { case absent, committed, rejected, unreachable }
    private let lock = NSLock()
    var saved: MobileRelaySecrets?
    var requestedStatus: RequestedStatus = .absent
    var failNextActivation = true
    var activationIds: [String] = []
    var deletedDevice: String?

    func read<T>(_ body: (ActivationReconciliationStub) -> T) -> T { lock.withLock { body(self) } }
    func write(_ body: (ActivationReconciliationStub) -> Void) { lock.withLock { body(self) } }

    var secretAccess: MobileRelaySecretAccess {
        MobileRelaySecretAccess(
            load: { [self] _ in read { $0.saved } },
            save: { [self] _, value in write { $0.saved = value } },
            delete: { [self] _ in write { $0.saved = nil } }
        )
    }

    var api: MobileRelayAPI {
        MobileRelayAPI(
            pair: { _, _ in throw URLError(.badServerResponse) },
            status: { [self] _, _, requestedId in
                guard let requestedId else {
                    return MobileRelayStatus(revision: 1, enabled: false, paused: false, activation: nil, health: .init(stream: .stopped, lastAckSeq: nil, latestNtfyAcceptanceAt: nil))
                }
                switch read({ $0.requestedStatus }) {
                case .absent:
                    return MobileRelayStatus(revision: 1, enabled: false, paused: false, activation: nil, health: .init(stream: .stopped, lastAckSeq: nil, latestNtfyAcceptanceAt: nil))
                case .committed:
                    return MobileRelayStatus(revision: 1, enabled: true, paused: false, activation: .init(status: .committed, activationId: requestedId), health: .init(stream: .connected, lastAckSeq: nil, latestNtfyAcceptanceAt: nil))
                case .rejected:
                    return MobileRelayStatus(revision: 1, enabled: false, paused: false, activation: .init(status: .rejected, activationId: requestedId), health: .init(stream: .stopped, lastAckSeq: nil, latestNtfyAcceptanceAt: nil))
                case .unreachable:
                    throw URLError(.timedOut)
                }
            },
            configure: { _, _, _, _ in 1 }, test: { _, _, _ in },
            activate: { [self] _, _, activation in
                let shouldFail = read { $0.failNextActivation }
                write { state in
                    state.activationIds.append(activation.activationId)
                    state.failNextActivation = false
                }
                if shouldFail { throw URLError(.timedOut) }
            },
            pause: { _, _, _ in }, repair: { _, _, _ in }, resume: { _, _ in }, remove: { _, _ in }, unpair: { _, _ in }
        )
    }
}

private final class CleanupStub: @unchecked Sendable {
    private let lock = NSLock()
    var shouldFail = true
    var calls = 0
    func attempt() throws {
        let fail = lock.withLock { calls += 1; return shouldFail }
        if fail { throw URLError(.cannotConnectToHost) }
    }
    func allow() { lock.withLock { shouldFail = false } }
    func count() -> Int { lock.withLock { calls } }
}

@MainActor
final class MobileNotificationControllerTests: XCTestCase {
    func testPairAddTestActivatePauseResumeAndRemove() async throws {
        let suite = "MobileNotificationControllerTests." + UUID().uuidString
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let stub = MobileControllerStub()
        let controller = MobileNotificationController(
            defaults: defaults, secrets: stub.secretAccess, api: stub.api,
            registerDevice: { id, _ in
                XCTAssertNotNil(UUID(uuidString: id))
                return RegistrationResponse(deviceId: "11111111-1111-4111-8111-111111111111", token: String(repeating: "s", count: 48))
            },
            deleteDevice: { device in stub.write { $0.deletedDevice = device } }
        )
        controller.configure(hubURL: URL(string: "https://hapi.example")!, preferences: ReminderPreferences())
        controller.endpointText = "https://relay.example"
        controller.pairingCode = "one-time-code"
        controller.privacyAccepted = true
        await controller.pairRelay()
        XCTAssertEqual(controller.stage, .readyToAdd)
        XCTAssertEqual(stub.read { $0.saved?.managementToken }, "management-secret")

        var preferences = ReminderPreferences()
        preferences.scope = .specified
        preferences.selectedSessionIDs = ["session-1"]
        await controller.addPhone(preferences: preferences)
        XCTAssertEqual(controller.stage, .awaitingPhone)
        let config = try XCTUnwrap(stub.read { $0.configuration })
        XCTAssertEqual(config.hapiOrigin, "https://hapi.example")
        XCTAssertEqual(config.policy.selectedSessionIds, ["session-1"])
        XCTAssertEqual(config.policy.timeZone, TimeZone.current.identifier)
        XCTAssertGreaterThanOrEqual(try XCTUnwrap(stub.read { $0.saved?.topic }).count, 37)
        XCTAssertEqual(controller.topicName, stub.read { $0.saved?.topic })
        XCTAssertEqual(controller.subscriptionAddress, "ntfy://ntfy.sh/\(try XCTUnwrap(controller.topicName))")

        await controller.testPhone(sessionId: "real-session")
        XCTAssertEqual(stub.read { $0.testedSession }, "real-session")
        await controller.confirmPhone()
        XCTAssertEqual(controller.stage, .active)
        XCTAssertEqual(Set(stub.read { $0.configuredReceiverIds }).count, 1, "receiverId must remain stable across configuration updates")
        let activation = try XCTUnwrap(stub.read { $0.activation })
        XCTAssertEqual(activation.deviceId, "11111111-1111-4111-8111-111111111111")
        XCTAssertEqual(activation.token, String(repeating: "s", count: 48))
        XCTAssertEqual(activation.revision, 1)

        stub.write { $0.healthCode = .hubUnauthorized }
        await controller.refreshStatus()
        XCTAssertTrue(controller.needsHubRepair)
        await controller.repairDevice()
        XCTAssertTrue(stub.read { $0.repaired })
        XCTAssertFalse(controller.needsHubRepair)
        XCTAssertTrue(controller.streamConnected)

        await controller.setEnabled(false)
        XCTAssertEqual(controller.stage, .paused)
        await controller.setEnabled(true)
        XCTAssertEqual(controller.stage, .active)
        XCTAssertEqual(stub.read { $0.pauses }, [true, false])

        let oldTopic = stub.read { $0.saved?.topic }
        await controller.rotateTopic(preferences: preferences)
        XCTAssertEqual(controller.stage, .awaitingRotation)
        XCTAssertNotEqual(stub.read { $0.saved?.topic }, oldTopic)
        await controller.cancelOnboarding()
        XCTAssertEqual(controller.stage, .active)
        XCTAssertEqual(stub.read { $0.saved?.topic }, oldTopic)
        XCTAssertEqual(stub.read { $0.pauses.suffix(2) }, [true, false])
        await controller.rotateTopic(preferences: preferences)
        XCTAssertFalse(controller.testAccepted)
        await controller.testPhone(sessionId: "real-session")
        await controller.confirmPhone()
        XCTAssertEqual(controller.stage, .active)
        XCTAssertGreaterThanOrEqual(stub.read { $0.configuredReceiverIds }.count, 2)
        XCTAssertEqual(Set(stub.read { $0.configuredReceiverIds }).count, 1, "receiverId must remain stable across configuration updates")

        await controller.removePhone()
        XCTAssertEqual(controller.stage, .readyToAdd)
        XCTAssertNil(stub.read { $0.saved?.topic })
        XCTAssertEqual(stub.read { $0.deletedDevice }, "11111111-1111-4111-8111-111111111111")
        XCTAssertTrue(controller.relayPaired)
        await controller.disconnectRelay()
        XCTAssertEqual(controller.stage, .relayNotPaired)
        XCTAssertFalse(controller.relayPaired)
        XCTAssertTrue(stub.read { $0.unpaired })
    }

    func testPairRequiresPrivacyAndHTTPS() async throws {
        let defaults = try XCTUnwrap(UserDefaults(suiteName: UUID().uuidString))
        let stub = MobileControllerStub()
        let controller = MobileNotificationController(defaults: defaults, secrets: stub.secretAccess, api: stub.api, registerDevice: { _, _ in throw MobileRelayError.invalidResponse }, deleteDevice: { _ in })
        controller.configure(hubURL: URL(string: "https://hapi.example")!, preferences: ReminderPreferences())
        controller.endpointText = "http://relay.example"
        controller.pairingCode = "code"
        await controller.pairRelay()
        XCTAssertTrue(controller.message?.contains("隐私") == true)
        controller.privacyAccepted = true
        await controller.pairRelay()
        XCTAssertTrue(controller.message?.contains("HTTPS") == true)
        XCTAssertFalse(controller.relayPaired)
        for invalid in ["https://user@relay.example", "https://relay.example/path", "https://relay.example?q=1", "https://relay.example/#fragment"] {
            controller.endpointText = invalid
            await controller.pairRelay()
            XCTAssertFalse(controller.relayPaired)
        }
    }

    func testCancelInitialAddCreatesNoHubDevice() async throws {
        let defaults = try XCTUnwrap(UserDefaults(suiteName: UUID().uuidString))
        let stub = MobileControllerStub()
        stub.saved = MobileRelaySecrets(managementToken: "management", topic: nil, pendingActivation: nil)
        let controller = MobileNotificationController(
            defaults: defaults, secrets: stub.secretAccess, api: stub.api,
            registerDevice: { _, _ in XCTFail("Cancel must not register a Hub device"); throw MobileRelayError.invalidResponse },
            deleteDevice: { _ in XCTFail("No Hub device exists to delete") }
        )
        controller.configure(hubURL: URL(string: "https://hapi.example")!, preferences: ReminderPreferences())
        controller.endpointText = "https://relay.example"
        await controller.addPhone(preferences: ReminderPreferences())
        await controller.cancelOnboarding()
        XCTAssertEqual(controller.stage, .readyToAdd)
        XCTAssertNil(stub.read { $0.saved?.topic })
        XCTAssertTrue(stub.read { $0.removed })
    }

    func testPendingSaveAndCleanupFailureSurvivesRelaunchThenRetries() async throws {
        let suite = "MobileNotificationControllerTests." + UUID().uuidString
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let stub = MobileControllerStub()
        stub.saved = MobileRelaySecrets(managementToken: "management", topic: "hapi-0123456789abcdef0123456789abcdef", pendingActivation: nil)
        stub.failSecretSave = true
        let cleanup = CleanupStub()
        let makeController = {
            MobileNotificationController(
                defaults: defaults, secrets: stub.secretAccess, api: stub.api,
                registerDevice: { _, _ in RegistrationResponse(deviceId: "11111111-1111-4111-8111-111111111111", token: String(repeating: "s", count: 48)) },
                deleteDevice: { _ in try cleanup.attempt() }
            )
        }
        var controller = makeController()
        controller.configure(hubURL: URL(string: "https://hapi.example")!, preferences: ReminderPreferences())
        controller.endpointText = "https://relay.example"
        controller.testAccepted = true
        await controller.confirmPhone()
        XCTAssertEqual(controller.stage, .removalIncomplete)
        XCTAssertEqual(cleanup.count(), 1)

        stub.write { $0.failSecretSave = false }
        cleanup.allow()
        controller = makeController()
        controller.configure(hubURL: URL(string: "https://hapi.example")!, preferences: ReminderPreferences())
        controller.endpointText = "https://relay.example"
        XCTAssertEqual(controller.stage, .removalIncomplete)
        await controller.removePhone()
        XCTAssertEqual(controller.stage, .readyToAdd)
        XCTAssertEqual(cleanup.count(), 2)
    }

    func testKeychainReadFailureDoesNotOfferPairing() async throws {
        let defaults = try XCTUnwrap(UserDefaults(suiteName: UUID().uuidString))
        let access = MobileRelaySecretAccess(load: { _ in throw URLError(.cannotOpenFile) }, save: { _, _ in }, delete: { _ in })
        let controller = MobileNotificationController(defaults: defaults, secrets: access, api: MobileControllerStub().api, registerDevice: { _, _ in throw MobileRelayError.invalidResponse }, deleteDevice: { _ in })
        controller.configure(hubURL: URL(string: "https://hapi.example")!, preferences: ReminderPreferences())
        XCTAssertTrue(controller.keychainUnavailable)
        XCTAssertTrue(controller.message?.contains("钥匙串") == true)
    }

    func testConflictCanOnlyBeOverwrittenExplicitlyOrDeferred() async throws {
        let defaults = try XCTUnwrap(UserDefaults(suiteName: UUID().uuidString))
        let stub = MobileControllerStub()
        stub.saved = MobileRelaySecrets(managementToken: "management", topic: "hapi-0123456789abcdef0123456789abcdef", pendingActivation: nil)
        stub.forceConflictRevision = 4
        let controller = MobileNotificationController(
            defaults: defaults, secrets: stub.secretAccess, api: stub.api,
            registerDevice: { _, _ in throw MobileRelayError.invalidResponse }, deleteDevice: { _ in }
        )
        controller.configure(hubURL: URL(string: "https://hapi.example")!, preferences: ReminderPreferences())
        controller.endpointText = "https://relay.example"

        await controller.sync(preferences: ReminderPreferences())
        XCTAssertEqual(controller.conflictRevision, 4)
        XCTAssertFalse(controller.conflictDeferred)
        controller.deferConflict()
        XCTAssertTrue(controller.conflictDeferred)
        XCTAssertNotNil(controller.conflictRevision, "Deferring must retain the conflict instead of pretending Relay policy was loaded")

        stub.write { $0.forceConflictRevision = nil }
        await controller.sync(preferences: ReminderPreferences(), force: true)
        XCTAssertNil(controller.conflictRevision)
        XCTAssertFalse(controller.conflictDeferred)
        XCTAssertEqual(stub.read { $0.configuration?.revision }, 5)
    }

    func testAttentionCodesExposeOnlyTheCorrectRecoveryAction() async throws {
        let defaults = try XCTUnwrap(UserDefaults(suiteName: UUID().uuidString))
        let stub = MobileControllerStub()
        stub.saved = MobileRelaySecrets(managementToken: "management", topic: "hapi-0123456789abcdef0123456789abcdef", pendingActivation: nil)
        let controller = MobileNotificationController(
            defaults: defaults, secrets: stub.secretAccess, api: stub.api,
            registerDevice: { _, _ in throw MobileRelayError.invalidResponse }, deleteDevice: { _ in }
        )
        controller.configure(hubURL: URL(string: "https://hapi.example")!, preferences: ReminderPreferences())
        controller.endpointText = "https://relay.example"

        stub.write { $0.healthCode = .hubUnauthorized }
        await controller.refreshStatus()
        XCTAssertTrue(controller.needsHubRepair)
        XCTAssertFalse(controller.canResume)
        XCTAssertEqual(controller.attentionMessage, "Hub 授权已失效，请修复 Relay 设备连接")

        stub.write { $0.healthCode = .ntfyConfigurationError }
        await controller.refreshStatus()
        XCTAssertFalse(controller.needsHubRepair)
        XCTAssertTrue(controller.canResume)
        XCTAssertEqual(controller.attentionMessage, "ntfy 配置需要检查")
        await controller.resumeNotifications()
        XCTAssertTrue(stub.read { $0.resumed })

    }

    func testUnknownActivationOutcomeDoesNotDeleteHubDevice() async throws {
        let defaults = try XCTUnwrap(UserDefaults(suiteName: UUID().uuidString))
        let stub = MobileControllerStub()
        stub.saved = MobileRelaySecrets(managementToken: "management", topic: "hapi-0123456789abcdef0123456789abcdef", pendingActivation: nil)
        let api = MobileRelayAPI(
            pair: { _, _ in throw URLError(.badServerResponse) },
            status: { _, _, activationId in
                if activationId != nil { throw URLError(.timedOut) }
                return MobileRelayStatus(revision: 1, enabled: false, paused: false, activation: nil, health: .init(stream: .stopped, lastAckSeq: nil, latestNtfyAcceptanceAt: nil))
            },
            configure: { _, _, _, _ in 1 }, test: { _, _, _ in },
            activate: { _, _, _ in throw URLError(.timedOut) }, pause: { _, _, _ in }, repair: { _, _, _ in }, resume: { _, _ in }, remove: { _, _ in }, unpair: { _, _ in }
        )
        let controller = MobileNotificationController(
            defaults: defaults, secrets: stub.secretAccess, api: api,
            registerDevice: { _, _ in RegistrationResponse(deviceId: "11111111-1111-4111-8111-111111111111", token: String(repeating: "s", count: 48)) },
            deleteDevice: { device in stub.write { $0.deletedDevice = device } }
        )
        controller.configure(hubURL: URL(string: "https://hapi.example")!, preferences: ReminderPreferences())
        controller.endpointText = "https://relay.example"
        controller.testAccepted = true
        await controller.confirmPhone()
        XCTAssertEqual(controller.stage, .activationUncertain)
        XCTAssertNil(stub.read { $0.deletedDevice }, "Unknown outcome must retain the Hub device until status reconciliation")
    }

    func testAbsentActivationRetriesSameIdAfterRelaunch() async throws {
        let suite = "MobileNotificationControllerTests." + UUID().uuidString
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let stub = ActivationReconciliationStub()
        stub.saved = MobileRelaySecrets(managementToken: "management", topic: "hapi-0123456789abcdef0123456789abcdef", pendingActivation: nil)

        func makeController() -> MobileNotificationController {
            MobileNotificationController(
                defaults: defaults, secrets: stub.secretAccess, api: stub.api,
                registerDevice: { _, _ in RegistrationResponse(deviceId: "11111111-1111-4111-8111-111111111111", token: String(repeating: "s", count: 48)) },
                deleteDevice: { device in stub.write { $0.deletedDevice = device } }
            )
        }

        var controller = makeController()
        controller.configure(hubURL: URL(string: "https://hapi.example")!, preferences: ReminderPreferences())
        controller.endpointText = "https://relay.example"
        controller.testAccepted = true
        await controller.confirmPhone()
        XCTAssertEqual(controller.stage, .activationUncertain)
        let pendingId = try XCTUnwrap(stub.read { $0.saved?.pendingActivation?.activationId })
        XCTAssertEqual(stub.read { $0.activationIds }, [pendingId])
        XCTAssertNil(stub.read { $0.deletedDevice })

        controller = makeController()
        controller.configure(hubURL: URL(string: "https://hapi.example")!, preferences: ReminderPreferences())
        controller.endpointText = "https://relay.example"
        XCTAssertEqual(controller.stage, .activationUncertain)
        await controller.refreshStatus()
        XCTAssertEqual(controller.stage, .active)
        XCTAssertEqual(stub.read { $0.activationIds }, [pendingId, pendingId])
        XCTAssertNil(stub.read { $0.saved?.pendingActivation })
        XCTAssertNil(stub.read { $0.deletedDevice })
    }

    func testLateCommitCompletesAfterRelaunchWithoutDuplicateActivation() async throws {
        let suite = "MobileNotificationControllerTests." + UUID().uuidString
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let stub = ActivationReconciliationStub()
        stub.saved = MobileRelaySecrets(managementToken: "management", topic: "hapi-0123456789abcdef0123456789abcdef", pendingActivation: nil)
        let makeController = {
            MobileNotificationController(
                defaults: defaults, secrets: stub.secretAccess, api: stub.api,
                registerDevice: { _, _ in RegistrationResponse(deviceId: "11111111-1111-4111-8111-111111111111", token: String(repeating: "s", count: 48)) },
                deleteDevice: { device in stub.write { $0.deletedDevice = device } }
            )
        }
        var controller = makeController()
        controller.configure(hubURL: URL(string: "https://hapi.example")!, preferences: ReminderPreferences())
        controller.endpointText = "https://relay.example"
        controller.testAccepted = true
        await controller.confirmPhone()
        let pendingId = try XCTUnwrap(stub.read { $0.saved?.pendingActivation?.activationId })
        stub.write { $0.requestedStatus = .committed }

        controller = makeController()
        controller.configure(hubURL: URL(string: "https://hapi.example")!, preferences: ReminderPreferences())
        controller.endpointText = "https://relay.example"
        await controller.refreshStatus()
        XCTAssertEqual(controller.stage, .active)
        XCTAssertEqual(stub.read { $0.activationIds }, [pendingId])
        XCTAssertNil(stub.read { $0.saved?.pendingActivation })
        XCTAssertNil(stub.read { $0.deletedDevice })
    }

    func testRejectedActivationKeepsPendingWhenHubCleanupFails() async throws {
        let defaults = try XCTUnwrap(UserDefaults(suiteName: UUID().uuidString))
        let stub = ActivationReconciliationStub()
        stub.saved = MobileRelaySecrets(managementToken: "management", topic: "hapi-0123456789abcdef0123456789abcdef", pendingActivation: nil)
        stub.requestedStatus = .rejected
        let controller = MobileNotificationController(
            defaults: defaults, secrets: stub.secretAccess, api: stub.api,
            registerDevice: { _, _ in RegistrationResponse(deviceId: "11111111-1111-4111-8111-111111111111", token: String(repeating: "s", count: 48)) },
            deleteDevice: { _ in throw URLError(.cannotConnectToHost) }
        )
        controller.configure(hubURL: URL(string: "https://hapi.example")!, preferences: ReminderPreferences())
        controller.endpointText = "https://relay.example"
        controller.testAccepted = true
        await controller.confirmPhone()
        XCTAssertEqual(controller.stage, .removalIncomplete)
        XCTAssertNotNil(stub.read { $0.saved?.pendingActivation })
    }

    func testRejectedActivationSuccessfulCleanupReturnsToAwaitingPhone() async throws {
        let defaults = try XCTUnwrap(UserDefaults(suiteName: UUID().uuidString))
        let stub = ActivationReconciliationStub()
        stub.saved = MobileRelaySecrets(managementToken: "management", topic: "hapi-0123456789abcdef0123456789abcdef", pendingActivation: nil)
        stub.requestedStatus = .rejected
        let controller = MobileNotificationController(
            defaults: defaults, secrets: stub.secretAccess, api: stub.api,
            registerDevice: { _, _ in RegistrationResponse(deviceId: "11111111-1111-4111-8111-111111111111", token: String(repeating: "s", count: 48)) },
            deleteDevice: { device in stub.write { $0.deletedDevice = device } }
        )
        controller.configure(hubURL: URL(string: "https://hapi.example")!, preferences: ReminderPreferences())
        controller.endpointText = "https://relay.example"
        controller.testAccepted = true
        await controller.confirmPhone()
        XCTAssertEqual(controller.stage, .awaitingPhone)
        XCTAssertNil(stub.read { $0.saved?.pendingActivation })
        XCTAssertEqual(stub.read { $0.deletedDevice }, "11111111-1111-4111-8111-111111111111")
    }
}
