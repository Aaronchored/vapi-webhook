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
// Limit prevents huge payload crashes
// ============================================
app.use(express.json({ limit: "1mb" }));


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

    const payload = req.body || {};

    // ============================================
    // DETECT EVENT TYPE
    // ============================================
    const eventType = payload?.message?.type;

    // ============================================
    // IGNORE NON-FINAL EVENTS
    // Vapi sends many webhook events per call
    // We only want the final call report
    // ============================================
    if (eventType !== "end-of-call-report") {

      console.log("Ignoring event:", eventType);

      return res.sendStatus(200);

    }


    console.log("=================================");
    console.log("FINAL CALL REPORT RECEIVED");


    // ============================================
    // EXTRACT CALL DATA SAFELY
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
    // Try structured data first
    // ============================================
    let endedReason =
      payload?.message?.call?.endedReason ||
      payload?.endedReason ||
      null;


    // ============================================
    // FALLBACK DETECTION
    // Some providers bury this in payload text
    // ============================================
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

      console.log("Conversation detected → AI determines outcome");

    }


    // ============================================
    // PRINT CLEAN CALL REPORT
    // ============================================
    console.log("CALL REPORT");

    console.log("callId:", callId);
    console.log("assistantId:", assistantId);
    console.log("phoneNumber:", phoneNumber);

    console.log("");

    console.log("duration:", duration);
    console.log("messages:", messages.length);
    console.log("endedReason:", endedReason);

    console.log("");

    console.log("finalOutcome:", outcome);

    console.log("=================================");


    // ============================================
    // STORE OUTCOME IN MEMORY
    // ============================================
    if (callId !== "unknown" && outcome) {

      callOutcomes[callId] = outcome;

      console.log("Outcome stored for:", callId);

    }


    // ============================================
    // RESPOND TO VAPI
    // ============================================
    res.sendStatus(200);

  }

  catch (error) {

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

    console.log("Outcome request for callId:", callId);


    // ============================================
    // VALIDATE REQUEST
    // ============================================
    if (!callId) {

      return res.status(400).json({
        error: "Missing callId"
      });

    }


    // ============================================
    // GET STORED OUTCOME
    // ============================================
    const outcome = callOutcomes[callId];


    // ============================================
    // IF OUTCOME NOT READY YET
    // ============================================
    if (!outcome) {

      return res.json({
        finalOutcome: null
      });

    }


    // ============================================
    // DELETE AFTER RETRIEVAL
    // Prevents duplicate processing
    // ============================================
    delete callOutcomes[callId];


    // ============================================
    // RETURN OUTCOME
    // ============================================
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
// HEALTH CHECK ROUTE
// Railway uses this to verify server is alive
// ============================================
app.get("/", (req, res) => {

  res.send("Server running");

});



// ============================================
// GLOBAL ERROR HANDLERS
// Prevent server crashes
// ============================================
process.on("uncaughtException", (err) => {

  console.error("Uncaught Exception:", err);

});

process.on("unhandledRejection", (err) => {

  console.error("Unhandled Promise Rejection:", err);

});



// ============================================
// START SERVER
// ============================================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {

  console.log(`Webhook server running on port ${PORT}`);

});
