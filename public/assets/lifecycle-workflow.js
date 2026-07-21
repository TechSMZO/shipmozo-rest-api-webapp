/** 8-step order lifecycle chain — verified sequence for Dev sandbox cleanup. */

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
};

export const lifecycleDependencies = {
  get_warehouses: ["public_key", "private_key"],
  push_order: ["public_key", "private_key", "warehouse_id"],
  rate_calculator: ["public_key", "private_key", "warehouse_pincode"],
  assign_courier: ["public_key", "private_key", "order_id", "courier_id"],
  schedule_pickup: ["public_key", "private_key", "order_id"],
  track_order: ["public_key", "private_key", "awb_number"],
  get_order_label: ["public_key", "private_key", "awb_number"],
  cancel_order: ["public_key", "private_key", "order_id", "awb_number"],
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

export const lifecycleWorkflow = {
  id: "order_lifecycle",
  label: "Order lifecycle (8 steps)",
  description:
    "Get default warehouse → push order → rate → assign → optional schedule pickup → track → label → mandatory cancel.",
  steps: [
    {
      id: "get_warehouses",
      label: "Get Warehouses",
      operationId: "getWarehouses",
      method: "GET",
      path: "/get-warehouses",
      purpose: "Fetch warehouses and pick the one with default === YES.",
      requires: lifecycleDependencies.get_warehouses,
      outputs: ["warehouse_id", "warehouse_pincode", "warehouse_name"],
      prerequisites: [],
    },
    {
      id: "push_order",
      label: "Push Order",
      operationId: "pushOrders",
      method: "POST",
      path: "/push-order",
      purpose: "Create order; capture internal data.order_id for all later steps.",
      requires: lifecycleDependencies.push_order,
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
      requires: lifecycleDependencies.rate_calculator,
      outputs: ["courier_id", "courier_name", "pickups_automatically_scheduled"],
      prerequisites: [{ step: "get_warehouses", label: "Get Warehouses", outputs: ["warehouse_pincode"] }],
      buildSampleBody: (ctx, deliveryPincode) => rateCalculatorBody(ctx, deliveryPincode),
      hasDeliveryPincode: true,
    },
    {
      id: "assign_courier",
      label: "Assign Courier",
      operationId: "assignCourier",
      method: "POST",
      path: "/assign-courier",
      purpose: "Assign courier and generate AWB.",
      requires: lifecycleDependencies.assign_courier,
      outputs: ["awb_number", "courier_name"],
      prerequisites: [
        { step: "push_order", label: "Push Order", outputs: ["order_id"] },
        { step: "rate_calculator", label: "Rate Calculator", outputs: ["courier_id"] },
      ],
      sampleBody: { order_id: "", courier_id: 37 },
    },
    {
      id: "schedule_pickup",
      label: "Schedule Pickup",
      operationId: "schedulePickup",
      method: "POST",
      path: "/schedule-pickup",
      purpose: "Only when pickups_automatically_scheduled is NO — otherwise skip.",
      requires: lifecycleDependencies.schedule_pickup,
      outputs: ["awb_number", "lr_number"],
      prerequisites: [{ step: "assign_courier", label: "Assign Courier", outputs: ["order_id"] }],
      sampleBody: { order_id: "" },
      conditional: "skip_when_auto_pickup",
    },
    {
      id: "track_order",
      label: "Track Order",
      operationId: "trackOrder",
      method: "GET",
      path: "/track-order",
      purpose: "Track shipment by AWB.",
      requires: lifecycleDependencies.track_order,
      outputs: ["tracking_status"],
      prerequisites: [{ step: "assign_courier", label: "Assign Courier", outputs: ["awb_number"] }],
      queryParams: ["awb_number"],
      warnOnFail: true,
    },
    {
      id: "get_order_label",
      label: "Get Order Label",
      operationId: "getOrderLabel",
      method: "GET",
      path: "/get-order-label/{awb_number}",
      purpose: "Download shipping label image.",
      requires: lifecycleDependencies.get_order_label,
      outputs: [],
      prerequisites: [{ step: "assign_courier", label: "Assign Courier", outputs: ["awb_number"] }],
      pathParams: ["awb_number"],
    },
    {
      id: "cancel_order",
      label: "Cancel Order",
      operationId: "cancelOrder",
      method: "POST",
      path: "/cancel-order",
      purpose: "Mandatory cleanup — cancels the test order so nothing stays live.",
      requires: lifecycleDependencies.cancel_order,
      outputs: [],
      prerequisites: [
        { step: "push_order", label: "Push Order", outputs: ["order_id"] },
        { step: "assign_courier", label: "Assign Courier", outputs: ["awb_number"] },
      ],
      sampleBody: { order_id: "", awb_number: "" },
      mandatory: true,
      warnOnFail: true,
    },
  ],
};

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

export function shouldSkipSchedulePickup(ctx) {
  return String(ctx.pickups_automatically_scheduled || "").toUpperCase() === "YES";
}

export function extractLifecycleResponse(payload, step) {
  const updates = {};
  const data = payload?.data ?? payload;

  if (step.id === "get_warehouses") {
    return pickDefaultWarehouse(payload);
  }
  if (step.id === "rate_calculator" && Array.isArray(data) && data.length) {
    const picked = pickFirstCourier(payload);
    Object.assign(updates, picked);
    if (data.length > 1) {
      updates._courierNote =
        "First available courier selected automatically. Change courier_id before Assign Courier if needed.";
    }
    return updates;
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
