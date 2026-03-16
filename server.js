import express from "express";
import fetch from "node-fetch";

const app = express();

app.use(express.json({ limit: "1mb" }));

// ============================================
// TEMP STORAGE FOR OUTCOMES
// ============================================
const callOutcomes = {};

const processedCalls = new Set();

setInterval(() => {
  processedCalls.clear();
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

    if (processedCalls.has(callId)) {
      return res.sendStatus(200);
    }

    processedCalls.add(callId);

    // ============================================
    // BASIC CALL DATA
    // ============================================

    const assistantId =
      payload?.assistant_id ||
      payload?.message?.assistant?.id ||
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
    // PARSE CALL NAME (personId|dealId)
    // ============================================

    let personId = null;
    let dealId = null;

    try {

      const callName =
        payload?.message?.call?.name || "";

      const parts = callName.split("|");

      personId = parts[0] || null;
      dealId = parts[1] || null;

    } catch {

      console.log("Call name parse failed");

    }

    // ============================================
    // PHONE FORMATTING
    // ============================================

    const phoneDigits =
      typeof phoneNumber === "string"
        ? phoneNumber.replace(/\D/g, "")
        : null;

    let phoneE164 = null;

    if (phoneDigits && phoneDigits.startsWith("04")) {
      phoneE164 = "+61" + phoneDigits.slice(1);
    }

    // ============================================
    // AI OUTPUT DETECTION
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
      structuredOutputs?.callOutcome?.result || null;

    const objectionType =
      structuredOutputs?.objectionType?.result || null;

    const callSummary =
      structuredOutputs?.callSummary?.result || null;

    const recordingUrl =
      structuredOutputs?.recordingUrl?.result || null;

    const lastAttemptUtc =
      structuredOutputs?.lastAttemptUtc?.result || null;

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

        if (payloadString.includes("voicemail")) {
          endedReason = "voicemail";
        }

        else if (payloadString.includes("silence-timed-out")) {
          endedReason = "silence-timed-out";
        }

        else if (payloadString.includes("customer-hangup")) {
          endedReason = "customer-hangup";
        }

      }

      if (endedReason === "voicemail") {
        outcome = "STVM";
      }

      else if (endedReason === "silence-timed-out") {
        outcome = "No Answer";
      }

      else if (endedReason === "customer-hangup") {
        outcome = "Call Ended Early";
      }

      else if (messages.length > 1) {
        outcome = "Conversation";
      }

      if (callId !== "unknown" && outcome) {
        callOutcomes[callId] = outcome;
      }

    }

    // ============================================
    // LOG OUTPUT
    // ============================================

    console.log(`
=================================
FINAL CALL REPORT

callId: ${callId}
assistantId: ${assistantId}

phoneNumber: ${phoneNumber}
phoneDigits: ${phoneDigits}
phoneE164: ${phoneE164}

personId: ${personId}
dealId: ${dealId}

duration: ${duration}
messages: ${messages.length}

endedReason: ${endedReason}
aiOutcomeDetected: ${aiOutcomeExists}

systemOutcome: ${outcome}

=================================
`);

    // ============================================
    // TRIGGER ZAP
    // ============================================

    const zapWebhook = process.env.ZAP_3_WEBHOOK;

    if (!zapWebhook) {

      console.error("Zap 3 webhook URL missing");

    } else {

      try {

        const zapResponse = await fetch(zapWebhook, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({

            personId,
            dealId,

            phoneDigits,
            phoneE164,

            callId,
            assistantId,

            duration,
            systemOutcome: outcome,
            aiOutcomeDetected: aiOutcomeExists,

            callOutcome,
            objectionType,
            callSummary,
            recordingUrl,
            lastAttemptUtc

          })
        });

        console.log(`Zap 3 webhook response: ${zapResponse.status}`);

      } catch (err) {

        console.error("Zap 3 webhook FAILED:", err);

      }

    }

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
  console.log(`Webhook server running on port ${PORT}`);
});
