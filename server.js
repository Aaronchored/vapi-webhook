// ============================================
// IMPORT EXPRESS
// Express is the web server framework
// ============================================
import express from "express";


// ============================================
// CREATE SERVER INSTANCE
// ============================================
const app = express();


// ============================================
// JSON BODY PARSER
// Allows the server to read webhook JSON payloads
// limit prevents extremely large payload crashes
// ============================================
app.use(express.json({ limit: "1mb" }));


// ============================================
// TEMPORARY MEMORY STORAGE
// Stores call outcomes until Zapier retrieves them
// Key = callId
// Value = outcome
// ============================================
const callOutcomes = {};


// ============================================
// VAPI WEBHOOK ENDPOINT
// This receives events from Vapi when calls end
// ============================================
app.post("/vapi-webhook", async (req, res) => {

  try {

    // ============================================
    // GET WEBHOOK PAYLOAD
    // ============================================
    const payload = req.body || {};

    console.log("------ VAPI WEBHOOK RECEIVED ------");


    // ============================================
    // SAFELY EXTRACT CALL DATA
    // Optional chaining prevents crashes
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
    // DETECT HOW THE CALL ENDED
    // Try structured data first
    // Fallback to string scan if needed
    // ============================================

    let endedReason =
      payload?.message?.call?.endedReason ||
      payload?.endedReason ||
      null;


    // fallback detection if provider changes structure
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
    // Only applies if no real conversation occurred
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

      // conversation happened
      // AI structured output should determine outcome
      console.log("Conversation detected → AI decides outcome");

    }


    // ============================================
    // PRINT CLEAN CALL REPORT
    // Structured logs help debugging later
    // ============================================

    console.log("=================================");
    console.log("CALL REPORT");

    console.log("callId:", callId);
    console.log("assistantId:", assistantId);
    console.log("phoneNumber:", phoneNumber);

    console.log("duration:", duration);
    console.log("messages:", messages.length);
    console.log("endedReason:", endedReason);

    console.log("finalOutcome:", outcome);

    console.log("=================================");


    // ============================================
    // STORE OUTCOME IN TEMP MEMORY
    // Only store if we have a valid callId + outcome
    // ============================================

    if (callId !== "unknown" && outcome) {

      callOutcomes[callId] = outcome;

      console.log("Outcome stored for:", callId);

    }


    // ============================================
    // RESPOND TO VAPI
    // Must return 200 or webhook will retry
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
// Zapier calls this to retrieve call outcome
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
    // GET OUTCOME FROM MEMORY
    // ============================================

    const outcome = callOutcomes[callId];


    // ============================================
    // IF OUTCOME NOT READY YET
    // Zapier should retry later
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
// GLOBAL ERROR HANDLER
// Prevents Railway crashes from uncaught errors
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
