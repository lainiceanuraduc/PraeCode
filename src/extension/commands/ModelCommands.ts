/**
 * Model and provider commands: the picker, favorites, per-model facts and the "+ Provider" form.
 *
 * Everything that writes configuration goes through the bridge (Hermes' own `save_config`); the
 * webview's values are re-validated here because the webview is not trusted.
 */
import * as vscode from 'vscode';
import {normalizeProviderId, providerDraftErrors} from '../../domain/ProviderDraft';
import {toggleFavorite} from '../../domain/ModelCatalog';
import type {ExtensionHost} from '../host';
import type {SessionCommands} from './SessionCommands';

export class ModelCommands {
  constructor(
    private readonly host: ExtensionHost,
    private readonly sessions: SessionCommands
  ) {}

  /** Open the picker modal; a command-palette call can arrive before the view ever mounted. */
  async openPicker(id?: string): Promise<void> {
    const session = id ? this.host.controller.get(id) : this.host.controller.active;
    if (!session) throw new Error('Create a conversation first');
    await this.host.view.open();
    await this.sessions.awaitViewReady();
    this.host.publish();
    this.host.view.post({type: 'openModelPicker'});
  }

  /** Favorites are extension state, bounded: a convenience list, not a catalog. */
  favorites(): string[] {
    return this.host.context.globalState.get<string[]>('radcode.favoriteModels', [])
      .filter(id => typeof id === 'string' && id.length <= 400)
      .slice(0, 200);
  }

  postFavorites(): void {
    this.host.view.post({type: 'favorites', ids: this.favorites()});
  }

  async setFavorite(message: Record<string, any>): Promise<void> {
    const id = typeof message.id === 'string' ? message.id.trim() : '';
    if (!id || id.length > 400) throw new Error('Invalid model identifier');
    const current = this.favorites();
    const next = message.on === true ? toggleFavorite(current.filter(entry => entry !== id), id) : current.filter(entry => entry !== id);
    await this.host.context.globalState.update('radcode.favoriteModels', next);
    this.host.view.post({type: 'favorites', ids: next});
  }

  /** Details for a row selected in the modal: lab, context window, effort ladder. */
  async readInfo(message: Record<string, any>): Promise<void> {
    const provider = typeof message.provider === 'string' ? message.provider.slice(0, 200) : '';
    const model = typeof message.model === 'string' ? message.model.slice(0, 300) : '';
    if (!model) throw new Error('Choose a model first');
    // A base URL is never taken from the webview: the bridge resolves the provider's own endpoint.
    this.host.view.post({type: 'modelDetails', details: await this.host.controller.control.modelInfo(provider, model)});
  }

  /** Provider facts for the picker; a provider without a model list is a log line, not a dialog. */
  async readFacts(): Promise<void> {
    try {
      const {models} = await this.host.controller.control.mistralModels();
      this.host.view.post({type: 'modelFacts', models});
    } catch (error) {
      this.host.output.appendLine(`Model facts unavailable: ${String(error)}`);
      this.host.view.post({type: 'modelFacts', models: []});
    }
  }

  async saveProvider(message: Record<string, any>): Promise<void> {
    const draft = {
      id: String(message.id ?? ''),
      label: String(message.label ?? ''),
      baseUrl: String(message.baseUrl ?? ''),
      apiKey: String(message.apiKey ?? ''),
      defaultModel: String(message.defaultModel ?? '')
    };
    const errors = providerDraftErrors(draft);
    if (errors.length) throw new Error(errors[0].message);
    const result = await this.host.controller.control.saveProvider({...draft, id: normalizeProviderId(draft.id)});
    this.host.view.post({type: 'providerSaved', result});
    void vscode.window.showInformationMessage(
      `Provider “${result.label}” saved to Hermes. Open a new conversation to use it.`, 'New conversation'
    ).then(choice => {
      if (choice) void this.sessions.newSession();
    });
  }

  async testProvider(message: Record<string, any>): Promise<void> {
    const baseUrl = String(message.baseUrl ?? '').trim();
    if (!baseUrl) throw new Error('Enter the endpoint base URL first');
    const result = await this.host.controller.control.testProvider(baseUrl, String(message.apiKey ?? ''));
    this.host.view.post({type: 'providerTest', result});
  }

  /** Manual provider + model entry for an id Hermes did not list. */
  async pickManual(id?: string): Promise<void> {
    const controller = this.host.controller;
    const session = id ? controller.get(id) : controller.active;
    if (!session) throw new Error('Create a conversation first');
    if (session.busy) throw new Error('Wait for the turn to finish before changing models');
    const provider = await vscode.window.showInputBox({
      title: 'Provider ID',
      prompt: 'Existing Hermes provider (e.g. mistral, ollama-cloud, openrouter, openai-codex, anthropic). Credentials stay in Hermes.',
      value: session.info?.provider ?? ''
    });
    if (provider === undefined) return;
    const model = await vscode.window.showInputBox({
      title: 'Model ID',
      prompt: 'Exact model ID supported by this provider',
      value: session.info?.model ?? ''
    });
    if (!model) return;
    await controller.setModel(session.id, model.trim(), provider.trim());
    this.host.publish();
  }
}
