import { EventEmitter } from 'node:events';
import { Readable, Writable } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';

type Pending = { resolve(value: any): void; reject(error: Error): void; timer?: NodeJS.Timeout };

/** ACP's newline-delimited JSON-RPC transport; no shell and no stdout logging. */
export class JsonRpcTransport extends EventEmitter {
  private sequence = 0;
  private buffer = '';
  private decoder = new StringDecoder('utf8');
  private pending = new Map<number, Pending>();
  private closed = false;
  handleRequest: (method: string, params: any) => Promise<unknown> = async () => { throw new Error('Unsupported client request'); };

  constructor(private input: Readable, private output: Writable, private timeout = 45_000) {
    super();
    input.on('data', this.onData);
    input.on('end', this.onEnd);
    input.on('error', this.onError);
    output.on('error', this.onError);
  }

  request<T = any>(method: string, params: unknown, timeout = this.timeout): Promise<T> {
    if (this.closed) return Promise.reject(new Error('Hermes connection closed'));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = timeout > 0 ? setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out; its outcome may be unknown. Reconnect before retrying.`));
      }, timeout) : undefined;
      this.pending.set(id, { resolve, reject, timer });
      try { this.send({ jsonrpc: '2.0', id, method, params }); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }

  notify(method: string, params: unknown): void { this.send({ jsonrpc: '2.0', method, params }); }

  private send(message: unknown): void {
    if (this.closed) throw new Error('Hermes connection closed');
    this.output.write(JSON.stringify(message) + '\n');
  }

  private onData = (chunk: Buffer | string): void => {
    this.buffer += typeof chunk === 'string' ? chunk : this.decoder.write(chunk);
    if (this.buffer.length > 8 * 1024 * 1024) return this.dispose(new Error('ACP frame exceeds 8 MiB'));
    let end: number;
    while ((end = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, end).trim(); this.buffer = this.buffer.slice(end + 1);
      if (!line) continue;
      let frame: any;
      try { frame = JSON.parse(line); }
      catch { this.emit('diagnostic', 'Ignored non-JSON ACP stdout line'); continue; }
      if (!frame || frame.jsonrpc !== '2.0') continue;
      if (typeof frame.method === 'string') {
        if (frame.id !== undefined) void this.respond(frame);
        else this.emit('notification', frame);
      } else {
        const request = this.pending.get(frame.id);
        if (!request) continue;
        this.pending.delete(frame.id); clearTimeout(request.timer);
        if (frame.error) request.reject(new Error(frame.error.message || 'ACP request failed'));
        else request.resolve(frame.result);
      }
    }
  };

  private async respond(frame: any): Promise<void> {
    try {
      const result = await this.handleRequest(frame.method, frame.params);
      if (!this.closed) this.send({ jsonrpc: '2.0', id: frame.id, result });
    } catch (error) {
      if (!this.closed) this.send({ jsonrpc: '2.0', id: frame.id, error: { code: -32603, message: String(error) } });
    }
  }
  private onEnd = (): void => this.dispose(new Error('Hermes exited or closed its output'));
  private onError = (error: Error): void => this.dispose(error);

  dispose(error = new Error('Hermes connection closed')): void {
    if (this.closed) return;
    this.closed = true;
    this.input.off('data', this.onData); this.input.off('end', this.onEnd);
    // Keep error listeners until stream close so late process errors stay handled.
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(error); }
    this.pending.clear();
    this.emit('closed', error.message);
  }
}
