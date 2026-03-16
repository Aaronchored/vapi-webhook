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
      console.log(`[${traceId}] Duplicate webhook ignored`);
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

    const duration =
      payload?.message?.call?.duration || 0;


    // ============================================
    // PARSE CALL NAME (personId|dealId|ledgerRowId)
    // ============================================

    let personId = null;
    let dealId = null;
    let ledgerRowId = null;

    try {
      const callName =
        payload?.message?.call?.name || "";

      const parts = callName.split("|");

      personId = parts[0] || null;
      dealId = parts[1] || null;
      ledgerRowId = parts[2] || null;
    } catch {}


    // ============================================
    // ATTEMPT COUNT FROM METADATA
    // ============================================

    const metadata =
      payload?.message?.call?.metadata ||
      payload?.message?.metadata ||
      payload?.metadata ||
      {};

    let attemptCount =
      metadata?.attemptCount ??
      metadata?.attempt_count ??
      metadata?.attempt ??
      payload?.message?.call?.attemptCount ??
      payload?.message?.call?.attempt_count ??
      null;

    if (attemptCount !== null && attemptCount !== undefined && attemptCount !== "") {
      const parsedAttemptCount = Number(attemptCount);
      attemptCount = Number.isNaN(parsedAttemptCount) ? attemptCount : parsedAttemptCount;
    } else {
      attemptCount = null;
    }


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
      } else if (digits.startsWith("04")) {
        phoneLocal = digits;
        phoneE164 = "+61" + digits.slice(1);
      }
    }


    // ============================================
    // AI OUTPUTS
    // ============================================

    const structuredOutputs =
      payload?.message?.artifact?.structuredOutputs || {};

    let aiOutcomeExists = false;

    for (const key in structuredOutputs) {
      if (structuredOutputs[key]?.result) {
        aiOutcomeExists = true;
        break;
      }
    }

    const callOutcome =
      structuredOutputs?.callOutcome?.result || "N/A";

    const engagementTier =
      structuredOutputs?.engagementTier?.result || "N/A";

    const dataQuality =
      structuredOutputs?.dataQuality?.result || "N/A";

    const finalStatus =
      structuredOutputs?.finalStatus?.result || "N/A";

    const objectionType =
      structuredOutputs?.objectionType?.result || "N/A";

    const callSummary =
      structuredOutputs?.callSummary?.result || "N/A";

    const recordingUrl =
      payload?.message?.call?.recordingUrl ||
      payload?.message?.artifact?.recordingUrl ||
      structuredOutputs?.recordingUrl?.result ||
      "N/A";


    // ============================================
    // LAST ATTEMPT UTC
    // ============================================

    const now = new Date();
    const launchTime = new Date(now.getTime() - duration * 1000);
    const lastAttemptUtc = launchTime.toISOString();


    // ============================================
    // TELEPHONY CLASSIFICATION
    // ============================================

    let outcome = null;

    let endedReason =
      payload?.message?.call?.endedReason ||
      payload?.endedReason ||
      null;

    if (!aiOutcomeExists) {
      if (!endedReason) {
        const payloadString = JSON.stringify(payload);

        if (payloadString.includes("voicemail"))
          endedReason = "voicemail";
        else if (payloadString.includes("silence-timed-out"))
          endedReason = "silence-timed-out";
        else if (payloadString.includes("customer-hangup"))
          endedReason = "customer-hangup";
      }

      if (endedReason === "voicemail")
        outcome = "STVM";
      else if (endedReason === "silence-timed-out")
        outcome = "No Answer";
      else if (endedReason === "customer-hangup")
        outcome = "Call Ended Early";
      else if (messages.length > 1)
        outcome = "Conversation";
    }


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
      } catch (err) {
        zapStatus = "failed";
      }
    }


    // ============================================
    // CLEAN REPORT BLOCK
    // ============================================

    const report = `
[${traceId}] =================================
[${traceId}] FINAL CALL REPORT

[${traceId}] callId: ${callId}
[${traceId}] assistantId: ${assistantId}
[${traceId}] assistantName: ${assistantName}

[${traceId}] personId: ${personId}
[${traceId}] dealId: ${dealId}
[${traceId}] ledgerRowId: ${ledgerRowId}
[${traceId}] attemptCount: ${attemptCount}

[${traceId}] phoneLocal: ${phoneLocal}
[${traceId}] phoneE164: ${phoneE164}

[${traceId}] duration: ${duration}
[${traceId}] messages: ${messages.length}

[${traceId}] endedReason: ${endedReason}
[${traceId}] systemOutcome: ${outcome}
[${traceId}] aiOutcomeDetected: ${aiOutcomeExists}

[${traceId}] callOutcome: ${callOutcome}
[${traceId}] engagementTier: ${engagementTier}
[${traceId}] dataQuality: ${dataQuality}
[${traceId}] finalStatus: ${finalStatus}

[${traceId}] recordingUrl: ${recordingUrl}
[${traceId}] lastAttemptUtc: ${lastAttemptUtc}

[${traceId}] Zap response: ${zapStatus}

[${traceId}] =================================
`;

    console.log(report);

    res.sendStatus(200);
  } catch (error) {
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
  console.log(`Webhook server running on port ${PORT}`);
});
