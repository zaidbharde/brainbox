# x86 Studio (BrainBox Module)

This module is the full-screen 8086 Studio app used by BrainBox.

## Changes applied

- Firebase removed
- Login/signup removed
- User database persistence removed
- History UI removed
- App opens directly to x86 Studio landing page

## Run

```bash
cd brainbox/8086-studio
npm install
npm run dev -- --port 5173
```

x86 Studio runs at `http://localhost:5173`.

## Engines

The lab runs one of two 8086 engines. The legacy one in `src/emulator/` is the
default and is unchanged; the new one in `src/engine/` is selected with a URL
parameter:

```
http://localhost:5173/?engine=v2
```

The **Run** button uses the selected engine. The debugger is still legacy-only.

- [`docs/HANDOFF.md`](docs/HANDOFF.md) — how the two engines are joined, what is
  verified, and what is left
- [`docs/engine-v2-divergences.md`](docs/engine-v2-divergences.md) — every place the
  two engines differ, and which of them is right

## Test

```bash
npm test
```
