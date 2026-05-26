# SiteBot Frontend

Next.js 16 (App Router) + TypeScript + Tailwind CSS v4 + shadcn/ui dashboard
for the SiteBot project.

## Prerequisites

- Node.js 20+ and npm 10+
- The SiteBot FastAPI backend running at `http://localhost:8000`
  (see the repo root `README.md` for backend setup)

## Setup

```bash
cd frontend
npm install
cp .env.example .env.local      # edit values if needed
npm run dev
```

The app starts on http://localhost:3000.

## Environment variables

`.env.local` (gitignored) holds local secrets. `.env.example` is the
committed template.

| Variable               | Default                 | Purpose                                |
| ---------------------- | ----------------------- | -------------------------------------- |
| `NEXT_PUBLIC_API_URL`  | `http://localhost:8000` | Base URL of the SiteBot backend        |
| `NEXT_PUBLIC_API_KEY`  | _(none)_                | Sent as `X-API-Key` on every request   |

## Scripts

| Script          | What it does                          |
| --------------- | ------------------------------------- |
| `npm run dev`   | Start the dev server with Turbopack   |
| `npm run build` | Production build                      |
| `npm run start` | Serve the production build            |
| `npm run lint`  | ESLint over the project               |

## File structure

```
frontend/
  app/                 # App Router routes
    layout.tsx         # Root layout (Inter font, ThemeProvider, Toaster)
    page.tsx           # Landing page
    dashboard/         # /dashboard (placeholder, fleshed out on Day 3)
    globals.css        # Tailwind v4 entry + design tokens + brand-gradient
  components/
    theme-provider.tsx # next-themes wrapper
    theme-toggle.tsx   # light/dark/system dropdown
    ui/                # shadcn/ui primitives
  lib/
    brand.ts           # BRAND constant — never hardcode the name elsewhere
    api.ts             # Typed fetch client for the FastAPI backend
    utils.ts           # cn() helper from shadcn
  .env.local           # local secrets (gitignored)
  .env.example         # committed env template
```

## Backend dependency

This frontend assumes the FastAPI backend is reachable at
`NEXT_PUBLIC_API_URL`. With the backend down, the landing page still loads,
but any API call (bot creation, status, chat) will throw `ApiError`.

Start the backend from the repo root:

```bash
uvicorn api.main:app --reload
```
