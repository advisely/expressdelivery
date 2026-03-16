import { logDebug } from '../logger.js';
import type { ChannelConnector, ChannelType } from './types.js';

class ChannelRegistry {
  private connectors: Map<string, ChannelConnector> = new Map();

  register(accountId: string, connector: ChannelConnector): void {
    this.connectors.set(accountId, connector);
    logDebug('[ChannelRegistry] Registered ' + connector.type + ' connector for ' + accountId);
  }

  unregister(accountId: string): void {
    const connector = this.connectors.get(accountId);
    if (connector) {
      connector.disconnect().catch((err) => {
        logDebug('[ChannelRegistry] Disconnect error for ' + accountId + ': ' + (err instanceof Error ? err.message : String(err)));
      });
      this.connectors.delete(accountId);
      logDebug('[ChannelRegistry] Unregistered connector for ' + accountId);
    }
  }

  get(accountId: string): ChannelConnector | undefined {
    return this.connectors.get(accountId);
  }

  getByType(type: ChannelType): ChannelConnector[] {
    return Array.from(this.connectors.values()).filter(c => c.type === type);
  }

  getAll(): Map<string, ChannelConnector> {
    return new Map(this.connectors);
  }

  async disconnectAll(): Promise<void> {
    const promises = Array.from(this.connectors.entries()).map(async ([id, connector]) => {
      try {
        await connector.disconnect();
      } catch (err) {
        logDebug('[ChannelRegistry] Error disconnecting ' + id + ': ' + (err instanceof Error ? err.message : String(err)));
      }
    });
    await Promise.all(promises);
    this.connectors.clear();
    logDebug('[ChannelRegistry] All connectors disconnected');
  }

  getStatus(): Array<{ accountId: string; type: ChannelType; connected: boolean }> {
    return Array.from(this.connectors.entries()).map(([id, c]) => ({
      accountId: id,
      type: c.type,
      connected: c.isConnected(),
    }));
  }
}

let _registry: ChannelRegistry | null = null;

export function getChannelRegistry(): ChannelRegistry {
  if (!_registry) {
    _registry = new ChannelRegistry();
  }
  return _registry;
}
