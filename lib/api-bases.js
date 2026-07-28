/** Allowed Shipmozo API base URLs — proxy only forwards to these. */
const API_BACKENDS = {
  dev: {
    id: "dev",
    label: "Shipmozo API",
    baseUrl: "https://appiify.com/app/api/v1",
  },
  live: {
    id: "live",
    label: "Shipmozo API",
    baseUrl: "https://shipping-api.com/app/api/v1",
  },
};

/** Public portal defaults to live. Set SHIPMOZO_BACKEND=dev only for unusual deploys. */
const DEFAULT_BACKEND = process.env.SHIPMOZO_BACKEND === "dev" ? "dev" : "live";

function resolveBackendBase(backendId) {
  return API_BACKENDS[backendId === "dev" ? "dev" : "live"].baseUrl;
}

function getBackendMeta(backendId) {
  const id = backendId === "dev" ? "dev" : "live";
  return API_BACKENDS[id];
}

module.exports = { API_BACKENDS, DEFAULT_BACKEND, resolveBackendBase, getBackendMeta };
