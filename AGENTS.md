# Repository Guidelines

## Project Structure & Module Organization
This repository is a Vite + SolidJS + TypeScript app. Application code lives in `src/`, with `src/index.tsx` bootstrapping the app and `src/App.tsx` holding the main UI. Component-level styles sit next to the app in `src/App.css`, while shared global styles live in `src/index.css`. Put bundled images and imported assets in `src/assets/`. Put static files that should be served as-is, such as `icons.svg`, in `public/`.

## Build, Test, and Development Commands
Use the package manager already in use for the branch; `npm` is the documented default.

- `npm install`: install dependencies.
- `npm run dev`: start the local Vite dev server at `http://localhost:5173`.
- `npm run build`: run TypeScript project checks with `tsc -b`, then produce a production build in `dist/`.
- `npm run preview`: serve the built app locally to verify the production bundle.

## Coding Style & Naming Conventions
Follow the existing style: TypeScript, ES modules, and Solid function components. Use 2-space indentation, semicolon-free statements, and single quotes where the current files do. Name components and files in PascalCase when they export a component, and keep utility or entry files lowercase where established, such as `index.tsx`. Keep CSS selectors readable and colocated with the component they style unless the rule is global.

## Testing Guidelines
There is no committed test runner yet. Until one is added, treat `npm run build` as the minimum pre-PR validation step. When adding tests, place them next to the code they cover or under `src/` using `*.test.ts` or `*.test.tsx` naming so they are easy to discover and wire into the toolchain later.

## Commit & Pull Request Guidelines
The current history starts with a terse `init commit`, so prefer short, imperative commit messages that are more descriptive, for example `feat: add JSON input panel` or `fix: guard empty state rendering`. Keep commits focused. PRs should include a clear summary, testing notes, linked issues when relevant, and screenshots or short recordings for UI changes.

## Assets & Configuration
Do not commit build output or secrets. Keep generated files out of source control, respect `.gitignore`, and review `vite.config.ts` and `tsconfig*.json` before introducing new aliases or build-time behavior.
