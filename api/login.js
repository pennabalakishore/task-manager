const { handleRequest } = require("../backend/server");

module.exports = async (req, res) => {
  req.url = "/api/login";

  try {
    await handleRequest(req, res, { allowStatic: false });
  } catch (error) {
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ error: "Internal server error" }));
    }
    console.error("login function error:", error);
  }
};

