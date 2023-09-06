/* Set the `main` and `module` paths for publishing.
We must transpile and build the packages to JS. */
const fs = require("fs");
const pkg = require("../package.json");
console.log("prepping package.json for build");
pkg.main = "dist/index.js";
pkg.module = "dist/index.es.js";
fs.writeFileSync(`${__dirname}/../package.json`, JSON.stringify(pkg));
