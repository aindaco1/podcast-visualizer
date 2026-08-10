import Foundation
import Testing
@testable import PodcastVisualizerCore

@Suite("App state reducer")
struct AppStateTests {
    @Test("exposes stable human-readable workflow stage labels")
    func stageDisplayNames() {
        #expect(WorkflowStage.allCases.map(\.displayName) == [
            "Empty",
            "Source Selected",
            "Initialized",
            "Prepared",
            "Analyzed",
            "Review Required",
            "Approved",
            "Aligned",
            "Rendering",
            "Verified",
            "Exported",
        ])
    }

    @Test("automatically advances every stage that requires no new user decision")
    func automaticWorkflowPolicy() {
        #expect(AutomaticWorkflowPolicy.nextAction(for: .sourceSelected) == nil)
        #expect(AutomaticWorkflowPolicy.nextAction(for: .initialized) == .prepare)
        #expect(AutomaticWorkflowPolicy.nextAction(for: .prepared) == .analyze)
        #expect(AutomaticWorkflowPolicy.nextAction(for: .reviewRequired) == .loadTranscriptReview)
        #expect(AutomaticWorkflowPolicy.nextAction(for: .approved) == .align)
        #expect(AutomaticWorkflowPolicy.nextAction(for: .aligned) == nil)
        #expect(AutomaticWorkflowPolicy.nextAction(for: .verified) == nil)
    }

    @Test("moves through the review-gated workflow")
    func workflow() throws {
        let probe = try TestSupport.decodeFixture("probe", as: MediaProbeResult.self)
        let initialized = try TestSupport.decodeFixture("init", as: InitResult.self)
        let prepared = try TestSupport.decodeFixture("prepare", as: PrepareResult.self)
        let analyzed = try TestSupport.decodeFixture("analyze", as: AnalyzeResult.self)
        let reviewed = try TestSupport.decodeFixture("review", as: ReviewResult.self)
        let aligned = try TestSupport.decodeFixture("align", as: AlignResult.self)
        let rendered = try TestSupport.decodeFixture("render", as: [RenderResult].self)
        var state = AppState()
        let source = URL(fileURLWithPath: probe.sourcePath)
        let project = URL(fileURLWithPath: initialized.projectRoot)

        try state.reduce(.sourceSelected(source, probe))
        try state.reduce(.projectInitialized(project, initialized))
        try state.reduce(.prepared(prepared))
        try state.reduce(.analyzed(analyzed))
        try state.reduce(.reviewRequired)
        try state.reduce(.approved(reviewed))
        try state.reduce(.aligned(aligned))
        try state.reduce(.renderStarted)
        try state.reduce(.verified(rendered))
        try state.reduce(.exported(URL(fileURLWithPath: "/Users/example/Desktop/output.mov")))

        #expect(state.stage == .exported)
        #expect(state.results.count == 1)
    }

    @Test("failure and cancellation preserve the last valid immutable stage", arguments: WorkflowStage.allCases)
    func recovery(stage: WorkflowStage) throws {
        var state = try state(at: stage)
        try state.reduce(.commandStarted("render"))
        try state.reduce(.failed(WorkflowFailure(code: "fixture", message: "failed")))
        #expect(state.stage == stage)
        #expect(state.failure?.code == "fixture")
        try state.reduce(.commandStarted("render"))
        try state.reduce(.cancelled)
        #expect(state.stage == stage)
        #expect(state.failure?.code == "cancelled")
    }

    @Test("rejects skipped stages")
    func rejectsSkippedStages() throws {
        var state = AppState()
        #expect(throws: WorkflowTransitionError.self) {
            try state.reduce(.renderStarted)
        }
    }

    @Test("accepts native transcript approval at the review gate")
    func nativeApproval() throws {
        var state = try state(at: .reviewRequired)
        let approval = try TestSupport.decodeFixture(
            "review approve",
            as: NativeReviewApprovalResult.self
        )
        try state.reduce(.nativeReviewApproved(approval))
        #expect(state.stage == .approved)
        #expect(state.nativeApproval?.transcriptId == approval.transcriptId)
        #expect(state.approval == nil)
    }

    @Test("a post-verification transcript revision returns to approved without reusing downstream selections")
    func postVerificationRevision() throws {
        var state = try state(at: .exported)
        let approval = try TestSupport.decodeFixture(
            "review approve",
            as: NativeReviewApprovalResult.self
        )
        #expect(!state.results.isEmpty)
        #expect(state.exportedURL != nil)
        try state.reduce(.nativeReviewApproved(approval))
        #expect(state.stage == .approved)
        #expect(state.results.isEmpty)
        #expect(state.alignment == nil)
        #expect(state.exportedURL == nil)
    }

    @Test("opens a validated existing project at its resumable stage")
    func opensExistingProject() throws {
        let status = try TestSupport.decodeFixture("status", as: StatusResult.self)
        var state = AppState()
        try state.reduce(.projectOpened(status))
        #expect(state.stage == .approved)
        #expect(state.projectURL?.path == status.projectRoot)
        #expect(state.sourceURL?.path == status.sourcePath)
    }

    @Test("maps the CLI review-required status when reopening a project")
    func opensProjectAtTranscriptReview() throws {
        var object = try TestSupport.successOutputs()["status"] as! [String: Any]
        object["state"] = "review_required"
        let status = try ContractDecoder.decode(
            StatusResult.self,
            from: JSONSerialization.data(withJSONObject: object)
        )
        var state = AppState()
        try state.reduce(.projectOpened(status))
        #expect(state.stage == .reviewRequired)
    }

    private func state(at target: WorkflowStage) throws -> AppState {
        if target == .empty { return AppState() }
        let probe = try TestSupport.decodeFixture("probe", as: MediaProbeResult.self)
        let initialized = try TestSupport.decodeFixture("init", as: InitResult.self)
        let prepared = try TestSupport.decodeFixture("prepare", as: PrepareResult.self)
        let analyzed = try TestSupport.decodeFixture("analyze", as: AnalyzeResult.self)
        let reviewed = try TestSupport.decodeFixture("review", as: ReviewResult.self)
        let aligned = try TestSupport.decodeFixture("align", as: AlignResult.self)
        let rendered = try TestSupport.decodeFixture("render", as: [RenderResult].self)
        var state = AppState()
        try state.reduce(.sourceSelected(URL(fileURLWithPath: probe.sourcePath), probe))
        if target == .sourceSelected { return state }
        try state.reduce(.projectInitialized(URL(fileURLWithPath: initialized.projectRoot), initialized))
        if target == .initialized { return state }
        try state.reduce(.prepared(prepared))
        if target == .prepared { return state }
        try state.reduce(.analyzed(analyzed))
        if target == .analyzed { return state }
        try state.reduce(.reviewRequired)
        if target == .reviewRequired { return state }
        try state.reduce(.approved(reviewed))
        if target == .approved { return state }
        try state.reduce(.aligned(aligned))
        if target == .aligned { return state }
        try state.reduce(.renderStarted)
        if target == .rendering { return state }
        try state.reduce(.verified(rendered))
        if target == .verified { return state }
        try state.reduce(.exported(URL(fileURLWithPath: "/Users/example/Desktop/output.mov")))
        return state
    }
}
