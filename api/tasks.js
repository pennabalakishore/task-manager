const { URL } = require("url");
const { handleRequest } = require("../backend/server");

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

module.exports = async (req, res) => {
  const parsed = new URL(req.url, "http://localhost");
  const method = req.method || "GET";

  if (method === "PUT" || method === "DELETE") {
    const id = parsed.searchParams.get("id");
    if (!id) {
      sendJson(res, 400, { error: "Task id is required as query param ?id=..." });
      return;
    }

    parsed.searchParams.delete("id");
    const query = parsed.searchParams.toString();
    req.url = `/api/tasks/${encodeURIComponent(id)}${query ? `?${query}` : ""}`;
  } else {
    req.url = `/api/tasks${parsed.search}`;
  }

  try {
    await handleRequest(req, res, { allowStatic: false });
  } catch (error) {
    if (!res.headersSent) {
      sendJson(res, 500, { error: "Internal server error" });
    }
    console.error("tasks function error:", error);
  }
};

