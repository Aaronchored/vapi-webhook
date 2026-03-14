// ============================================
// IMPORT EXPRESS
// Express allows us to create a small web server
// that can receive webhook events from Vapi
// ============================================
import express from "express";


// ============================================
// CREATE THE SERVER APP
// ============================================
const app = express();


// ============================================
// ALLOW THE SERVER TO READ JSON DATA
// Vapi sends webhook payloads as JSON
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
// This endpoint receives events when calls end
// Vapi sends the "end-of-call-report" here
// ============================================
app.post("/vapi-webhook", async (req, res) => {

  // The entire webhook payload sent by Vapi
  const payload = req.body;

  // TEMPORARY: print the full payload so we can inspect Vapi's data structure
  console.log(JSON.stringify(payload, null, 2));

  // Divider to make Railway logs easier to read
  console.log("------ WEBHOOK RECEIVED ------");


  // Convert payload into a string so we can search keywords
  const payloadString = JSON.stringify(payload);


  // ============================================
  // DETECT HOW THE CALL ENDED
  // ============================================
  let endedReason = null;

  // Nobody spoke and the call timed out
  if (payloadString.includes("silence-timed-out")) {
    endedReason = "silence-timed-out";
  }

  // Call went straight to voicemail
  if (payloadString.includes("voicemail")) {
    endedReason = "voicemail";
  }

  // Customer hung up quickly
  if (payloadString.includes("customer-hangup")) {
    endedReason = "customer-hangup";
  }


  // ============================================
  // EXTRACT IMPORTANT DATA FROM PAYLOAD
  // ============================================

  // Unique call identifier
  const callId = payload.message?.call?.id || "unknown";

  // Assistant ID that placed the call
  const assistantId = payload.message?.assistant?.id || "unknown";

  // Phone number used
  const phoneNumber = payload.message?.call?.phoneNumber || "unknown";

  // Conversation messages
  const messages = payload.message?.artifact?.messages || [];


  // ============================================
  // PRINT DEBUG INFO TO RAILWAY LOGS
  // This helps monitor the system in real time
  // ============================================
  console.log("callId:", callId);
  console.log("assistantId:", assistantId);
  console.log("phoneNumber:", phoneNumber);
  console.log("Detected endedReason:", endedReason);
  console.log("messages.length:", messages.length);


  // ============================================
  // DETERMINE FINAL SYSTEM OUTCOME
  // IMPORTANT:
  // TELEPHONY SIGNALS MUST OVERRIDE AI MESSAGES
  // ============================================
  let outcome = null;


  // --------------------------------------------
  // VOICEMAIL OVERRIDES EVERYTHING
  // Even if messages exist (AI greeting etc)
  // --------------------------------------------
  if (endedReason === "voicemail") {
    outcome = "STVM";
  }


  // --------------------------------------------
  // NOBODY ANSWERED
  // --------------------------------------------
  else if (endedReason === "silence-timed-out") {
    outcome = "No Answer";
  }


  // --------------------------------------------
  // PERSON HUNG UP QUICKLY
  // --------------------------------------------
  else if (endedReason === "customer-hangup") {
    outcome = "Call Ended Early";
  }


  // --------------------------------------------
  // OTHERWISE CHECK IF A CONVERSATION HAPPENED
  // --------------------------------------------
  else if (messages.length > 1) {

    // If more than one message exists
    // it means a real conversation likely occurred
    // In this case we allow the AI structured output
    // to determine the outcome instead
    console.log("Conversation detected → AI decides outcome");

  }


  // Print classification result
  console.log("System classified outcome:", outcome);


  // ============================================
  // STORE OUTCOME IN TEMP MEMORY
  // Zapier will retrieve this using the callId
  // ============================================
  if (callId !== "unknown" && outcome) {
    callOutcomes[callId] = outcome;
  }


  // Tell Vapi the webhook was received successfully
  res.sendStatus(200);

});



// ============================================
// ENDPOINT FOR ZAPIER TO FETCH FINAL OUTCOME
// ============================================
app.get("/outcome", (req, res) => {

  // Zapier sends the callId as a query parameter
  const callId = req.query.callId;

  console.log("Outcome request received for callId:", callId);


  // If callId was not provided
  if (!callId) {
    return res.status(400).json({
      error: "Missing callId"
    });
  }


  // Look up stored outcome
  const outcome = callOutcomes[callId];


  // If outcome is not ready yet
  if (!outcome) {
    return res.json({
      finalOutcome: null
    });
  }


  // ============================================
  // RACE CONDITION PROTECTION
  // Delete the outcome after Zapier retrieves it
  // This prevents memory buildup and stale data
  // ============================================
  delete callOutcomes[callId];


  // Send the result back to Zapier
  res.json({
    finalOutcome: outcome
  });

});



// ============================================
// START THE SERVER
// Railway exposes this port to the internet
// ============================================
app.listen(3000, () => {
  console.log("Webhook running on port 3000");
});
