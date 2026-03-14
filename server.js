import express from "express";

const app = express();
app.use(express.json());

app.post("/vapi-webhook", async (req, res) => {

  const payload = req.body;

  // Print full payload so we can inspect Vapi structure
  console.log("FULL PAYLOAD:");
  console.log(JSON.stringify(payload, null, 2));

  // Extract call object safely
  const call = payload.call || {};

  const endedReason = call.endedReason;
  const status = call.status;
  const messages = payload.messages || [];

  console.log("endedReason:", endedReason);
  console.log("status:", status);
  console.log("messages.length:", messages.length);

  let outcome = null;

  // If conversation happened, let AI structured output decide
  if (messages.length > 1) {
    console.log("Conversation detected → AI decides outcome");
  }

  // Otherwise classify system outcome
  else {

    if (endedReason === "voicemail") {
      outcome = "STVM";
    }

    else if (endedReason === "silence-timed-out") {
      outcome = "No Answer";
    }

    else if (endedReason === "customer-hangup") {
      outcome = "Call Ended Early";
    }

    else if (status === "failed") {
      outcome = "Call Failed";
    }

    console.log("System classified outcome:", outcome);

  }

  res.sendStatus(200);

});

app.listen(3000, () => {
  console.log("Webhook running on port 3000");
});
