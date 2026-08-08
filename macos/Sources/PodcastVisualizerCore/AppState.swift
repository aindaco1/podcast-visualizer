import Foundation

public enum WorkflowStage: String, Codable, CaseIterable, Sendable {
    case empty
    case sourceSelected
    case initialized
    case prepared
    case analyzed
    case reviewRequired
    case approved
    case aligned
    case rendering
    case verified
    case exported

    init?(projectStatus: String) {
        switch projectStatus {
        case "initialized": self = .initialized
        case "prepared": self = .prepared
        case "review_required": self = .reviewRequired
        case "approved": self = .approved
        case "aligned": self = .aligned
        case "verified": self = .verified
        default: return nil
        }
    }
}

public enum AutomaticWorkflowAction: Equatable, Sendable {
    case prepare
    case analyze
    case enterTranscriptReview
    case loadTranscriptReview
    case align
    case render
}

public enum AutomaticWorkflowPolicy {
    public static func nextAction(for stage: WorkflowStage) -> AutomaticWorkflowAction? {
        switch stage {
        case .initialized: .prepare
        case .prepared: .analyze
        case .analyzed: .enterTranscriptReview
        case .reviewRequired: .loadTranscriptReview
        case .approved: .align
        case .aligned: .render
        case .empty, .sourceSelected, .rendering, .verified, .exported: nil
        }
    }
}

public struct WorkflowFailure: Error, Equatable, Sendable {
    public let code: String
    public let message: String
    public let hint: String?

    public init(code: String, message: String, hint: String? = nil) {
        self.code = code
        self.message = message
        self.hint = hint
    }
}

public enum WorkflowEvent: Sendable {
    case sourceSelected(URL, MediaProbeResult)
    case projectInitialized(URL, InitResult)
    case projectOpened(StatusResult)
    case prepared(PrepareResult)
    case analyzed(AnalyzeResult)
    case reviewRequired
    case reviewReady(URL)
    case approved(ReviewResult)
    case nativeReviewApproved(NativeReviewApprovalResult)
    case aligned(AlignResult)
    case renderStarted
    case verified([RenderResult])
    case exported(URL)
    case commandStarted(String)
    case progress(CLIProgressEvent)
    case commandFinished
    case failed(WorkflowFailure)
    case cancelled
}

public enum WorkflowTransitionError: Error, Equatable, Sendable {
    case invalid(from: WorkflowStage, to: WorkflowStage)
}

public struct AppState: Equatable, Sendable {
    public private(set) var stage: WorkflowStage = .empty
    public private(set) var sourceURL: URL?
    public private(set) var projectURL: URL?
    public private(set) var mediaProbe: MediaProbeResult?
    public private(set) var project: InitResult?
    public private(set) var prepared: PrepareResult?
    public private(set) var analysis: AnalyzeResult?
    public private(set) var reviewURL: URL?
    public private(set) var approval: ReviewResult?
    public private(set) var nativeApproval: NativeReviewApprovalResult?
    public private(set) var alignment: AlignResult?
    public private(set) var results: [RenderResult] = []
    public private(set) var exportedURL: URL?
    public private(set) var activeCommand: String?
    public private(set) var latestProgress: CLIProgressEvent?
    public private(set) var failure: WorkflowFailure?

    public init() {}

    public mutating func reduce(_ event: WorkflowEvent) throws {
        switch event {
        case .sourceSelected(let source, let probe):
            self = AppState()
            sourceURL = source
            mediaProbe = probe
            stage = .sourceSelected
        case .projectInitialized(let root, let result):
            try advance(to: .initialized, allowed: [.sourceSelected])
            projectURL = root
            project = result
        case .projectOpened(let result):
            guard let restoredStage = WorkflowStage(projectStatus: result.state) else {
                throw WorkflowTransitionError.invalid(from: stage, to: .empty)
            }
            self = AppState()
            projectURL = URL(fileURLWithPath: result.projectRoot).standardizedFileURL
            sourceURL = URL(fileURLWithPath: result.sourcePath).standardizedFileURL
            stage = restoredStage
        case .prepared(let result):
            try advance(to: .prepared, allowed: [.initialized])
            prepared = result
        case .analyzed(let result):
            try advance(to: .analyzed, allowed: [.prepared])
            analysis = result
        case .reviewRequired:
            try advance(to: .reviewRequired, allowed: [.analyzed])
        case .reviewReady(let url):
            guard stage == .reviewRequired else {
                throw WorkflowTransitionError.invalid(from: stage, to: .reviewRequired)
            }
            reviewURL = url
        case .approved(let result):
            try advance(to: .approved, allowed: [.reviewRequired])
            approval = result
            reviewURL = nil
        case .nativeReviewApproved(let result):
            try advance(to: .approved, allowed: [.reviewRequired])
            nativeApproval = result
            reviewURL = nil
        case .aligned(let result):
            try advance(to: .aligned, allowed: [.approved])
            alignment = result
        case .renderStarted:
            try advance(to: .rendering, allowed: [.aligned, .verified])
        case .verified(let outputs):
            try advance(to: .verified, allowed: [.rendering])
            results = outputs
        case .exported(let url):
            try advance(to: .exported, allowed: [.verified, .exported])
            exportedURL = url
        case .commandStarted(let command):
            activeCommand = command
            latestProgress = nil
            failure = nil
        case .progress(let progress):
            latestProgress = progress
            if progress.event == "review.ready", let rawURL = progress.detail.reviewURL,
               let url = URL(string: rawURL), url.host == "127.0.0.1" {
                reviewURL = url
            }
        case .commandFinished:
            activeCommand = nil
        case .failed(let error):
            activeCommand = nil
            failure = error
        case .cancelled:
            activeCommand = nil
            failure = WorkflowFailure(
                code: "cancelled",
                message: "The current operation was cancelled.",
                hint: "Verified media and completed stages were preserved."
            )
        }
    }

    private mutating func advance(to next: WorkflowStage, allowed: Set<WorkflowStage>) throws {
        guard allowed.contains(stage) else {
            throw WorkflowTransitionError.invalid(from: stage, to: next)
        }
        stage = next
        failure = nil
    }
}
