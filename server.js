const messages = call.messages || [];
const endedReason = call.endedReason;
const status = call.status;

let outcome = null;

// conversation happened
if (messages.length > 1) {
  console.log("Conversation detected → AI decides outcome");
}

// system outcome classification
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

  if (outcome) {
    console.log("System classified outcome:", outcome);
  }
}
