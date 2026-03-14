import express from "express";

const app = express();
app.use(express.json());

const callOutcomes = {};

app.post("/vapi-webhook", async (req, res) => {

  const payload = req.body;

  console.log("------ WEBHOOK RECEIVED ------");
  console.log(JSON.stringify(payload, null, 2));

  // Extract call data
  const callId = payload.call_id || payload.message?.call?.id || "unknown";
  const assistantId = payload.assistant_id || payload.message?.assistant?.id || "unknown";
  const phoneNumber = payload.phone_number || payload.message?.call?.phoneNumber || "unknown";

  const messages = payload.message?.artifact?.messages || [];

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

  console.log("callId:", callId);
  console.log("assistantId:", assistantId);
  console.log("phoneNumber:", phoneNumber);
  console.log("Detected endedReason:", endedReason);
  console.log("messages.length:", messages.length);

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

  console.log("System classified outcome:", outcome);

  if (callId !== "unknown" && outcome) {
    callOutcomes[callId] = outcome;
  }

  res.sendStatus(200);

});


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

  delete callOutcomes[callId];

  res.json({
    finalOutcome: outcome
  });

});


app.listen(3000, () => {
  console.log("Webhook running on port 3000");
});
