function defaultSpeakerName(id) {
  return `Speaker ${Number(id.slice(-2))}`;
}

export function summarizeApprovedTranscript(transcript) {
  const usedSpeakerIDs = new Set(transcript.cues.map(({ speakerLabel }) => speakerLabel));
  const reviewedSpeakers = (Array.isArray(transcript.speakers)
    ? transcript.speakers
    : [...usedSpeakerIDs].map((id) => ({ id, displayName: defaultSpeakerName(id) })))
    .filter(({ id }) => usedSpeakerIDs.has(id));
  return {
    words: transcript.projection.wordCount,
    speakers: reviewedSpeakers.length,
    recognizedSpeakers: reviewedSpeakers.filter(
      ({ id, displayName }) => displayName !== defaultSpeakerName(id)
    ).length,
    cues: transcript.cues.length
  };
}

export function approvedReviewResult(approved) {
  return {
    state: "approved",
    transcriptId: approved.transcriptId,
    contentSha256: approved.contentSha256,
    manifestSha256: approved.manifestSha256,
    transcript: summarizeApprovedTranscript(approved)
  };
}
