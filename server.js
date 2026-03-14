import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

app.post("/vapi-webhook", async (req, res) => {
  const call = req.body;

  const messages = call.messages || [];
  const endedReason = call.endedReason;
  const status = call.status;

  let outcome = null;

  // If a real conversation happened, let AI decide outcome
  if (messages.length > 1) {
    console.log("Conversation detected → AI decides outcome");
  } else {
    // System outcomes decided by webhook
    if (endedReason === "voicemail") {
      outcome = "STVM";
    } else if (endedReason === "silence-timed-out") {
      outcome = "No Answer";
    } else if (endedReason === "customer-hangup") {
      outcome = "Call Ended Early";
    } else if (status === "failed") {
      outcome = "Call Failed";
    }

    console.log("endedReason:", endedReason);
    console.log("status:", status);
    console.log("messages.length:", messages.length);
    console.log("System classified outcome:", outcome);
  }

  res.sendStatus(200);
});

app.listen(3000, () => {
  console.log("Webhook running on port 3000");
});
