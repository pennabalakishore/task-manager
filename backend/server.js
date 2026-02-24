const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { URL } = require("url");

const PORT = process.env.PORT || 3000;
const STATIC_USERNAME = "admin";
const STATIC_PASSWORD = "1234";
const IS_VERCEL = Boolean(process.env.VERCEL);

const DATA_DIR = IS_VERCEL ? path.join("/tmp", "task-manager-data") : path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "tasks.json");
const FRONTEND_DIR = path.join(__dirname, "..", "frontend");
const VALID_VIEWS = new Set(["inbox", "today", "upcoming", "completed", "month"]);

const sessions = new Map();

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function ensureDataFile() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, "{}\n", "utf8");
  }
}

function readTasksData() {
  ensureDataFile();
  const raw = fs.readFileSync(DATA_FILE, "utf8").trim();

  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed;
    }
    return {};
  } catch {
    return {};
  }
}

function writeTasksData(data) {
  ensureDataFile();
  fs.writeFileSync(DATA_FILE, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function sendFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const contentTypes = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".ico": "image/x-icon"
  };

  const contentType = contentTypes[ext] || "application/octet-stream";

  fs.readFile(filePath, (err, data) => {
    if (err) {
      sendJson(res, 404, { error: "Not found" });
      return;
    }
    res.writeHead(200, { "Content-Type": contentType });
    res.end(data);
  });
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";

    req.on("data", (chunk) => {
      body += chunk.toString();
      if (body.length > 1_000_000) {
        reject(new Error("Body too large"));
      }
    });

    req.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }

      try {
        const parsed = JSON.parse(body);
        resolve(parsed);
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });

    req.on("error", reject);
  });
}

function normalizeMonth(value) {
  const text = String(value || "").trim();
  if (!text) {
    return null;
  }

  if (/^\d{1,2}$/.test(text)) {
    const numberMonth = Number(text);
    if (numberMonth >= 1 && numberMonth <= 12) {
      return String(numberMonth).padStart(2, "0");
    }
  }

  return null;
}

function isValidYear(value) {
  return /^\d{4}$/.test(String(value || "").trim());
}

function normalizeIsoDate(value) {
  const text = String(value || "").trim();
  if (!text) {
    return null;
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return null;
  }

  const date = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  if (date.toISOString().slice(0, 10) !== text) {
    return null;
  }

  return text;
}

function normalizePriority(value) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return 4;
  }

  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 4) {
    return null;
  }

  return number;
}

function normalizeStatus(value) {
  const status = String(value || "").trim().toLowerCase();
  if (status === "pending" || status === "completed") {
    return status;
  }
  return null;
}

function createTaskId() {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${crypto.randomBytes(8).toString("hex")}`;
}

function sanitizeText(value) {
  return String(value || "").trim();
}

function normalizeProjectName(value) {
  const name = sanitizeText(value);
  if (!name || name.toLowerCase() === "inbox") {
    return "General";
  }
  return name;
}

function getTaskContent(task) {
  return sanitizeText(task.content || task.title);
}

function getTaskProjectName(task) {
  return normalizeProjectName(task.projectName);
}

function getTaskComments(task) {
  return sanitizeText(task.comments || task.description);
}

function normalizeTask(task, bucketYear, bucketMonth) {
  if (!task || typeof task !== "object") {
    return null;
  }

  const content = getTaskContent(task);
  if (!content) {
    return null;
  }

  const status = normalizeStatus(task.status) || "pending";
  const dueDate = normalizeIsoDate(task.dueDate);
  const createdAt = normalizeIsoDate(task.createdAt) || todayDate();
  const updatedAt = normalizeIsoDate(task.updatedAt);
  const priority = normalizePriority(task.priority) || 4;

  return {
    id: String(task.id || ""),
    content,
    projectName: getTaskProjectName(task),
    comments: getTaskComments(task),
    status,
    dueDate,
    priority,
    createdAt,
    updatedAt,
    year: bucketYear,
    month: bucketMonth,
    title: content,
    description: getTaskComments(task)
  };
}

function resolveBucket(payload, fallbackYear, fallbackMonth) {
  const hasYear = payload.year !== undefined && payload.year !== null && String(payload.year).trim() !== "";
  const hasMonth = payload.month !== undefined && payload.month !== null && String(payload.month).trim() !== "";

  if (hasYear || hasMonth) {
    const year = String(payload.year || "").trim();
    const month = normalizeMonth(payload.month);
    if (!isValidYear(year) || !month) {
      return { error: "Provide valid year (YYYY) and month (01-12)" };
    }
    return { year, month };
  }

  const dueDate = normalizeIsoDate(payload.dueDate);
  if (dueDate) {
    return { year: dueDate.slice(0, 4), month: dueDate.slice(5, 7) };
  }

  if (fallbackYear && fallbackMonth) {
    return { year: fallbackYear, month: fallbackMonth };
  }

  const now = todayDate();
  return { year: now.slice(0, 4), month: now.slice(5, 7) };
}

function getAuthToken(req) {
  const authHeader = req.headers.authorization || "";
  if (!authHeader.startsWith("Bearer ")) {
    return null;
  }
  return authHeader.slice("Bearer ".length).trim();
}

function requireAuth(req, res) {
  const token = getAuthToken(req);
  if (!token || !sessions.has(token)) {
    sendJson(res, 401, { error: "Unauthorized" });
    return null;
  }
  return token;
}

function getOrCreateMonthBucket(data, year, month) {
  if (!data[year] || typeof data[year] !== "object" || Array.isArray(data[year])) {
    data[year] = {};
  }

  if (!Array.isArray(data[year][month])) {
    data[year][month] = [];
  }

  return data[year][month];
}

function cleanupEmptyBuckets(data, year, month) {
  if (Array.isArray(data?.[year]?.[month]) && data[year][month].length === 0) {
    delete data[year][month];
  }

  if (data?.[year] && Object.keys(data[year]).length === 0) {
    delete data[year];
  }
}

function getTaskLocations(data) {
  const locations = [];

  for (const year of Object.keys(data)) {
    if (!isValidYear(year)) {
      continue;
    }

    const months = data[year];
    if (!months || typeof months !== "object") {
      continue;
    }

    for (const rawMonth of Object.keys(months)) {
      const month = normalizeMonth(rawMonth);
      if (!month) {
        continue;
      }

      const tasks = months[rawMonth];
      if (!Array.isArray(tasks)) {
        continue;
      }

      for (let index = 0; index < tasks.length; index += 1) {
        const task = tasks[index];
        if (!task || typeof task !== "object" || !task.id) {
          continue;
        }

        locations.push({
          year,
          month,
          tasks,
          index,
          task
        });
      }
    }
  }

  return locations;
}

function findTaskById(data, taskId) {
  return getTaskLocations(data).find((location) => String(location.task.id) === taskId) || null;
}

function sortTasks(tasks) {
  tasks.sort((a, b) => {
    if (a.status !== b.status) {
      return a.status === "pending" ? -1 : 1;
    }

    if (a.dueDate && b.dueDate && a.dueDate !== b.dueDate) {
      return a.dueDate.localeCompare(b.dueDate);
    }

    if (a.dueDate && !b.dueDate) {
      return -1;
    }

    if (!a.dueDate && b.dueDate) {
      return 1;
    }

    if (a.priority !== b.priority) {
      return a.priority - b.priority;
    }

    return a.createdAt.localeCompare(b.createdAt);
  });
}

function getFilteredTasks(data, query) {
  const hasYearRaw = query.year !== null && query.year !== undefined && sanitizeText(query.year) !== "";
  const hasMonthRaw = query.month !== null && query.month !== undefined && sanitizeText(query.month) !== "";
  const yearParam = sanitizeText(query.year);
  const monthParam = normalizeMonth(query.month);
  const viewParam = sanitizeText(query.view).toLowerCase();
  const projectNameFilter = sanitizeText(query.projectName).toLowerCase();
  const today = todayDate();

  if (hasYearRaw !== hasMonthRaw) {
    return { error: "Provide both year (YYYY) and month (01-12) together" };
  }

  if (hasYearRaw && (!isValidYear(yearParam) || !monthParam)) {
    return { error: "Provide valid year (YYYY) and month (01-12)" };
  }

  let view = viewParam;
  if (!view) {
    view = yearParam && monthParam ? "month" : "inbox";
  }

  if (!VALID_VIEWS.has(view)) {
    return { error: "Invalid view. Use inbox, today, upcoming, completed, or month" };
  }

  let effectiveYear = yearParam;
  let effectiveMonth = monthParam;
  if (view === "month" && (!effectiveYear || !effectiveMonth)) {
    const now = todayDate();
    effectiveYear = now.slice(0, 4);
    effectiveMonth = now.slice(5, 7);
  }

  const tasks = getTaskLocations(data)
    .map((location) => normalizeTask(location.task, location.year, location.month))
    .filter(Boolean);

  let filtered = tasks;

  if (view === "month") {
    filtered = filtered.filter((task) => task.year === effectiveYear && task.month === effectiveMonth);
  } else if (view === "today") {
    filtered = filtered.filter((task) => task.status === "pending" && task.dueDate === today);
  } else if (view === "upcoming") {
    filtered = filtered.filter((task) => task.status === "pending" && task.dueDate && task.dueDate > today);
  } else if (view === "completed") {
    filtered = filtered.filter((task) => task.status === "completed");
  } else {
    filtered = filtered.filter((task) => task.status === "pending");
  }

  if (projectNameFilter) {
    filtered = filtered.filter((task) => task.projectName.toLowerCase() === projectNameFilter);
  }

  sortTasks(filtered);

  return {
    tasks: filtered,
    view,
    year: effectiveYear || null,
    month: effectiveMonth || null
  };
}

function getProjects(data) {
  const projectsMap = new Map();

  const locations = getTaskLocations(data);
  for (const location of locations) {
    const normalizedTask = normalizeTask(location.task, location.year, location.month);
    if (!normalizedTask) {
      continue;
    }

    const name = normalizedTask.projectName;
    if (!projectsMap.has(name)) {
      projectsMap.set(name, { name, total: 0, pending: 0, completed: 0 });
    }

    const project = projectsMap.get(name);
    project.total += 1;
    if (normalizedTask.status === "completed") {
      project.completed += 1;
    } else {
      project.pending += 1;
    }
  }

  return Array.from(projectsMap.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function serveStatic(req, res, pathname) {
  let relativePath = pathname;
  if (relativePath === "/") {
    relativePath = "/login.html";
  }

  const requestedPath = path.normalize(path.join(FRONTEND_DIR, relativePath));
  const relativeResolved = path.relative(FRONTEND_DIR, requestedPath);
  if (relativeResolved.startsWith("..") || path.isAbsolute(relativeResolved)) {
    sendJson(res, 403, { error: "Forbidden" });
    return;
  }

  fs.stat(requestedPath, (err, stats) => {
    if (err) {
      sendJson(res, 404, { error: "Not found" });
      return;
    }

    if (stats.isDirectory()) {
      sendFile(res, path.join(requestedPath, "index.html"));
      return;
    }

    sendFile(res, requestedPath);
  });
}

async function handleRequest(req, res, { allowStatic = true } = {}) {
  const host = req.headers.host || "localhost";
  const requestUrl = new URL(req.url, `http://${host}`);
  const searchParams = requestUrl.searchParams;
  const rawPathname = requestUrl.pathname;
  let pathname = rawPathname;
  if (pathname === "/api") {
    pathname = "/";
  } else if (pathname.startsWith("/api/")) {
    pathname = pathname.slice(4);
  }
  const isApiRequest = rawPathname === "/api" || rawPathname.startsWith("/api/");
  const method = req.method || "GET";

  if (method === "POST" && pathname === "/login") {
    try {
      const body = await parseJsonBody(req);
      const username = sanitizeText(body.username);
      const password = String(body.password || "");

      if (username === STATIC_USERNAME && password === STATIC_PASSWORD) {
        const token = crypto.randomBytes(24).toString("hex");
        sessions.set(token, { username, createdAt: Date.now() });
        sendJson(res, 200, { token });
        return;
      }

      sendJson(res, 401, { error: "Invalid credentials" });
      return;
    } catch (error) {
      sendJson(res, 400, { error: error.message || "Bad request" });
      return;
    }
  }

  if (pathname === "/projects") {
    if (!requireAuth(req, res)) {
      return;
    }

    if (method !== "GET") {
      sendJson(res, 405, { error: "Method not allowed" });
      return;
    }

    const data = readTasksData();
    const projects = getProjects(data);
    sendJson(res, 200, { projects });
    return;
  }

  if (pathname === "/tasks" || pathname.startsWith("/tasks/")) {
    if (!requireAuth(req, res)) {
      return;
    }

    if (method === "GET" && pathname === "/tasks") {
      const data = readTasksData();
      const result = getFilteredTasks(data, {
        view: searchParams.get("view"),
        year: searchParams.get("year"),
        month: searchParams.get("month"),
        projectName: searchParams.get("projectName")
      });

      if (result.error) {
        sendJson(res, 400, { error: result.error });
        return;
      }

      sendJson(res, 200, result);
      return;
    }

    if (method === "POST" && pathname === "/tasks") {
      try {
        const body = await parseJsonBody(req);
        const content = sanitizeText(body.content || body.title || body.projectName);
        const projectName = normalizeProjectName(body.projectName);
        const comments = sanitizeText(
          Object.prototype.hasOwnProperty.call(body, "comments") ? body.comments : body.description
        );
        const status = body.status ? normalizeStatus(body.status) : "pending";
        const dueDateRaw = Object.prototype.hasOwnProperty.call(body, "dueDate") ? body.dueDate : null;
        const dueDate = dueDateRaw ? normalizeIsoDate(dueDateRaw) : null;
        const priority = normalizePriority(body.priority);

        if (!content) {
          sendJson(res, 400, { error: "Task content is required" });
          return;
        }

        if (!status) {
          sendJson(res, 400, { error: "Status must be pending or completed" });
          return;
        }

        if (dueDateRaw && !dueDate) {
          sendJson(res, 400, { error: "Due date must be in YYYY-MM-DD format" });
          return;
        }

        if (!priority) {
          sendJson(res, 400, { error: "Priority must be between 1 and 4" });
          return;
        }

        const bucket = resolveBucket(body, null, null);
        if (bucket.error) {
          sendJson(res, 400, { error: bucket.error });
          return;
        }

        const now = todayDate();
        const task = {
          id: createTaskId(),
          content,
          projectName,
          comments,
          status,
          dueDate,
          priority,
          createdAt: now,
          updatedAt: now,
          title: content,
          description: comments
        };

        const data = readTasksData();
        const monthTasks = getOrCreateMonthBucket(data, bucket.year, bucket.month);
        monthTasks.push(task);
        writeTasksData(data);

        sendJson(res, 201, { task: normalizeTask(task, bucket.year, bucket.month) });
        return;
      } catch (error) {
        sendJson(res, 400, { error: error.message || "Bad request" });
        return;
      }
    }

    const taskIdMatch = pathname.match(/^\/tasks\/([^/]+)$/);
    const taskIdFromQuery =
      (method === "PUT" || method === "DELETE") && pathname === "/tasks"
        ? String(searchParams.get("id") || "").trim()
        : "";
    const taskId =
      taskIdMatch && taskIdMatch[1]
        ? decodeURIComponent(taskIdMatch[1])
        : taskIdFromQuery || null;

    if (taskId) {

      if (method === "PUT") {
        try {
          const body = await parseJsonBody(req);
          const data = readTasksData();
          const location = findTaskById(data, taskId);

          if (!location) {
            sendJson(res, 404, { error: "Task not found" });
            return;
          }

          const current = location.task;
          const next = { ...current };
          let changed = false;

          if (Object.prototype.hasOwnProperty.call(body, "content") || Object.prototype.hasOwnProperty.call(body, "title")) {
            const content = sanitizeText(body.content || body.title);
            if (!content) {
              sendJson(res, 400, { error: "Task content cannot be empty" });
              return;
            }
            next.content = content;
            next.title = content;
            changed = true;
          }

          if (Object.prototype.hasOwnProperty.call(body, "projectName")) {
            next.projectName = normalizeProjectName(body.projectName);
            changed = true;
          }

          if (Object.prototype.hasOwnProperty.call(body, "comments") || Object.prototype.hasOwnProperty.call(body, "description")) {
            const comments = sanitizeText(
              Object.prototype.hasOwnProperty.call(body, "comments") ? body.comments : body.description
            );
            next.comments = comments;
            next.description = comments;
            changed = true;
          }

          if (Object.prototype.hasOwnProperty.call(body, "status")) {
            const status = normalizeStatus(body.status);
            if (!status) {
              sendJson(res, 400, { error: "Status must be pending or completed" });
              return;
            }
            next.status = status;
            changed = true;
          }

          if (Object.prototype.hasOwnProperty.call(body, "priority")) {
            const priority = normalizePriority(body.priority);
            if (!priority) {
              sendJson(res, 400, { error: "Priority must be between 1 and 4" });
              return;
            }
            next.priority = priority;
            changed = true;
          }

          let dueDateTouched = false;
          if (Object.prototype.hasOwnProperty.call(body, "dueDate")) {
            dueDateTouched = true;
            const rawDueDate = body.dueDate;
            if (rawDueDate === null || String(rawDueDate).trim() === "") {
              next.dueDate = null;
            } else {
              const dueDate = normalizeIsoDate(rawDueDate);
              if (!dueDate) {
                sendJson(res, 400, { error: "Due date must be in YYYY-MM-DD format" });
                return;
              }
              next.dueDate = dueDate;
            }
            changed = true;
          }

          if (!changed) {
            sendJson(res, 400, { error: "No updatable fields provided" });
            return;
          }

          const bucketPayload = {
            year: body.year,
            month: body.month,
            dueDate: dueDateTouched ? next.dueDate : next.dueDate || null
          };

          const resolvedBucket = resolveBucket(bucketPayload, location.year, location.month);
          if (resolvedBucket.error) {
            sendJson(res, 400, { error: resolvedBucket.error });
            return;
          }

          next.updatedAt = todayDate();

          const originalYear = location.year;
          const originalMonth = location.month;
          const movingBucket =
            resolvedBucket.year !== originalYear || resolvedBucket.month !== originalMonth;

          if (movingBucket) {
            location.tasks.splice(location.index, 1);
            cleanupEmptyBuckets(data, originalYear, originalMonth);
            const targetTasks = getOrCreateMonthBucket(data, resolvedBucket.year, resolvedBucket.month);
            targetTasks.push(next);
          } else {
            location.tasks[location.index] = next;
          }

          writeTasksData(data);
          sendJson(res, 200, { task: normalizeTask(next, resolvedBucket.year, resolvedBucket.month) });
          return;
        } catch (error) {
          sendJson(res, 400, { error: error.message || "Bad request" });
          return;
        }
      }

      if (method === "DELETE") {
        const data = readTasksData();
        const location = findTaskById(data, taskId);

        if (!location) {
          sendJson(res, 404, { error: "Task not found" });
          return;
        }

        location.tasks.splice(location.index, 1);
        cleanupEmptyBuckets(data, location.year, location.month);
        writeTasksData(data);
        sendJson(res, 200, { message: "Task deleted" });
        return;
      }
    }

    if ((method === "PUT" || method === "DELETE") && pathname === "/tasks") {
      sendJson(res, 400, { error: "Task id is required" });
      return;
    }

    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  if (allowStatic && method === "GET" && !isApiRequest) {
    serveStatic(req, res, pathname);
    return;
  }

  sendJson(res, 404, { error: "Not found" });
}

ensureDataFile();

function createServer() {
  return http.createServer((req, res) => {
    handleRequest(req, res, { allowStatic: true }).catch((error) => {
      if (!res.headersSent) {
        sendJson(res, 500, { error: "Internal server error" });
      }
      console.error("Unhandled request error:", error);
    });
  });
}

if (require.main === module) {
  const server = createServer();
  server.listen(PORT, () => {
    console.log(`Task Manager server running on http://localhost:${PORT}`);
  });
}

module.exports = {
  handleRequest,
  createServer
};
