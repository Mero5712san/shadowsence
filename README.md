# ShadowSense

Privacy-first real-time user behavior analytics and anomaly detection platform.

## Core Flow

1. Website loads ShadowSense SDK
2. SDK tracks page and behavior events
3. Backend stores events in MySQL via Prisma
4. Backend pushes anomaly jobs to BullMQ/Redis
5. Dashboard consumes APIs and Socket.io updates in real-time

## Monorepo Structure

- `backend`: Express API, Socket.io server, BullMQ workers, Prisma models
- `dashboard`: React app for analytics and live monitoring
- `sdk`: Browser SDK to track behavior events
- `extension`: Browser extension for quick session visibility and alert stream

## Quick Start

1. Install dependencies:
   - `npm install`
2. Configure backend environment:
   - Copy `backend/.env.example` to `backend/.env`
   - Set `DATABASE_URL` and `REDIS_URL`
3. Run Prisma migration:
   - `npm run prisma:migrate -w backend`
4. Start backend:
   - `npm run dev:backend`
5. Start dashboard:
   - `npm run dev:dashboard`
6. Build SDK:
   - `npm run build -w sdk`
7. Load extension:
   - Open browser extension page
   - Enable Developer Mode
   - Load unpacked folder `extension`

## API Endpoints

- `POST /api/events` tracks behavior events
- `GET /api/dashboard` returns summary and recent events
- `GET /api/live` returns currently active sessions
- `GET /api/alerts` returns anomaly alerts

## SDK Integration Example

```html
<script type="module">
  import { shadowSense } from "./dist/index.js";
  shadowSense.init({
   apiBaseUrl: "https://shadowsence.onrender.com",
    siteId: "demo-site",
    consent: true
  });
</script>
```

## Privacy Guardrails

- Anonymous IDs are used instead of personal identity
- SDK includes opt-in consent and local opt-out
- Sensitive input data is intentionally not tracked
- Add a consent banner in your product before enabling tracking

## Anomaly Rules Included

- More than 50 clicks in 10 seconds -> bot-like clicking alert
- 5 or more sessions from same IP within 5 minutes -> suspicious IP alert
- 5 or more failed logins in 5 minutes -> brute-force alert

## Resume Pitch

"Built a real-time user behavior analytics platform with a custom JavaScript SDK, event-driven backend, and React dashboard featuring anomaly detection and live session tracking."
