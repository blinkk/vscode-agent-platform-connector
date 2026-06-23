#!/usr/bin/env node
/**
 * google-agent-platform-connector
 *
 * Maintenance CLI for the Google Agent Platform connector. The connector now
 * runs as a native VS Code Language Model Chat Provider (see the bundled
 * extension), so there is no server to start — this CLI only manages
 * credentials and verifies connectivity. Executed directly by Node >=24, which
 * strips TypeScript types natively.
 *
 *   google-agent-platform-connector --login         # isolated gcloud sign-in
 *   google-agent-platform-connector --check         # probe token + models
 *   google-agent-platform-connector --print-config  # show effective config
 *   google-agent-platform-connector --proxy         # serve Claude to Copilot CLI
 */

import {startCliProxy} from '../src/cli-proxy.ts';
import {printConfig, runCheck, runLogin} from '../src/vertex.ts';

const argv = process.argv.slice(2);

if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
  console.log(
    `google-agent-platform-connector — Google Agent Platform (Vertex AI) connector CLI

The chat models are served by the bundled VS Code extension (a native Language
Model Chat Provider). This CLI manages credentials and connectivity only.

Usage:
  google-agent-platform-connector --login         Sign in to the connector's own isolated
                                                  credential store (independent of your global
                                                  gcloud/ADC), then exit
  google-agent-platform-connector --check         Probe access token + all models, then exit
  google-agent-platform-connector --print-config  Print effective config
  google-agent-platform-connector --proxy         Run a local Anthropic-compatible proxy so
                                                  GitHub Copilot CLI can use Claude on Vertex
                                                  (keeps running until interrupted)
  google-agent-platform-connector --help          Show this help`,
  );
  process.exit(0);
} else if (argv.includes('--proxy')) {
  startCliProxy().catch((e: unknown) => {
    console.error('proxy failed:', e instanceof Error ? e.message : e);
    process.exit(1);
  });
  // Intentionally do not exit: the proxy runs until the process is interrupted.
} else if (argv.includes('--login')) {
  runLogin()
    .then(() => process.exit(0))
    .catch((e: unknown) => {
      console.error('login failed:', e instanceof Error ? e.message : e);
      process.exit(1);
    });
} else if (argv.includes('--print-config')) {
  printConfig();
  process.exit(0);
} else if (argv.includes('--check')) {
  runCheck()
    .then(() => process.exit(0))
    .catch((e: unknown) => {
      console.error('check failed:', e instanceof Error ? e.message : e);
      process.exit(1);
    });
} else {
  console.error(`unknown argument: ${argv.join(' ')}`);
  console.error('run with --help to see available commands');
  process.exit(1);
}
