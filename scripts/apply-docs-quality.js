const fs = require("fs");

const enrichPath = "shipmozo-enrichment.json";
const openapiPath = "shipmozo-openapi.json";
const contractsPath = "public/assets/field-contracts.json";

const e = JSON.parse(fs.readFileSync(enrichPath, "utf8"));
const openapi = JSON.parse(fs.readFileSync(openapiPath, "utf8"));
const contracts = JSON.parse(fs.readFileSync(contractsPath, "utf8"));

e["x-portal"].errorCodes = [
  {
    id: "profile-under-verification",
    result: "0",
    typicalMessage: "Your profile is under verification",
    when: "Seller KYC not completed or pending approval on Shipmozo panel",
    action:
      "Finish verification in Shipmozo panel — keys may be valid while APIs stay blocked until approval",
  },
  {
    id: "invalid-api-keys",
    result: "0",
    typicalMessage: "unauthorised user access / Invalid API credentials",
    when: "Wrong, missing, or expired public-key / private-key",
    action: "Re-login via POST /login or paste fresh keys from Panel → Profile",
  },
  {
    id: "login-failed",
    result: "0",
    typicalMessage:
      'Invalid username or password (exact text unverified). Unknown email/phone may return "Email or phone number is not registered."',
    when: "POST /login with bad credentials",
    action:
      "Verify panel username/password. Unknown accounts may return the unregistered email/phone message.",
  },
  {
    id: "order-not-found",
    result: "0",
    typicalMessage: "Order not found",
    when: "Unknown order_id on assign, schedule, cancel, or get-detail",
    action: "Push the order first; use Shipmozo internal order_id from push-order response",
  },
  {
    id: "invalid-warehouse",
    result: "0",
    typicalMessage: "The selected warehouse id is invalid.",
    when: "push-order with a warehouse_id that does not belong to the account",
    action: "Call get-warehouses or create-warehouse and use a returned warehouse_id",
  },
  {
    id: "auto-assign-not-setup",
    result: "0",
    typicalMessage: "please setup auto assign",
    when: "auto-assign-order without panel Settings → Auto Assign configured",
    action: "Enable Auto Assign rules in the Shipmozo panel, or use assign-courier instead",
  },
  {
    id: "rate-limit",
    result: "0",
    typicalMessage: "Rate limit exceeded (or HTTP 429)",
    when: "Too many calls in the shared 1-minute window",
    action: "Pause and retry after ~60s",
  },
  {
    id: "cors-trailing-slash",
    result: "—",
    typicalMessage: "Browser CORS error",
    when: "Base URL ends with a trailing slash after /v1",
    action: "Use the base URL without a trailing slash",
  },
];

const ops = e.operations;

function setExample(opId, example, opts = {}) {
  if (!ops[opId]) ops[opId] = {};
  const op = ops[opId];
  delete op["x-errors"];
  if (opts.description) op.description = opts.description;
  if (opts.summary) op.summary = opts.summary;
  if (opts.useCases) op["x-useCases"] = opts.useCases;
  if (opts.docNotes) op["x-docNotes"] = opts.docNotes;
  if (opts.responseFields) op["x-responseFields"] = opts.responseFields;
  if (opts.failureFields) op["x-failureFields"] = opts.failureFields;
  if (opts.queryExamples) op["x-queryExamples"] = opts.queryExamples;
  if (opts.errorExample) op["x-errorExample"] = opts.errorExample;
  if (opts.errorUnavailable) op["x-errorExampleUnavailable"] = true;
  if (opts.exampleUnavailable) {
    op["x-exampleUnavailable"] = true;
    op.responses = {
      200: {
        "x-exampleUnavailable": true,
        content: {
          "application/json": {
            schema: { type: "object" },
          },
        },
      },
    };
    return;
  }
  if (example) {
    delete op["x-exampleUnavailable"];
    op.responses = {
      200: {
        content: {
          "application/json": {
            example,
          },
        },
      },
    };
  }
}

for (const op of Object.values(ops)) {
  delete op["x-errors"];
  const raw = JSON.stringify(op);
  if (raw.includes("[PLACEHOLDER")) {
    op["x-exampleUnavailable"] = true;
    if (op.responses?.["200"]) {
      op.responses["200"]["x-exampleUnavailable"] = true;
      const cj = op.responses["200"].content?.["application/json"];
      if (cj?.schema?.example) delete cj.schema.example;
      if (cj?.example) delete cj.example;
    }
  }
}

setExample(
  "getWarehouses",
  {
    result: "1",
    message: "Success",
    data: [
      {
        id: "12345",
        default: "YES",
        address_title: "Main Warehouse",
        name: "Rahul",
        email: "ops@example.com",
        phone: "9876543210",
        alt_phone: "",
        address_line_one: "12 MG Road",
        address_line_two: "Near Metro",
        pincode: "110001",
        city: "New Delhi",
        state: "Delhi",
        country: "India",
        status: "ACTIVE",
      },
    ],
  },
  {
    description:
      "Returns all warehouses configured on your Shipmozo account, including the default warehouse used for pushing orders.",
    queryExamples: ["?page=2"],
    responseFields: [
      { name: "id", notes: "Warehouse ID to use as warehouse_id on push-order and related calls." },
      {
        name: "default",
        notes: '"YES" marks the warehouse used automatically when none is specified elsewhere; otherwise "NO".',
      },
      { name: "address_title", notes: "Label for this warehouse in the panel." },
      { name: "name", notes: "Contact name for the warehouse." },
      { name: "email", notes: "Contact email." },
      { name: "phone", notes: "Primary phone (digits)." },
      { name: "alt_phone", notes: "Alternate phone, if set." },
      { name: "address_line_one", notes: "Primary street address." },
      { name: "address_line_two", notes: "Secondary address line." },
      { name: "pincode", notes: "Pickup pincode." },
      { name: "city", notes: "City." },
      { name: "state", notes: "State." },
      { name: "country", notes: "Country." },
      { name: "status", notes: "Warehouse status in Shipmozo (e.g. ACTIVE)." },
    ],
  }
);

setExample(
  "getApiInfo",
  { result: "1", message: "Success", data: { version: "v1" } },
  {
    description:
      "Checks whether the Shipmozo API is currently reachable and responding. Requires no authentication — useful as a first connectivity check before setting up credentials.",
    responseFields: [
      { name: "result", notes: '"1" means the API responded successfully.' },
      { name: "message", notes: "Human-readable outcome." },
      { name: "data", notes: "Health/version details when provided by the API." },
    ],
    errorUnavailable: true,
  }
);

setExample(
  "Login",
  {
    result: "1",
    message: "Success",
    data: [{ name: "Seller Name", public_key: "YOUR_PUBLIC_KEY", private_key: "YOUR_PRIVATE_KEY" }],
  },
  {
    description:
      "Exchanges a Shipmozo panel username and password for the public_key / private_key pair used to authenticate all other requests. On success, data is an array: [{ name, public_key, private_key }] — note the array wrapping.",
    responseFields: [
      { name: "data[0].name", notes: "Seller / account display name." },
      { name: "data[0].public_key", notes: "Send as the public-key header on later calls." },
      {
        name: "data[0].private_key",
        notes: "Send as the private-key header on later calls. Keep server-side only.",
      },
    ],
    errorUnavailable: true,
    docNotes: ["Success data is an array of one object — do not treat data as a plain object."],
  }
);

setExample(
  "createWarehouse",
  { result: "1", message: "Success", data: { warehouse_id: "12345" } },
  {
    description:
      "Registers a new warehouse (pickup location) on your Shipmozo account and returns its warehouse_id.",
    docNotes: [
      "If you reuse an existing address_title, Shipmozo typically returns the existing warehouse_id instead of creating a duplicate or erroring.",
    ],
    responseFields: [
      { name: "warehouse_id", notes: "ID to pass as warehouse_id on push-order and related calls." },
    ],
  }
);

setExample(
  "orderUpdateWarehouse",
  { result: "1", message: "Success", data: { order_id: "98765", refrence_id: "STORE-1001" } },
  {
    summary: "Change an order's linked warehouse",
    description: "Updates which warehouse is associated with an already-created order.",
    docNotes: [
      "order_id must be Shipmozo internal order_id from push-order — not your storefront order id alone.",
      "Live responses may spell the reference field as refrence_id (missing e). Parse that spelling when reading responses.",
    ],
    responseFields: [
      { name: "order_id", notes: "Shipmozo internal order id." },
      { name: "refrence_id", notes: "Reference echoed by the API (live spelling often omits an e)." },
    ],
  }
);

{
  const op = ops.pushOrders || (ops.pushOrders = {});
  delete op["x-errors"];
  op.description =
    "Creates a domestic shipment order in Shipmozo and returns the internal order_id used for all downstream calls (rates, assign, track, cancel).";
  op["x-errorExample"] = {
    result: "0",
    message: "Error",
    data: { error: "The selected warehouse id is invalid." },
  };
  op["x-responseFields"] = [
    { name: "Info", notes: "Human-readable success note when present." },
    { name: "order_id", notes: "Shipmozo internal order ID — use this for all downstream APIs." },
    { name: "refrence_id", notes: "Echo of the order_id you sent (store id). Not for chaining later calls." },
    { name: "error", notes: "Populated on failure with the validation or business error text." },
  ];
  op["x-docNotes"] = [
    "Weight is in grams. Dimensions are in cm. Dates use YYYY-MM-DD. Phone fields are digits only (no country code).",
  ];
}

setExample(
  "rateCalculator",
  {
    result: "1",
    message: "Success",
    data: [
      {
        id: "12",
        name: "Demo Courier",
        estimated_delivery: "2026-08-08",
        total_charges: "85.00",
        shipping_charges: "72.00",
        gst: "13.00",
        pickups_automatically_scheduled: "NO",
        from_zone: "A",
        to_zone: "B",
      },
    ],
  },
  {
    description:
      "Returns available couriers and their rates for a shipment between two pincodes. Also useful as a serviceability check — if it returns one or more couriers, the pincode pair is serviceable.",
    docNotes: [
      "Each courier id in the response is the courier_id used in Assign Courier.",
      "Weight is in grams. Dimensions (length, width, height) are in cm.",
    ],
    responseFields: [
      { name: "id", notes: "Courier id — pass as courier_id to assign-courier." },
      { name: "name", notes: "Courier display name." },
      { name: "estimated_delivery", notes: "Estimated delivery date when provided." },
      { name: "total_charges", notes: "Total charge including GST components when provided." },
      { name: "shipping_charges", notes: "Base shipping charge." },
      { name: "gst", notes: "GST amount." },
      {
        name: "pickups_automatically_scheduled",
        notes:
          '"YES" means you can skip schedule-pickup; "NO" means call schedule-pickup after assign.',
      },
      { name: "from_zone", notes: "Origin zone used for rating." },
      { name: "to_zone", notes: "Destination zone used for rating." },
    ],
  }
);

setExample(
  "autoCourierAssign",
  {
    result: "1",
    message: "Success",
    data: {
      order_id: "98765",
      reference_id: "STORE-1001",
      awb_number: "AWB123456789",
      courier_company: "Demo Courier",
      courier_company_service: "Surface",
    },
  },
  {
    description:
      "Automatically assigns a courier to an order based on rules configured in the Shipmozo panel Settings Auto Assign. Requires that feature to be enabled first — otherwise the call fails.",
    docNotes: [
      "Prerequisite: configure Auto Assign rules in the Shipmozo panel before calling this endpoint.",
    ],
    errorExample: {
      result: "0",
      message: "Error",
      data: { error: "please setup auto assign" },
    },
    responseFields: [
      { name: "order_id", notes: "Shipmozo internal order id." },
      { name: "reference_id", notes: "Reference returned by the API (spelling may vary)." },
      { name: "awb_number", notes: "Air Waybill — use for track-order and get-order-label." },
      { name: "courier_company", notes: "Assigned courier name." },
      { name: "courier_company_service", notes: "Service level when provided." },
    ],
  }
);

setExample(
  "schedulePickup",
  {
    result: "1",
    message: "Success",
    data: {
      order_id: "98765",
      reference_id: "STORE-1001",
      courier: "Demo Courier",
      awb_number: "AWB123456789",
      lr_number: "LR001",
    },
  },
  {
    description:
      "Schedules a courier pickup for an order whose assigned courier does not automatically schedule pickup (pickups_automatically_scheduled: NO from Rate Calculator).",
    docNotes: [
      'Only call this when Rate Calculator showed pickups_automatically_scheduled: "NO" for the chosen courier; otherwise the AWB is already assigned.',
    ],
    errorExample: { result: "0", message: "Order not found" },
    responseFields: [
      { name: "order_id", notes: "Shipmozo internal order id." },
      { name: "reference_id", notes: "Reference returned by the API." },
      { name: "courier", notes: "Courier name." },
      { name: "awb_number", notes: "Air Waybill after pickup scheduling." },
      { name: "lr_number", notes: "LR number when provided by the courier." },
    ],
  }
);

setExample(
  "getOrderLabel",
  {
    result: "1",
    message: "Success",
    data: [
      {
        label:
          "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
        created_at: "2026-08-05 12:00:00",
      },
    ],
  },
  {
    description:
      "Returns the shipping label for a shipment as a base64-encoded image, once a courier has been assigned.",
    docNotes: [
      "awb_number comes from Assign Courier, Auto-Assign, or Schedule Pickup.",
      "The verified response shape is a PNG base64 data-URL — not a caller-selected PDF/ZPL format.",
    ],
    responseFields: [
      { name: "data[].label", notes: "Base64 data-URL for the label image (typically PNG)." },
      { name: "data[].created_at", notes: "When the label was generated." },
    ],
  }
);

setExample("generateManifest", null, {
  summary: "Generate a pickup manifest",
  description: "Generates a pickup manifest document for the given AWB number(s).",
  exampleUnavailable: true,
  docNotes: [
    "awb_numbers supports multiple comma-separated AWB numbers. A specific maximum per request is not independently verified in this portal.",
  ],
  errorUnavailable: true,
});

setExample(
  "trackOrder",
  {
    result: "1",
    message: "Success",
    data: {
      order_id: "98765",
      refrence_id: "STORE-1001",
      awb_number: "AWB123456789",
      rto_awb_number: "",
      courier: "Demo Courier",
      order_status: "Pickup Pending",
      expected_delivery_date: "2026-08-10",
      current_status: "Pickup Pending",
      status_time: "2026-08-05 10:15:00",
      scan_detail: [],
    },
  },
  {
    description: "Returns the current tracking status and scan history for a shipment by AWB number.",
    docNotes: ["awb_number is obtained from Assign Courier, Auto-Assign, or Schedule Pickup."],
    queryExamples: ["?awb_number=YOUR_AWB"],
    responseFields: [
      { name: "order_id", notes: "Shipmozo internal order id." },
      { name: "refrence_id", notes: "Reference field (live spelling often omits an e)." },
      { name: "awb_number", notes: "Tracking AWB." },
      { name: "rto_awb_number", notes: "RTO AWB when applicable." },
      { name: "courier", notes: "Courier name." },
      { name: "order_status", notes: "High-level order status." },
      { name: "expected_delivery_date", notes: "ETA when provided." },
      { name: "current_status", notes: "Latest scan/status text (e.g. Pickup Pending)." },
      { name: "status_time", notes: "Timestamp of the current status." },
      { name: "scan_detail", notes: "Array of scan events when provided." },
    ],
    errorUnavailable: true,
  }
);

fs.writeFileSync(enrichPath, JSON.stringify(e, null, 2) + "\n");

const labelPath = openapi.paths["/get-order-label/{awb_number}"];
if (labelPath?.get?.parameters) {
  labelPath.get.parameters = labelPath.get.parameters.filter((p) => p.name !== "type_of_label");
}
const man = openapi.paths["/generate-manifest"]?.get;
if (man?.parameters) {
  man.parameters = man.parameters.map((p) => {
    if (p.name === "awb_numbers" || p.name === "awb_number") {
      return {
        ...p,
        description:
          "One or more AWB numbers as a comma-separated list. A specific maximum count per request is not independently verified in this portal.",
      };
    }
    return p;
  });
}
fs.writeFileSync(openapiPath, JSON.stringify(openapi, null, 2) + "\n");

if (contracts.generateManifest) {
  contracts.generateManifest = {
    title: "Generate Manifest",
    tip: "Pass AWB numbers as a comma-separated list. A specific maximum per request is not independently verified here.",
    placeholder: true,
    unavailableMessage: "Full request payload reference not yet available for Generate Manifest",
    fields: [],
  };
}
if (contracts.createWarehouse) {
  contracts.createWarehouse.tip =
    "address_title must be unique for new warehouses. Reusing an existing address_title typically returns the existing warehouse_id instead of erroring.";
}
if (contracts.pushOrders?.fields) {
  for (const f of contracts.pushOrders.fields) {
    if (f.field === "weight") f.notes = `${f.notes || ""} Unit: grams.`.trim();
    if (f.field?.includes("phone")) f.notes = `${f.notes || ""} Digits only; no country code.`.trim();
    if (f.field?.includes("date")) f.notes = `${f.notes || ""} Format: YYYY-MM-DD.`.trim();
    if (f.field === "product_detail") {
      f.notes =
        'Array of line items. Example: [{"name":"T-Shirt","sku_number":"SKU1","quantity":1,"discount":"","hsn":"6109","unit_price":499,"product_category":"Apparel"}]';
      f.values = "array of objects";
    }
    if (["length", "width", "height"].includes(f.field)) {
      f.notes = `${f.notes || ""} Unit: cm.`.trim();
    }
  }
}
if (contracts.rateCalculator?.fields) {
  for (const f of contracts.rateCalculator.fields) {
    if (f.field === "weight") f.notes = `${f.notes || ""} Unit: grams.`.trim();
    if (f.field === "dimensions") {
      f.notes =
        'Array of boxes, e.g. [{"no_of_box":1,"length":10,"width":10,"height":10}] with length/width/height in cm.';
    }
  }
}
fs.writeFileSync(contractsPath, JSON.stringify(contracts, null, 2) + "\n");

console.log("Updated enrichment, openapi, field-contracts");
