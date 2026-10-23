import { randomUUID } from 'node:crypto';
export interface Storage { get(key: string, fallback: any): any; update(key: string, value: any): PromiseLike<void>; }
export interface AgentPreset { id: string; name: string; provider: string; model: string; effort: string; instructions: string; }
export const EFFORTS = ['default','none','minimal','low','medium','high','xhigh','max'];

/** Extension-local worker templates. Credentials stay exclusively with Hermes. */
export class PresetRepository {
  constructor(private storage: Storage) {}
  list(): AgentPreset[] { return this.storage.get('workerPresets', []).map((p:AgentPreset)=>({...p})); }
  async save(input: Partial<AgentPreset>): Promise<AgentPreset> {
    const name = String(input.name ?? '').trim();
    if (!name || name.length > 60) throw new Error('Agent name must contain 1–60 characters');
    const effort = String(input.effort ?? 'default');
    if (!EFFORTS.includes(effort)) throw new Error('Invalid reasoning effort');
    const instructions = String(input.instructions ?? '').trim();
    if (instructions.length > 16_000) throw new Error('Instructions exceed 16000 characters');
    const model = String(input.model ?? '').trim(), provider = String(input.provider ?? '').trim();
    for (const value of [model,provider]) if (value.length > 200 || /[\r\n\0]/.test(value)) throw new Error('Invalid provider/model identifier');
    const presets = this.list();
    const existing = input.id ? presets.find(p => p.id === input.id) : undefined;
    if (input.id && !existing) throw new Error('Preset no longer exists');
    const preset = {id:existing?.id ?? randomUUID(),name,provider,model,effort,instructions};
    const next = existing ? presets.map(p => p.id === preset.id ? preset : p) : [...presets,preset];
    if (next.length > 50) throw new Error('Maximum 50 worker presets');
    await this.storage.update('workerPresets', next); return preset;
  }
  async remove(id: string): Promise<void> { await this.storage.update('workerPresets',this.list().filter(p=>p.id!==id)); }
}
