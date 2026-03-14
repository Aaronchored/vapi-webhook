import express from "express";

const app = express();
app.use(express.json());

app.post("/vapi-webhook", async (req, res) => {

  const call = req.body;

  const callId = call.call?.id;
  const messages = call.messages || [];

  const userMessages = messages.filter(
    m => m.role === "user"
  );

  if (userMessages.length === 0) {

    console.log("No user speech detected → classify as No Answer");

    await fetch("https://api.vapi.ai/structured-output/run", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.VAPI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        callId: callId,
        name: "AI_Call_Outcome",
        result: "No Answer"
      })
    });

  }

  res.sendStatus(200);

});

app.listen(3000, () => {
  console.log("Webhook running on port 3000");
});
