const audio = document.querySelector("#audio");
const cueRoot = document.querySelector("#cues");
const status = document.querySelector("#status");
const template = document.querySelector("#cue-template");
const confirmSpeakersButton = document.querySelector("#confirm-speakers");
const saveButton = document.querySelector("#save");
const approveButton = document.querySelector("#approve");
const speakerFields = document.querySelector("#speaker-fields");
const addSpeakerButton = document.querySelector("#add-speaker");

let speakers = [];
let cues = [];
let dirty = false;

function tokenFromFragment() {
  const params = new URLSearchParams(location.hash.slice(1));
  const token = params.get("token") || "";
  history.replaceState(null, "", `${location.pathname}${location.search}`);
  return token;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const contentType = response.headers.get("content-type") || "";
  const body = contentType.includes("application/json") ? await response.json() : await response.text();
  if (!response.ok) throw new Error(body?.error || body || `Request failed (${response.status})`);
  return body;
}

function clock(milliseconds) {
  const total = Math.max(0, Math.floor(milliseconds / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function markDirty() {
  dirty = true;
  status.value = "Unsaved edits";
}

function defaultSpeakerName(id) {
  return `Speaker ${Number(id.slice(-2))}`;
}

function renderSpeakers() {
  speakerFields.replaceChildren();
  for (const definition of speakers) {
    const row = document.createElement("div");
    row.className = "speaker-field";
    const label = document.createElement("label");
    label.htmlFor = `name-${definition.id}`;
    label.textContent = definition.id;
    const input = document.createElement("input");
    input.id = label.htmlFor;
    input.type = "text";
    input.maxLength = 60;
    input.value = definition.displayName;
    input.setAttribute("aria-label", `Display name for ${definition.id}`);
    input.addEventListener("input", () => {
      definition.displayName = input.value.normalize("NFC").trim();
      markDirty();
    });
    input.addEventListener("change", render);
    row.append(label, input);
    speakerFields.append(row);
  }
  addSpeakerButton.disabled = speakers.length >= 6;
}

function addSpeaker() {
  const existing = new Set(speakers.map(({ id }) => id));
  const id = Array.from({ length: 6 }, (_, index) => `speaker-0${index + 1}`)
    .find((candidate) => !existing.has(candidate));
  if (!id) return;
  speakers.push({ id, displayName: defaultSpeakerName(id) });
  markDirty();
  renderSpeakers();
  render();
  document.querySelector(`#name-${id}`)?.focus();
}

function render() {
  cueRoot.replaceChildren();
  cues.forEach((cue, index) => {
    const node = template.content.firstElementChild.cloneNode(true);
    const seek = node.querySelector(".seek");
    seek.textContent = clock(cue.startsAtMs);
    seek.addEventListener("click", () => {
      audio.currentTime = cue.startsAtMs / 1000;
      audio.play().catch((error) => { status.value = `Audio playback failed: ${error.message}`; });
    });
    const speaker = node.querySelector(".speaker");
    for (const definition of speakers) {
      speaker.add(new Option(definition.displayName, definition.id));
    }
    speaker.add(new Option("Unknown", "unknown"));
    speaker.value = cue.speakerLabel;
    speaker.addEventListener("change", () => { cue.speakerLabel = speaker.value; markDirty(); render(); });
    const confirmed = node.querySelector(".confirmed");
    confirmed.checked = cue.speakerConfirmed;
    confirmed.disabled = cue.speakerLabel === "unknown";
    confirmed.addEventListener("change", () => { cue.speakerConfirmed = confirmed.checked; markDirty(); });
    const text = node.querySelector(".text");
    text.value = cue.textMarkdown;
    text.addEventListener("input", () => { cue.textMarkdown = text.value; markDirty(); });
    const warning = node.querySelector(".warning");
    if (cue.speakerAmbiguous || cue.speakerLabel === "unknown") {
      warning.hidden = false;
      warning.textContent = "Speaker assignment needs review.";
    }
    node.querySelector(".split").addEventListener("click", () => splitCue(index));
    const merge = node.querySelector(".merge");
    merge.disabled = index === cues.length - 1;
    merge.addEventListener("click", () => mergeCue(index));
    cueRoot.append(node);
  });
}

function splitCue(index) {
  const cue = cues[index];
  const at = Math.round(audio.currentTime * 1000);
  if (at <= cue.startsAtMs + 150 || at >= cue.endsAtMs - 150) {
    status.value = "Move the playhead inside this cue before splitting.";
    return;
  }
  const words = cue.textMarkdown.trim().split(/\s+/);
  const fraction = (at - cue.startsAtMs) / (cue.endsAtMs - cue.startsAtMs);
  const cut = Math.max(1, Math.min(words.length - 1, Math.round(words.length * fraction)));
  const left = { ...cue, endsAtMs: at, textMarkdown: words.slice(0, cut).join(" ") };
  const right = { ...cue, startsAtMs: at, textMarkdown: words.slice(cut).join(" ") };
  cues.splice(index, 1, left, right);
  markDirty();
  render();
}

function mergeCue(index) {
  const left = cues[index];
  const right = cues[index + 1];
  cues.splice(index, 2, {
    ...left,
    endsAtMs: right.endsAtMs,
    textMarkdown: `${left.textMarkdown.trim()} ${right.textMarkdown.trim()}`,
    speakerConfirmed: left.speakerConfirmed && right.speakerConfirmed && left.speakerLabel === right.speakerLabel,
    speakerAmbiguous: left.speakerLabel !== right.speakerLabel
  });
  markDirty();
  render();
}

async function save() {
  await api("/api/working", { method: "PUT", body: JSON.stringify({ speakers, cues }) });
  dirty = false;
  status.value = "Working copy saved";
}

function confirmAssignedSpeakers() {
  if (!confirm("Confirm every current non-unknown anonymous speaker assignment?")) return;
  for (const cue of cues) {
    if (cue.speakerLabel !== "unknown") cue.speakerConfirmed = true;
  }
  markDirty();
  render();
}

async function approve() {
  if (!cues.every((cue) => cue.textMarkdown.trim() && cue.speakerConfirmed && cue.speakerLabel !== "unknown")) {
    status.value = "Every cue needs text and a confirmed anonymous speaker.";
    return;
  }
  if (!confirm("Approve this exact lightly cleaned verbatim transcript revision?")) return;
  approveButton.disabled = true;
  const result = await api("/api/approve", { method: "POST", body: JSON.stringify({ speakers, cues }) });
  dirty = false;
  status.value = `Approved ${result.transcriptId}. You may close this tab.`;
}

window.addEventListener("beforeunload", (event) => {
  if (!dirty) return;
  event.preventDefault();
  event.returnValue = "";
});

saveButton.addEventListener("click", () => save().catch((error) => { status.value = error.message; }));
confirmSpeakersButton.addEventListener("click", confirmAssignedSpeakers);
approveButton.addEventListener("click", () => approve().catch((error) => { approveButton.disabled = false; status.value = error.message; }));
addSpeakerButton.addEventListener("click", addSpeaker);

try {
  const token = tokenFromFragment();
  const session = await api("/api/session", { method: "POST", headers: { "X-Review-Token": token } });
  audio.src = `/api/audio?token=${encodeURIComponent(session.audioToken)}`;
  audio.load();
  const working = await api("/api/working");
  speakers = structuredClone(working.speakers);
  cues = structuredClone(working.cues);
  renderSpeakers();
  render();
  status.value = working.hasWorkingCopy
    ? `${cues.length} cues restored from the working copy`
    : `${cues.length} cues ready for review`;
} catch (error) {
  status.value = error.message;
  confirmSpeakersButton.disabled = true;
  saveButton.disabled = true;
  approveButton.disabled = true;
  addSpeakerButton.disabled = true;
}
