import express from "express";

const app = express();
app.use(express.json());

app.post("/vapi-webhook", async (req, res) => {

  const payload = req.body;

  console.log("------ WEBHOOK RECEIVED ------");

  // Correct nested structure
  const call = payload.message?.artifact?.call || {};
  const messages = payload.message?.artifact?.messages || [];

  const endedReason = call.endedReason;
  const status = call.status;

  console.log("endedReason:", endedReason);
  console.log("status:", status);
  console.log("messages.length:", messages.length);

  let outcome = null;

  // If a conversation happened
  if (messages.length > 1) {
    console.log("Conversation detected → AI decides outcome");
  } 
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
