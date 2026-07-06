/** Public URLs Postman can fetch for one-click Fork / Import (GitHub raw is most reliable). */
const GITHUB_REPO = process.env.GITHUB_REPO || "ViditGupta0603/shipmozo-api-docs";
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || "main";

function githubRawAsset(filename) {
  return `https://raw.githubusercontent.com/${GITHUB_REPO}/${GITHUB_BRANCH}/public/assets/${filename}`;
}

const POSTMAN_FILES = {
  collection: "shipmozo.postman_collection.json",
  envDev: "shipmozo.postman_environment.dev.json",
  envLive: "shipmozo.postman_environment.live.json",
};

function postmanCollectionSourceUrl(siteOrigin) {
  return githubRawAsset(POSTMAN_FILES.collection);
}

function postmanEnvSourceUrl(env, siteOrigin) {
  const file = env === "live" ? POSTMAN_FILES.envLive : POSTMAN_FILES.envDev;
  return githubRawAsset(file);
}

function postmanCollectionImportUrl(siteOrigin) {
  const source = postmanCollectionSourceUrl(siteOrigin);
  return `https://go.postman.co/collection-import?collection-url=${encodeURIComponent(source)}`;
}

function postmanEnvImportUrl(env, siteOrigin) {
  const source = postmanEnvSourceUrl(env, siteOrigin);
  return `https://go.postman.co/environment-import?environment-url=${encodeURIComponent(source)}`;
}

module.exports = {
  GITHUB_REPO,
  GITHUB_BRANCH,
  POSTMAN_FILES,
  githubRawAsset,
  postmanCollectionSourceUrl,
  postmanEnvSourceUrl,
  postmanCollectionImportUrl,
  postmanEnvImportUrl,
};
