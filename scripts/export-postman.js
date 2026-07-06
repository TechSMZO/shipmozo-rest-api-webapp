const fs = require("fs");
const path = require("path");
const { loadMergedSpec } = require("../lib/merge-spec");
const { buildPostmanCollection, buildPostmanEnvironments } = require("../lib/postman-export");

const root = path.join(__dirname, "..");
const assetsDir = path.join(root, "public", "assets");
const overrideCollection = path.join(root, "postman", "collection.json");

const collectionOut = path.join(assetsDir, "shipmozo.postman_collection.json");
const envDevOut = path.join(assetsDir, "shipmozo.postman_environment.dev.json");
const envLiveOut = path.join(assetsDir, "shipmozo.postman_environment.live.json");

fs.mkdirSync(assetsDir, { recursive: true });

if (fs.existsSync(overrideCollection)) {
  fs.copyFileSync(overrideCollection, collectionOut);
  console.log("Exported", collectionOut, "— from postman/collection.json (override)");
} else {
  const spec = loadMergedSpec(root);
  const collection = buildPostmanCollection(spec);
  fs.writeFileSync(collectionOut, JSON.stringify(collection, null, 2));
  console.log(
    "Exported",
    collectionOut,
    "—",
    collection.item.reduce((n, f) => n + f.item.length, 0),
    "requests in",
    collection.item.length,
    "folders"
  );
}

const envs = buildPostmanEnvironments();
fs.writeFileSync(envDevOut, JSON.stringify(envs.dev, null, 2));
fs.writeFileSync(envLiveOut, JSON.stringify(envs.live, null, 2));
console.log("Exported", envDevOut);
console.log("Exported", envLiveOut);
