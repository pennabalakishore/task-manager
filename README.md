# Task Manager (Todoist-Style)

Personal task manager inspired by modern productivity apps:

- Static login (`admin` / `1234`)
- JSON file persistence (`backend/data/tasks.json`)
- Month-wise storage (`year -> month -> tasks`)
- Sidebar views: `Inbox`, `Today`, `Upcoming`, `Completed`, `Month`
- Projects list with counts (system Inbox is hidden from project list)
- Task fields: `content`, `projectName`, `comments`, `dueDate`, `priority`, `status`

## Run

```bash
npm start
```

Open:

`http://localhost:3000`

## Main API

- `POST /login` -> `{ token }`
- `GET /projects` -> projects with `total/pending/completed` counts
- `GET /tasks?view=inbox|today|upcoming|completed|month&year=YYYY&month=MM&projectName=Work`
- `POST /tasks` body:
  - `content` (required)
  - `projectName` (optional, default `General`)
  - `comments` (optional)
  - `dueDate` (optional, `YYYY-MM-DD`)
  - `priority` (optional, `1-4`)
  - `year` + `month` (optional bucket override)
- `PUT /tasks/:id` updatable:
  - `content`, `projectName`, `comments`, `dueDate`, `priority`, `status`, `year`, `month`
- `DELETE /tasks/:id`
# task-manager
