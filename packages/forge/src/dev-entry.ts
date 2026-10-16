// Child process of `forge dev`: the app from source, in development mode.
import { startApp } from "./app.ts";

await startApp({ root: process.argv[2] ?? process.cwd(), dev: true });
