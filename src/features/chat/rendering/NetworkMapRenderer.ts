import { setIcon } from 'obsidian';

export type NetworkNodeKind =
  | 'internet'
  | 'firewall'
  | 'router'
  | 'switch'
  | 'vpn'
  | 'vlan'
  | 'server'
  | 'client'
  | 'wireless'
  | 'network'
  | 'unknown';

export type NetworkHealth = 'ok' | 'warning' | 'error' | 'unknown';

export interface NetworkMapNode {
  id: string;
  label: string;
  kind: NetworkNodeKind;
  health: NetworkHealth;
}

export interface NetworkMapEdge {
  from: string;
  to: string;
  label?: string;
  health: NetworkHealth;
}

export interface NetworkTopology {
  title: string;
  source: 'explicit' | 'automatic';
  nodes: NetworkMapNode[];
  edges: NetworkMapEdge[];
}

interface ParsedNetworkMapBlock {
  content: string;
  closed: boolean;
  topology: NetworkTopology | null;
}

interface PositionedNode extends NetworkMapNode {
  x: number;
  y: number;
  layer: number;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const MAX_NODES = 14;
const NODE_WIDTH = 164;
const NODE_HEIGHT = 58;
const COLUMN_GAP = 82;
const ROW_GAP = 28;
const MARGIN_X = 34;
const MARGIN_Y = 28;

const HEALTH_ERROR_RE = /\b(down|offline|failed|failure|error|blocked|broken|unreachable|timeout|drop(?:ped)?|fehler|ausgefallen|nicht erreichbar|rot)\b/i;
const HEALTH_WARNING_RE = /\b(warn(?:ing)?|degraded|unstable|flap(?:ping)?|loss|latency|slow|problem|prüfen|unklar|gelb)\b/i;
const HEALTH_OK_RE = /\b(up|online|healthy|ok|working|reachable|established|connected|grün|erreichbar)\b/i;

function normalizeLabel(value: string): string {
  return value
    .replace(/^[-*+]\s+/, '')
    .replace(/^`|`$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 72);
}

function nodeId(label: string): string {
  return label
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'node';
}

function inferHealth(text: string): NetworkHealth {
  if (HEALTH_ERROR_RE.test(text)) return 'error';
  if (HEALTH_WARNING_RE.test(text)) return 'warning';
  if (HEALTH_OK_RE.test(text)) return 'ok';
  return 'unknown';
}

function inferKind(label: string): NetworkNodeKind {
  if (/internet|\bwan\b|\bisp\b|cloud/i.test(label)) return 'internet';
  if (/fortigate|fortinet|firewall|palo alto|sophos|opnsense|pfsense/i.test(label)) return 'firewall';
  if (/router|gateway/i.test(label)) return 'router';
  if (/switch|stack/i.test(label)) return 'switch';
  if (/vpn|ipsec|ssl-vpn|tunnel/i.test(label)) return 'vpn';
  if (/\bvlan\b|subnet|\bnetz\b|\/\d{1,2}\b/i.test(label)) return 'vlan';
  if (/server|dns|dhcp|domain controller|\bdc\b|nas|hyper-v|vmware/i.test(label)) return 'server';
  if (/access point|\bap\b|wifi|wlan|wireless/i.test(label)) return 'wireless';
  if (/client|pc|laptop|workstation|endpoint|user/i.test(label)) return 'client';
  if (/lan|network|netzwerk/i.test(label)) return 'network';
  return 'unknown';
}

function uniqueId(base: string, existing: Set<string>): string {
  let candidate = base;
  let suffix = 2;
  while (existing.has(candidate)) {
    candidate = `${base}-${suffix++}`;
  }
  existing.add(candidate);
  return candidate;
}

function parseEdgeLine(line: string): { from: string; to: string; label?: string } | null {
  const clean = line.trim().replace(/^[-*+]\s+/, '');
  if (!clean || clean.startsWith('#') || clean.startsWith('//')) return null;

  const labeled = clean.match(/^(.+?)\s+--\s*(.*?)\s*-->\s*(.+)$/);
  if (labeled) {
    const from = normalizeLabel(labeled[1]);
    const label = normalizeLabel(labeled[2]);
    const to = normalizeLabel(labeled[3]);
    return from && to ? { from, to, ...(label ? { label } : {}) } : null;
  }

  const simple = clean.match(/^(.+?)\s*-->\s*(.+)$/);
  if (!simple) return null;
  const from = normalizeLabel(simple[1]);
  const to = normalizeLabel(simple[2]);
  return from && to ? { from, to } : null;
}

export function parseNetworkMapDsl(content: string): NetworkTopology | null {
  const nodeByLabel = new Map<string, NetworkMapNode>();
  const usedIds = new Set<string>();
  const edges: NetworkMapEdge[] = [];

  const ensureNode = (label: string): NetworkMapNode => {
    const key = label.toLowerCase();
    const existing = nodeByLabel.get(key);
    if (existing) return existing;

    const node: NetworkMapNode = {
      id: uniqueId(nodeId(label), usedIds),
      label,
      kind: inferKind(label),
      health: inferHealth(label),
    };
    nodeByLabel.set(key, node);
    return node;
  };

  for (const line of content.split(/\r?\n/)) {
    const parsed = parseEdgeLine(line);
    if (!parsed) continue;
    const from = ensureNode(parsed.from);
    const to = ensureNode(parsed.to);
    if (nodeByLabel.size > MAX_NODES) break;
    edges.push({
      from: from.id,
      to: to.id,
      label: parsed.label,
      health: inferHealth(`${parsed.label ?? ''} ${parsed.to}`),
    });
  }

  const nodes = Array.from(nodeByLabel.values()).slice(0, MAX_NODES);
  const nodeIds = new Set(nodes.map((node) => node.id));
  const validEdges = edges.filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to));
  if (nodes.length < 2 || validEdges.length < 1) return null;

  return {
    title: 'Live-Netzwerkplan',
    source: 'explicit',
    nodes,
    edges: validEdges,
  };
}

export function parseNetworkMapBlocks(markdown: string): ParsedNetworkMapBlock[] {
  const blocks: ParsedNetworkMapBlock[] = [];
  const re = /```network-map\s*\n([\s\S]*?)(```|$)/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(markdown)) !== null) {
    const content = match[1].trim();
    blocks.push({
      content,
      closed: match[2] === '```',
      topology: parseNetworkMapDsl(content),
    });
    if (!match[2]) break;
  }
  return blocks;
}

function collectMatches(markdown: string, re: RegExp, formatter: (match: RegExpExecArray) => string): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  let match: RegExpExecArray | null;
  re.lastIndex = 0;
  while ((match = re.exec(markdown)) !== null) {
    const value = normalizeLabel(formatter(match));
    const key = value.toLowerCase();
    if (value && !seen.has(key)) {
      seen.add(key);
      result.push(value);
    }
  }
  return result;
}

/**
 * Builds a conservative best-effort map from prose while the answer streams.
 * It only activates for strong network troubleshooting signals and marks all
 * inferred links as unknown unless the surrounding text reports health.
 */
export function inferNetworkTopology(markdown: string): NetworkTopology | null {
  const lower = markdown.toLowerCase();
  let relevance = 0;
  if (/fortigate|fortinet/.test(lower)) relevance += 5;
  if (/firewall|palo alto|sophos|opnsense|pfsense/.test(lower)) relevance += 3;
  if (/\bvlan\b|subnet|routing|route\b/.test(lower)) relevance += 2;
  if (/ipsec|ssl-vpn|\bvpn\b|tunnel/.test(lower)) relevance += 2;
  if (/switch|gateway|\bwan\b|\blan\b|dhcp|dns/.test(lower)) relevance += 1;
  if (/troubleshoot|diagnos|packet|sniffer|ping|traceroute|nicht erreichbar|timeout|connectivity/.test(lower)) relevance += 1;
  if (relevance < 4) return null;

  const nodes: NetworkMapNode[] = [];
  const edges: NetworkMapEdge[] = [];
  const usedIds = new Set<string>();
  const addNode = (label: string, kind?: NetworkNodeKind): NetworkMapNode => {
    const existing = nodes.find((node) => node.label.toLowerCase() === label.toLowerCase());
    if (existing) return existing;
    const healthContextIndex = lower.indexOf(label.toLowerCase());
    const healthContext = healthContextIndex >= 0
      ? markdown.slice(Math.max(0, healthContextIndex - 45), healthContextIndex + label.length + 60)
      : label;
    const node: NetworkMapNode = {
      id: uniqueId(nodeId(label), usedIds),
      label,
      kind: kind ?? inferKind(label),
      health: inferHealth(healthContext),
    };
    nodes.push(node);
    return node;
  };
  const addEdge = (from: NetworkMapNode, to: NetworkMapNode, label?: string) => {
    if (from.id === to.id || edges.some((edge) => edge.from === from.id && edge.to === to.id)) return;
    edges.push({ from: from.id, to: to.id, label, health: inferHealth(label ?? '') });
  };

  const internet = /\binternet\b|\bwan\b|\bisp\b/i.test(markdown)
    ? addNode(/\bisp\b/i.test(markdown) ? 'ISP / Internet' : 'Internet / WAN', 'internet')
    : null;

  const fortigateMatch = markdown.match(/\bFortiGate(?:\s+(?:[A-Z0-9][A-Z0-9-]{1,18}))?/i);
  const firewallMatch = markdown.match(/\b(?:Firewall|OPNsense|pfSense|Palo Alto|Sophos)(?:\s+[A-Z0-9-]+)?/i);
  const routerMatch = markdown.match(/\b(?:Core\s+)?(?:Router|Gateway)(?:\s+[A-Z0-9-]+)?/i);
  const security = fortigateMatch
    ? addNode(normalizeLabel(fortigateMatch[0]), 'firewall')
    : firewallMatch
      ? addNode(normalizeLabel(firewallMatch[0]), 'firewall')
      : routerMatch
        ? addNode(normalizeLabel(routerMatch[0]), 'router')
        : addNode('Gateway / Firewall?', 'unknown');

  const vpnMatch = markdown.match(/\b(?:IPsec|SSL[- ]?VPN|Site[- ]to[- ]Site VPN|VPN)[^\n,.;:]{0,24}/i);
  const vpn = vpnMatch ? addNode(normalizeLabel(vpnMatch[0]), 'vpn') : null;

  const switchMatch = markdown.match(/\b(?:(?:Core|Access|Distribution|Managed)\s+)?Switch(?:\s+[A-Z0-9-]+)?/i);
  const networkSwitch = switchMatch ? addNode(normalizeLabel(switchMatch[0]), 'switch') : null;

  const vlans = collectMatches(
    markdown,
    /\bVLAN\s*[-:]?\s*(\d{1,4})(?:\s*[([]([^\])\n]{1,28})[)\]])?/gi,
    (match) => `VLAN ${match[1]}${match[2] ? ` · ${match[2].trim()}` : ''}`,
  ).slice(0, 6).map((label) => addNode(label, 'vlan'));

  const subnets = collectMatches(
    markdown,
    /\b((?:\d{1,3}\.){3}\d{1,3}\/\d{1,2})\b/g,
    (match) => `Subnet ${match[1]}`,
  ).slice(0, vlans.length > 0 ? 2 : 4).map((label) => addNode(label, 'vlan'));

  const endpoints: NetworkMapNode[] = [];
  if (/\b(?:dns|dhcp|domain controller|server|nas)\b/i.test(markdown)) {
    const endpoint = markdown.match(/\b(?:DNS(?: Server)?|DHCP(?: Server)?|Domain Controller|Server|NAS)(?:\s+[A-Z0-9._-]+)?/i);
    if (endpoint) endpoints.push(addNode(normalizeLabel(endpoint[0]), 'server'));
  }
  if (/access point|\bap\b|wifi|wlan/i.test(markdown)) endpoints.push(addNode('WLAN / Access Point', 'wireless'));
  if (/client|endpoint|workstation|laptop|\bpc\b/i.test(markdown)) endpoints.push(addNode('Clients / Endpoints', 'client'));

  if (internet) addEdge(internet, security, 'WAN');
  if (vpn) addEdge(vpn, security, 'Tunnel');
  const distribution = networkSwitch ?? security;
  if (networkSwitch) addEdge(security, networkSwitch, 'LAN / Trunk');

  const segments = [...vlans, ...subnets].slice(0, 7);
  for (const segment of segments) addEdge(distribution, segment, 'Routing');
  const endpointParent = segments[0] ?? distribution;
  for (const endpoint of endpoints) addEdge(endpointParent, endpoint);

  if (nodes.length === 1) {
    const unknownNetwork = addNode('Netzwerkpfad · zu prüfen', 'unknown');
    addEdge(security, unknownNetwork, 'Status unbekannt');
  }

  return nodes.length >= 2 && edges.length >= 1
    ? { title: 'Live-Netzwerkplan', source: 'automatic', nodes: nodes.slice(0, MAX_NODES), edges }
    : null;
}

function createSvgElement<K extends keyof SVGElementTagNameMap>(
  doc: Document,
  name: K,
): SVGElementTagNameMap[K] {
  return doc.createElementNS(SVG_NS, name);
}

function setAttributes(element: Element, attributes: Record<string, string | number>): void {
  for (const [name, value] of Object.entries(attributes)) {
    element.setAttribute(name, String(value));
  }
}

function computeLayers(topology: NetworkTopology): Map<string, number> {
  const nodeIds = new Set(topology.nodes.map((node) => node.id));
  const incoming = new Map<string, number>();
  const outgoing = new Map<string, string[]>();
  for (const id of nodeIds) {
    incoming.set(id, 0);
    outgoing.set(id, []);
  }
  for (const edge of topology.edges) {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) continue;
    incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
    outgoing.get(edge.from)?.push(edge.to);
  }

  const layers = new Map<string, number>();
  const queue = Array.from(nodeIds).filter((id) => (incoming.get(id) ?? 0) === 0);
  if (queue.length === 0 && topology.nodes[0]) queue.push(topology.nodes[0].id);
  for (const id of queue) layers.set(id, 0);

  let cursor = 0;
  while (cursor < queue.length) {
    const id = queue[cursor++];
    const nextLayer = Math.min(4, (layers.get(id) ?? 0) + 1);
    for (const target of outgoing.get(id) ?? []) {
      const previous = layers.get(target);
      if (previous === undefined || nextLayer > previous) layers.set(target, nextLayer);
      incoming.set(target, Math.max(0, (incoming.get(target) ?? 1) - 1));
      if ((incoming.get(target) ?? 0) === 0) queue.push(target);
    }
  }

  for (const node of topology.nodes) {
    if (!layers.has(node.id)) layers.set(node.id, Math.min(4, layers.size > 0 ? 1 : 0));
  }
  return layers;
}

function positionNodes(topology: NetworkTopology): { nodes: PositionedNode[]; width: number; height: number } {
  const layerById = computeLayers(topology);
  const groups = new Map<number, NetworkMapNode[]>();
  for (const node of topology.nodes) {
    const layer = layerById.get(node.id) ?? 0;
    const group = groups.get(layer) ?? [];
    group.push(node);
    groups.set(layer, group);
  }

  const layerNumbers = Array.from(groups.keys()).sort((a, b) => a - b);
  const maxRows = Math.max(1, ...Array.from(groups.values()).map((group) => group.length));
  const width = Math.max(420, MARGIN_X * 2 + layerNumbers.length * NODE_WIDTH + Math.max(0, layerNumbers.length - 1) * COLUMN_GAP);
  const height = Math.max(150, MARGIN_Y * 2 + maxRows * NODE_HEIGHT + Math.max(0, maxRows - 1) * ROW_GAP);
  const positioned: PositionedNode[] = [];

  layerNumbers.forEach((layer, columnIndex) => {
    const group = groups.get(layer) ?? [];
    const groupHeight = group.length * NODE_HEIGHT + Math.max(0, group.length - 1) * ROW_GAP;
    const startY = (height - groupHeight) / 2;
    group.forEach((node, rowIndex) => {
      positioned.push({
        ...node,
        layer,
        x: MARGIN_X + columnIndex * (NODE_WIDTH + COLUMN_GAP),
        y: startY + rowIndex * (NODE_HEIGHT + ROW_GAP),
      });
    });
  });

  return { nodes: positioned, width, height };
}

function splitLabel(label: string): [string, string?] {
  if (label.length <= 22) return [label];
  const midpoint = Math.floor(label.length / 2);
  let split = label.lastIndexOf(' ', midpoint);
  if (split < 8) split = label.indexOf(' ', midpoint);
  if (split < 0) return [label.slice(0, 21), `${label.slice(21, 39)}${label.length > 39 ? '…' : ''}`];
  return [label.slice(0, split), `${label.slice(split + 1, split + 22)}${label.length > split + 22 ? '…' : ''}`];
}

function renderTopologySvg(container: HTMLElement, topology: NetworkTopology): void {
  const doc = container.ownerDocument ?? window.document;
  const layout = positionNodes(topology);
  const byId = new Map(layout.nodes.map((node) => [node.id, node]));
  const svg = createSvgElement(doc, 'svg');
  svg.classList.add('claudian-network-map-svg');
  setAttributes(svg, {
    viewBox: `0 0 ${layout.width} ${layout.height}`,
    role: 'img',
    'aria-label': topology.title,
    preserveAspectRatio: 'xMidYMid meet',
  });

  const defs = createSvgElement(doc, 'defs');
  const marker = createSvgElement(doc, 'marker');
  setAttributes(marker, { id: `cl-network-arrow-${Math.random().toString(36).slice(2)}`, markerWidth: 8, markerHeight: 8, refX: 7, refY: 3, orient: 'auto', markerUnits: 'strokeWidth' });
  const arrow = createSvgElement(doc, 'path');
  setAttributes(arrow, { d: 'M0,0 L0,6 L7,3 z' });
  arrow.classList.add('claudian-network-map-arrow');
  marker.appendChild(arrow);
  defs.appendChild(marker);
  svg.appendChild(defs);

  for (const edge of topology.edges) {
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    if (!from || !to) continue;
    const x1 = from.x + NODE_WIDTH;
    const y1 = from.y + NODE_HEIGHT / 2;
    const x2 = to.x;
    const y2 = to.y + NODE_HEIGHT / 2;
    const bend = Math.max(28, (x2 - x1) * 0.46);
    const path = createSvgElement(doc, 'path');
    setAttributes(path, {
      d: `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`,
      'marker-end': `url(#${marker.id})`,
    });
    path.classList.add('claudian-network-map-edge', `is-${edge.health}`);
    svg.appendChild(path);

    if (edge.label) {
      const label = createSvgElement(doc, 'text');
      setAttributes(label, { x: (x1 + x2) / 2, y: (y1 + y2) / 2 - 7, 'text-anchor': 'middle' });
      label.classList.add('claudian-network-map-edge-label');
      label.textContent = edge.label.slice(0, 28);
      svg.appendChild(label);
    }
  }

  for (const node of layout.nodes) {
    const group = createSvgElement(doc, 'g');
    group.classList.add('claudian-network-map-node', `is-${node.kind}`, `is-${node.health}`);
    setAttributes(group, { transform: `translate(${node.x} ${node.y})` });

    const rect = createSvgElement(doc, 'rect');
    setAttributes(rect, { width: NODE_WIDTH, height: NODE_HEIGHT, rx: 12, ry: 12 });
    group.appendChild(rect);

    const kind = createSvgElement(doc, 'text');
    setAttributes(kind, { x: 13, y: 18 });
    kind.classList.add('claudian-network-map-kind');
    kind.textContent = node.kind.toUpperCase();
    group.appendChild(kind);

    const [line1, line2] = splitLabel(node.label);
    const label = createSvgElement(doc, 'text');
    setAttributes(label, { x: 13, y: line2 ? 36 : 42 });
    label.classList.add('claudian-network-map-node-label');
    const firstLine = createSvgElement(doc, 'tspan');
    setAttributes(firstLine, { x: 13, dy: 0 });
    firstLine.textContent = line1;
    label.appendChild(firstLine);
    if (line2) {
      const secondLine = createSvgElement(doc, 'tspan');
      setAttributes(secondLine, { x: 13, dy: 16 });
      secondLine.textContent = line2;
      label.appendChild(secondLine);
    }
    group.appendChild(label);

    const status = createSvgElement(doc, 'circle');
    setAttributes(status, { cx: NODE_WIDTH - 13, cy: 14, r: 4 });
    status.classList.add('claudian-network-map-status');
    group.appendChild(status);
    svg.appendChild(group);
  }

  container.appendChild(svg);
}

export function renderNetworkTopology(container: HTMLElement, topology: NetworkTopology): HTMLElement {
  const card = container.createDiv({ cls: 'claudian-network-map' });
  card.setAttribute('data-source', topology.source);
  const header = card.createDiv({ cls: 'claudian-network-map-header' });
  const titleArea = header.createDiv({ cls: 'claudian-network-map-title-area' });
  const icon = titleArea.createSpan({ cls: 'claudian-network-map-icon' });
  setIcon(icon, 'network');
  titleArea.createSpan({ cls: 'claudian-network-map-title', text: topology.title });
  titleArea.createSpan({
    cls: 'claudian-network-map-live',
    text: topology.source === 'explicit' ? 'LIVE' : 'AUTO',
  });

  const meta = header.createSpan({
    cls: 'claudian-network-map-meta',
    text: `${topology.nodes.length} Knoten · ${topology.edges.length} Verbindungen`,
  });
  meta.setAttribute('title', topology.source === 'automatic'
    ? 'Automatisch aus dem laufenden Chat erkannt'
    : 'Vom Agenten als Netzwerkplan strukturiert');

  const canvas = card.createDiv({ cls: 'claudian-network-map-canvas' });
  renderTopologySvg(canvas, topology);

  const footer = card.createDiv({ cls: 'claudian-network-map-footer' });
  footer.createSpan({
    text: topology.source === 'automatic'
      ? 'Automatisch erkannt · unbekannte Verbindungen vor der Änderung prüfen'
      : 'Pfeiltasten/Zoom des Obsidian-Fensters nutzen · Plan aktualisiert sich beim Streamen',
  });
  return card;
}

/** Replaces `network-map` code fences and optionally appends an inferred live map. */
export function renderNetworkMaps(root: HTMLElement, markdown: string): boolean {
  const blocks = parseNetworkMapBlocks(markdown);
  const codeBlocks = Array.from(root.querySelectorAll('pre code.language-network-map'));
  let rendered = false;

  blocks.forEach((block, index) => {
    const topology = block.topology;
    if (!topology) return;
    const code = codeBlocks[index];
    const pre = code?.closest('pre');
    if (pre?.parentElement) {
      const doc = root.ownerDocument ?? window.document;
      const host = doc.createElement('div');
      pre.parentElement.replaceChild(host, pre);
      renderNetworkTopology(host, topology);
      rendered = true;
    } else if (!block.closed) {
      renderNetworkTopology(root, topology);
      rendered = true;
    }
  });

  if (rendered) return true;

  const isUserMessage = (root.closest?.('.claudian-message-user') ?? null) !== null;
  if (isUserMessage) return false;
  const inferred = inferNetworkTopology(markdown);
  if (!inferred) return false;
  renderNetworkTopology(root, inferred);
  return true;
}
