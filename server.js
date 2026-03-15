// ============================================
// IMPORT EXPRESS
// ============================================
import express from "express";


// ============================================
// CREATE SERVER
// ============================================
const app = express();


// ============================================
// ALLOW JSON PAYLOADS
// ============================================
app.use(express.json({ limit: "1mb" }));


// ============================================
// TEMP MEMORY STORAGE
// ============================================
const callOutcomes = {};


// ============================================
// VAPI WEBHOOK ENDPOINT
// ============================================
app.post("/vapi-webhook", async (req, res) => {

  try {

    const payload = req.body || {};

    const eventType = payload?.message?.type || "unknown";


    // ============================================
    // IGNORE NON FINAL EVENTS
    // ============================================
    if (eventType !== "end-of-call-report") {
      return res.sendStatus(200);
    }


    // ============================================
    // EXTRACT CALL DATA
    // ============================================
    const callId =
      payload?.call_id ||
      payload?.message?.call?.id ||
      "unknown";

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
    // DETECT ENDED REASON
    // ============================================
    let endedReason =
      payload?.message?.call?.endedReason ||
      payload?.endedReason ||
      null;

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


    // ============================================
    // DETERMINE OUTCOME
    // ============================================
    let outcome = null;

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


    // ============================================
    // STORE OUTCOME
    // ============================================
    if (callId !== "unknown" && outcome) {
      callOutcomes[callId] = outcome;
    }


    // ============================================
    // BUILD CLEAN LOG BLOCK
    // ============================================
    const log = [];

    log.push("=================================");
    log.push("FINAL CALL REPORT");

    log.push(`callId: ${callId}`);
    log.push(`assistantId: ${assistantId}`);
    log.push(`phoneNumber: ${phoneNumber}`);

    log.push("");

    log.push(`duration: ${duration}`);
    log.push(`messages: ${messages.length}`);
    log.push(`endedReason: ${endedReason}`);

    log.push("");

    log.push(`finalOutcome: ${outcome}`);

    if (outcome) {
      log.push(`outcomeStored: true`);
    }

    log.push("=================================");


    console.log(log.join("\n"));


    res.sendStatus(200);

  }

  catch (error) {

    console.error("Webhook processing error:", error);

    res.sendStatus(500);

  }

});


// ============================================
// ZAPIER OUTCOME RETRIEVAL
// ============================================
app.get("/outcome", (req, res) => {

  try {

    const callId = req.query.callId;

    if (!callId) {
      return res.status(400).json({ error: "Missing callId" });
    }

    const outcome = callOutcomes[callId];

    if (!outcome) {
      return res.json({ finalOutcome: null });
    }

    delete callOutcomes[callId];

    res.json({ finalOutcome: outcome });

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
// CRASH PROTECTION
// ============================================
process.on("uncaughtException", err => {
  console.error("Uncaught Exception:", err);
});

process.on("unhandledRejection", err => {
  console.error("Unhandled Rejection:", err);
});


// ============================================
// START SERVER
// ============================================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Webhook server running on port ${PORT}`);
});
