/*
 * Widget bundler.
 *
 * Produces two artifacts in ./dist:
 *   widget.js  — minified entry point loaded by the customer's site
 *   chat.html  — self-contained iframe content with inlined CSS + JS
 *
 * Run:  node build.js
 */
const fs = require("node:fs");
const path = require("node:path");
const esbuild = require("esbuild");

const root = __dirname;
const srcDir = path.join(root, "src");
const distDir = path.join(root, "dist");

fs.mkdirSync(distDir, { recursive: true });

const readSrc = (name) => fs.readFileSync(path.join(srcDir, name), "utf8");
const widgetSrc = readSrc("widget.js");

function bundleIframe(htmlName, cssName, jsName, outName) {
  const html = readSrc(htmlName);
  const css = readSrc(cssName);
  const jsSrc = readSrc(jsName);
  const jsMin = esbuild.transformSync(jsSrc, {
    minify: true,
    target: ["es2018"],
    legalComments: "none",
  }).code;
  const inlined = html
    .replace("<!--CSS-->", "<style>\n" + css + "\n</style>")
    .replace("<!--JS-->", "<script>\n" + jsMin + "\n</script>");
  fs.writeFileSync(path.join(distDir, outName), inlined);
}

bundleIframe("chat.html", "chat.css", "chat.js", "chat.html");
bundleIframe("call.html", "call.css", "call.js", "call.html");

esbuild.buildSync({
  stdin: { contents: widgetSrc, loader: "js", resolveDir: srcDir },
  outfile: path.join(distDir, "widget.js"),
  minify: true,
  target: ["es2018"],
  legalComments: "none",
});

const fmt = (bytes) => (bytes / 1024).toFixed(1) + " KB";
const widgetSize = fs.statSync(path.join(distDir, "widget.js")).size;
const chatSize = fs.statSync(path.join(distDir, "chat.html")).size;
const callSize = fs.statSync(path.join(distDir, "call.html")).size;
console.log("widget.js : " + fmt(widgetSize));
console.log("chat.html : " + fmt(chatSize));
console.log("call.html : " + fmt(callSize));
