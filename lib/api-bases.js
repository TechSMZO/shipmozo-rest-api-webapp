/** Allowed Shipmozo API base URLs — proxy only forwards to these. */
const API_BACKENDS = {
  dev: {
    id: "dev",
    label: "Dev server",
    baseUrl: "https://appiify.com/app/api/v1",
  },
  live: {
    id: "live",
    label: "Live server",
    baseUrl: "https://shipping-api.com/app/api/v1",
  },
};

const DEFAULT_BACKEND = process.env.SHIPMOZO_BACKEND === "live" ? "live" : "dev";

function resolveBackendBase(backendId) {
  return API_BACKENDS[backendId === "live" ? "live" : "dev"].baseUrl;
}

module.exports = { API_BACKENDS, DEFAULT_BACKEND, resolveBackendBase };
