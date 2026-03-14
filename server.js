// Import the Express framework so we can create a web server
import express from "express";

// Create the web server app
const app = express();

// Allow the server to read JSON data that Vapi sends
app.use(express.json());


// ============================================
// Temporary memory storage for call outcomes
// Each callId will store its classified result
// Example:
// callOutcomes["019cea..."] = "STVM"
// ============================================
const callOutcomes = {};



// ============================================
// VAPI WEBHOOK ENDPOINT
// This endpoint receives events when calls end
// ============================================
app.post("/vapi-webhook", async (req, res) => {

  // The entire webhook payload sent by Vapi
  const payload = req.body;

  // Divider to make logs easier to read
  console.log("------ WEBHOOK RECEIVED ------");


  // Convert payload into a string so we can easily search keywords
  const payloadString = JSON.stringify(payload);


  // This variable will store how the call ended
  let endedReason = null;


  // If the call timed out due to silence
  if (payloadString.includes("silence-timed-out")) {
    endedReason = "silence-timed-out";
  }

  // If the call went to voicemail
  if (payloadString.includes("voicemail")) {
    endedReason = "voicemail";
  }

  // If the customer hung up quickly
  if (payloadString.includes("customer-hangup")) {
    endedReason = "customer-hangup";
  }


  // ============================================
  // Extract useful information from the payload
  // ============================================

  // Unique call ID
  const callId = payload.message?.call?.id || "unknown";

  // Assistant ID used to place the call
  const assistantId = payload.message?.assistant?.id || "unknown";

  // Phone number used
  const phoneNumber = payload.message?.call?.phoneNumber || "unknown";

  // Conversation messages
  const messages = payload.message?.artifact?.messages || [];


  // Print debug info so we can monitor calls in Railway logs
  console.log("callId:", callId);
  console.log("assistantId:", assistantId);
  console.log("phoneNumber:", phoneNumber);
  console.log("Detected endedReason:", endedReason);
  console.log("messages.length:", messages.length);


  // ============================================
  // Determine the system call outcome
  // ============================================

  let outcome = null;


  // If more than one message exists
  // it means a real conversation happened
  if (messages.length > 1) {

    // In this case we let the AI structured output decide
    console.log("Conversation detected → AI decides outcome");

  } else {

    // Otherwise the system classifies the call


    // Straight to voicemail
    if (endedReason === "voicemail") {
      outcome = "STVM";
    }

    // Nobody answered and call timed out
    else if (endedReason === "silence-timed-out") {
      outcome = "No Answer";
    }

    // Customer hung up quickly
    else if (endedReason === "customer-hangup") {
      outcome = "Call Ended Early";
    }

    // Print classification result
    console.log("System classified outcome:", outcome);
  }


  // ============================================
  // Store the classified outcome in memory
  // This allows Zapier to retrieve it later
  // ============================================

  if (callId !== "unknown" && outcome) {
    callOutcomes[callId] = outcome;
  }


  // Tell Vapi we successfully received the webhook
  res.sendStatus(200);

});



// ============================================
// ENDPOINT FOR ZAPIER TO FETCH FINAL OUTCOME
// ============================================

app.get("/outcome", (req, res) => {

  // Zapier sends the callId in the query
  const callId = req.query.callId;

  console.log("Outcome request received for callId:", callId);

  // If callId is missing
  if (!callId) {
    return res.status(400).json({
      error: "Missing callId"
    });
  }

  // Look up stored outcome
  const outcome = callOutcomes[callId];

  // If no outcome exists yet
  if (!outcome) {
    return res.json({
      finalOutcome: null
    });
  }

  // ============================================
  // Race-condition fix
  // Delete the outcome after Zapier reads it
  // This prevents memory buildup and incorrect reuse
  // ============================================
  delete callOutcomes[callId];

  // Return the final outcome
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
