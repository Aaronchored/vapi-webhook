import express from "express";

const app = express();

app.use(express.json({ limit: "1mb" }));

// ============================================
// TEMP STORAGE FOR OUTCOMES
// ============================================
const callOutcomes = {};

// prevent duplicate webhook processing
const processedCalls = new Set();


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
    // CHECK IF AI ALREADY PRODUCED AN OUTCOME
    // ============================================

    const structuredOutputs =
      payload?.message?.artifact?.structuredOutputs || {};

    const aiOutcomeExists =
      structuredOutputs && Object.keys(structuredOutputs).length > 0;


    let outcome = null;
    let endedReason =
      payload?.message?.call?.endedReason ||
      payload?.endedReason ||
      null;


    // ============================================
    // ONLY CLASSIFY TELEPHONY OUTCOME
    // IF NO AI OUTCOME EXISTS
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
    // CLEAN LOG BLOCK
    // ============================================

    console.log(`
=================================
FINAL CALL REPORT

callId: ${callId}
assistantId: ${assistantId}
phoneNumber: ${phoneNumber}

duration: ${duration}
messages: ${messages.length}
endedReason: ${endedReason}

aiOutcomeDetected: ${aiOutcomeExists}

systemOutcome: ${outcome}

=================================
`);


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
// START SERVER
// ============================================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Webhook server running on port ${PORT}`);
});
