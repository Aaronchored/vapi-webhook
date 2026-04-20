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

    const assistantName =
      payload?.message?.assistant?.name ||
      "unknown";

    const phoneNumber =
      payload?.message?.call?.customer?.number ||
      "unknown";

    const messages =
      payload?.message?.artifact?.messages || [];

    let duration =
      payload?.message?.call?.duration || null;

    // PARSE METADATA
    let personId = null;
    let dealId = null;
    let ledgerRowId = null;
    let attemptCount = null;

    try {
      const parts =
        (payload?.message?.call?.name || "")
          .split("|")
          .map(p => p.trim());

      personId = parts[0] || null;
      dealId = parts[1] || null;
      ledgerRowId = parts[2] ? Number(parts[2]) : null;
      attemptCount = parts[3] ? Number(parts[3]) : null;
    } catch {}

    // PHONE
    const digits = phoneNumber.replace(/\D/g, "");
    const phoneLocal = digits.startsWith("614")
      ? "0" + digits.slice(2)
      : digits;

    // MESSAGE ANALYSIS
    const customerSpoke = messages.some(m =>
      ["customer","user"].includes((m.role || "").toLowerCase())
    );

    const assistantTurns = messages.filter(m =>
      ["assistant","bot"].includes((m.role || "").toLowerCase())
    ).length;

    const customerTurns = messages.filter(m =>
      ["customer","user"].includes((m.role || "").toLowerCase())
    ).length;

    // AI OUTPUTS
    const outputs = payload?.message?.artifact?.structuredOutputs || {};

    let callOutcome = null;
    let callSummary = null;
    let engagementTier = null;
    let dataQuality = null;

    for (const key in outputs) {
      const item = outputs[key];
      if (!item) continue;

      if (item.name === "AI_Call_Outcome") callOutcome = item.result;
      if (item.name === "AI_Call_Summary") callSummary = item.result;
      if (item.name === "Engagement_Tier") engagementTier = item.result;
      if (item.name === "Data_Quality") dataQuality = item.result;
    }

    const aiOutcomeExists = callOutcome !== null;
    let finalOutcome = aiOutcomeExists ? callOutcome : null;

    // TELEPHONY FALLBACK
    let systemOutcome = null;

    if (!callOutcome) {
      if (customerSpoke) systemOutcome = "Conversation";
      else systemOutcome = "No Answer";
    }

    if (!finalOutcome) finalOutcome = systemOutcome;

    const recordingUrl =
      payload?.message?.call?.recordingUrl || null;

    const lastAttemptUtc = new Date().toISOString();

    const call = {
      id: callId,
      assistantName,
      personId,
      dealId,
      ledgerRowId,
      attemptCount,
      phoneLocal,
      duration,
      customerSpoke,
      assistantTurns,
      customerTurns,
      ai: {
        summary: callSummary,
        engagement: engagementTier,
        dataQuality
      }
    };

    // ============================================
    // 🔥 NEW ROUTER (REPLACES ZAP)
    // ============================================

    await routeCallResult({
      call,
      finalOutcome,
      recordingUrl,
      lastAttemptUtc
    });

    console.log(`[${traceId}] processed via backend`);

    res.sendStatus(200);

  } catch (err) {
    console.error(err);
    res.sendStatus(500);
  }
});


// ============================================
// ROUTER
// ============================================

async function routeCallResult({ call, finalOutcome, recordingUrl, lastAttemptUtc }) {

  const attemptMeta = buildAttemptMetadata(
    call.attemptCount,
    lastAttemptUtc
  );

  await upsertLedgerRow({ call, finalOutcome, attemptMeta, recordingUrl });
  await updatePipedrive({ call, finalOutcome, attemptMeta, recordingUrl });

  if (finalOutcome === "Interested") {
    await sendSMS({ call, finalOutcome, attemptMeta, recordingUrl });
  }
}


// ============================================
// GOOGLE SHEETS LOGIC (LOG ONLY)
// ============================================

async function upsertLedgerRow(ctx) {
  if (ctx.call.ledgerRowId) {
    return updateLedgerRow(ctx);
  }
  return createLedgerRow(ctx);
}

async function updateLedgerRow({ call, finalOutcome, attemptMeta, recordingUrl }) {

  console.log("UPDATE ROW", {
    row: call.ledgerRowId,
    outcome: finalOutcome,
    attempt: attemptMeta.attempt_count_new
  });

}

async function createLedgerRow({ call, finalOutcome, attemptMeta, recordingUrl }) {

  console.log("CREATE ROW", {
    phone: call.phoneLocal,
    outcome: finalOutcome
  });

}


// ============================================
// PIPEDRIVE (LOG ONLY)
// ============================================

async function updatePipedrive({ call, finalOutcome, attemptMeta }) {

  console.log("PIPEDRIVE UPDATE", {
    dealId: call.dealId,
    outcome: finalOutcome
  });

}


// ============================================
// SMS (LOG ONLY)
// ============================================

async function sendSMS({ call, finalOutcome, attemptMeta, recordingUrl }) {

  console.log("SMS TRIGGERED", {
    phone: call.phoneLocal,
    outcome: finalOutcome
  });

}


// ============================================
// SERVER
// ============================================

app.get("/", (req, res) => {
  res.send("Server running");
});

app.listen(process.env.PORT || 3000, () => {
  console.log("Server running");
});
