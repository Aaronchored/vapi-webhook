// ============================================
// IMPORT EXPRESS
// Express allows us to create a small web server
// that receives webhook events from Vapi
// ============================================
import express from "express";


// ============================================
// CREATE THE SERVER
// ============================================
const app = express();


// ============================================
// ALLOW THE SERVER TO READ JSON PAYLOADS
// Vapi sends webhook data as JSON
// ============================================
app.use(express.json());


// ============================================
// TEMPORARY MEMORY STORAGE
// This stores call outcomes until Zapier fetches them
//
// Example:
// callOutcomes["019cea..."] = "STVM"
// ============================================
const callOutcomes = {};



// ============================================
// VAPI WEBHOOK ENDPOINT
// Vapi sends events here when calls change state
// ============================================
app.post("/vapi-webhook", async (req, res) => {

  const payload = req.body;

  console.log("------ WEBHOOK RECEIVED ------");


  // ============================================
  // PRINT FULL PAYLOAD FOR DEBUGGING
  // Helps inspect Vapi's event structure
  // ============================================
  console.log(JSON.stringify(payload, null, 2));


  // ============================================
  // CHECK EVENT TYPE
  // We only want to process the final call report
  // Other events should be ignored
  // ============================================
  const eventType = payload.type;

  if (eventType !== "end-of-call-report") {

    console.log("Ignoring event type:", eventType);

    // Acknowledge webhook but stop processing
    return res.sendStatus(200);
  }


  // ============================================
  // EXTRACT IMPORTANT CALL DATA
  // ============================================
  const callId = payload.message?.call?.id || "unknown";
  const assistantId = payload.message?.assistant?.id || "unknown";
  const phoneNumber = payload.message?.call?.phoneNumber || "unknown";

  const messages = payload.message?.artifact?.messages || [];


  // ============================================
  // DETECT HOW THE CALL ENDED
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
  // LOG CALL DETAILS
  // ============================================
  console.log("callId:", callId);
  console.log("assistantId:", assistantId);
  console.log("phoneNumber:", phoneNumber);
  console.log("Detected endedReason:", endedReason);
  console.log("messages.length:", messages.length);


  // ============================================
  // DETERMINE FINAL SYSTEM OUTCOME
  // TELEPHONY SIGNALS OVERRIDE CONVERSATION
  // ============================================
  let outcome = null;


  // --------------------------------------------
  // VOICEMAIL
  // --------------------------------------------
  if (endedReason === "voicemail") {
    outcome = "STVM";
  }


  // --------------------------------------------
  // NO ANSWER
  // --------------------------------------------
  else if (endedReason === "silence-timed-out") {
    outcome = "No Answer";
  }


  // --------------------------------------------
  // CUSTOMER HUNG UP
  // --------------------------------------------
  else if (endedReason === "customer-hangup") {
    outcome = "Call Ended Early";
  }


  // --------------------------------------------
  // CONVERSATION DETECTED
  // --------------------------------------------
  else if (messages.length > 1) {

    // If conversation exists, let AI structured output decide
    console.log("Conversation detected → AI decides outcome");

  }


  console.log("System classified outcome:", outcome);


  // ============================================
  // STORE OUTCOME IN MEMORY
  // Zapier will retrieve this later using callId
  // ============================================
  if (callId !== "unknown" && outcome) {

    callOutcomes[callId] = outcome;

  }


  // ============================================
  // ACKNOWLEDGE WEBHOOK
  // ============================================
  res.sendStatus(200);

});



// ============================================
// ZAPIER OUTCOME RETRIEVAL ENDPOINT
// Zapier calls this to get the final outcome
// ============================================
app.get("/outcome", (req, res) => {

  const callId = req.query.callId;

  console.log("Outcome request received for callId:", callId);


  // If callId is missing
  if (!callId) {

    return res.status(400).json({
      error: "Missing callId"
    });

  }


  const outcome = callOutcomes[callId];


  // If outcome not ready yet
  if (!outcome) {

    return res.json({
      finalOutcome: null
    });

  }


  // ============================================
  // DELETE AFTER RETRIEVAL
  // Prevents memory buildup and duplicate reads
  // ============================================
  delete callOutcomes[callId];


  // Return the outcome to Zapier
  res.json({
    finalOutcome: outcome
  });

});



// ============================================
// START THE SERVER
// Railway exposes this to the internet
// ============================================
app.listen(3000, () => {

  console.log("Webhook running on port 3000");

});
