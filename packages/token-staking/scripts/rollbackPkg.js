/* Reset the `main` and `module` paths for development.
Keeping them as `.ts` removes the need to build the package
during development. */
const fs = require("fs");
const pkg = require("../package.json");
console.log("undoing package.json from build");
pkg.main = "src/index.ts";
pkg.module = "src/index.ts";
fs.writeFileSync(`${__dirname}/../package.json`, JSON.stringify(pkg));
