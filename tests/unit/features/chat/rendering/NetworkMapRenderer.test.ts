/** @jest-environment jsdom */

import {
  inferNetworkTopology,
  parseNetworkMapBlocks,
  parseNetworkMapDsl,
  renderNetworkMaps,
  renderNetworkTopology,
} from '@/features/chat/rendering/NetworkMapRenderer';

function installObsidianDomHelpers(): void {
  (HTMLElement.prototype as any).createDiv = function createDiv(options?: { cls?: string; text?: string }) {
    const element = document.createElement('div');
    if (options?.cls) element.className = options.cls;
    if (options?.text) element.textContent = options.text;
    this.appendChild(element);
    return element;
  };
  (HTMLElement.prototype as any).createSpan = function createSpan(options?: { cls?: string; text?: string }) {
    const element = document.createElement('span');
    if (options?.cls) element.className = options.cls;
    if (options?.text) element.textContent = options.text;
    this.appendChild(element);
    return element;
  };
  (HTMLElement.prototype as any).createEl = function createEl(
    tag: string,
    options?: { cls?: string; text?: string; attr?: Record<string, string> },
  ) {
    const element = document.createElement(tag);
    if (options?.cls) element.className = options.cls;
    if (options?.text) element.textContent = options.text;
    for (const [name, value] of Object.entries(options?.attr ?? {})) {
      element.setAttribute(name, value);
    }
    this.appendChild(element);
    return element;
  };
}

describe('NetworkMapRenderer', () => {
  beforeAll(() => installObsidianDomHelpers());

  describe('parseNetworkMapDsl', () => {
    it('parses labeled and simple links into a topology', () => {
      const topology = parseNetworkMapDsl([
        'Internet / WAN -- up --> FortiGate 60F',
        'FortiGate 60F -- port2 / trunk --> Core Switch',
        'Core Switch --> VLAN 10 (Clients)',
      ].join('\n'));

      expect(topology).not.toBeNull();
      expect(topology?.source).toBe('explicit');
      expect(topology?.nodes.map((node) => node.label)).toEqual([
        'Internet / WAN',
        'FortiGate 60F',
        'Core Switch',
        'VLAN 10 (Clients)',
      ]);
      expect(topology?.edges).toHaveLength(3);
      expect(topology?.edges[0].label).toBe('up');
      expect(topology?.edges[0].health).toBe('ok');
    });

    it('ignores comments and returns null without a real connection', () => {
      expect(parseNetworkMapDsl('# topology\nFortiGate 60F')).toBeNull();
    });
  });

  describe('parseNetworkMapBlocks', () => {
    it('parses a completed network-map fence', () => {
      const blocks = parseNetworkMapBlocks([
        'Topology:',
        '```network-map',
        'Internet --> FortiGate 80F',
        'FortiGate 80F --> VLAN 20',
        '```',
      ].join('\n'));

      expect(blocks).toHaveLength(1);
      expect(blocks[0].closed).toBe(true);
      expect(blocks[0].topology?.nodes).toHaveLength(3);
    });

    it('supports an unfinished fence while the answer streams', () => {
      const blocks = parseNetworkMapBlocks('```network-map\nWAN --> FortiGate\nFortiGate --> LAN');
      expect(blocks).toHaveLength(1);
      expect(blocks[0].closed).toBe(false);
      expect(blocks[0].topology?.edges).toHaveLength(2);
    });
  });

  describe('inferNetworkTopology', () => {
    it('builds a FortiGate troubleshooting topology from prose', () => {
      const topology = inferNetworkTopology(
        'Internet WAN reaches the FortiGate 100F. Port2 is a trunk to the Core Switch. '
        + 'VLAN 10 (Clients) cannot reach DNS Server 10.0.0.10. Subnet 10.0.10.0/24.',
      );

      expect(topology).not.toBeNull();
      expect(topology?.source).toBe('automatic');
      expect(topology?.nodes.some((node) => node.kind === 'firewall')).toBe(true);
      expect(topology?.nodes.some((node) => node.kind === 'switch')).toBe(true);
      expect(topology?.nodes.some((node) => node.label.startsWith('VLAN 10'))).toBe(true);
      expect(topology?.edges.length).toBeGreaterThanOrEqual(3);
    });

    it('does not activate for unrelated prose', () => {
      expect(inferNetworkTopology('Please rewrite this marketing email and shorten the headline.')).toBeNull();
    });
  });

  describe('DOM rendering', () => {
    it('renders responsive SVG nodes and edges', () => {
      const topology = parseNetworkMapDsl(
        'Internet -- WAN up --> FortiGate 100F\nFortiGate 100F -- trunk --> Core Switch',
      );
      const root = document.createElement('div');

      renderNetworkTopology(root, topology!);

      expect(root.querySelector('.claudian-network-map')).not.toBeNull();
      expect(root.querySelectorAll('.claudian-network-map-node')).toHaveLength(3);
      expect(root.querySelectorAll('.claudian-network-map-edge')).toHaveLength(2);
      expect(root.querySelector('.claudian-network-map-svg')?.getAttribute('viewBox')).toBeTruthy();
    });

    it('replaces a rendered network-map code fence with the visual map', () => {
      const root = document.createElement('div');
      root.innerHTML = '<pre><code class="language-network-map">Internet -- WAN --> FortiGate 60F</code></pre>';
      const markdown = '```network-map\nInternet -- WAN --> FortiGate 60F\n```';

      expect(renderNetworkMaps(root, markdown)).toBe(true);
      expect(root.querySelector('pre')).toBeNull();
      expect(root.querySelector('.claudian-network-map')).not.toBeNull();
    });

    it('never renders a map from prose without an explicit fence', () => {
      // Regression: the former AUTO inference kept surfacing half-guessed maps
      // under unrelated answers. Only explicit blocks may render.
      const root = document.createElement('div');
      const markdown = 'Die FortiGate 60F hängt am WAN, dahinter der Core Switch mit VLAN 10 und VLAN 20.';

      expect(renderNetworkMaps(root, markdown)).toBe(false);
      expect(root.querySelector('.claudian-network-map')).toBeNull();
    });

    it('renders header actions only when an app context is provided', () => {
      const topology = parseNetworkMapDsl('Internet -- WAN --> FortiGate 60F');

      const plain = document.createElement('div');
      renderNetworkTopology(plain, topology!);
      expect(plain.querySelectorAll('.claudian-network-map-action')).toHaveLength(0);

      const withApp = document.createElement('div');
      renderNetworkTopology(withApp, topology!, { app: {} as never, mediaFolder: '' });
      expect(withApp.querySelectorAll('.claudian-network-map-action')).toHaveLength(3);
    });
  });
});
