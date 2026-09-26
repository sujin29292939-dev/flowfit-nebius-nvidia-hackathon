import { classifyConnectorFailureStatus } from "./runtime.js";
import { Capability } from "./connectorTypes.js";

let failed = 0;

function check(name: string, condition: boolean, detail = ""): void {
  if (condition) {
    console.log(`PASS ${name}`);
    return;
  }
  failed += 1;
  console.error(`FAIL ${name}${detail ? ` :: ${detail}` : ""}`);
}

function status(status: number, capability: string, idempotencySupported: boolean) {
  return classifyConnectorFailureStatus(
    { status, idempotency: { supported: idempotencySupported } },
    Capability.parse(capability),
  );
}

check(
  "read capability can retry 5xx even without connector idempotency",
  status(503, "inventory.read", false) === "retry_pending",
);
check(
  "write capability can retry 5xx when connector idempotency is supported",
  status(503, "quote.create", true) === "retry_pending",
);
check(
  "write capability does not retry 5xx when connector idempotency is unsupported",
  status(503, "quote.create", false) === "failed",
);
check("400 is permanent failed", status(400, "quote.create", true) === "failed");
check("422 is permanent failed", status(422, "quote.create", true) === "failed");
check("401 requires connector reauth", status(401, "inventory.read", false) === "connector_reauth_required");
check("403 requires connector reauth", status(403, "quote.create", true) === "connector_reauth_required");
check("network error for unsupported write is permanent failed", status(0, "order.create", false) === "failed");
check("network error for supported write is retry_pending", status(0, "order.create", true) === "retry_pending");

if (failed > 0) {
  console.error(`FAILURE_CLASSIFICATION_TEST_FAIL ${failed}`);
  process.exitCode = 1;
} else {
  console.log("FAILURE_CLASSIFICATION_TEST_OK");
}
