import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json({ limit: "1mb" }));

// ============================================
// HELPER — SYDNEY TIME + ATTEMPTS
// ============================================

function buildAttemptMetadata(attemptCount, utcIso) {
  const current = parseInt(attemptCount || "0", 10);
  const attempt_count_new = current + 1;

  const d = new Date(utcIso || new Date().toISOString());

  const sydParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Sydney",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).formatToParts(d);

  const get = (t) => sydParts.find(p => p.type === t)?.value;

  return {
    attempt_count_new,
    last_attempt_at_syd:
      `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}:${get("second")}`,
    last_called_date_pipedrive:
      `${get("year")}-${get("month")}-${get("day")}`
  };
}

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
    console.log("WEBHOOK HIT");

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
      } else if (digits.startsWith("04")) {
        phoneLocal = digits;
        phoneE164 = "+61" + digits.slice(1);
      } else {
        phoneLocal = digits;
      }
    }

 // ============================================
// CUSTOMER / ASSISTANT DETECTION (FIXED)
// ============================================

const HUMAN_ROLES = ["customer", "caller", "human"];
const ASSISTANT_ROLES = ["assistant", "bot"];

function getText(m) {
  return (m.message || m.content || m.text || "").toString().trim();
}

function isMeaningful(text) {
  if (!text) return false;
  const t = text.toLowerCase().trim();
  return !["silence", "[silence]", "noise", "[noise]", "..."].includes(t);
}

const assistantTurns = messages.filter(m => {
  const role = (m.role || "").toLowerCase();
  return ASSISTANT_ROLES.includes(role) && getText(m);
}).length;

const customerTurns = messages.filter(m => {
  const role = (m.role || "").toLowerCase();
  return HUMAN_ROLES.includes(role) && isMeaningful(getText(m));
}).length;

const customerSpoke = customerTurns > 0;

    // ============================================
    // AI OUTPUTS
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
      finalStatus = "dnc";
    }

    const aiOutcomeExists = callOutcome !== null;
    let finalOutcome = aiOutcomeExists ? callOutcome : null;

    // ============================================
    // DURATION FALLBACK
    // ============================================

    if (!duration && aiCallDuration) {
      duration = aiCallDuration;
    }

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
// TELEPHONY CLASSIFICATION (FIXED)
// ============================================

let systemOutcome = null;

if (!call.ai.outcome) {
  const ended = call.telephony.endedReason;

  if (ended === "voicemail") {
    systemOutcome = "STVM";
  } 
  else if (ended === "silence-timed-out") {
    systemOutcome = "No Answer";
  } 
  else if (ended === "customer-hangup") {
    systemOutcome = customerTurns > 0
      ? "Call Ended Early"
      : "No Answer";
  } 
  else {
    systemOutcome = "No Answer";
  }
}
    // ============================================
    // LAST ATTEMPT UTC
    // ============================================

    const now = new Date();
    const safeDuration = Number(call.duration) || 0;
    const launchTime = new Date(now.getTime() - safeDuration * 1000);
    const lastAttemptUtc = launchTime.toISOString();

    // ============================================
    // ROUTER
    // ============================================

    await routeCallResult({
      call,
      finalOutcome,
      systemOutcome,
      aiOutcomeExists,
      recordingUrl,
      lastAttemptUtc
    });

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
      "\n\n[" + traceId + "] phoneLocal: " + call.phoneLocal +
      "\n[" + traceId + "] phoneE164: " + call.phoneE164 +
      "\n\n[" + traceId + "] customerSpoke: " + call.customerSpoke +
      "\n[" + traceId + "] customerTurns: " + call.customerTurns +
      "\n[" + traceId + "] assistantTurns: " + call.assistantTurns +
      "\n\n[" + traceId + "] aiOutcome: " + call.ai.outcome +
      "\n[" + traceId + "] aiCallDuration: " + aiCallDuration +
      "\n[" + traceId + "] systemOutcome: " + systemOutcome +
      "\n[" + traceId + "] finalOutcome: " + finalOutcome +
      "\n\n[" + traceId + "] recordingUrl: " + recordingUrl +
      "\n[" + traceId + "] lastAttemptUtc: " + lastAttemptUtc +
      "\n\n[" + traceId + "] processed via backend" +
      "\n\n[" + traceId + "] =================================";

    console.log(report);

    res.sendStatus(200);
  } catch (error) {
    console.error("Webhook processing error:", error);
    res.sendStatus(500);
  }
});

// ============================================
// ROUTER
// ============================================

async function routeCallResult({
  call,
  finalOutcome,
  systemOutcome,
  aiOutcomeExists,
  recordingUrl,
  lastAttemptUtc
}) {
  const attemptMeta = buildAttemptMetadata(
    call.attemptCount,
    lastAttemptUtc
  );

  await upsertLedgerRow({
    call,
    finalOutcome,
    systemOutcome,
    aiOutcomeExists,
    attemptMeta,
    recordingUrl,
    lastAttemptUtc
  });

  await updatePipedrive({
    call,
    finalOutcome,
    systemOutcome,
    aiOutcomeExists,
    attemptMeta,
    recordingUrl,
    lastAttemptUtc
  });

  if (finalOutcome === "Interested") {
    await sendSMS({
      call,
      finalOutcome,
      attemptMeta,
      recordingUrl
    });
  }

  // ============================================
  // SEND TO ZAP 2 PART 2
  // ============================================

  const zapHook = process.env.ZAP_2_PART_2_WEBHOOK;

  if (zapHook) {
    await fetch(zapHook, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        personId: call.personId,
        dealId: call.dealId,
        ledgerRowId: call.ledgerRowId,
        attemptCount: call.attemptCount,

        phoneLocal: call.phoneLocal,
        phoneE164: call.phoneE164,

        callId: call.id,
        assistantName: call.assistantName,

        duration: call.duration,
        systemOutcome: systemOutcome,
        aiOutcomeDetected: aiOutcomeExists,

        callOutcome: call.ai.outcome,
        finalOutcome: finalOutcome,

        engagementTier: call.ai.engagement,
        dataQuality: call.ai.dataQuality,
        finalStatus: call.ai.finalStatus,
        callSummary: call.ai.summary,

        recordingUrl,
        lastAttemptUtc
      })
    });
  }
}

// ============================================
// GOOGLE SHEETS LOGIC (LOG ONLY FOR NOW)
// ============================================

async function upsertLedgerRow(ctx) {
  if (ctx.call.ledgerRowId) {
    return updateLedgerRow(ctx);
  }
  return createLedgerRow(ctx);
}

async function updateLedgerRow({
  call,
  finalOutcome,
  attemptMeta,
  recordingUrl,
  lastAttemptUtc
}) {
  console.log("UPDATE ROW", {
    row: call.ledgerRowId,
    phone: call.phoneLocal,
    outcome: finalOutcome,
    attempt: attemptMeta.attempt_count_new,
    last_attempt_at_utc: lastAttemptUtc,
    last_attempt_at_syd: attemptMeta.last_attempt_at_syd,
    call_connected: call.customerSpoke ? "yes" : "no",
    duration: call.duration,
    engagement_tier: call.ai.engagement,
    data_quality: call.ai.dataQuality,
    final_status: call.ai.finalStatus,
    call_summary: call.ai.summary,
    vapi_call_id: call.id,
    recording_url: recordingUrl,
    assistant_name: call.assistantName
  });
}

async function createLedgerRow({
  call,
  finalOutcome,
  attemptMeta,
  recordingUrl,
  lastAttemptUtc
}) {
  console.log("CREATE ROW", {
    phone: call.phoneLocal,
    outcome: finalOutcome,
    attempt: 1,
    last_attempt_at_utc: lastAttemptUtc,
    last_attempt_at_syd: attemptMeta.last_attempt_at_syd,
    call_connected: call.customerSpoke ? "yes" : "no",
    duration: call.duration,
    engagement_tier: call.ai.engagement,
    data_quality: call.ai.dataQuality,
    final_status: call.ai.finalStatus,
    call_summary: call.ai.summary,
    vapi_call_id: call.id,
    recording_url: recordingUrl,
    assistant_name: call.assistantName
  });
}

// ============================================
// PIPEDRIVE (LOG ONLY FOR NOW)
// ============================================

async function updatePipedrive({
  call,
  finalOutcome,
  attemptMeta,
  recordingUrl
}) {
  console.log("PIPEDRIVE UPDATE", {
    dealId: call.dealId,
    personId: call.personId,
    phone: call.phoneLocal,
    outcome: finalOutcome,
    duration: call.duration,
    summary: call.ai.summary,
    recordingUrl,
    last_called_date: attemptMeta.last_called_date_pipedrive
  });
}

// ============================================
// SMS (LOG ONLY FOR NOW)
// ============================================

async function sendSMS({
  call,
  finalOutcome,
  attemptMeta,
  recordingUrl
}) {
  console.log("SMS TRIGGERED", {
    phone: call.phoneLocal,
    outcome: finalOutcome,
    last_called: attemptMeta.last_attempt_at_syd,
    duration: call.duration,
    summary: call.ai.summary,
    recordingUrl
  });
}

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
