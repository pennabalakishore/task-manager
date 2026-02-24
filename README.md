# Task Manager (Todoist-Style)

Personal task manager inspired by modern productivity apps:

- Static login (`admin` / `1234`)
- Month-wise organization (`year -> month -> tasks`)
- Sidebar views: `Inbox`, `Today`, `Upcoming`, `Completed`, `Month`
- Project list and quick task management
- Task fields: `content`, `projectName`, `comments`, `dueDate`, `priority`, `status`

## Local Run

```bash
npm start
```

Open:

`http://localhost:3000`

## API (Current Frontend Uses `/api/*`)

- `POST /api/login` -> `{ token }`
- `GET /api/projects` -> project counts
- `GET /api/tasks?view=inbox|today|upcoming|completed|month&year=YYYY&month=MM&projectName=Work`
- `POST /api/tasks`
- `PUT /api/tasks?id=<taskId>`
- `DELETE /api/tasks?id=<taskId>`

## Deploy To Vercel

1. Push this repo to GitHub/GitLab/Bitbucket.
2. Import the repo in Vercel.
3. Vercel will run `npm run build` (configured in `vercel.json`) and publish `public/` + `api/`.
4. Deploy.

Recommended Vercel Environment Variables:

- `AUTH_TOKEN_SECRET` -> long random string (required for stable secure login tokens)
- `AUTH_TOKEN_TTL_SECONDS` -> optional (default `1209600`, i.e. 14 days)

CLI alternative:

```bash
npm i -g vercel
vercel
vercel --prod
```

## Important Note About Data On Vercel

This app currently uses file storage. On Vercel, writable storage is only temporary (`/tmp`), so task data is **not guaranteed to persist** across cold starts/redeployments.

If you want real persistence on Vercel, I can migrate storage to Vercel Blob or KV while keeping the same UI/API behavior.
