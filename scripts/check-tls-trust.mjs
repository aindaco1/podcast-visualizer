// Public, opt-in TLS acceptance. Run with the exact binary being shipped.
import https from "node:https";
const issuers = ["dv-g3b", "dv-g3c", "ov-g3b", "ov-g3c", "ev-g3b", "ev-g3c"];
const badHosts = issuers.flatMap(issuer => ["", "-aaa"].map(cross => `${issuer}${cross}-emudhra.we-have-a-problem.com`));
const certErrors = new Set(["CERT_REVOKED", "CERT_SIGNATURE_FAILURE", "CERT_UNTRUSTED", "UNABLE_TO_GET_ISSUER_CERT_LOCALLY", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "SELF_SIGNED_CERT_IN_CHAIN"]);
function request(host) {
  return new Promise((resolve, reject) => {
    const req = https.get(`https://${host}/`, {timeout: 15000}, res => { res.resume(); resolve(res.statusCode); });
    req.on("timeout", () => req.destroy(new Error("request timed out")));
    req.on("error", reject);
  });
}
for (const [name, get] of [
  ["https", request],
  ["fetch", async host => (await fetch(`https://${host}/`, {redirect: "error", signal: AbortSignal.timeout(15000)})).status]
]) {
  if (await get("example.com") !== 200) throw new Error(`${name}: valid control failed`);
  console.log(JSON.stringify({client:name, host:"example.com", result:"control-accepted", node:process.version}));
  for (const host of badHosts) {
    let failure;
    try { await get(host); } catch (error) { failure = error; }
    const code = failure?.cause?.code || failure?.code;
    if (!certErrors.has(code)) throw new Error(`${name}: ${host}: certificate rejection not established: ${failure || "ACCEPTED"}`);
    console.log(JSON.stringify({client:name, host, result:"certificate-rejected", code}));
  }
}

