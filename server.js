import express from "express";

const app = express();
app.use(express.json());

app.post("/vapi-webhook", async (req, res) => {

  const call = req.body;

  const messages = call.messages || [];

  const userMessages = messages.filter(
    m => m.role === "user"
  );

  if (userMessages.length === 0) {
    console.log("No user speech detected → classify as No Answer");
  }

  res.sendStatus(200);

});

app.listen(3000, () => {
  console.log("Webhook running on port 3000");
});
