/**
 * VS Code extension host for the Blinkk Agent Platform Chat Connector connector.
 *
 * This extension registers a NATIVE VS Code Language Model Chat Provider that
 * talks directly to Vertex AI from the extension host. There is no local HTTP
 * proxy, no BYOK `chatLanguageModels.json`, and no launchd service: the
 * provider streams chat + tool-calling straight to Gemini and Claude using your
 * own gcloud credentials (ADC, or the connector's isolated credential store).
 *
 * Models appear under "Manage Models…" in the Copilot model picker, grouped by
 * the provider vendor declared in package.json
 * (`contributes.languageModelChatProviders`).
 *
 * Credentials come from gcloud; the extension never embeds secrets.
 */

import * as vscode from 'vscode';

import {ISOLATED_GCLOUD_DIR, displayName, findModel} from './catalog.ts';
import type {AuthMode, ModelDef} from './catalog.ts';
import {
  formatUsd,
  getTodayUsage,
  recordUsage,
  usageListeners,
} from './usage.ts';
import {
  applyConfigOverrides,
  config as connectorConfig,
  getModels,
  logListeners,
  runCheck,
  setCustomModels,
  streamChat,
} from './vertex.ts';
import type {
  NormMessage,
  NormRequest,
  NormToolCall,
  NormToolResult,
  ResolvedConfig,
} from './vertex.ts';

const VENDOR = 'blinkk-google-agent-platform';
const SETTINGS_SECTION = 'blinkkAgentPlatformConnector';

let output: vscode.OutputChannel;
let statusBar: vscode.StatusBarItem;

/** Read overrides from VS Code settings (empty values are ignored downstream). */
function readSettingsOverrides(): Partial<ResolvedConfig> {
  const cfg = vscode.workspace.getConfiguration(SETTINGS_SECTION);
  return {
    project: cfg.get<string>('project') || undefined,
    geminiLocation: cfg.get<string>('geminiLocation') || undefined,
    claudeLocation: cfg.get<string>('claudeLocation') || undefined,
    authMode: cfg.get<AuthMode>('authMode') || undefined,
    authAccount: cfg.get<string>('authAccount') || undefined,
    debug: cfg.get<boolean>('debug'),
  };
}

/** Read the raw `customModels` setting (validated downstream in setCustomModels). */
function readCustomModels(): unknown {
  return vscode.workspace
    .getConfiguration(SETTINGS_SECTION)
    .get('customModels');
}

function renderStatusBar(): void {
  const hasProject = Boolean(connectorConfig.project);
  statusBar.text = hasProject
    ? '$(sparkle) Agent Platform Chat Connector'
    : '$(warning) Agent Platform Chat Connector';

  const account = connectorConfig.authAccount;
  const models = getModels();
  const usage = getTodayUsage();
  const lines: string[] = [
    '**Blinkk Agent Platform Chat Connector**',
    '',
    hasProject
      ? `- $(project) Project: \`${connectorConfig.project}\``
      : '- $(warning) Project: not set — configure `blinkkAgentPlatformConnector.project`',
    `- $(key) Auth: \`${connectorConfig.authMode}\`${account ? ` (\`${account}\`)` : ''}`,
    `- $(globe) Gemini: \`${connectorConfig.geminiLocation}\` · Claude: \`${connectorConfig.claudeLocation}\``,
    `- $(graph) Today's estimated cost: \`${formatUsd(usage.costUsd)}\` (${usage.requests} req)`,
    '',
    `**Models** (${models.length})`,
    ...models.map((m) => `- $(sparkle) ${m.name}`),
    '',
    '$(gear) [Settings](command:googleAgentPlatform.openSettings) · $(output) [Show logs](command:googleAgentPlatform.showLogs) · $(sign-in) [Sign in](command:googleAgentPlatform.signIn) · $(check) [Check models](command:googleAgentPlatform.check)',
  ];

  const tooltip = new vscode.MarkdownString(lines.join('\n'));
  tooltip.isTrusted = true;
  tooltip.supportThemeIcons = true;
  statusBar.tooltip = tooltip;
  statusBar.show();
}

/**
 * QuickPick shown when the status bar item is clicked. VS Code only reveals the
 * hover tooltip on hover (there is no API to pop it on click), so clicking opens
 * this menu with the same status info plus the same actions.
 */
async function showStatusMenu(): Promise<void> {
  const account = connectorConfig.authAccount;
  const info: vscode.QuickPickItem[] = [
    {
      label: connectorConfig.project
        ? `$(project) Project: ${connectorConfig.project}`
        : '$(warning) Project: not set',
      kind: vscode.QuickPickItemKind.Default,
    },
    {
      label: `$(key) Auth: ${connectorConfig.authMode}${account ? ` (${account})` : ''}`,
    },
    {
      label: `$(globe) Gemini: ${connectorConfig.geminiLocation} · Claude: ${connectorConfig.claudeLocation}`,
    },
    {
      label: `$(sparkle) Models: ${getModels()
        .map((m) => m.name)
        .join(', ')}`,
    },
    {
      label: `$(graph) Today's estimated cost: ${formatUsd(
        getTodayUsage().costUsd
      )} (${getTodayUsage().requests} req)`,
    },
  ];
  const actions: (vscode.QuickPickItem & {command: string})[] = [
    {
      label: '$(gear) Settings',
      detail: 'Open the connector settings',
      command: 'googleAgentPlatform.openSettings',
    },
    {
      label: '$(output) Show logs',
      detail: 'Reveal the output channel',
      command: 'googleAgentPlatform.showLogs',
    },
    {
      label: '$(sign-in) Sign in (isolated credentials)',
      detail: "Populate the connector's isolated gcloud store",
      command: 'googleAgentPlatform.signIn',
    },
    {
      label: '$(check) Check models',
      detail: 'Probe the configured models against Vertex',
      command: 'googleAgentPlatform.check',
    },
  ];

  const picked = await vscode.window.showQuickPick(
    [
      {label: 'Status', kind: vscode.QuickPickItemKind.Separator},
      ...info,
      {label: 'Actions', kind: vscode.QuickPickItemKind.Separator},
      ...actions,
    ],
    {
      title: 'Blinkk Agent Platform Chat Connector',
      placeHolder: 'Connector status and actions',
    }
  );
  const command = (picked as {command?: string} | undefined)?.command;
  if (command) await vscode.commands.executeCommand(command);
}

/* -------------------------------------------------------------------------- */
/* Message conversion: VS Code -> normalized                                  */
/* -------------------------------------------------------------------------- */

/** Extract plain text from a tool-result part's content array. */
function toolResultText(part: vscode.LanguageModelToolResultPart): string {
  const out: string[] = [];
  for (const piece of part.content) {
    if (piece instanceof vscode.LanguageModelTextPart) {
      out.push(piece.value);
    } else if (typeof piece === 'string') {
      out.push(piece);
    } else {
      try {
        out.push(JSON.stringify(piece));
      } catch {
        /* skip unserializable */
      }
    }
  }
  return out.join('');
}

/** Convert VS Code request messages into the connector's normalized shape. */
function toNormMessages(
  messages: readonly vscode.LanguageModelChatRequestMessage[]
): NormMessage[] {
  const result: NormMessage[] = [];
  for (const msg of messages) {
    const isAssistant =
      msg.role === vscode.LanguageModelChatMessageRole.Assistant;
    const role: NormMessage['role'] = isAssistant ? 'assistant' : 'user';

    let text = '';
    const toolCalls: NormToolCall[] = [];
    const toolResults: NormToolResult[] = [];

    for (const part of msg.content) {
      if (part instanceof vscode.LanguageModelTextPart) {
        text += part.value;
      } else if (part instanceof vscode.LanguageModelToolCallPart) {
        toolCalls.push({
          id: part.callId,
          name: part.name,
          input: part.input,
        });
      } else if (part instanceof vscode.LanguageModelToolResultPart) {
        toolResults.push({
          callId: part.callId,
          content: toolResultText(part),
        });
      }
    }

    // Tool results must travel as their own user-role turn so the upstream
    // request keeps assistant tool_use -> user tool_result adjacency intact.
    if (toolResults.length) {
      result.push({role: 'user', toolResults});
    }
    if (text || toolCalls.length) {
      result.push({
        role,
        text: text || undefined,
        toolCalls: toolCalls.length ? toolCalls : undefined,
      });
    }
  }
  return result;
}

function toNormTools(
  options: vscode.ProvideLanguageModelChatResponseOptions
): Pick<NormRequest, 'tools' | 'toolMode'> {
  const tools = options.tools?.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema as object | undefined,
  }));
  const toolMode =
    options.toolMode === vscode.LanguageModelChatToolMode.Required
      ? ('required' as const)
      : ('auto' as const);
  return {tools, toolMode};
}

/**
 * VS Code injects internal bookkeeping fields into `modelOptions` (e.g.
 * `_capturingTokenCorrelationId`). These get spread into the upstream request
 * body, and Vertex/Anthropic reject unknown fields ("Extra inputs are not
 * permitted"). Drop any `_`-prefixed keys before they reach the wire.
 */
function sanitizeModelOptions(
  modelOptions: unknown
): Record<string, unknown> | undefined {
  if (!modelOptions || typeof modelOptions !== 'object') return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(
    modelOptions as Record<string, unknown>
  )) {
    if (!k.startsWith('_')) out[k] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

/* -------------------------------------------------------------------------- */
/* Provider                                                                   */
/* -------------------------------------------------------------------------- */

class GoogleAgentPlatformProvider implements vscode.LanguageModelChatProvider {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  /** Fired when model metadata changes (e.g. the project in display names). */
  readonly onDidChangeLanguageModelChatInformation = this._onDidChange.event;

  /** Signal VS Code to re-query model information (labels, etc.). */
  refresh(): void {
    this._onDidChange.fire();
  }

  dispose(): void {
    this._onDidChange.dispose();
  }

  async provideLanguageModelChatInformation(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _options: {readonly silent: boolean},
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelChatInformation[]> {
    return getModels().map((m) => this.toChatInformation(m));
  }

  private toChatInformation(m: ModelDef): vscode.LanguageModelChatInformation {
    return {
      id: m.id,
      name: displayName(m, connectorConfig.project),
      family: m.api === 'messages' ? 'claude' : 'gemini',
      version: '1.0.0',
      maxInputTokens: m.maxInputTokens,
      maxOutputTokens: m.maxOutputTokens,
      capabilities: {
        imageInput: Boolean(m.vision),
        toolCalling: true,
      },
    };
  }

  async provideLanguageModelChatResponse(
    model: vscode.LanguageModelChatInformation,
    messages: readonly vscode.LanguageModelChatRequestMessage[],
    options: vscode.ProvideLanguageModelChatResponseOptions,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken
  ): Promise<void> {
    const def = findModel(model.id, getModels());
    if (!def) {
      throw new Error(
        `Unknown model "${model.id}". Re-enable it under Manage Models, or ` +
          'check your "customModels" setting.'
      );
    }

    const controller = new AbortController();
    const cancelSub = token.onCancellationRequested(() => controller.abort());

    const req: NormRequest = {
      messages: toNormMessages(messages),
      maxOutputTokens: def.maxOutputTokens,
      modelOptions: sanitizeModelOptions(options.modelOptions),
      ...toNormTools(options),
    };

    try {
      for await (const evt of streamChat(def, req, controller.signal)) {
        if (token.isCancellationRequested) break;
        if (evt.type === 'text') {
          progress.report(new vscode.LanguageModelTextPart(evt.text));
        } else if (evt.type === 'usage') {
          recordUsage(def, evt.inputTokens, evt.outputTokens);
        } else {
          progress.report(
            new vscode.LanguageModelToolCallPart(
              evt.id,
              evt.name,
              (evt.input ?? {}) as object
            )
          );
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      output.appendLine(`[provider] ${model.id} error: ${message}`);
      throw err;
    } finally {
      cancelSub.dispose();
    }
  }

  async provideTokenCount(
    _model: vscode.LanguageModelChatInformation,
    text: string | vscode.LanguageModelChatRequestMessage,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _token: vscode.CancellationToken
  ): Promise<number> {
    // Vertex exposes no client-side tokenizer; approximate at ~4 chars/token.
    let chars = 0;
    if (typeof text === 'string') {
      chars = text.length;
    } else {
      for (const part of text.content) {
        if (part instanceof vscode.LanguageModelTextPart) {
          chars += part.value.length;
        } else if (part instanceof vscode.LanguageModelToolResultPart) {
          chars += toolResultText(part).length;
        } else if (part instanceof vscode.LanguageModelToolCallPart) {
          chars += JSON.stringify(part.input ?? {}).length + part.name.length;
        }
      }
    }
    return Math.max(1, Math.ceil(chars / 4));
  }
}

/* -------------------------------------------------------------------------- */
/* Activation                                                                 */
/* -------------------------------------------------------------------------- */

export function activate(context: vscode.ExtensionContext): void {
  output = vscode.window.createOutputChannel(
    'Blinkk Agent Platform Chat Connector'
  );
  context.subscriptions.push(output);

  const sink = (line: string) => output.appendLine(line);
  logListeners.push(sink);
  context.subscriptions.push({
    dispose: () => {
      const i = logListeners.indexOf(sink);
      if (i >= 0) logListeners.splice(i, 1);
    },
  });

  // Apply VS Code settings over file/default config before anything reads it.
  applyConfigOverrides(readSettingsOverrides());
  setCustomModels(readCustomModels());

  statusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  // Hover reveals the info tooltip; clicking opens the same info as a menu.
  statusBar.command = 'googleAgentPlatform.showMenu';
  context.subscriptions.push(statusBar);
  renderStatusBar();

  // Refresh the status bar whenever usage/cost is recorded.
  const usageSink = () => renderStatusBar();
  usageListeners.push(usageSink);
  context.subscriptions.push({
    dispose: () => {
      const i = usageListeners.indexOf(usageSink);
      if (i >= 0) usageListeners.splice(i, 1);
    },
  });

  const provider = new GoogleAgentPlatformProvider();
  context.subscriptions.push(
    provider,
    vscode.lm.registerLanguageModelChatProvider(VENDOR, provider)
  );

  // Re-apply config when the user edits settings; refresh model labels.
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration(SETTINGS_SECTION)) return;
      applyConfigOverrides(readSettingsOverrides());
      setCustomModels(readCustomModels());
      renderStatusBar();
      provider.refresh();
      output.appendLine(
        `[extension] settings updated (project ${connectorConfig.project}, ` +
          `auth ${connectorConfig.authMode})`
      );
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'googleAgentPlatform.showMenu',
      showStatusMenu
    ),
    vscode.commands.registerCommand('googleAgentPlatform.openSettings', () =>
      vscode.commands.executeCommand(
        'workbench.action.openSettings',
        SETTINGS_SECTION
      )
    ),
    vscode.commands.registerCommand('googleAgentPlatform.showLogs', () =>
      output.show(true)
    ),
    vscode.commands.registerCommand('googleAgentPlatform.signIn', () => {
      // Runs gcloud directly in a terminal (no npm package needed). The exact
      // command depends on the configured auth mode:
      //   - adc:      refresh your global Application Default Credentials.
      //   - isolated: log into the connector's own CLOUDSDK_CONFIG store,
      //               decoupled from your global ADC.
      const scopes =
        'openid,https://www.googleapis.com/auth/userinfo.email,' +
        'https://www.googleapis.com/auth/cloud-platform';
      const account = connectorConfig.authAccount
        ? ` --account=${connectorConfig.authAccount}`
        : '';
      const isolated = connectorConfig.authMode === 'isolated';

      const term = vscode.window.createTerminal({
        name: 'Blinkk Agent Platform Chat Connector sign-in',
        env: isolated ? {CLOUDSDK_CONFIG: ISOLATED_GCLOUD_DIR} : undefined,
      });
      term.show(true);
      term.sendText(
        isolated
          ? `mkdir -p '${ISOLATED_GCLOUD_DIR}' && ` +
              `gcloud auth login --update-adc --brief${account}`
          : `gcloud auth application-default login --scopes="${scopes}"${account}`
      );
    }),
    vscode.commands.registerCommand('googleAgentPlatform.check', async () => {
      output.show(true);
      output.appendLine('[extension] probing models against Vertex…');
      try {
        await runCheck();
        output.appendLine('[extension] model check complete');
      } catch (e) {
        output.appendLine(
          `[extension] model check failed: ${e instanceof Error ? e.message : e}`
        );
      }
    })
  );

  output.appendLine(
    `[extension] registered ${getModels().length} models under vendor ` +
      `"${VENDOR}" (project ${connectorConfig.project}, ` +
      `auth ${connectorConfig.authMode})`
  );
}

export function deactivate(): void {
  /* Disposables registered on the context handle cleanup. */
}
