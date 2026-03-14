import express from "express";

const app = express();
app.use(express.json());

app.post("/vapi-webhook", async (req, res) => {

  const payload = req.body;

  console.log("------ WEBHOOK RECEIVED ------");

  // Convert payload to string so we can search it
  const payloadString = JSON.stringify(payload);

  let endedReason = null;

  if (payloadString.includes("silence-timed-out")) {
    endedReason = "silence-timed-out";
  }

  if (payloadString.includes("voicemail")) {
    endedReason = "voicemail";
  }

  if (payloadString.includes("customer-hangup")) {
    endedReason = "customer-hangup";
  }

  console.log("Detected endedReason:", endedReason);

  const messages = payload.message?.artifact?.messages || [];

  console.log("messages.length:", messages.length);

  let outcome = null;

  if (messages.length > 1) {
    console.log("Conversation detected → AI decides outcome");
  } else {

    if (endedReason === "voicemail") {
      outcome = "STVM";
    }

    else if (endedReason === "silence-timed-out") {
      outcome = "No Answer";
    }

    else if (endedReason === "customer-hangup") {
      outcome = "Call Ended Early";
    }

    console.log("System classified outcome:", outcome);
  }

  res.sendStatus(200);

});

app.listen(3000, () => {
  console.log("Webhook running on port 3000");
});
