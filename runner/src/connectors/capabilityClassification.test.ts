import {
  Capability,
  CAPABILITY_KIND,
  assertCapabilityClassification,
  isReadCapability,
  isWriteCapability,
} from "./connectorTypes.js";

let failed = 0;

function check(name: string, condition: boolean, detail = ""): void {
  if (condition) {
    console.log(`PASS ${name}`);
    return;
  }
  failed += 1;
  console.error(`FAIL ${name}${detail ? ` :: ${detail}` : ""}`);
}

console.log("[1] every Capability is explicitly classified");
{
  let error: string | null = null;
  try {
    assertCapabilityClassification();
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
  }
  check("assertCapabilityClassification passes", error === null, error ?? "");
}

console.log("[2] enum and classification counts match");
check(
  `Capability ${Capability.options.length} == CAPABILITY_KIND ${Object.keys(CAPABILITY_KIND).length}`,
  Capability.options.length === Object.keys(CAPABILITY_KIND).length,
);

console.log("[3] every classification is read or write");
for (const capability of Capability.options) {
  const kind = CAPABILITY_KIND[capability];
  check(`${capability} classified as ${kind}`, kind === "read" || kind === "write");
}

console.log("[4] expected write capabilities stay write");
for (const capability of ["order.create", "order.confirm", "quote.create", "staff.confirm", "inquiry.reply"] as const) {
  check(`${capability} is write`, isWriteCapability(capability) === true && isReadCapability(capability) === false);
}

console.log("[5] expected read capabilities stay read");
for (const capability of ["shipment.track", "inventory.read", "payment.check", "inquiry.read"] as const) {
  check(`${capability} is read`, isReadCapability(capability) === true && isWriteCapability(capability) === false);
}

if (failed > 0) {
  console.error(`CLASSIFICATION_TEST_FAIL ${failed}`);
  process.exitCode = 1;
} else {
  console.log("CLASSIFICATION_TEST_OK");
}
