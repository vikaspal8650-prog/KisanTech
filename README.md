# Fasal Guru — Smart Farming Assistant

Phase 1 foundation for the Fasal Guru hackathon MVP. It includes a React + Vite client and a Node.js + Express API.

## Prerequisites

- Node.js 20 or newer
- npm

## Run locally (Windows PowerShell)

Open two PowerShell windows from the repository root.

```powershell
cd "C:\Users\vikas\OneDrive\ドキュメント\ChatGPT\FasalGuruTech"
cd server
npm run dev
```

```powershell
cd "C:\Users\vikas\OneDrive\ドキュメント\ChatGPT\FasalGuruTech"
cd client
npm run dev
```

Then open the URL shown by Vite (normally `http://localhost:5173`). The frontend proxies `/api` requests to the backend at `http://localhost:5000`.

## Available scripts

- `server/npm run dev` — starts the API with automatic restart.
- `server/npm start` — starts the API normally.
- `client/npm run dev` — starts the Vite development server.
- `client/npm run build` — creates a production build in `client/dist`.
- `client/npm run preview` — previews the production build locally.

## API

`GET /api/health` returns the current health status of the backend.

## Environment configuration

Copy `server/.env.example` to `server/.env` to override the backend port. Do not commit `.env` files.
