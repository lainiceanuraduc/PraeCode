import { EventEmitter } from 'node:events';
import { spawn, ChildProcessWithoutNullStreams } from 'node:child_process';
import { JsonRpcTransport } from './JsonRpcTransport';

export interface LaunchOptions { executable: string; args?: string[]; cwd: string; home?: string; }
/** ACP content block: text, or an image the agent turns into a multimodal part. */
export type PromptBlock =
 | {type:'text';text:string}
 | {type:'image';data:string;mimeType:string;uri?:string};
/** ACP mcpServers entries (stdio / http / sse), passed through to session/new untouched. */
export type McpServerSpec = Record<string, unknown>;

/** Owns one ACP viewer process. The Hermes daemon remains Hermes-owned. */
export class AcpClient extends EventEmitter {
  private child?: ChildProcessWithoutNullStreams;
  private rpc?: JsonRpcTransport;
  private connecting?: Promise<any>;
  private initialized?: any;
  permission: (params: any) => Promise<any> = async () => ({ outcome: { outcome: 'cancelled' } });
  constructor(private options: LaunchOptions) { super(); }

  connect(): Promise<any> {
    if (this.initialized) return Promise.resolve(this.initialized);
    if (this.connecting) return this.connecting;
    this.connecting = this.start().finally(() => { this.connecting = undefined; });
    return this.connecting;
  }
  private async start(): Promise<any> {
    const child = spawn(this.options.executable, this.options.args ?? ['acp'], {
      cwd: this.options.cwd, shell: false, windowsHide: true,
      env: { ...process.env, ...(this.options.home ? { HERMES_HOME: this.options.home } : {}) },
      stdio: ['pipe', 'pipe', 'pipe']
    });
    this.child = child;
    const rpc = new JsonRpcTransport(child.stdout, child.stdin, 90_000);
    this.rpc = rpc;
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', text => this.emit('diagnostic', String(text)));
    child.on('error', error => {
      // A missing executable means Hermes is not installed (or the path is wrong); the raw spawn
      // ENOENT tells a user nothing, so name the cause and the fix.
      const code = (error as NodeJS.ErrnoException).code;
      rpc.dispose(code === 'ENOENT'
        ? new Error(`Hermes is not installed at "${this.options.executable}". Install Hermes, or set radcode.hermesPath to the hermes executable.`)
        : error);
    });
    child.on('exit', (code, signal) => rpc.dispose(new Error(`Hermes ACP exited (${signal ?? code})`)));
    rpc.on('diagnostic', message => this.emit('diagnostic', message));
    rpc.on('closed', message => { this.initialized = undefined; this.emit('closed', message); });
    rpc.on('notification', ({method,params}) => { if (method === 'session/update') this.emit('update', params); });
    rpc.handleRequest = async (method, params) => {
      if (method === 'session/request_permission') return this.permission(params);
      throw new Error(`Client capability not advertised: ${method}`);
    };
    try {
      this.initialized = await rpc.request('initialize', {
        protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: 'radcode-hermes', version: '0.1.22' }
      });
      return this.initialized;
    } catch (error) { this.dispose(); throw error; }
  }
  async newSession(cwd: string, mcpServers: McpServerSpec[] = []): Promise<any> {
    await this.connect();
    return this.rpc!.request('session/new', { cwd, mcpServers });
  }
  async loadSession(sessionId: string, cwd: string, mcpServers: McpServerSpec[] = []): Promise<any> {
    const init = await this.connect();
    if (!init.agentCapabilities?.loadSession) throw new Error('This Hermes version does not advertise session loading');
    return this.rpc!.request('session/load', { sessionId, cwd, mcpServers });
  }
  /** Whether the agent advertised image prompts; decided by initialize(), not guessed here. */
  get acceptsImages(): boolean { return !!this.initialized?.agentCapabilities?.promptCapabilities?.image; }
  prompt(sessionId: string, blocks: string | PromptBlock[]): Promise<any> {
    if (!this.initialized) return Promise.reject(new Error('Connect to Hermes first'));
    const prompt = typeof blocks === 'string' ? [{ type: 'text', text: blocks }] : blocks;
    // No client-side turn deadline: cancelling a turn is an explicit protocol action.
    return this.rpc!.request('session/prompt', { sessionId, prompt }, 0);
  }
  setModel(sessionId: string, modelId: string): Promise<any> { return this.rpc!.request('session/set_model', { sessionId, modelId }); }
  setConfig(sessionId: string, configId: string, value: string): Promise<any> { return this.rpc!.request('session/set_config_option', {sessionId,configId,value}); }
  /**
   * ACP modes are Hermes' edit-approval policy (Default/ask, Accept Edits, Don't Ask) and appear in
   * `session/new` as `modes`. This is the same control Zed renders next to the model picker.
   */
  setMode(sessionId: string, modeId: string): Promise<any> { return this.rpc!.request('session/set_mode', {sessionId,modeId}); }
  cancel(sessionId: string): void { this.rpc?.notify('session/cancel', { sessionId }); }
  dispose(): void {
    this.rpc?.dispose(); this.rpc = undefined; this.initialized = undefined;
    const child = this.child; this.child = undefined;
    if (child && child.exitCode === null) {
      child.stdin.end(); child.kill();
      const timer = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }, 2000);
      timer.unref();
    }
  }
}
