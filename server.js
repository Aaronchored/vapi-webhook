import express from "express";

const app = express();
app.use(express.json());

app.post("/vapi-webhook", async (req, res) => {

  const payload = req.body;

  console.log("------ WEBHOOK RECEIVED ------");

  // Show the top level structure
  console.log("Top level keys:", Object.keys(payload));

  // Print entire payload (shortened view)
  console.log("Payload preview:");
  console.log(JSON.stringify(payload, null, 2));

  res.sendStatus(200);

});

app.listen(3000, () => {
  console.log("Webhook running on port 3000");
});
