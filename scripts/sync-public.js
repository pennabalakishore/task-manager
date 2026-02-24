const fs = require("fs");
const path = require("path");

const rootDir = path.join(__dirname, "..");
const sourceDir = path.join(rootDir, "frontend");
const publicDir = path.join(rootDir, "public");

function copyHtmlFile(fileName) {
  const source = path.join(sourceDir, fileName);
  const destination = path.join(publicDir, fileName);
  fs.copyFileSync(source, destination);
}

function writeIndexFile() {
  const indexPath = path.join(publicDir, "index.html");
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="refresh" content="0;url=/login.html" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Task Manager</title>
  </head>
  <body>
    <p>Redirecting to login...</p>
  </body>
</html>
`;

  fs.writeFileSync(indexPath, html, "utf8");
}

function main() {
  fs.mkdirSync(publicDir, { recursive: true });
  copyHtmlFile("login.html");
  copyHtmlFile("dashboard.html");
  writeIndexFile();
  console.log("Synced frontend HTML to public/ for deployment.");
}

main();

