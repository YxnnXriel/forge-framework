#!/usr/bin/env bun
import { run } from "@forge/cli";

process.exitCode = await run(process.argv.slice(2));
