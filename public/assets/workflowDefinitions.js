/** Workflow definitions for API Tester — sample bodies from Postman collection. */

export const extractionMap = {
  order_id: ["order_id", "orderId", "shipment_id", "shipmentId", "id"],
  reference_id: ["reference_id", "referenceId", "refrence_id", "client_order_id"],
  courier_id: ["courier_id", "courierId", "logistic_id", "logistics_id"],
  courier_name: ["courier_name", "courierName", "courier", "logistic_name", "logistics_name"],
  freight_amount: ["freight_amount", "freight", "total_freight", "total_charges", "rate", "shipping_charge"],
  awb_number: ["awb_number", "awb", "waybill", "tracking_number"],
  label_url: ["label_url", "label", "label_link", "pdf_url"],
  tracking_status: ["tracking_status", "current_status", "status"],
};

export const workflowDependencies = {
  push_order: ["public_key", "private_key"],
  rate_calculator: ["public_key", "private_key"],
  assign_courier: ["public_key", "private_key", "order_id", "courier_id"],
  generate_label: ["public_key", "private_key", "awb_number"],
  track_order: ["public_key", "private_key", "awb_number"],
};

const stepPrerequisites = {
  push_order: [],
  rate_calculator: [{ step: "push_order", label: "Push Order", outputs: ["order_id"] }],
  assign_courier: [
    { step: "push_order", label: "Push Order", outputs: ["order_id"] },
    { step: "rate_calculator", label: "Rate Calculator", outputs: ["courier_id"] },
  ],
  generate_label: [{ step: "assign_courier", label: "Assign Courier", outputs: ["awb_number"] }],
  track_order: [{ step: "assign_courier", label: "Assign Courier", outputs: ["awb_number"] }],
};

export function buildPushOrderSample() {
  return {
    order_id: `POSTMAN-${Date.now()}`,
    order_date: new Date().toISOString().slice(0, 10),
    order_type: "ESSENTIALS",
    consignee_name: "Postman Test Customer",
    consignee_phone: 9876543210,
    consignee_alternate_phone: 9876543211,
    consignee_email: "customer@example.com",
    consignee_address_line_one: "House 101, Test Street",
    consignee_address_line_two: "Near Test Landmark",
    consignee_pin_code: 110001,
    consignee_city: "New Delhi",
    consignee_state: "Delhi",
    product_detail: [
      {
        name: "Test Product",
        sku_number: "SKU-POSTMAN-001",
        quantity: 1,
        discount: "",
        hsn: "1234",
        unit_price: 1000,
        product_category: "Other",
      },
    ],
    payment_type: "PREPAID",
    cod_amount: "",
    weight: 500,
    length: 10,
    width: 10,
    height: 10,
    warehouse_id: "",
    gst_ewaybill_number: "",
    gstin_number: "",
  };
}

export const rateCalculatorSample = {
  order_id: "",
  pickup_pincode: 122001,
  delivery_pincode: 110001,
  payment_type: "PREPAID",
  shipment_type: "FORWARD",
  order_amount: 1000,
  type_of_package: "SPS",
  rov_type: "ROV_OWNER",
  cod_amount: "",
  weight: 500,
  dimensions: [
    {
      no_of_box: "1",
      length: "22",
      width: "10",
      height: "10",
    },
  ],
};

export const assignCourierSample = {
  order_id: "",
  courier_id: 5,
};

export const workflows = [
  {
    id: "create_shipment_assign_courier",
    label: "Create shipment and assign courier",
    description:
      "Create an order, calculate rates, assign courier, generate label, and track shipment.",
    steps: [
      {
        id: "push_order",
        label: "Push Order",
        operationId: "pushOrders",
        method: "POST",
        path: "/push-order",
        purpose: "Creates the order in Shipmozo.",
        requires: workflowDependencies.push_order,
        outputs: ["order_id", "reference_id"],
        prerequisites: stepPrerequisites.push_order,
        sampleBody: null,
        buildSampleBody: buildPushOrderSample,
      },
      {
        id: "rate_calculator",
        label: "Rate Calculator",
        operationId: "rateCalculator",
        method: "POST",
        path: "/rate-calculator",
        purpose: "Checks courier availability and rates.",
        requires: workflowDependencies.rate_calculator,
        outputs: ["courier_id", "courier_name", "freight_amount"],
        prerequisites: stepPrerequisites.rate_calculator,
        sampleBody: rateCalculatorSample,
      },
      {
        id: "assign_courier",
        label: "Assign Courier",
        operationId: "assignCourier",
        method: "POST",
        path: "/assign-courier",
        purpose: "Assigns courier and generates AWB.",
        requires: workflowDependencies.assign_courier,
        outputs: ["awb_number", "courier_name"],
        prerequisites: stepPrerequisites.assign_courier,
        sampleBody: assignCourierSample,
      },
      {
        id: "generate_label",
        label: "Generate Label",
        operationId: "getOrderLabel",
        method: "GET",
        path: "/get-order-label/{awb_number}",
        purpose: "Generates the shipping label.",
        requires: workflowDependencies.generate_label,
        outputs: ["label_url"],
        prerequisites: stepPrerequisites.generate_label,
        pathParams: ["awb_number"],
        queryParams: [],
      },
      {
        id: "track_order",
        label: "Track Order",
        operationId: "trackOrder",
        method: "GET",
        path: "/track-order",
        purpose: "Tracks the shipment.",
        requires: workflowDependencies.track_order,
        outputs: ["tracking_status"],
        prerequisites: stepPrerequisites.track_order,
        queryParams: ["awb_number"],
      },
    ],
  },
];

export const defaultWorkflow = workflows[0];
