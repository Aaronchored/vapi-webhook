// Import the Express framework so we can create a web server
import express from "express";

// Create the web server app
const app = express();

// Allow the server to read JSON data that Vapi sends
app.use(express.json());


// This is the webhook endpoint Vapi will send call events to
// Whenever a call ends, Vapi sends a POST request here
app.post("/vapi-webhook", async (req, res) => {

  // The entire webhook payload sent by Vapi
  const payload = req.body;

  // Print a divider so logs are easier to read
  console.log("------ WEBHOOK RECEIVED ------");


  // Convert the entire payload to a string
  // This lets us search for keywords like "voicemail"
  const payloadString = JSON.stringify(payload);


  // Variable that will store how the call ended
  let endedReason = null;


  // If the payload contains "silence-timed-out"
  // that means nobody spoke and the call ended automatically
  if (payloadString.includes("silence-timed-out")) {
    endedReason = "silence-timed-out";
  }

  // If the payload contains "voicemail"
  // that means the call went straight to voicemail
  if (payloadString.includes("voicemail")) {
    endedReason = "voicemail";
  }

  // If the payload contains "customer-hangup"
  // that means the person hung up quickly
  if (payloadString.includes("customer-hangup")) {
    endedReason = "customer-hangup";
  }


  // Extract the call ID if it exists
  // This helps track individual calls later
  const callId = payload.message?.call?.id || "unknown";

  // Extract the assistant ID that made the call
  const assistantId = payload.message?.assistant?.id || "unknown";

  // Extract the phone number used to place the call
  // Useful when rotating multiple numbers
  const phoneNumber = payload.message?.call?.phoneNumber || "unknown";


  // Extract the messages from the conversation
  // If nobody answered, this will usually be very short
  const messages = payload.message?.artifact?.messages || [];


  // Print important debugging information
  console.log("callId:", callId);
  console.log("assistantId:", assistantId);
  console.log("phoneNumber:", phoneNumber);

  // Print how the call ended
  console.log("Detected endedReason:", endedReason);

  // Print how many messages happened in the call
  console.log("messages.length:", messages.length);


  // Variable to store the final classified outcome
  let outcome = null;


  // If there were more than 1 message
  // it means a real conversation happened
  if (messages.length > 1) {

    // In that case we let the AI structured output decide
    console.log("Conversation detected → AI decides outcome");

  } else {

    // Otherwise the webhook classifies the call outcome


    // If the call went to voicemail
    if (endedReason === "voicemail") {
      outcome = "STVM";
    }

    // If nobody spoke and the call timed out
    else if (endedReason === "silence-timed-out") {
      outcome = "No Answer";
    }

    // If the person hung up early
    else if (endedReason === "customer-hangup") {
      outcome = "Call Ended Early";
    }

    // Print the final classification result
    console.log("System classified outcome:", outcome);
  }


  // Tell Vapi we successfully received the webhook
  res.sendStatus(200);

});


// Start the server on port 3000
// Railway will expose this to the internet

// ===============================
// Endpoint for Zapier to fetch the final classified outcome
// ===============================

app.get('/outcome', (req, res) => {

  // Get the callId from the query parameter
  const callId = req.query.callId;

  console.log("Outcome request received for callId:", callId);

  // If we don't have a callId, return an error
  if (!callId) {
    return res.status(400).json({
      error: "Missing callId"
    });
  }

  // Look up the stored outcome
  const outcome = callOutcomes[callId];

  // If no outcome exists yet
  if (!outcome) {
    return res.json({
      finalOutcome: null
    });
  }

  // Return the outcome to Zapier
  res.json({
    finalOutcome: outcome
  });

});

app.listen(3000, () => {
  console.log("Webhook running on port 3000");
});
