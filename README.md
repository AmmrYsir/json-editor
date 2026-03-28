# JSON Editor

A compact web JSON editor built with Bun, Vite, SolidJS, and Tailwind CSS.

## Features

- Multi-tab editing with inline rename and close actions
- Split-screen editing with independent left and right tab focus
- Live JSON validation while typing
- Format and minify actions
- Local storage workspace recovery
- Per-pane search and copy actions
- Compact editor-first UI

## Stack

- Bun
- Vite
- SolidJS
- Tailwind CSS
- TypeScript

## Development

Install dependencies:

```bash
bun install
```

Start the development server:

```bash
bun run dev
```

Create a production build:

```bash
bun run build
```

Preview the production build locally:

```bash
bun run preview
```

The app runs on the default Vite dev server at `http://localhost:5173`.

## Project Structure

```text
src/
  App.tsx           Main editor workspace
  App.css           Workspace-specific styling
  index.css         Global theme and base styles
  lib/workspace.ts  Tab, pane, validation, and local-storage logic
```

## Split Screen Behavior

When split mode is enabled, the editor prefers a different tab for the second pane so both sides can be edited independently. If only one tab exists, the app creates a second tab automatically for the split workspace.

## Notes

- Workspace state is saved to local storage automatically.
- `npm run ...` also works because Vite scripts are defined in `package.json`, but Bun is the intended workflow here.
