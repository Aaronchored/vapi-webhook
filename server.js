import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json({ limit: "1mb" }));

// ============================================
// DUPLICATE WEBHOOK PROTECTION
// ============================================

const processedCalls = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [key, value] of processedCalls.entries()) {
    if (now - value > 60 * 60 * 1000) {
      processedCalls.delete(key);
    }
  }
}, 60 * 60 * 1000);


// ============================================
// VAPI WEBHOOK
// ============================================

app.post("/vapi-webhook", async (req, res) => {

  try {

    const payload = req.body || {};
    const eventType = payload?.message?.type || "unknown";

    if (eventType !== "end-of-call-report") {
      return res.sendStatus(200);
    }

    const callId =
      payload?.call_id ||
      payload?.message?.call?.id ||
      "unknown";

    const traceId =
      callId !== "unknown"
        ? callId.slice(-4)
        : "????";

    if (processedCalls.has(callId)) {
      console.log("[" + traceId + "] Duplicate webhook ignored");
      return res.sendStatus(200);
    }

    processedCalls.set(callId, Date.now());


    // ============================================
    // BASIC CALL DATA
    // ============================================

    const assistantId =
      payload?.assistant_id ||
      payload?.message?.assistant?.id ||
      "unknown";

    const assistantName =
      payload?.message?.assistant?.name ||
      payload?.assistant_name ||
      "unknown";

    const phoneNumber =
      payload?.phone_number ||
      payload?.message?.call?.phoneNumber ||
      payload?.message?.customer?.number ||
      payload?.message?.call?.customer?.number ||
      "unknown";

    const messages =
      payload?.message?.artifact?.messages || [];

    const customerSpoke = messages.some(m => m.role === "customer");

    const assistantTurns = messages.filter(m => m.role === "assistant").length;

    const duration =
      payload?.message?.call?.duration || 0;


    // ============================================
    // PARSE CALL NAME (personId|dealId|ledgerRowId|attemptCount)
    // ============================================

    let personId = null;
    let dealId = null;
    let ledgerRowId = null;
    let attemptCount = null;

    try {

      const callName =
        payload?.message?.call?.name || "";

    const parts = callName.split("|").map(p => p.trim());

        personId = parts[0] || null;
        dealId = parts[1] || null;
        ledgerRowId = parts[2] ? Number(parts[2]) : null;

    if (parts[3]) {
      const parsed = Number(parts[3]);
        attemptCount = Number.isNaN(parsed) ? null : parsed;
    }

    } catch {}


    // ============================================
    // PHONE FORMATTING
    // ============================================

    let phoneLocal = null;
    let phoneE164 = null;

    if (typeof phoneNumber === "string") {

      const digits = phoneNumber.replace(/\D/g, "");

      if (digits.startsWith("614")) {
        phoneLocal = "0" + digits.slice(2);
        phoneE164 = "+" + digits;
      }

      else if (digits.startsWith("04")) {
        phoneLocal = digits;
        phoneE164 = "+61" + digits.slice(1);
      }

    }


    // ============================================
    // AI OUTPUTS
    // ============================================

    const structuredOutputs =
      payload?.message?.artifact?.structuredOutputs || {};

    let callOutcome =
      structuredOutputs?.callOutcome?.result ?? null;

    let engagementTier =
      structuredOutputs?.engagementTier?.result ?? null;

    let dataQuality =
      structuredOutputs?.dataQuality?.result ?? null;

    let finalStatus =
      structuredOutputs?.finalStatus?.result ?? null;

    let objectionType =
      structuredOutputs?.objectionType?.result ?? null;

    let callSummary =
      structuredOutputs?.callSummary?.result ?? null;

    const recordingUrl =
      payload?.message?.call?.recordingUrl ||
      payload?.message?.artifact?.recordingUrl ||
      structuredOutputs?.recordingUrl?.result ||
      null;


    // ============================================
    // DETECT IF AI OUTCOME EXISTS
    // ============================================

    const aiOutcomeExists =
      callOutcome !== null ||
      engagementTier !== null ||
      dataQuality !== null ||
      finalStatus !== null ||
      objectionType !== null ||
      callSummary !== null;


// ============================================
// TELEPHONY CLASSIFICATION (PRODUCTION PATTERN)
// ============================================

let outcome = null;

let endedReason =
  payload?.message?.call?.endedReason ||
  payload?.endedReason ||
  null;

// Detect if the customer actually spoke
const customerSpoke = messages.some(
  m => m.role === "customer"
);

if (!aiOutcomeExists) {

  // 1️⃣ Human speech always wins
  if (customerSpoke) {

    outcome = "Conversation";

  }

  // 2️⃣ Voicemail detected
  else if (endedReason === "voicemail") {

    outcome = "STVM";

  }

  // 3️⃣ Silence timeout
  else if (endedReason === "silence-timed-out") {

    outcome = "No Answer";

  }

  // 4️⃣ Customer hung up before speaking
  else if (endedReason === "customer-hangup") {

    outcome = "Call Ended Early";

  }

  // 5️⃣ Long interaction fallback
  else if (messages.length > 4) {

    outcome = "Conversation";

  }

  // 6️⃣ Default fallback
  else {

    outcome = "No Answer";

  }

}

    // ============================================
    // LAST ATTEMPT UTC
    // ============================================

    const now = new Date();
    const launchTime = new Date(now.getTime() - duration * 1000);
    const lastAttemptUtc = launchTime.toISOString();


    // ============================================
    // TRIGGER ZAP
    // ============================================

    let zapStatus = "not_sent";

    const zapWebhook = process.env.ZAP_3_WEBHOOK;

    if (zapWebhook) {

      try {

        const zapResponse = await fetch(zapWebhook, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({

            personId,
            dealId,
            ledgerRowId,
            attemptCount,

            phoneLocal,
            phoneE164,

            callId,
            assistantId,
            assistantName,

            duration,
            systemOutcome: outcome,
            aiOutcomeDetected: aiOutcomeExists,

            callOutcome,
            engagementTier,
            dataQuality,
            finalStatus,
            objectionType,
            callSummary,

            recordingUrl,
            lastAttemptUtc

          })
        });

        zapStatus = zapResponse.status;

      }

      catch {

        zapStatus = "failed";

      }

    }


    // ============================================
    // CLEAN REPORT BLOCK
    // ============================================

    const report =
      "\n[" + traceId + "] =================================" +
      "\n[" + traceId + "] FINAL CALL REPORT\n" +
      "\n[" + traceId + "] callId: " + callId +
      "\n[" + traceId + "] assistantId: " + assistantId +
      "\n[" + traceId + "] assistantName: " + assistantName +
      "\n\n[" + traceId + "] personId: " + personId +
      "\n[" + traceId + "] dealId: " + dealId +
      "\n[" + traceId + "] ledgerRowId: " + ledgerRowId +
      "\n[" + traceId + "] attemptCount: " + attemptCount +
      "\n\n[" + traceId + "] phoneLocal: " + phoneLocal +
      "\n[" + traceId + "] phoneE164: " + phoneE164 +
      "\n\n[" + traceId + "] duration: " + duration +
      "\n[" + traceId + "] messages: " + messages.length +
      "\n[" + traceId + "] customerSpoke: " + customerSpoke +
      "\n[" + traceId + "] assistantTurns: " + assistantTurns +
      "\n\n[" + traceId + "] endedReason: " + endedReason +
      "\n[" + traceId + "] systemOutcome: " + outcome +
      "\n[" + traceId + "] aiOutcomeDetected: " + aiOutcomeExists +
      "\n\n[" + traceId + "] callOutcome: " + callOutcome +
      "\n[" + traceId + "] engagementTier: " + engagementTier +
      "\n[" + traceId + "] dataQuality: " + dataQuality +
      "\n[" + traceId + "] finalStatus: " + finalStatus +
      "\n\n[" + traceId + "] recordingUrl: " + recordingUrl +
      "\n[" + traceId + "] lastAttemptUtc: " + lastAttemptUtc +
      "\n\n[" + traceId + "] Zap response: " + zapStatus +
      "\n\n[" + traceId + "] =================================";

    console.log(report);

    res.sendStatus(200);

  }

  catch (error) {

    console.error("Webhook processing error:", error);
    res.sendStatus(500);

  }

});


// ============================================
// HEALTH CHECK
// ============================================

app.get("/", (req, res) => {
  res.send("Server running");
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Webhook server running on port " + PORT);
});
