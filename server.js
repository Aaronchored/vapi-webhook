import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json({ limit: "1mb" }));

// ============================================
// DUPLICATE WEBHOOK PROTECTION
// ============================================

const processedCalls = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [key, value] of processedCalls.entries()) {
    if (now - value > 60 * 60 * 1000) {
      processedCalls.delete(key);
    }
  }
}, 60 * 60 * 1000);


// ============================================
// VAPI WEBHOOK
// ============================================

app.post("/vapi-webhook", async (req, res) => {

  try {

    const payload = req.body || {};
    const eventType = payload?.message?.type || "unknown";

    if (eventType !== "end-of-call-report") {
      return res.sendStatus(200);
    }

    const callId =
      payload?.call_id ||
      payload?.message?.call?.id ||
      "unknown";

    const traceId =
      callId !== "unknown"
        ? callId.slice(-4)
        : "????";

    if (processedCalls.has(callId)) {
      console.log("[" + traceId + "] Duplicate webhook ignored");
      return res.sendStatus(200);
    }

    processedCalls.set(callId, Date.now());


    // ============================================
    // BASIC CALL DATA
    // ============================================

    const assistantId =
      payload?.assistant_id ||
      payload?.message?.assistant?.id ||
      "unknown";

    const assistantName =
      payload?.message?.assistant?.name ||
      payload?.assistant_name ||
      "unknown";

    const phoneNumber =
      payload?.phone_number ||
      payload?.message?.call?.phoneNumber ||
      payload?.message?.customer?.number ||
      payload?.message?.call?.customer?.number ||
      "unknown";

    const messages =
      payload?.message?.artifact?.messages || [];

    let duration =
      payload?.message?.call?.duration || null;

      // fallback to AI duration if telephony duration missing
      if (!duration && aiCallDuration) {
      duration = aiCallDuration;


    // ============================================
    // PARSE CALL NAME (personId|dealId|ledgerRowId|attemptCount)
    // ============================================

    let personId = null;
    let dealId = null;
    let ledgerRowId = null;
    let attemptCount = null;

    try {

      const callName =
        payload?.message?.call?.name || "";

      const parts = callName.split("|").map(p => p.trim());

      personId = parts[0] || null;
      dealId = parts[1] || null;
      ledgerRowId = parts[2] ? Number(parts[2]) : null;

      if (parts[3]) {
        const parsed = Number(parts[3]);
        attemptCount = Number.isNaN(parsed) ? null : parsed;
      }

    } catch {}


    // ============================================
    // PHONE FORMATTING
    // ============================================

    let phoneLocal = null;
    let phoneE164 = null;

    if (typeof phoneNumber === "string") {

      const digits = phoneNumber.replace(/\D/g, "");

      if (digits.startsWith("614")) {
        phoneLocal = "0" + digits.slice(2);
        phoneE164 = "+" + digits;
      }

      else if (digits.startsWith("04")) {
        phoneLocal = digits;
        phoneE164 = "+61" + digits.slice(1);
      }

    }


// ============================================
// CUSTOMER / ASSISTANT DETECTION (VAPI FORMAT)
// ============================================

// detect if the caller actually spoke
const customerSpoke = messages.some(m => {

  const role = (m.role || "").toLowerCase();

  const roles = ["customer", "user", "caller", "human"];

  const text =
    (m.message || m.content || m.text || "").toString().trim();

  return roles.includes(role) && text.length > 0;

});

// count assistant speech turns
const assistantTurns = messages.filter(m => {

  const role = (m.role || "").toLowerCase();

  const text =
    (m.message || m.content || m.text || "").toString().trim();

  return ["assistant","bot"].includes(role) && text.length > 0;

}).length;

// count customer speech turns
const customerTurns = messages.filter(m => {

  const role = (m.role || "").toLowerCase();

  const text =
    (m.message || m.content || m.text || "").toString().trim();

  return ["customer","user","caller","human"].includes(role) && text.length > 0;

}).length;

    // ============================================
    // AI OUTPUTS (VAPI FORMAT)
    // ============================================

    const structuredOutputs =
      payload?.message?.artifact?.structuredOutputs || {};

    let callOutcome = null;
    let aiCallDuration = null;
    let engagementTier = null;
    let dataQuality = null;
    let finalStatus = null;
    let objectionType = null;
    let callSummary = null;

    for (const key in structuredOutputs) {

      const item = structuredOutputs[key];

      if (!item || !item.name) continue;

      switch (item.name) {

        case "AI_Call_Outcome":
          callOutcome = item.result;
          break;

        case "Engagement_Tier":
          engagementTier = item.result;
          break;

        case "Data_Quality":
          dataQuality = item.result;
          break;

        case "AI_Objection_Type":
          objectionType = item.result;
          break;

        case "AI_Call_Summary":
          callSummary = item.result;
          break;

      case "AI_Call_Duration":
        aiCallDuration = item.result;
        break;

      }

    }

    if (callOutcome === "Do Not Call") {
      finalStatus = "suppressed";
    }

    const aiOutcomeExists = callOutcome !== null;


    const recordingUrl =
      payload?.message?.call?.recordingUrl ||
      payload?.message?.artifact?.recordingUrl ||
      null;


    // ============================================
    // NORMALIZED CALL OBJECT
    // ============================================

    const call = {

      id: callId,

      assistantId,
      assistantName,

      personId,
      dealId,
      ledgerRowId,
      attemptCount,

      phoneLocal,
      phoneE164,

      duration,
      messages,

      customerSpoke,
      assistantTurns,
      customerTurns,

      ai: {
        outcome: callOutcome,
        engagement: engagementTier,
        dataQuality,
        objection: objectionType,
        summary: callSummary,
        finalStatus
      },

      telephony: {
        endedReason:
          payload?.message?.call?.endedReason ||
          payload?.endedReason ||
          null
      }

    };


    // ============================================
    // TELEPHONY CLASSIFICATION
    // ============================================

    let systemOutcome = null;

    if (!call.ai.outcome) {

      if (call.customerSpoke) {
        systemOutcome = "Conversation";
      }

      else if (call.telephony.endedReason === "voicemail") {
        systemOutcome = "STVM";
      }

      else if (call.telephony.endedReason === "silence-timed-out") {
        systemOutcome = "No Answer";
      }

      else if (call.telephony.endedReason === "customer-hangup") {
        systemOutcome = "Call Ended Early";
      }

      else if (call.messages.length > 4) {
        systemOutcome = "Conversation";
      }

      else {
        systemOutcome = "No Answer";
      }

    }


    // ============================================
    // LAST ATTEMPT UTC
    // ============================================

    const now = new Date();
    const launchTime = new Date(now.getTime() - call.duration * 1000);
    const lastAttemptUtc = launchTime.toISOString();


    // ============================================
    // TRIGGER ZAP
    // ============================================

    let zapStatus = "not_sent";

    const zapWebhook = process.env.ZAP_3_WEBHOOK;

    if (zapWebhook) {

      try {

        const zapResponse = await fetch(zapWebhook, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({

            personId: call.personId,
            dealId: call.dealId,
            ledgerRowId: call.ledgerRowId,
            attemptCount: call.attemptCount,

            phoneLocal: call.phoneLocal,
            phoneE164: call.phoneE164,

            callId: call.id,
            assistantId: call.assistantId,
            assistantName: call.assistantName,

            duration: call.duration,
            systemOutcome: systemOutcome,
            aiOutcomeDetected: aiOutcomeExists,

            callOutcome: call.ai.outcome,
            engagementTier: call.ai.engagement,
            dataQuality: call.ai.dataQuality,
            finalStatus: call.ai.finalStatus,
            objectionType: call.ai.objection,
            callSummary: call.ai.summary,

            recordingUrl,
            lastAttemptUtc

          })
        });

        zapStatus = zapResponse.status;

      }

      catch {

        zapStatus = "failed";

      }

    }


    // ============================================
    // CLEAN REPORT BLOCK
    // ============================================

    const report =
      "\n[" + traceId + "] =================================" +
      "\n[" + traceId + "] FINAL CALL REPORT\n" +
      "\n[" + traceId + "] callId: " + call.id +
      "\n[" + traceId + "] assistant: " + call.assistantName +
      "\n\n[" + traceId + "] personId: " + call.personId +
      "\n[" + traceId + "] dealId: " + call.dealId +
      "\n[" + traceId + "] ledgerRowId: " + call.ledgerRowId +
      "\n[" + traceId + "] attemptCount: " + call.attemptCount +
      "\n\n[" + traceId + "] customerSpoke: " + call.customerSpoke +
      "\n[" + traceId + "] customerTurns: " + call.customerTurns +
      "\n[" + traceId + "] assistantTurns: " + call.assistantTurns +
      "\n\n[" + traceId + "] aiOutcome: " + call.ai.outcome +
      "\n[" + traceId + "] aiCallDuration: " + aiCallDuration +
      "\n[" + traceId + "] systemOutcome: " + systemOutcome +
      "\n\n[" + traceId + "] recordingUrl: " + recordingUrl +
      "\n[" + traceId + "] lastAttemptUtc: " + lastAttemptUtc +
      "\n\n[" + traceId + "] Zap response: " + zapStatus +
      "\n\n[" + traceId + "] =================================";

    console.log(report);

    res.sendStatus(200);

  }

  catch (error) {

    console.error("Webhook processing error:", error);
    res.sendStatus(500);

  }

});


// ============================================
// HEALTH CHECK
// ============================================

app.get("/", (req, res) => {
  res.send("Server running");
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Webhook server running on port " + PORT);
});
