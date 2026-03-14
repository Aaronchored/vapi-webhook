```javascript
// ============================================
// IMPORT EXPRESS
// ============================================
import express from "express";


// ============================================
// CREATE SERVER
// ============================================
const app = express();


// ============================================
// ALLOW SERVER TO READ JSON WEBHOOK PAYLOADS
// ============================================
app.use(express.json());


// ============================================
// TEMP MEMORY STORAGE
// Stores outcomes until Zapier retrieves them
// ============================================
const callOutcomes = {};


// ============================================
// VAPI WEBHOOK ENDPOINT
// ============================================
app.post("/vapi-webhook", async (req, res) => {

  try {

    const payload = req.body;

    console.log("------ WEBHOOK RECEIVED ------");

    // Print full payload for debugging
    console.log(JSON.stringify(payload, null, 2));


    // ============================================
    // EXTRACT IMPORTANT CALL DATA SAFELY
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
    // DETECT HOW CALL ENDED
    // ============================================

    const payloadString = JSON.stringify(payload);

    let endedReason = null;

    if (payloadString.includes("voicemail")) {
      endedReason = "voicemail";
    }

    if (payloadString.includes("silence-timed-out")) {
      endedReason = "silence-timed-out";
    }

    if (payloadString.includes("customer-hangup")) {
      endedReason = "customer-hangup";
    }


    // ============================================
    // DETERMINE SYSTEM OUTCOME
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
      console.log("Conversation detected → AI decides outcome");
    }


    // ============================================
    // STRUCTURED CALL REPORT LOG
    // ============================================

    console.log("=================================");
    console.log("CALL REPORT");

    console.log("callId:", callId);
    console.log("assistantId:", assistantId);
    console.log("phoneNumber:", phoneNumber);

    console.log("");

    console.log("duration:", duration);
    console.log("endedReason:", endedReason);
    console.log("messages:", messages.length);

    console.log("");

    console.log("finalOutcome:", outcome);

    console.log("=================================");


    // ============================================
    // STORE OUTCOME IN MEMORY
    // ============================================

    if (callId !== "unknown" && outcome) {
      callOutcomes[callId] = outcome;
    }


    // Respond to Vapi
    res.sendStatus(200);

  } catch (error) {

    console.error("Webhook processing error:", error);

    res.sendStatus(500);

  }

});



// ============================================
// ZAPIER OUTCOME RETRIEVAL ENDPOINT
// ============================================

app.get("/outcome", (req, res) => {

  try {

    const callId = req.query.callId;

    console.log("Outcome request received for callId:", callId);

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


    // delete after retrieval
    delete callOutcomes[callId];


    res.json({
      finalOutcome: outcome
    });

  } catch (error) {

    console.error("Outcome retrieval error:", error);

    res.sendStatus(500);

  }

});



// ============================================
// HEALTH CHECK ROUTE
// (helps Railway confirm server is alive)
// ============================================

app.get("/", (req, res) => {
  res.send("Server running");
});



// ============================================
// START SERVER
// ============================================

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Webhook running on port ${PORT}`);
});
```
