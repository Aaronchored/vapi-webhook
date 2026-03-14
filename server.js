import express from "express";

const app = express();
app.use(express.json());

app.post("/vapi-webhook", async (req, res) => {

  const payload = req.body;

  console.log("------ WEBHOOK RECEIVED ------");
  console.log(JSON.stringify(payload, null, 2));

  // Correct Vapi structure
  const call = payload.message?.call || {};
  const messages = payload.message?.artifact?.messages || [];

  const endedReason = call.endedReason;
  const status = call.status;

  console.log("endedReason:", endedReason);
  console.log("status:", status);
  console.log("messages.length:", messages.length);

  let outcome = null;

  // Conversation happened
  if (messages.length > 1) {
    console.log("Conversation detected → AI decides outcome");
  }

  // System classification
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
