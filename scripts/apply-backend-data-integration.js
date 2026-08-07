/**
 * Apply Backend Data Integration Spec updates to OpenAPI, enrichment, and field-contracts.
 * Run: node scripts/apply-backend-data-integration.js && npm run build
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const openapiPath = path.join(root, "shipmozo-openapi.json");
const enrichPath = path.join(root, "shipmozo-enrichment.json");
const contractsPath = path.join(root, "public", "assets", "field-contracts.json");
const rateLimitsPath = path.join(root, "lib", "rate-limits.js");

const openapi = JSON.parse(fs.readFileSync(openapiPath, "utf8"));
const enrich = JSON.parse(fs.readFileSync(enrichPath, "utf8"));
const contracts = JSON.parse(fs.readFileSync(contractsPath, "utf8"));

const AUTH_PARAMS = [
  {
    name: "public-key",
    in: "header",
    description: "Api Public Key",
    required: true,
    schema: { type: "string" },
  },
  {
    name: "private-key",
    in: "header",
    description: "Api Private Key",
    required: true,
    schema: { type: "string" },
  },
];

function field(field, type, required, values, notes) {
  return { field, type, required, values: values || "—", notes: notes || "" };
}

function setFailure(opId, messages, exampleMessage) {
  const op = enrich.operations[opId] || (enrich.operations[opId] = {});
  delete op["x-errorExampleUnavailable"];
  op["x-failureMessages"] = messages;
  if (exampleMessage) {
    op["x-errorExample"] = {
      result: "0",
      message: "Error",
      data: { error: exampleMessage },
    };
  }
}

// ---------------------------------------------------------------------------
// OpenAPI: Get Manifests (new) + Generate Manifest fix + type_of_label + etc.
// ---------------------------------------------------------------------------

openapi.paths["/generate-manifest"].get.parameters = [
  ...AUTH_PARAMS,
  {
    name: "awb_numbers",
    in: "query",
    description:
      "Comma-separated AWB numbers to generate manifests for. Required. Maximum 25 AWBs per request.",
    required: true,
    schema: { type: "string", maxItems: 25 },
  },
];
openapi.paths["/generate-manifest"].get.summary = "Generate Manifest";
openapi.paths["/generate-manifest"].get.description =
  "Generate pickup manifest PDF(s) for up to 25 AWB numbers. Returns a list of {file, awb_numbers} where file is a URL.";

openapi.paths["/get-manifests"] = {
  get: {
    tags: ["Label"],
    summary: "Get Manifests",
    description:
      "Retrieve previously generated manifest file URLs for the given AWB numbers (max 25).",
    operationId: "getManifests",
    parameters: [
      ...AUTH_PARAMS,
      {
        name: "awb_numbers",
        in: "query",
        description:
          "Comma-separated AWB numbers. Required. Maximum 25 AWBs per request.",
        required: true,
        schema: { type: "string" },
      },
    ],
    responses: {
      200: { description: "Successful operation" },
    },
  },
};

// type_of_label on Get Order Label
const labelParams = openapi.paths["/get-order-label/{awb_number}"].get.parameters;
if (!labelParams.some((p) => p.name === "type_of_label")) {
  labelParams.push({
    name: "type_of_label",
    in: "query",
    description:
      "Pass PDF (case-insensitive) for a PDF label URL. Any other value or omit → default BASE64 PNG data URI. Not validated server-side.",
    required: false,
    schema: { type: "string", enum: ["PDF", "BASE64"] },
  });
}

// create-shipper: add status
const shipperSchema =
  openapi.paths["/create-shipper"].post.requestBody.content["application/json"].schema;
shipperSchema.properties = shipperSchema.properties || {};
shipperSchema.properties.status = {
  type: "string",
  description: "Shipper status (required; no restricted value set).",
};
if (!shipperSchema.required) shipperSchema.required = ["name", "phone", "address_line_one", "pin_code", "status"];
else if (!shipperSchema.required.includes("status")) shipperSchema.required.push("status");

// international push: ensure weight_unit, ref_order_id, shipper_id
const intlSchema =
  openapi.paths["/international-push-order"].post.requestBody.content["application/json"].schema;
intlSchema.properties = intlSchema.properties || {};
Object.assign(intlSchema.properties, {
  ref_order_id: { type: "string", description: "Optional reference order id" },
  weight_unit: { type: "string", description: "Weight unit for the shipment" },
  shipper_id: {
    type: "integer",
    description: "Shipper of record from create-shipper (international customs/export)",
  },
});

// ndr-action: move action to request body (spec)
const ndrOp = openapi.paths["/ndr-action/{awb_number}"].post;
ndrOp.parameters = ndrOp.parameters.filter((p) => p.name !== "action");
ndrOp.requestBody = {
  required: true,
  content: {
    "application/json": {
      schema: {
        type: "object",
        required: ["action"],
        properties: {
          action: {
            type: "string",
            enum: ["REATTEMPT", "RETURN"],
            description: "NDR action: REATTEMPT or RETURN",
          },
        },
      },
      example: { action: "REATTEMPT" },
    },
  },
};

// push-return: ensure is_qc, pickup_alternate_phone, brand/color in product_detail notes via contracts
const retSchema =
  openapi.paths["/push-return-order"].post.requestBody.content["application/json"].schema;
retSchema.properties = retSchema.properties || {};
retSchema.properties.pickup_alternate_phone = {
  type: "string",
  description: "Optional 10-digit alternate phone; must differ from pickup_phone",
};
retSchema.properties.is_qc = {
  type: "string",
  enum: ["YES", "NO"],
  description: "Optional QC flag",
};

// ---------------------------------------------------------------------------
// Enrichment: navigation, operations, error catalog, info rate-limit text
// ---------------------------------------------------------------------------

if (enrich.info?.description) {
  enrich.info.description = enrich.info.description.replace(
    /Quota is \*\*500 requests per 1-minute window\*\* per API key/,
    "Quota is **500 requests per 1-minute window** per client IP address (not per API key)"
  );
}

enrich.operations.generateManifest = {
  summary: "Generate a pickup manifest",
  description:
    "Generates pickup manifest PDF file(s) for up to 25 AWB numbers. Response data is a list of objects with file (URL) and awb_numbers.",
  "x-useCases": ["Generate pickup manifests for scheduled AWBs"],
  "x-queryExamples": ["?awb_numbers=AWB1,AWB2"],
  "x-docNotes": [
    "awb_numbers is required and accepts a maximum of 25 AWBs.",
    "If one AWB-group's generation fails internally, that failure is logged server-side and not returned — a partial failure can look like a full success unless nothing succeeded.",
  ],
  "x-responseFields": [
    { name: "data[].file", notes: "URL of the generated manifest PDF." },
    { name: "data[].awb_numbers", notes: "AWB numbers included in that manifest file." },
  ],
  responses: {
    200: {
      content: {
        "application/json": {
          example: {
            result: "1",
            message: "Success",
            data: [
              {
                file: "https://example.com/manifests/manifest_xxx.pdf",
                awb_numbers: ["AWB123", "AWB456"],
              },
            ],
          },
        },
      },
    },
  },
};
delete enrich.operations.generateManifest["x-exampleUnavailable"];
setFailure("generateManifest", [
  {
    cause: "Validation (missing / too many / unowned AWBs)",
    message: 'Laravel default, e.g. "The awb numbers may not have more than 25 items."',
  },
  { cause: "Nothing generated", message: "Please try again" },
], "Please try again");

enrich.operations.getManifests = {
  summary: "Get previously generated manifests",
  description:
    "Returns previously generated manifest file URLs for the given AWB numbers (max 25). Distinct from Generate Manifest — this retrieves existing files rather than creating new ones.",
  "x-useCases": ["Get previously generated manifest files"],
  "x-queryExamples": ["?awb_numbers=AWB1,AWB2"],
  "x-docNotes": [
    "Same awb_numbers request field as Generate Manifest (required, max 25).",
    "Response shape differs: each item has manifest_files (URL array) and created_at — not the Generate Manifest {file, awb_numbers} shape.",
  ],
  "x-responseFields": [
    { name: "data[].manifest_files", notes: "Array of manifest PDF URLs." },
    { name: "data[].created_at", notes: "When the manifest set was created." },
  ],
  responses: {
    200: {
      content: {
        "application/json": {
          example: {
            result: "1",
            message: "Success",
            data: [
              {
                manifest_files: [
                  "https://example.com/manifests/m1.pdf",
                  "https://example.com/manifests/m2.pdf",
                ],
                created_at: "2026-08-03 12:00:00",
              },
            ],
          },
        },
      },
    },
  },
};
setFailure("getManifests", [
  { cause: "awb_number missing", message: "AWB number not found" },
  { cause: "More than 25 requested", message: "you can get a maximum of 25 manifests" },
  {
    cause: "No manifest file exists yet",
    message: "No file found. Please generate manifest first",
  },
], "No file found. Please generate manifest first");

enrich["x-portal"].navigation.operations.getManifests = {
  category: "labels-tracking",
  order: 25,
  keywords: ["manifest", "get manifests", "download manifest"],
};

enrich.operations.getOrderLabel = {
  summary: "Download the shipping label",
  description:
    "Generates and returns the shipping label for an AWB. Pass type_of_label=PDF for a PDF URL; omit (or any other value) for the default BASE64 PNG data URI. Always generates fresh content — there is no “label not ready yet” error.",
  "x-docNotes": [
    "awb_number comes from Assign Courier, Auto-Assign, or Schedule Pickup.",
    "type_of_label is not validated — only the exact value PDF (case-insensitive) selects the PDF path; anything else silently uses the default BASE64 PNG path.",
  ],
  "x-queryExamples": ["", "?type_of_label=PDF"],
  "x-responseFields": [
    { name: "data[].type", notes: '"PDF" or "BASE64" depending on type_of_label.' },
    {
      name: "data[].label",
      notes: "PDF: URL string. BASE64: data:image/png;base64,... data URI.",
    },
    { name: "data[].created_at", notes: "When the label was generated." },
  ],
  responses: {
    200: {
      content: {
        "application/json": {
          example: {
            result: "1",
            message: "Success",
            data: [
              {
                type: "BASE64",
                label:
                  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
                created_at: "2026-08-05 12:00:00",
              },
            ],
          },
        },
      },
    },
  },
};
setFailure("getOrderLabel", [
  { cause: "AWB invalid / not owned", message: "The selected awb number is invalid." },
  {
    cause: "QR-label mode for non-qualifying courier",
    message: "QR Label only available for Delhivery B2B courier.",
  },
], "The selected awb number is invalid.");

enrich.operations.trackOrder = {
  ...enrich.operations.trackOrder,
  summary: "Track a shipment's status",
  description:
    "Returns the current tracking status and scan history for a single shipment by AWB number.",
  "x-docNotes": [
    "Single AWB only — pass one awb_number per request.",
    "Most date/time fields display in IST; scan_detail[].date is the exception and is returned as the raw UTC string (Y-m-d H:i:s).",
    "expected_delivery_date is IST, date-only.",
  ],
  "x-responseFields": [
    { name: "order_id", notes: "Shipmozo internal order id." },
    { name: "refrence_id", notes: "Reference field (live spelling often omits an e)." },
    { name: "awb_number", notes: "Tracking AWB." },
    { name: "rto_awb_number", notes: "RTO AWB when applicable." },
    { name: "courier", notes: "Courier name." },
    { name: "order_status", notes: "High-level order status." },
    { name: "expected_delivery_date", notes: "ETA when provided (IST, date-only)." },
    { name: "current_status", notes: "Latest scan/status text (e.g. Pickup Pending)." },
    { name: "status_time", notes: "Timestamp of the current status (IST display)." },
    {
      name: "scan_detail",
      notes:
        "Array of {date, status, location}. date is raw UTC (Y-m-d H:i:s); status is a human-readable label; location is free text from the courier. A populated example from a moved shipment is not yet available.",
    },
  ],
};
setFailure("trackOrder", [
  { cause: "No record for this AWB", message: "We not found any record" },
], "We not found any record");
delete enrich.operations.trackOrder["x-errorExampleUnavailable"];
// Keep success example but leave scan_detail empty (pending real moved-shipment example)
enrich.operations.trackOrder.responses = {
  200: {
    content: {
      "application/json": {
        example: {
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
        "x-exampleNote":
          "scan_detail is empty here — a real populated example from a shipment that has moved past Pickup Pending is not yet available.",
      },
    },
  },
};

enrich.operations.internationalPushOrder = {
  summary: "Create a new international shipment order",
  description:
    "Creates an international/export shipment order. Returns the same order_id (internal) / refrence_id (echo) split as domestic Push Order. International never takes a courier_id at push time.",
  "x-useCases": ["Create export / cross-border orders"],
  "x-docNotes": [
    "KYC precondition: the account's Aadhaar KYC must be verified before this endpoint works. Failure returns \"Kyc is not verified\".",
    "Unlike domestic Push Order, consignee_pin_code has no database-existence check — only required, max:20. A pincode rejected on domestic push for not being in Shipmozo's serviceable-pincode master can still be accepted here.",
    "Weight limits are in kg (not grams). International Rate Calculator uses grams with different caps — do not reuse those numbers here.",
    "type_of_package accepts SPS and MPS only (no B2B for international).",
  ],
  "x-responseFields": [
    { name: "Info", notes: "Human-readable success note when present." },
    { name: "order_id", notes: "Shipmozo internal order ID — use for downstream APIs." },
    { name: "refrence_id", notes: "Echo of the order_id / ref you sent." },
    { name: "error", notes: "Populated on failure." },
  ],
  responses: {
    200: {
      content: {
        "application/json": {
          example: {
            result: "1",
            message: "Success",
            data: {
              Info: "Order Pushed Successfully",
              order_id: "ordID",
              refrence_id: "ordID",
            },
          },
        },
      },
    },
  },
};
delete enrich.operations.internationalPushOrder["x-exampleUnavailable"];
setFailure("internationalPushOrder", [
  { cause: "Aadhaar KYC not verified", message: "Kyc is not verified" },
  { cause: "Weight over cap", message: "Order Weight must be less than or equal 70 kg" },
  { cause: "E-way bill required", message: "Gst E-way bill number is required" },
], "Kyc is not verified");
enrich.operations.internationalPushOrder["x-failureMessages"].push({
  cause: "Other field validation",
  message: "Additional per-field Laravel validation messages may also be returned.",
});

enrich.operations.internationalRateCalculator = {
  summary: "Compare courier rates for an international shipment",
  description:
    "Compares international courier rates for a destination and package. Response is a courier array like domestic Rate Calculator, but without from_zone / to_zone (no zone concept for cross-border).",
  "x-useCases": ["Quote international shipping before push"],
  "x-docNotes": [
    "pickup_pincode is validated against Shipmozo's pincode master (must exist). delivery_pincode is presence-only — required, but no format or existence check.",
    "Weight is in grams with different caps than International Push Order (which uses kg). Do not document these two endpoints with the same numbers.",
  ],
  "x-responseFields": [
    {
      name: "data[]",
      notes:
        "Courier quote objects similar to domestic Rate Calculator, minus from_zone / to_zone.",
    },
  ],
  "x-exampleUnavailable": true,
};
setFailure("internationalRateCalculator", [
  { cause: "Validation / weight", message: "Order Weight must be less than or equal 70 kg (and other field validation messages)" },
], null);
enrich.operations.internationalRateCalculator["x-errorExampleUnavailable"] = true;

enrich.operations.createShipper = {
  summary: "Register a shipper of record (international only)",
  description:
    "Registers a shipper of record used only for international shipments — the returned shipper_id is passed into International Push Order for customs/export paperwork. Has no relationship to domestic orders.",
  "x-useCases": ["Register exporter / shipper before international push"],
  "x-docNotes": [
    "Failures return Laravel's stock English validation text (no custom message catalog). Example: \"The phone must be 10 digits.\"",
  ],
  "x-responseFields": [
    { name: "shipper_id", notes: "Integer id to pass into international-push-order." },
  ],
  responses: {
    200: {
      content: {
        "application/json": {
          example: {
            result: "1",
            message: "Success",
            data: { shipper_id: 42 },
          },
        },
      },
    },
  },
};
setFailure("createShipper", [
  { cause: "Validation", message: "The phone must be 10 digits." },
], "The phone must be 10 digits.");

enrich.operations.getOrderDetail = {
  summary: "Get full details of an order",
  description: "Returns the full order snapshot by Shipmozo internal order_id.",
  "x-docNotes": [
    "shipping_details (awb_number, courier_company, lr_number, optionally child_awb_numbers) is populated only when order_status is PROCESS or SCHEDULED — otherwise it is [].",
    "weight and volumetric_weight are returned in grams, not kg.",
    "pickup_details shape differs by order type — forward orders pull from the warehouse; return orders pull pickup_* fields from the order.",
    "For non-domestic orders, billing_* fields are literal copies of shipping_* — there is no separate billing address stored.",
    "zone is typically a string, but the exact type is not fully confirmed for all order states (it may fall back to a richer object when no partner-zone relation is set).",
  ],
  "x-responseFields": [
    { name: "order_id", notes: "Shipmozo internal order id." },
    { name: "order_date", notes: "Order date." },
    { name: "order_status", notes: "Current order status." },
    { name: "store_code", notes: "Always 0 in current responses." },
    { name: "package_type", notes: "Package type." },
    { name: "order_total", notes: "Order total amount." },
    { name: "payment_type", notes: "Payment type." },
    { name: "collectable_amount", notes: "Collectable / COD amount." },
    {
      name: "shipping_details",
      notes: "Object with awb/courier when PROCESS/SCHEDULED; otherwise [].",
    },
    { name: "shipment_type", notes: "Shipment type." },
    { name: "shipping_*", notes: "Recipient shipping address fields." },
    { name: "billing_*", notes: "Billing address fields (copies of shipping_* for non-domestic)." },
    { name: "products", notes: "Array of {product, price, product_code, amount}." },
    { name: "weight", notes: "Weight in grams." },
    { name: "volumetric_weight", notes: "Volumetric weight in grams." },
    { name: "no_of_box", notes: "Box count." },
    { name: "pickup_details", notes: "Pickup/warehouse details (shape varies by order type)." },
    { name: "total_shipping_charges", notes: "Total shipping charges." },
    {
      name: "zone",
      notes: "Typically a string; exact type not fully confirmed for all order states.",
    },
    { name: "route_code", notes: "Route code when present." },
  ],
  responses: {
    200: {
      content: {
        "application/json": {
          example: {
            result: "1",
            message: "Success",
            data: {
              order_id: "98765",
              order_date: "2026-08-01",
              order_status: "NEW_ORDER",
              store_code: 0,
              package_type: "SPS",
              order_total: "1000",
              payment_type: "PREPAID",
              collectable_amount: "0",
              shipping_details: [],
              shipment_type: "FORWARD",
              shipping_firstname: "Customer",
              shipping_email: "customer@example.com",
              shipping_phone: "8000042323",
              shipping_address: "House 101",
              shipping_address2: "",
              shipping_city: "Gurgaon",
              shipping_state: "Haryana",
              shipping_zipcode: "122001",
              shipping_country: "India",
              billing_firstname: "Customer",
              billing_email: "customer@example.com",
              billing_phone: "8000042323",
              billing_address: "House 101",
              billing_address2: "",
              billing_city: "Gurgaon",
              billing_state: "Haryana",
              billing_zipcode: "122001",
              billing_country: "India",
              products: [
                {
                  product: "Test Product",
                  price: "1000",
                  product_code: "SKU-001",
                  amount: "1000",
                },
              ],
              weight: 500,
              volumetric_weight: 200,
              no_of_box: 1,
              pickup_details: {},
              total_shipping_charges: "0",
              zone: "",
              route_code: "",
            },
          },
        },
      },
    },
  },
};
delete enrich.operations.getOrderDetail["x-exampleUnavailable"];

enrich.operations.pushReturnOrder = {
  summary: "Create a return/reverse shipment order",
  description:
    "Creates a reverse/return shipment with pickup from the customer address. Use a return_reason_id from get-return-reason.",
  "x-useCases": ["Create reverse pickup / return orders"],
  "x-docNotes": [
    "customer_request must be the string \"REFUND\" or \"EXCHANGE\" (case-sensitive). Sending raw numbers 1/2 fails even though the validator checks against 1/2 after an internal remap.",
    "payment_type accepts PREPAID only — COD is not allowed for return orders (unlike domestic Push Order).",
    "weight / length / width / height are required, numeric, and not zero — with no upper bound (unlike forward orders).",
    "Success response has no error key: {Info, order_id, refrence_id} only.",
  ],
  "x-responseFields": [
    { name: "Info", notes: "Human-readable success note." },
    { name: "order_id", notes: "Shipmozo internal order ID." },
    { name: "refrence_id", notes: "Echo of your order_id / reference." },
  ],
  responses: {
    200: {
      content: {
        "application/json": {
          example: {
            result: "1",
            message: "Success",
            data: {
              Info: "Order Pushed Successfully",
              order_id: "ordID",
              refrence_id: "ordID",
            },
          },
        },
      },
    },
  },
};

enrich.operations.getAllNdrShipments = {
  summary: "List failed-delivery (NDR) orders",
  description:
    "Lists non-delivery report (NDR) shipments that need action. Response is a paginated envelope with limit, from_to, next_page_url, total_pages, current_page, total, and data.",
  "x-useCases": ["Review NDR orders and decide reattempt vs return"],
  "x-queryExamples": ["?page=1&per_page=25"],
  "x-responseFields": [
    { name: "limit", notes: "Page size." },
    { name: "from_to", notes: "Date range applied." },
    { name: "next_page_url", notes: "URL for the next page when present." },
    { name: "total_pages", notes: "Total pages." },
    { name: "current_page", notes: "Current page number." },
    { name: "total", notes: "Total matching NDR orders." },
    {
      name: "data[]",
      notes:
        "Per-order NDR objects (id, order_date, channel, order_id, office_name, ref_order_id, order_status, product_*, type_of_package, parcel_*, volumetric_weight, no_of_box, courier, awb_number, webparex_status, order_amount, cod_amount, payment_type, buyer_detail, warehouse_detail, delivery_attempt, courier_status, is_RTO, delivered_date, rto_date, ndr_date, rto_delivered_date).",
    },
  ],
  "x-exampleUnavailable": true,
  "x-exampleUnavailableReason":
    "A real populated NDR order example is not yet available — field shape is documented; sample values pending.",
};

enrich.operations.ndrOrderAction = {
  summary: "Take action on a failed delivery",
  description:
    "Applies an NDR action on a shipment. Request body field action must be REATTEMPT or RETURN.",
  "x-useCases": ["Reattempt delivery or return an NDR shipment"],
  "x-docNotes": [
    "Success responses return data: [] — no order payload is echoed back.",
  ],
  "x-responseFields": [
    { name: "message", notes: "Success or failure text." },
    { name: "data", notes: "Empty array on success." },
  ],
  responses: {
    200: {
      content: {
        "application/json": {
          example: {
            result: "1",
            message: "Order Reattempt Updated successfully",
            data: [],
          },
        },
      },
    },
  },
};
setFailure("ndrOrderAction", [
  { cause: "AWB doesn't exist / not owned", message: "The selected awb number is invalid." },
  { cause: "action not REATTEMPT/RETURN", message: "The selected action is invalid." },
  {
    cause: "Support ticket already open",
    message: "Ticket is already raised for this order",
  },
], "The selected awb number is invalid.");
enrich.operations.ndrOrderAction["x-successNotes"] = [
  '{"result":"1","message":"Order Reattempt Updated successfully","data":[]}',
  '{"result":"1","message":"Order Reattempt Applied successfully","data":[]} (courier-level fallback / raised support ticket; same message shape for action=RETURN)',
];

enrich.operations.Countries = {
  summary: "Get list of countries (for international shipments)",
  description:
    "Returns countries available for international shipping. Each country has id, name, phone_code, country_code, and iso_code. Country id 1 (India) is explicitly excluded from this list.",
  "x-useCases": ["Populate country picker for international orders"],
  "x-docNotes": [
    "Country id 1 (India) is excluded — India will not appear if you build a country picker from this endpoint alone.",
  ],
  "x-responseFields": [
    { name: "id", notes: "Country id (use as consignee_country_id / delivery_country_id)." },
    { name: "name", notes: "Country name." },
    { name: "phone_code", notes: "International dialing code." },
    { name: "country_code", notes: "Country code." },
    { name: "iso_code", notes: "ISO country code." },
  ],
  responses: {
    200: {
      content: {
        "application/json": {
          example: {
            result: "1",
            message: "Success",
            data: [
              {
                id: 2,
                name: "United States",
                phone_code: "+1",
                country_code: "US",
                iso_code: "USA",
              },
            ],
          },
        },
      },
    },
  },
};
delete enrich.operations.Countries["x-exampleUnavailable"];

// Domestic push notes + limits
enrich.operations.pushOrders = {
  ...enrich.operations.pushOrders,
  "x-docNotes": [
    "Weight is in grams. Dimensions are in cm. Dates use YYYY-MM-DD. Phone fields are digits only (no country code).",
    "consignee_pin_code is validated against Shipmozo's serviceable-pincode master — a syntactically valid 6-digit pincode that is not in that table is rejected at push-order time.",
    "Package-type limits: SPS → weight >0 ≤70 kg (field in grams), each L/W/H >0 ≤3000 cm. MPS/B2B → overall weight >0 ≤3000 kg; per-box no_of_box/length/width/height >0 ≤2000; per-box weight optional ≤70kg (MPS) or ≤400kg (B2B).",
    "order_id ≤20 chars, alphanumeric. gstin_number exactly 15 characters. consignee_alternate_phone must differ from consignee_phone. order_date within the last 6 months and no later than tomorrow (IST).",
    "product_detail.*.quantity ≤100,000; unit_price ≤10,000,000; discount ≤1,000,000; no limit on number of line items.",
  ],
};
setFailure("pushOrders", [
  { cause: "Weight over cap", message: "Order Weight must be less than or equal 70 kg" },
  { cause: "Invalid COD amount", message: "Please enter valid cod amount" },
  { cause: "E-way bill required", message: "Gst E-way bill number is required" },
  { cause: "Courier unavailable", message: "Courier service not available, Please try later" },
  { cause: "Courier unavailable", message: "Courier not available, Please try later" },
  { cause: "Assign failure", message: "Courier not assigned. Please try again." },
], "The selected warehouse id is invalid.");

setFailure("Login", [
  { cause: "Unknown account", message: "Email or phone is not registered." },
  { cause: "Deactivated", message: "Your account has been deactivated." },
  { cause: "Non-admin login", message: "Please use main admin account to login" },
  { cause: "Bad password", message: "Invalid password" },
], "Invalid password");

setFailure("autoCourierAssign", [
  { cause: "KYC pending", message: "Your Profile is under verification" },
  { cause: "Rules not configured", message: "Please setup auto assign rule" },
  { cause: "Courier unavailable", message: "Courier not available, Please try later" },
  { cause: "Wallet", message: "Insufficient wallet balance, Please recharge your wallet" },
  {
    cause: "No valid courier",
    message: "We not found any valid courier for this order please try again.",
  },
], "Please setup auto assign rule");

setFailure("assignCourier", [
  { cause: "Bad order id", message: "Order id is not valid" },
  { cause: "Bad courier id", message: "Courier id is not valid" },
  { cause: "Assign failure", message: "Courier not assigned. Please try again." },
  { cause: "Service unavailable", message: "Courier service not available, Please try later" },
  { cause: "Courier unavailable", message: "Courier not available, Please try later" },
], "Order id is not valid");

enrich.operations.schedulePickup = {
  ...enrich.operations.schedulePickup,
  "x-docNotes": [
    ...(enrich.operations.schedulePickup["x-docNotes"] || []),
    '"Order is already scheduled" is a SUCCESS response (result: "1") with order/courier/AWB/lr_number data — not a failure.',
  ],
};
setFailure("schedulePickup", [
  { cause: "Bad order id", message: "Order id is not valid" },
  { cause: "No courier assigned", message: "Order should be assigned courier" },
  { cause: "Assign failure", message: "Courier not assigned. Please try again." },
], "Order id is not valid");

setFailure("cancelOrder", [
  { cause: "Invalid order id", message: "The selected order id is invalid." },
  { cause: "Invalid AWB", message: "The selected awb number is invalid." },
  { cause: "Cancel failure", message: "Courier not cancelled. Please try again." },
], "The selected order id is invalid.");
enrich.operations.cancelOrder = {
  ...enrich.operations.cancelOrder,
  "x-docNotes": [
    "There is no distinct \"already shipped/delivered\" message — a shipment past PICKUP_PENDING falls into the generic invalid message, indistinguishable from a wrong ID.",
  ],
};

setFailure("orderUpdateWarehouse", [
  {
    cause: "Order already assigned",
    message: "You can not update warehouse because order is assigned",
  },
  {
    cause: "Order already scheduled",
    message: "You can not update warehouse because order is scheduled",
  },
], "You can not update warehouse because order is assigned");

setFailure("rateCalculator", [
  { cause: "Weight over cap", message: "Order Weight must be less than or equal 70 kg" },
], "Order Weight must be less than or equal 70 kg");

// Error codes page — already-in-state cross-note + refresh catalog messages
enrich["x-portal"].errorCodes = [
  {
    id: "profile-under-verification",
    result: "0",
    typicalMessage: "Your profile is under verification / Your Profile is under verification",
    when: "Seller KYC not completed or pending approval",
    action: "Finish verification in Shipmozo panel",
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
      "Email or phone is not registered. / Your account has been deactivated. / Please use main admin account to login / Invalid password",
    when: "POST /login failures",
    action: "Verify panel username/password and that the account is active admin",
  },
  {
    id: "track-not-found",
    result: "0",
    typicalMessage: "We not found any record",
    when: "Track Order — no record for the given AWB",
    action: "Confirm the AWB from Assign Courier / Schedule Pickup",
  },
  {
    id: "auto-assign-not-setup",
    result: "0",
    typicalMessage: "Please setup auto assign rule",
    when: "auto-assign-order without panel Auto Assign rules",
    action: "Enable Auto Assign in the Shipmozo panel, or use assign-courier",
  },
  {
    id: "wallet-insufficient",
    result: "0",
    typicalMessage: "Insufficient wallet balance, Please recharge your wallet",
    when: "Auto-assign (and similar) when wallet is empty",
    action: "Recharge wallet in the Shipmozo panel",
  },
  {
    id: "invalid-warehouse",
    result: "0",
    typicalMessage: "The selected warehouse id is invalid.",
    when: "push-order with a warehouse_id that does not belong to the account",
    action: "Call get-warehouses or create-warehouse first",
  },
  {
    id: "rate-limit",
    result: "0",
    typicalMessage: "Rate limit exceeded (or HTTP 429)",
    when: "Too many calls in the shared 1-minute window (bucketed per client IP)",
    action: "Back off and retry when x-ratelimit-remaining recovers",
  },
];
enrich["x-portal"].alreadyInStateNote = {
  title: "“Already in this state” can be a success",
  body:
    "Several responses look like duplicates but return result: \"1\": Push Order → \"Order is already scheduled\"; Schedule Pickup → \"Order is already scheduled\"; Create Warehouse → \"warehouse with same title already exists\" (returns the existing warehouse_id). Checking only for result \"0\" will miss these. Assign Courier is not in this list — a second assign on an already-assigned order is blocked earlier and returns \"Order id is not valid\".",
};

enrich["x-portal"].rateLimitHeaders.headers = enrich["x-portal"].rateLimitHeaders.headers.map(
  (h) => {
    if (h.name === "x-ratelimit-limit") {
      return {
        ...h,
        meaning:
          "Max requests allowed in the current 1-minute window per client IP address (not per API key)",
      };
    }
    return h;
  }
);
enrich["x-portal"].rateLimitIpNote =
  "The 500 requests/minute limit is enforced per client IP address, not per API key. If you run multiple API key pairs from behind the same network (e.g. an office NAT), they share one combined 500/min budget rather than 500 each.";

enrich["x-portal"].timezoneNote =
  "API storage/app timezone is UTC. Most user-facing date/time fields are converted to IST (Asia/Kolkata) for display. expected_delivery_date is IST, date-only. Exception: Track Order scan_detail[].date is returned as the raw UTC string, not converted to IST.";

enrich["x-portal"].optionalFieldNote =
  "When an optional field has nothing to provide, omit the field entirely or send null. Both are treated as “not provided” in most cases. Do not treat empty string \"\" as universally safe — some fields pass empty strings through rather than substituting a default.";

// ---------------------------------------------------------------------------
// Field contracts
// ---------------------------------------------------------------------------

contracts.generateManifest = {
  title: "Generate Manifest",
  tip: "Maximum 25 AWB numbers per request. Partial internal failures may not be surfaced.",
  fields: [
    field(
      "awb_numbers",
      "string (query)",
      true,
      "comma-separated, max 25",
      "Required. Confirmed max 25 AWBs."
    ),
  ],
};

contracts.getManifests = {
  title: "Get Manifests",
  tip: "Retrieves existing manifest files — generate first if you see “No file found”.",
  fields: [
    field(
      "awb_numbers",
      "string (query)",
      true,
      "comma-separated, max 25",
      "Required. Max 25 AWBs."
    ),
  ],
};

contracts.getOrderLabel = {
  title: "Get Order Label",
  tip: "type_of_label is not validated — only PDF (case-insensitive) selects the PDF path.",
  fields: [
    field("awb_number", "string", true, "path param", "From Assign Courier or Schedule Pickup"),
    field(
      "type_of_label",
      "string",
      false,
      "PDF (else → BASE64)",
      "PDF → DomPDF → S3 URL, response type \"PDF\". Omit or any other value → HTML→PDF→Imagick→base64 PNG data URI, response type \"BASE64\". Not validated server-side."
    ),
  ],
};

contracts.trackOrder = {
  title: "Track Order",
  tip: "Single AWB only. scan_detail[].date is raw UTC; other timestamps display in IST.",
  fields: [
    field("awb_number", "string", true, "query param", "Single AWB from Assign Courier or Schedule Pickup"),
  ],
};

contracts.Countries = {
  title: "Countries",
  tip: "Country id 1 (India) is excluded from this list.",
  fields: [],
};

contracts.createShipper = {
  title: "Create Shipper",
  tip: "International shipments only — returned shipper_id feeds International Push Order.",
  fields: [
    field("name", "string", true, "—", "Shipper / exporter name"),
    field("email", "string", false, "—", "Optional email"),
    field("phone", "string", true, "exactly 10 digits", "Required; exactly 10 digits"),
    field("address_line_one", "string", true, "—", "Primary address"),
    field("address_line_two", "string", false, "—", "Secondary address"),
    field("pin_code", "string", true, "must exist", "Required; must exist in pincode master"),
    field("status", "string", true, "any", "Required; no restricted value set"),
  ],
};

contracts.internationalPushOrder = {
  title: "International Push Order",
  tip: "Aadhaar KYC must be verified first (\"Kyc is not verified\" otherwise). Weight caps are in kg — different from International Rate Calculator (grams).",
  fields: [
    field("order_id", "string", true, "—", "Your order reference"),
    field("ref_order_id", "string", false, "—", "Optional reference order id"),
    field("order_date", "string", true, "YYYY-MM-DD", "Order date"),
    field("consignee_name", "string", true, "—", "Recipient full name"),
    field("consignee_company_name", "string", false, "—", "Recipient company"),
    field("consignee_phone", "string", true, "digits", "Recipient phone"),
    field("consignee_alternate_phone", "string", false, "digits", "Alternate phone"),
    field("consignee_email", "string", false, "—", "Recipient email"),
    field("consignee_address_line_one", "string", true, "—", "Primary address"),
    field("consignee_address_line_two", "string", false, "—", "Secondary address"),
    field("consignee_country_id", "number", true, "from /countries", "Country id (India id 1 not in /countries list)"),
    field(
      "consignee_pin_code",
      "string",
      true,
      "max 20",
      "Required, max:20 only — NO pincode-master existence check (unlike domestic Push Order)."
    ),
    field("consignee_state", "string", true, "—", "State"),
    field("consignee_city", "string", true, "—", "City"),
    field("consignee_gst_number", "string", false, "—", "Consignee GST if applicable"),
    field("warehouse_id", "string", true, "—", "From get-warehouses / create-warehouse"),
    field("shipper_id", "number", false, "from create-shipper", "Shipper of record for customs/export"),
    field("gstin_number", "string", false, "—", "Shipper GSTIN"),
    field("gst_ewaybill_number", "string", false, "—", "E-way bill when required"),
    field("type_of_package", "string", true, "SPS, MPS", "SPS or MPS only — no B2B for international"),
    field("shipment_purpose", "string", true, "DCSB4, SCSB4, CSB5", "Shipment purpose / customs scheme"),
    field("weight_unit", "string", false, "—", "Weight unit"),
    field("currency", "string", false, "—", "Currency code"),
    field("weight", "number", true, "kg", "Shipment weight in kg (caps differ from rate calculator grams)"),
    field("length / width / height", "number", true, "cm", "Dimensions in cm"),
    field("row_content.*", "array", true, "line items", "Line-item fields for customs contents"),
    field(
      "iec_number",
      "string",
      false,
      "CSB5",
      "Required when shipment_purpose == CSB5",
      "CSB5 conditional"
    ),
  ],
};
// Fix CSB5 conditional fields properly with group markers
contracts.internationalPushOrder.fields = [
  field("order_id", "string", true, "—", "Your order reference"),
  field("ref_order_id", "string", false, "—", "Optional reference order id"),
  field("order_date", "string", true, "YYYY-MM-DD", "Order date"),
  field("consignee_name", "string", true, "—", "Recipient full name"),
  field("consignee_company_name", "string", false, "—", "Recipient company"),
  field("consignee_phone", "string", true, "digits", "Recipient phone"),
  field("consignee_alternate_phone", "string", false, "digits", "Alternate phone"),
  field("consignee_email", "string", false, "—", "Recipient email"),
  field("consignee_address_line_one", "string", true, "—", "Primary address"),
  field("consignee_address_line_two", "string", false, "—", "Secondary address"),
  field("consignee_country_id", "number", true, "from /countries", "Country id (India id 1 not listed by /countries)"),
  field(
    "consignee_pin_code",
    "string",
    true,
    "max 20",
    "Required, max:20 only — NO pincode-master existence check (unlike domestic Push Order)."
  ),
  field("consignee_state", "string", true, "—", "State"),
  field("consignee_city", "string", true, "—", "City"),
  field("consignee_gst_number", "string", false, "—", "Consignee GST if applicable"),
  field("warehouse_id", "string", true, "—", "From get-warehouses / create-warehouse"),
  field("shipper_id", "number", false, "from create-shipper", "Shipper of record for customs/export"),
  field("gstin_number", "string", false, "—", "Shipper GSTIN"),
  field("gst_ewaybill_number", "string", false, "—", "E-way bill when required"),
  field("type_of_package", "string", true, "SPS, MPS", "SPS or MPS only — no B2B for international"),
  field("shipment_purpose", "string", true, "DCSB4, SCSB4, CSB5", "Shipment purpose / customs scheme"),
  field("weight_unit", "string", false, "—", "Weight unit"),
  field("currency", "string", false, "—", "Currency code"),
  field("weight", "number", true, "kg", "Weight in kg; SPS/MPS caps apply (see notes). Not grams."),
  field("length / width / height", "number", true, "cm", "Dimensions in cm"),
  field("row_content.*", "array", true, "line items", "Customs line-item content fields"),
];
contracts.internationalPushOrder.sections = [
  {
    title: "Required when shipment_purpose is CSB5",
    fields: [
      field("iec_number", "string", true, "CSB5", "Import Export Code"),
      field("terms_of_invoice", "string", true, "CSB5", "Terms of invoice"),
      field("ecomm", "string", true, "CSB5", "E-commerce flag / value as required by CSB5"),
      field("ad_code", "string", true, "CSB5", "AD code"),
      field("meis", "string", true, "CSB5", "MEIS"),
      field("export_type", "string", true, "CSB5", "Export type (BOND / UT trigger further fields)"),
      field("incoterms", "string", true, "CSB5", "Incoterms"),
      field("invoice_number", "string", true, "CSB5", "Invoice number"),
      field("invoice_date", "string", true, "CSB5", "Invoice date"),
    ],
  },
  {
    title: "Also required when export_type is BOND or UT",
    fields: [
      field("lut_number", "string", true, "BOND/UT", "LUT number"),
      field("lut_till_date", "string", true, "BOND/UT", "LUT valid-till date"),
      field("lut_issue_date", "string", true, "BOND/UT", "LUT issue date"),
    ],
  },
];

contracts.internationalRateCalculator = {
  title: "International Rate Calculator",
  tip: "Weight is in grams (≠ International Push Order kg caps). pickup_pincode is master-validated; delivery_pincode is presence-only.",
  fields: [
    field(
      "pickup_pincode",
      "string/number",
      true,
      "must exist",
      "Validated against Shipmozo pincode master — must exist."
    ),
    field(
      "delivery_country_id",
      "number",
      true,
      "from /countries",
      "Destination country id"
    ),
    field(
      "delivery_pincode",
      "string",
      true,
      "presence only",
      "Required, but NO format or existence check — unlike pickup_pincode."
    ),
    field("order_amount", "number", true, "—", "Order amount"),
    field("type_of_package", "string", true, "SPS, MPS", "Package type"),
    field("shipment_purpose", "string", true, "DCSB4, SCSB4, CSB5", "Shipment purpose"),
    field(
      "weight",
      "number",
      true,
      "grams",
      "≤70,000 (SPS) / ≤10,000,000 (MPS). Different unit & caps from International Push Order."
    ),
    field(
      "dimensions",
      "array",
      true,
      "cm",
      "Each box: no_of_box ≤100 SPS / ≤1,000 MPS; length/width/height ≤1,000"
    ),
  ],
};

contracts.getOrderDetail = {
  title: "Get Order Detail",
  tip: "Path param only. See response field notes for conditional shipping_details and grams vs kg.",
  fields: [
    field("order_id", "string", true, "path param", "Shipmozo internal order_id"),
  ],
};

contracts.pushReturnOrder = {
  title: "Push Return Order",
  tip: "payment_type = PREPAID only. customer_request = REFUND or EXCHANGE strings (not 1/2). No upper bound on weight/dimensions.",
  fields: [
    field("order_id", "string", true, "≤20 alphanumeric", "Required, unique, ≤20 chars, alphanumeric"),
    field("order_date", "string", true, "YYYY-MM-DD", "Required"),
    field(
      "pickup_name",
      "string",
      true,
      "letters/spaces/periods",
      "Letters, spaces, periods only — no digits or special characters"
    ),
    field("pickup_phone", "string", true, "10-digit", "Required, 10 digits"),
    field(
      "pickup_alternate_phone",
      "string",
      false,
      "10-digit",
      "Optional; must differ from pickup_phone"
    ),
    field("pickup_email", "string", false, "—", "Optional"),
    field(
      "pickup_address_line_one / pickup_address_line_two",
      "string",
      true,
      "combined ≤200",
      "Combined ≤200 characters; some special characters restricted"
    ),
    field("pickup_pin_code", "string", true, "must exist", "Required; must exist in pincode master"),
    field("warehouse_id", "string", false, "must exist", "Optional; must exist for the calling user"),
    field("reason_comment", "string", false, "—", "Optional free-text reason"),
    field(
      "customer_request",
      "string",
      true,
      "REFUND, EXCHANGE",
      "Send the string \"REFUND\" or \"EXCHANGE\" (case-sensitive). Do not send 1/2."
    ),
    field(
      "return_reason_id",
      "number",
      true,
      "from get-return-reason",
      "Must exist in return-reason list. Id→title mapping not yet available."
    ),
    field(
      "weight / length / width / height",
      "number",
      true,
      "numeric, ≠0",
      "Required, numeric, not zero — NO upper bound (unlike forward orders)."
    ),
    field("is_qc", "string", false, "YES, NO", "Optional QC flag"),
    field("payment_type", "string", true, "PREPAID", "PREPAID only — COD not allowed for returns"),
    field(
      "product_detail.*.name",
      "string",
      true,
      "—",
      "Line item name"
    ),
    field("product_detail.*.sku_number", "string", true, "—", "SKU"),
    field("product_detail.*.discount", "number", false, "≤10,000", "Discount ≤10,000"),
    field(
      "product_detail.*.hsn",
      "string",
      false,
      "≤8 chars",
      "HSN ≤8 characters — different from domestic Push Order's hsn limit"
    ),
    field("product_detail.*.quantity", "number", true, "≤100,000", "Quantity ≤100,000"),
    field("product_detail.*.unit_price", "number", true, "≤1,000,000", "Unit price ≤1,000,000"),
    field("product_detail.*.product_category", "string", false, "—", "Category"),
    field(
      "product_detail.*.brand",
      "string",
      false,
      "—",
      "Return-only field — not on domestic Push Order"
    ),
    field(
      "product_detail.*.color",
      "string",
      false,
      "—",
      "Return-only field — not on domestic Push Order"
    ),
  ],
};

contracts.getAllNdrShipments = {
  title: "Get NDR All",
  tip: "Paginated list. A real populated NDR order example is not yet available — query params and response shape are documented.",
  fields: [
    field("from", "string", false, "dd-mm-yyyy", "From date; default ~2 months"),
    field("to", "string", false, "dd-mm-yyyy", "To date; default ~2 months"),
    field("per_page", "string", false, "max 100, default 25", "Records per page"),
    field("page", "string", false, "—", "Page number"),
  ],
};

contracts.ndrOrderAction = {
  title: "NDR Action",
  tip: "action enum: REATTEMPT or RETURN.",
  fields: [
    field("awb_number", "string", true, "path param", "NDR shipment AWB"),
    field("action", "string", true, "REATTEMPT, RETURN", "Required enum — use tester dropdown"),
  ],
};

// Domestic push field limit notes
const push = contracts.pushOrders;
push.tip =
  "consignee_pin_code must exist in Shipmozo's serviceable-pincode master (format-valid ≠ accepted). See package-type weight/dimension caps in Notes.";
const byName = Object.fromEntries(push.fields.map((f) => [f.field, f]));
if (byName.order_id) {
  byName.order_id.notes =
    "≤20 chars, alphanumeric only. Must be unique across retries.";
}
if (byName.order_date) {
  byName.order_date.notes =
    "YYYY-MM-DD. Must be within the last 6 months and no later than tomorrow (IST).";
}
if (byName.consignee_alternate_phone) {
  byName.consignee_alternate_phone.notes =
    "Digits only if provided; must differ from consignee_phone.";
}
if (byName.consignee_pin_code) {
  byName.consignee_pin_code.notes =
    "Validated against Shipmozo's serviceable-pincode master — format-valid 6-digit codes not in that table are rejected.";
}
if (byName.weight) {
  byName.weight.notes =
    "Shipment weight in grams. Caps by type_of_package: SPS ≤70 kg; MPS/B2B overall ≤3000 kg (see package-type table in endpoint notes).";
}
if (byName["gst_ewaybill_number, gstin_number"]) {
  byName["gst_ewaybill_number, gstin_number"].notes =
    "gstin_number must be exactly 15 characters when provided. gst_ewaybill_number required when business rules demand it.";
}
if (!push.fields.some((f) => f.field === "type_of_package")) {
  push.fields.push(
    field(
      "type_of_package",
      "string",
      true,
      "SPS, MPS, B2B",
      "SPS: weight >0 ≤70kg, each L/W/H >0 ≤3000cm. MPS/B2B: overall weight >0 ≤3000kg; per-box no_of_box/L/W/H >0 ≤2000; per-box weight optional ≤70kg (MPS) or ≤400kg (B2B)."
    )
  );
} else {
  const t = push.fields.find((f) => f.field === "type_of_package");
  t.values = "SPS, MPS, B2B";
  t.notes =
    "SPS: weight >0 ≤70kg, each L/W/H >0 ≤3000cm. MPS/B2B: overall weight >0 ≤3000kg; per-box no_of_box/L/W/H >0 ≤2000; per-box weight optional ≤70kg (MPS) or ≤400kg (B2B).";
}
if (!push.fields.some((f) => f.field.startsWith("product_detail"))) {
  push.fields.push(
    field(
      "product_detail.*",
      "array",
      true,
      "—",
      "quantity ≤100,000; unit_price ≤10,000,000; discount ≤1,000,000; no limit on number of line items."
    )
  );
}

// Clear stubs
for (const key of [
  "generateManifest",
  "getManifests",
  "createShipper",
  "Countries",
  "internationalPushOrder",
  "internationalRateCalculator",
  "getAllNdrShipments",
  "ndrOrderAction",
  "getOrderDetail",
]) {
  const c = contracts[key];
  if (!c) continue;
  delete c.placeholder;
  delete c.deferred;
  delete c.partialNotice;
  delete c.unavailableMessage;
}

fs.writeFileSync(openapiPath, JSON.stringify(openapi, null, 2) + "\n");
fs.writeFileSync(enrichPath, JSON.stringify(enrich, null, 2) + "\n");
fs.writeFileSync(contractsPath, JSON.stringify(contracts, null, 2) + "\n");

// rate-limits.js — insert getManifests after generateManifest
let rl = fs.readFileSync(rateLimitsPath, "utf8");
if (!rl.includes('operationId: "getManifests"')) {
  rl = rl.replace(
    '{ operationId: "generateManifest", method: "GET", path: "/generate-manifest", tag: "Label", auth: true, limit: 500, notes: "Max 25 AWB numbers per request (comma-separated)" },',
    `{ operationId: "generateManifest", method: "GET", path: "/generate-manifest", tag: "Label", auth: true, limit: 500, notes: "Max 25 AWB numbers per request (comma-separated)" },
  { operationId: "getManifests", method: "GET", path: "/get-manifests", tag: "Label", auth: true, limit: 500, notes: "Retrieve previously generated manifests; max 25 AWBs" },`
  );
  fs.writeFileSync(rateLimitsPath, rl);
}

console.log("Applied backend data integration updates.");
console.log("- OpenAPI paths:", Object.keys(openapi.paths).length);
console.log("- Enrichment ops:", Object.keys(enrich.operations).length);
console.log("- Field contracts:", Object.keys(contracts).length);
