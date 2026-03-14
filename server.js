```javascript
// ============================================
// IMPORT EXPRESS
// Express creates the web server that receives
// webhook events from Vapi
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
//
// Example:
// callOutcomes["019cea..."] = "STVM"
// ============================================
const callOutcomes = {};


// ============================================
// VAPI WEBHOOK ENDPOINT
// Vapi sends call reports here
// ============================================
app.post("/vapi-webhook", async (req, res) => {

  const payload = req.body;

  console.log("------ WEBHOOK RECEIVED ------");

  // Print full payload for debugging
  console.log(JSON.stringify(payload, null, 2));


  // ============================================
  // EXTRACT IMPORTANT CALL DATA
  // ============================================

  const callId =
    payload.call_id ||
    payload.message?.call?.id ||
    "unknown";

  const assistantId =
    payload.assistant_id ||
    payload.message?.assistant?.id ||
    "unknown";

  const phoneNumber =
    payload.phone_number ||
    payload.message?.call?.phoneNumber ||
    "unknown";

  const messages =
    payload.message?.artifact?.messages || [];

  const duration =
    payload.message?.call?.duration || 0;


  // ============================================
  // DETECT HOW CALL ENDED
  // (simple keyword scan of payload)
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
  // Much easier to read when running
  // multiple callers simultaneously
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
  // Zapier will fetch this using callId
  // ============================================

  if (callId !== "unknown" && outcome) {
    callOutcomes[callId] = outcome;
  }


  // ============================================
  // ACKNOWLEDGE WEBHOOK RECEIVED
  // ============================================

  res.sendStatus(200);

});



// ============================================
// ZAPIER OUTCOME RETRIEVAL ENDPOINT
// Zapier calls this to retrieve final outcome
// ============================================

app.get("/outcome", (req, res) => {

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


  // ============================================
  // DELETE AFTER RETRIEVAL
  // Prevents memory buildup and stale data
  // ============================================

  delete callOutcomes[callId];


  // Return final outcome to Zapier
  res.json({
    finalOutcome: outcome
  });

});



// ============================================
// START SERVER
// Railway exposes port 3000 publicly
// ============================================

app.listen(3000, () => {
  console.log("Webhook running on port 3000");
});
```
