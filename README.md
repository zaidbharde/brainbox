# BrainBox

BrainBox is an all-in-one coding platform shell with:

- Landing page (`frontend/pages/Landing.jsx`)
- Universal IDE (`frontend/pages/StartCoding.jsx`)
- x86 Studio module integration (`frontend/pages/X86Studio.jsx`)
- Turbo C++ lab (`frontend/pages/TurboC.jsx`)
- MATLAB Lab with GNU Octave backend (`frontend/pages/OctaveLab.jsx`)
- Extensible compile API (`backend/routes/compile.js`)

## Structure

```text
brainbox/
├── 8086-studio/
│   ├── src/
│   └── backend/
├── frontend/
│   ├── pages/
│   │   ├── Landing.jsx
│   │   ├── StartCoding.jsx
│   │   ├── TurboC.jsx
│   │   └── OctaveLab.jsx
│   │   └── X86Studio.jsx
│   ├── components/
│   │   └── Header.jsx
│   ├── styles/
│   │   └── globals.css
│   └── src/
│       ├── App.jsx
│       └── main.jsx
├── backend/
│   ├── routes/
│   │   ├── compile.js
│   │   └── octaveLab.js
│   └── services/
│       ├── octaveLabService.js
│       └── runners/
└── README.md
```

## Run

### Quick start (recommended)

From project root:

```bash
./brainbox/dev-up.sh
```

Stop all:

```bash
./brainbox/dev-down.sh
```

### 1) Backend

```bash
cd backend
npm install
npm run dev
```

Backend starts on `http://localhost:4100`.
Octave API endpoint: `POST /api/run-octave`

### 2) Frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend starts on `http://localhost:5174` and proxies `/api/*` to backend.

For Turbo C++, optional environment variable:

```bash
VITE_TURBOC_BUNDLE_URL=<your-jsdos-bundle-url>
```

### 3) x86 Studio integration

`x86 Studio` opens directly in full-screen mode at `http://localhost:5173`.

Optionally set a different URL in `frontend/.env`:

```bash
VITE_X86_STUDIO_URL=http://localhost:5173
```

## Compile API contract

`POST /api/compile`

```json
{
  "language": "javascript",
  "code": "console.log('hello')",
  "stdin": ""
}
```

Response:

```json
{
  "success": true,
  "output": "hello",
  "error": ""
}
```

Current implementation supports JavaScript (VM), Python, C, C++, and Java via local system runtimes/compilers.
If a compiler/runtime is missing on your machine, API returns an install hint in `error`.
