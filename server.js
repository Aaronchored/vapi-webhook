import express from "express";
import fetch from "node-fetch";

const app = express();

app.use(express.json({ limit: "1mb" }));


// ============================================
// TEMP STORAGE FOR OUTCOMES
// ============================================
const callOutcomes = {};


// prevent duplicate webhook processing
const processedCalls = new Set();


// ============================================
// CLEANUP MEMORY (prevents memory growth)
// ============================================
setInterval(() => {
  processedCalls.clear();
}, 60 * 60 * 1000); // clear every hour


// ============================================
// VAPI WEBHOOK ENDPOINT
// ============================================
app.post("/vapi-webhook", async (req, res) => {

  try {

    const payload = req.body || {};

    const eventType = payload?.message?.type || "unknown";

    // only process final call reports
    if (eventType !== "end-of-call-report") {
      return res.sendStatus(200);
    }

    const callId =
      payload?.call_id ||
      payload?.message?.call?.id ||
      "unknown";

    // prevent duplicate processing
    if (processedCalls.has(callId)) {
      return res.sendStatus(200);
    }

    processedCalls.add(callId);


    // ============================================
    // EXTRACT BASIC CALL DATA
    // ============================================

    const assistantId =
      payload?.assistant_id ||
      payload?.message?.assistant?.id ||
      "unknown";

    const phoneNumber =
      payload?.phone_number ||
      payload?.message?.call?.phoneNumber ||
      "unknown";

    const messages =
      payload?.message?.artifact?.messages || [];

    const duration =
      payload?.message?.call?.duration || 0;


    // ============================================
    // EXTRACT METADATA FROM CALL NAME (Zap 2)
    // ============================================

    let name = null;
    let personId = null;
    let dealId = null;

    try {

      const callName =
        payload?.message?.call?.name || "{}";

      const parsedMeta = JSON.parse(callName);

      name = parsedMeta.name || null;
      personId = parsedMeta.personId || null;
      dealId = parsedMeta.dealId || null;

    } catch (err) {

      console.log("Metadata parse failed");

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
    // DETECT REAL AI OUTCOME
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


    // ============================================
    // EXTRACT STRUCTURED OUTPUT VALUES
    // ============================================

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


    let outcome = null;

    let endedReason =
      payload?.message?.call?.endedReason ||
      payload?.endedReason ||
      null;


    // ============================================
    // TELEPHONY CLASSIFICATION
    // ============================================

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
    // CLEAN SINGLE LOG BLOCK
    // ============================================

    const logBlock = [
      "=================================",
      "FINAL CALL REPORT",
      "",
      `callId: ${callId}`,
      `assistantId: ${assistantId}`,
      `phoneNumber: ${phoneNumber}`,
      `phoneDigits: ${phoneDigits}`,
      `phoneE164: ${phoneE164}`,
      "",
      `name: ${name}`,
      `personId: ${personId}`,
      `dealId: ${dealId}`,
      "",
      `duration: ${duration}`,
      `messages: ${messages.length}`,
      "",
      `endedReason: ${endedReason}`,
      `aiOutcomeDetected: ${aiOutcomeExists}`,
      "",
      `systemOutcome: ${outcome}`,
      "",
      "================================="
    ].join("\n");

    console.log(logBlock);


    // ============================================
    // TRIGGER ZAP 3
    // ============================================

    const zapWebhook = process.env.ZAP_3_WEBHOOK;

    if (!zapWebhook) {

      console.error("Zap 3 webhook URL missing: ZAP_3_WEBHOOK is not set");

    } else {

      try {

        console.log("Triggering Zap 3 webhook");

        const zapResponse = await fetch(zapWebhook, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({

            name,
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

      } catch (zapError) {

        console.error("Zap 3 webhook FAILED:", zapError);

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
// OUTCOME RETRIEVAL ENDPOINT (ZAPIER)
// ============================================
app.get("/outcome", (req, res) => {

  try {

    const callId = req.query.callId;

    if (!callId) {
      return res.status(400).json({
        error: "Missing callId"
      });
    }

    const outcome = callOutcomes[callId];

    if (!outcome) {
      return res.json({
        finalOutcome: null
      });
    }

    delete callOutcomes[callId];

    res.json({
      finalOutcome: outcome
    });

  }

  catch (error) {

    console.error("Outcome retrieval error:", error);

    res.sendStatus(500);

  }

});


// ============================================
// HEALTH CHECK
// ============================================
app.get("/", (req, res) => {
  res.send("Server running");
});


// ============================================
// START SERVER
// ============================================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Webhook server running on port ${PORT}`);
});
