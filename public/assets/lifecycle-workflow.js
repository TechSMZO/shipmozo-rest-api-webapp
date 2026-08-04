/** Lifecycle Simulator scenarios — real API chains (not Run Demo). */

import { buildPushOrderSample } from "./workflowDefinitions.js";

export const lifecycleExtractionMap = {
  warehouse_id: ["id", "warehouse_id"],
  warehouse_pincode: ["pincode", "pickup_pincode"],
  warehouse_name: ["address_title", "name"],
  order_id: ["order_id", "orderId"],
  reference_id: ["reference_id", "referenceId", "refrence_id"],
  courier_id: ["courier_id", "courierId", "id"],
  courier_name: ["courier_name", "courierName", "courier", "name"],
  pickups_automatically_scheduled: ["pickups_automatically_scheduled"],
  awb_number: ["awb_number", "awb", "waybill", "tracking_number", "airway_bill", "airway_bill_number"],
  lr_number: ["lr_number"],
  tracking_status: ["current_status", "tracking_status", "order_status"],
  return_reason_id: ["return_reason_id", "id", "reason_id"],
  consignee_country_id: ["consignee_country_id", "country_id", "id"],
};

const sharedDeps = {
  keys: ["public_key", "private_key"],
  warehouse: ["public_key", "private_key", "warehouse_id"],
  warehousePin: ["public_key", "private_key", "warehouse_pincode"],
  assign: ["public_key", "private_key", "order_id", "courier_id"],
  schedule: ["public_key", "private_key", "order_id"],
  track: ["public_key", "private_key", "awb_number"],
  label: ["public_key", "private_key", "awb_number"],
  cancel: ["public_key", "private_key", "order_id", "awb_number"],
};

function pushOrderBody(ctx) {
  const body = buildPushOrderSample();
  body.order_id = `PORTAL${Date.now()}`;
  if (ctx.warehouse_id) body.warehouse_id = String(ctx.warehouse_id);
  return body;
}

function rateCalculatorBody(ctx, deliveryPincode = "122001") {
  return {
    order_id: ctx.order_id || "",
    pickup_pincode: Number(ctx.warehouse_pincode) || 122018,
    delivery_pincode: Number(deliveryPincode) || 122001,
    payment_type: "PREPAID",
    shipment_type: "FORWARD",
    order_amount: 1000,
    type_of_package: "SPS",
    rov_type: "ROV_OWNER",
    cod_amount: "",
    weight: 500,
    dimensions: [{ no_of_box: "1", length: "22", width: "10", height: "10" }],
  };
}

/** Return rate: pickup = customer (item origin), delivery = warehouse (return destination). */
function returnRateCalculatorBody(ctx, customerPincode = "122001") {
  return {
    order_id: ctx.order_id || "",
    pickup_pincode: Number(customerPincode || ctx.return_customer_pincode) || 122001,
    delivery_pincode: Number(ctx.warehouse_pincode) || 122018,
    payment_type: "PREPAID",
    shipment_type: "RETURN",
    order_amount: 1000,
    type_of_package: "SPS",
    rov_type: "ROV_OWNER",
    cod_amount: "",
    weight: 500,
    dimensions: [{ no_of_box: "1", length: "22", width: "10", height: "10" }],
  };
}

function pushReturnOrderBody(ctx) {
  const customerPin = ctx.return_customer_pincode || "122001";
  return {
    order_id: `PORTALRET${Date.now()}`,
    order_date: new Date().toISOString().slice(0, 10),
    pickup_name: "Return Customer",
    pickup_phone: "8000042323",
    pickup_email: "return.customer@example.com",
    pickup_address_line_one: "Sector 49",
    pickup_address_line_two: "Sohna Road",
    pickup_pin_code: String(customerPin),
    pickup_city: "Gurgaon",
    pickup_state: "Haryana",
    product_detail: [
      {
        name: "Returned Item",
        sku_number: "SKU-R1",
        quantity: 1,
        discount: 0,
        unit_price: 500,
        product_category: "Other",
      },
    ],
    payment_type: "PREPAID",
    weight: 1,
    length: 10,
    width: 10,
    height: 10,
    warehouse_id: String(ctx.warehouse_id || ""),
    return_reason_id: ctx.return_reason_id ? Number(ctx.return_reason_id) || ctx.return_reason_id : "",
    customer_request: "REFUND",
  };
}

function internationalPushOrderBody(ctx) {
  return {
    order_id: `PORTALINTL${Date.now()}`,
    order_date: new Date().toISOString().slice(0, 10),
    consignee_name: "John",
    consignee_company_name: "Acme Inc",
    consignee_phone: "8000042323",
    consignee_alternate_phone: "8000042323",
    consignee_email: "johnhelp@gmail.com",
    consignee_address_line_one: "123 Main Street",
    consignee_address_line_two: "Suite 100",
    consignee_country_id: String(ctx.consignee_country_id || ""),
    consignee_pin_code: "10001",
    consignee_city: "New York",
    consignee_state: "NY",
    product_detail: [
      {
        name: "Sample Product",
        sku_number: "SKU-INTL-1",
        quantity: 1,
        discount: 0,
        hsn: "#123",
        unit_price: 1000,
        tax: 0,
        product_category: "Other",
      },
    ],
    type_of_package: "B2B",
    shipment_purpose: "CSB5",
    weight: "200",
    length: "10",
    width: "20",
    height: "15",
    warehouse_id: String(ctx.warehouse_id || ""),
    currency: "INR",
    terms_of_invoice: "FOB",
    ecomm: "NO",
  };
}

/**
 * International rate request — schema not independently live-verified.
 * OpenAPI uses delivery_country_id; docs also mention consignee_country_id — send both.
 */
function internationalRateCalculatorBody(ctx) {
  const countryId = String(ctx.consignee_country_id || "");
  return {
    pickup_pincode: String(ctx.warehouse_pincode || "122018"),
    delivery_pincode: "10001",
    delivery_country_id: countryId,
    consignee_country_id: countryId,
    order_amount: "1000",
    type_of_package: "B2B",
    shipment_purpose: "CSB5",
    weight: "500",
    currency: "INR",
    dimensions: [{ no_of_box: 1, length: 22, width: 10, height: 10 }],
  };
}

function stepGetWarehouses({ purpose, outputs } = {}) {
  return {
    id: "get_warehouses",
    label: "Get Warehouses",
    operationId: "getWarehouses",
    method: "GET",
    path: "/get-warehouses",
    purpose: purpose || "Fetch warehouses and pick the one with default === YES.",
    requires: sharedDeps.keys,
    outputs: outputs || ["warehouse_id", "warehouse_pincode", "warehouse_name"],
    prerequisites: [],
  };
}

function stepAssignCourier(orderStepLabel, rateStepLabel, rateStepId = "rate_calculator") {
  return {
    id: "assign_courier",
    label: "Assign Courier",
    operationId: "assignCourier",
    method: "POST",
    path: "/assign-courier",
    purpose: "Assign courier and generate AWB.",
    requires: sharedDeps.assign,
    outputs: ["awb_number", "courier_name"],
    prerequisites: [
      { step: "push_order_like", label: orderStepLabel, outputs: ["order_id"] },
      { step: rateStepId, label: rateStepLabel, outputs: ["courier_id"] },
    ],
    sampleBody: { order_id: "", courier_id: 37 },
  };
}

function stepSchedulePickup() {
  return {
    id: "schedule_pickup",
    label: "Schedule Pickup",
    operationId: "schedulePickup",
    method: "POST",
    path: "/schedule-pickup",
    purpose: "Only when pickups_automatically_scheduled is NO — otherwise skip.",
    requires: sharedDeps.schedule,
    outputs: ["awb_number", "lr_number"],
    prerequisites: [{ step: "assign_courier", label: "Assign Courier", outputs: ["order_id"] }],
    sampleBody: { order_id: "" },
    conditional: "skip_when_auto_pickup",
  };
}

function stepTrackOrder() {
  return {
    id: "track_order",
    label: "Track Order",
    operationId: "trackOrder",
    method: "GET",
    path: "/track-order",
    purpose: "Track shipment by AWB.",
    requires: sharedDeps.track,
    outputs: ["tracking_status"],
    prerequisites: [{ step: "assign_courier", label: "Assign Courier", outputs: ["awb_number"] }],
    queryParams: ["awb_number"],
    warnOnFail: true,
  };
}

function stepGetLabel() {
  return {
    id: "get_order_label",
    label: "Get Order Label",
    operationId: "getOrderLabel",
    method: "GET",
    path: "/get-order-label/{awb_number}",
    purpose: "Download shipping label image.",
    requires: sharedDeps.label,
    outputs: [],
    prerequisites: [{ step: "assign_courier", label: "Assign Courier", outputs: ["awb_number"] }],
    pathParams: ["awb_number"],
  };
}

function stepCancelOrder(orderStepLabel) {
  return {
    id: "cancel_order",
    label: "Cancel Order",
    operationId: "cancelOrder",
    method: "POST",
    path: "/cancel-order",
    purpose: "Mandatory cleanup — cancels the test order so nothing stays live.",
    requires: sharedDeps.cancel,
    outputs: [],
    prerequisites: [
      { step: "order", label: orderStepLabel, outputs: ["order_id"] },
      { step: "assign_courier", label: "Assign Courier", outputs: ["awb_number"] },
    ],
    sampleBody: { order_id: "", awb_number: "" },
    mandatory: true,
    warnOnFail: true,
  };
}

/** Scenario A — Domestic (unchanged behavior). */
export const domesticLifecycleWorkflow = {
  id: "order_lifecycle_domestic",
  scenarioId: "domestic",
  kind: "lifecycle",
  label: "Order lifecycle (8 steps)",
  description:
    "Get default warehouse → push order → Rate Calculator → assign → optional schedule pickup → track → label → mandatory cancel.",
  steps: [
    stepGetWarehouses(),
    {
      id: "push_order",
      label: "Push Order",
      operationId: "pushOrders",
      method: "POST",
      path: "/push-order",
      purpose: "Create order; capture internal data.order_id for all later steps.",
      requires: sharedDeps.warehouse,
      outputs: ["order_id", "reference_id"],
      prerequisites: [{ step: "get_warehouses", label: "Get Warehouses", outputs: ["warehouse_id"] }],
      buildSampleBody: (ctx) => pushOrderBody(ctx),
    },
    {
      id: "rate_calculator",
      label: "Rate Calculator",
      operationId: "rateCalculator",
      method: "POST",
      path: "/rate-calculator",
      purpose: "Quote couriers; capture courier_id and pickups_automatically_scheduled.",
      requires: sharedDeps.warehousePin,
      outputs: ["courier_id", "courier_name", "pickups_automatically_scheduled"],
      prerequisites: [{ step: "get_warehouses", label: "Get Warehouses", outputs: ["warehouse_pincode"] }],
      buildSampleBody: (ctx, deliveryPincode) => rateCalculatorBody(ctx, deliveryPincode),
      hasDeliveryPincode: true,
    },
    stepAssignCourier("Push Order", "Rate Calculator"),
    stepSchedulePickup(),
    stepTrackOrder(),
    stepGetLabel(),
    stepCancelOrder("Push Order"),
  ],
};

/** Scenario B — Reverse / Return (8 steps, no label). */
export const returnLifecycleWorkflow = {
  id: "order_lifecycle_return",
  scenarioId: "return",
  kind: "lifecycle",
  label: "Order lifecycle (8 steps)",
  description:
    "Get return reason → warehouses (return delivery destination) → push return → Rate Calculator (RETURN, reversed pincodes) → assign → optional schedule → track → mandatory cancel.",
  steps: [
    {
      id: "get_return_reason",
      label: "Get Return Reason",
      operationId: "getReturnReason",
      method: "GET",
      path: "/get-return-reason",
      purpose: 'Prefer return_reason_id 9 ("Item is damaged") if present; otherwise first id from live response.',
      requires: sharedDeps.keys,
      outputs: ["return_reason_id"],
      prerequisites: [],
    },
    stepGetWarehouses({
      purpose:
        "Pick default warehouse — this is the RETURN delivery destination (item coming back here), not a pickup origin.",
    }),
    {
      id: "push_return_order",
      label: "Push Return Order",
      operationId: "pushReturnOrder",
      method: "POST",
      path: "/push-return-order",
      purpose: "Create return order (weight in kg); capture internal data.order_id.",
      requires: ["public_key", "private_key", "warehouse_id", "return_reason_id"],
      outputs: ["order_id", "reference_id"],
      prerequisites: [
        { step: "get_return_reason", label: "Get Return Reason", outputs: ["return_reason_id"] },
        { step: "get_warehouses", label: "Get Warehouses", outputs: ["warehouse_id"] },
      ],
      buildSampleBody: (ctx) => pushReturnOrderBody(ctx),
    },
    {
      id: "rate_calculator",
      label: "Rate Calculator",
      operationId: "rateCalculator",
      method: "POST",
      path: "/rate-calculator",
      purpose: 'shipment_type RETURN; pickup = customer pincode, delivery = warehouse pincode.',
      requires: ["public_key", "private_key", "warehouse_pincode", "order_id"],
      outputs: ["courier_id", "courier_name", "pickups_automatically_scheduled"],
      prerequisites: [
        { step: "get_warehouses", label: "Get Warehouses", outputs: ["warehouse_pincode"] },
        { step: "push_return_order", label: "Push Return Order", outputs: ["order_id"] },
      ],
      buildSampleBody: (ctx, customerPincode) => returnRateCalculatorBody(ctx, customerPincode),
      hasDeliveryPincode: true,
      deliveryPincodeLabel: "Customer (return pickup) pincode",
    },
    {
      ...stepAssignCourier("Push Return Order", "Rate Calculator"),
      prerequisites: [
        { step: "push_return_order", label: "Push Return Order", outputs: ["order_id"] },
        { step: "rate_calculator", label: "Rate Calculator", outputs: ["courier_id"] },
      ],
    },
    stepSchedulePickup(),
    stepTrackOrder(),
    stepCancelOrder("Push Return Order"),
  ],
};

/** Scenario C — International (9 steps). */
export const internationalLifecycleWorkflow = {
  id: "order_lifecycle_international",
  scenarioId: "international",
  kind: "lifecycle",
  label: "Order lifecycle (9 steps)",
  description:
    "Get warehouse → countries → international push → international Rate Calculator (warn-on-fail) → assign → optional schedule → track → label → mandatory cancel.",
  steps: [
    stepGetWarehouses({ purpose: "Fetch warehouses and pick the default as pickup origin." }),
    {
      id: "get_countries",
      label: "Get Countries",
      operationId: "Countries",
      method: "GET",
      path: "/countries",
      purpose: 'Pick a real country from the live list (prefer "United States"); never hardcode the id.',
      requires: sharedDeps.keys,
      outputs: ["consignee_country_id"],
      prerequisites: [],
    },
    {
      id: "international_push_order",
      label: "International Push Order",
      operationId: "internationalPushOrder",
      method: "POST",
      path: "/international-push-order",
      purpose: "Create international order (B2B / CSB5 / INR); capture internal order_id.",
      requires: ["public_key", "private_key", "warehouse_id", "consignee_country_id"],
      outputs: ["order_id", "reference_id"],
      prerequisites: [
        { step: "get_warehouses", label: "Get Warehouses", outputs: ["warehouse_id"] },
        { step: "get_countries", label: "Get Countries", outputs: ["consignee_country_id"] },
      ],
      buildSampleBody: (ctx) => internationalPushOrderBody(ctx),
    },
    {
      id: "international_rate_calculator",
      label: "International Rate Calculator",
      operationId: "internationalRateCalculator",
      method: "POST",
      path: "/international-rate-calculator",
      purpose:
        "Quote international couriers. Request schema is unconfirmed — failure is amber and does not block the chain.",
      requires: ["public_key", "private_key", "warehouse_pincode", "consignee_country_id"],
      outputs: ["courier_id", "courier_name", "pickups_automatically_scheduled"],
      prerequisites: [
        { step: "get_warehouses", label: "Get Warehouses", outputs: ["warehouse_pincode"] },
        { step: "get_countries", label: "Get Countries", outputs: ["consignee_country_id"] },
      ],
      buildSampleBody: (ctx) => internationalRateCalculatorBody(ctx),
      warnOnFail: true,
      warnOnFailMessage:
        "This step's request format is unconfirmed — see field-contract notes. Continuing with available courier data.",
    },
    {
      ...stepAssignCourier("International Push Order", "International Rate Calculator", "international_rate_calculator"),
      prerequisites: [
        { step: "international_push_order", label: "International Push Order", outputs: ["order_id"] },
        { step: "international_rate_calculator", label: "International Rate Calculator", outputs: ["courier_id"] },
      ],
      // courier_id may be missing if rate failed — assign still required; getMissingDeps softens for warn-prev
    },
    stepSchedulePickup(),
    stepTrackOrder(),
    stepGetLabel(),
    stepCancelOrder("International Push Order"),
  ],
};

export const LIFECYCLE_SCENARIOS = [
  {
    id: "domestic",
    label: "Domestic Shipment",
    workflow: domesticLifecycleWorkflow,
    capturedFields: [
      { key: "warehouse_id", label: "Warehouse" },
      { key: "order_id", label: "Order ID" },
      { key: "courier_id", label: "Courier ID" },
      { key: "awb_number", label: "AWB" },
    ],
  },
  {
    id: "return",
    label: "Reverse Shipment (Return)",
    workflow: returnLifecycleWorkflow,
    capturedFields: [
      { key: "warehouse_id", label: "Return delivery address (warehouse)" },
      { key: "order_id", label: "Order ID" },
      { key: "return_reason_id", label: "Return Reason ID" },
      { key: "courier_id", label: "Courier ID" },
      { key: "awb_number", label: "AWB" },
    ],
  },
  {
    id: "international",
    label: "International Shipment",
    workflow: internationalLifecycleWorkflow,
    capturedFields: [
      { key: "warehouse_id", label: "Warehouse (pickup)" },
      { key: "consignee_country_id", label: "Country ID" },
      { key: "order_id", label: "Order ID" },
      { key: "courier_id", label: "Courier ID" },
      { key: "awb_number", label: "AWB" },
    ],
  },
];

export function getLifecycleScenario(scenarioId) {
  return LIFECYCLE_SCENARIOS.find((s) => s.id === scenarioId) || LIFECYCLE_SCENARIOS[0];
}

export function getLifecycleWorkflow(scenarioId) {
  return getLifecycleScenario(scenarioId).workflow;
}

/** @deprecated use getLifecycleWorkflow('domestic') — kept as default domestic alias */
export const lifecycleWorkflow = domesticLifecycleWorkflow;

/** Pick default warehouse from get-warehouses response. */
export function pickDefaultWarehouse(payload) {
  const list = Array.isArray(payload?.data) ? payload.data : [];
  const match = list.find((w) => String(w.default).toUpperCase() === "YES") || list[0];
  if (!match) return {};
  return {
    warehouse_id: String(match.id),
    warehouse_pincode: String(match.pincode || ""),
    warehouse_name: match.address_title || match.name || "",
  };
}

/** Pick first courier from rate-calculator response. */
export function pickFirstCourier(payload) {
  const list = Array.isArray(payload?.data) ? payload.data : [];
  const first = list[0];
  if (!first) return {};
  return {
    courier_id: String(first.id),
    courier_name: first.name || "",
    pickups_automatically_scheduled: String(first.pickups_automatically_scheduled || "NO"),
  };
}

function asReasonList(data) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== "object") return [];
  if (Array.isArray(data.reasons)) return data.reasons;
  if (Array.isArray(data.return_reasons)) return data.return_reasons;
  for (const v of Object.values(data)) {
    if (Array.isArray(v) && v.length && (v[0]?.id != null || v[0]?.return_reason_id != null)) return v;
  }
  return [];
}

/** Prefer id 9 ("Item is damaged") when present in the live response. */
export function pickReturnReason(payload) {
  const list = asReasonList(payload?.data ?? payload);
  const preferred = list.find((r) => String(r.id ?? r.return_reason_id) === "9");
  const match = preferred || list[0];
  if (!match) return {};
  return { return_reason_id: String(match.id ?? match.return_reason_id) };
}

function asCountryList(data) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== "object") return [];
  if (Array.isArray(data.countries)) return data.countries;
  for (const v of Object.values(data)) {
    if (Array.isArray(v) && v.length && (v[0]?.id != null || v[0]?.country_id != null)) return v;
  }
  return [];
}

function countryDisplayName(c) {
  return String(c?.name || c?.country_name || c?.country || c?.title || "");
}

/** Prefer United States by name from live /countries; never hardcode an id. */
export function pickCountry(payload) {
  const list = asCountryList(payload?.data ?? payload);
  const us = list.find((c) => /united\s*states/i.test(countryDisplayName(c)));
  const match = us || list[0];
  if (!match) return {};
  return {
    consignee_country_id: String(match.id ?? match.country_id ?? match.consignee_country_id),
  };
}

/**
 * Capture internal order_id for chaining.
 * Domestic/return OpenAPI examples use data.order_id vs data.refrence_id — prefer order_id, never chain on refrence_id alone.
 * International: adapt if live shape differs; note observed keys in updates._observedOrderShape when unusual.
 */
function extractInternalOrderId(payload) {
  const data = payload?.data ?? payload;
  if (data == null || typeof data !== "object") return {};
  const updates = {};
  if (isPresent(data.order_id)) {
    updates.order_id = String(data.order_id);
  } else if (isPresent(data.orderId)) {
    updates.order_id = String(data.orderId);
    updates._observedOrderShape = "data.orderId (not data.order_id)";
  } else {
    const deep = findDeepValue(data, ["order_id", "orderId"]);
    if (isPresent(deep)) {
      updates.order_id = String(deep);
      updates._observedOrderShape = "nested order_id/orderId (not top-level data.order_id)";
    }
  }
  if (isPresent(data.refrence_id)) updates.reference_id = String(data.refrence_id);
  else if (isPresent(data.reference_id)) updates.reference_id = String(data.reference_id);
  return updates;
}

export function shouldSkipSchedulePickup(ctx) {
  return String(ctx.pickups_automatically_scheduled || "").toUpperCase() === "YES";
}

export function extractLifecycleResponse(payload, step) {
  const updates = {};
  const data = payload?.data ?? payload;

  if (step.id === "get_warehouses") {
    return pickDefaultWarehouse(payload);
  }
  if (step.id === "get_return_reason") {
    return pickReturnReason(payload);
  }
  if (step.id === "get_countries") {
    return pickCountry(payload);
  }
  if (
    step.id === "rate_calculator" ||
    step.id === "international_rate_calculator"
  ) {
    if (Array.isArray(data) && data.length) {
      const picked = pickFirstCourier(payload);
      Object.assign(updates, picked);
      if (data.length > 1) {
        updates._courierNote =
          "First available courier selected automatically. Change courier_id before Assign Courier if needed.";
      }
      return updates;
    }
    return updates;
  }

  if (
    step.id === "push_order" ||
    step.id === "push_return_order" ||
    step.id === "international_push_order"
  ) {
    return extractInternalOrderId(payload);
  }

  for (const field of step.outputs || []) {
    const keys = lifecycleExtractionMap[field] || [field];
    for (const key of keys) {
      const v = findShallow(data, key);
      if (isPresent(v)) {
        updates[field] = String(v);
        break;
      }
    }
    if (!updates[field]) {
      const deep = findDeepValue(data, keys);
      if (isPresent(deep)) updates[field] = String(deep);
    }
  }

  if (step.id === "assign_courier" && !updates.awb_number) {
    const awb = findDeepValue(payload, lifecycleExtractionMap.awb_number);
    if (isPresent(awb)) updates.awb_number = String(awb);
  }

  return updates;
}

function isPresent(value) {
  return value !== undefined && value !== null && value !== "";
}

function findShallow(obj, key) {
  if (obj == null || typeof obj !== "object") return undefined;
  if (Object.prototype.hasOwnProperty.call(obj, key)) {
    const v = obj[key];
    if (isPresent(v)) return v;
  }
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const v = findShallow(item, key);
      if (v !== undefined) return v;
    }
  }
  return undefined;
}

/** Search nested objects/arrays for the first matching alias (used for AWB after assign). */
export function findDeepValue(obj, aliases, maxDepth = 6, depth = 0) {
  if (obj == null || depth > maxDepth) return undefined;
  if (typeof obj !== "object") return undefined;

  for (const key of aliases) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const v = obj[key];
      if (isPresent(v)) return v;
    }
  }

  if (Array.isArray(obj)) {
    for (const item of obj) {
      const v = findDeepValue(item, aliases, maxDepth, depth + 1);
      if (v !== undefined) return v;
    }
    return undefined;
  }

  for (const val of Object.values(obj)) {
    if (val && typeof val === "object") {
      const v = findDeepValue(val, aliases, maxDepth, depth + 1);
      if (v !== undefined) return v;
    }
  }
  return undefined;
}

export function extractFieldFromPayload(payload, field) {
  const aliases = lifecycleExtractionMap[field] || [field];
  const data = payload?.data ?? payload;
  const shallow = findShallow(data, aliases[0]);
  if (isPresent(shallow)) return String(shallow);
  for (const key of aliases) {
    const v = findShallow(data, key);
    if (isPresent(v)) return String(v);
  }
  const deep = findDeepValue(data, aliases);
  return isPresent(deep) ? String(deep) : "";
}

/** Resolve AWB via get-order-detail when assign-courier omits it (common with auto-pickup couriers). */
export async function resolveAwbNumber(api, ctx, { attempts = 4, delayMs = 1500 } = {}) {
  if (ctx.awb_number) return ctx.awb_number;
  if (!ctx.order_id || !api?.proxyRequest) return "";

  const headers = api.authHeaders?.() || {};
  if (!headers["public-key"]) return "";

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
    try {
      const wrapped = await api.proxyRequest({
        method: "GET",
        path: `/get-order-detail/${encodeURIComponent(ctx.order_id)}`,
        headers,
      });
      const payload = wrapped.data;
      if (payload?.result === "1") {
        const awb = extractFieldFromPayload(payload, "awb_number");
        if (awb) return awb;
      }
    } catch {
      /* retry */
    }
  }
  return "";
}
