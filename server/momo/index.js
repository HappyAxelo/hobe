import { config } from '../config.js';
import { createSimulatorProvider } from './simulator.js';
import { createMtnProvider } from './mtn.js';
import { createAirtelProvider } from './airtel.js';

export function createProvider() {
  switch (config.momoProvider) {
    case 'mtn': return createMtnProvider();
    case 'airtel': return createAirtelProvider();
    case 'simulator': return createSimulatorProvider();
    default: throw new Error(`Unknown MOMO_PROVIDER: ${config.momoProvider}`);
  }
}
