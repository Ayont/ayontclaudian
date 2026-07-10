import { TFile, type Vault } from 'obsidian';
import * as path from 'path';
import * as zlib from 'zlib';

const PACKET_TRACER_FOLDER = '.claudian/packet-tracer';
const MAX_DECODED_XML_BYTES = 24 * 1024 * 1024;

export class PacketTracerFormatError extends Error {}

export interface PacketTracerInspection {
  xmlPath: string;
  version?: string;
  devices: Array<{ name: string; type: string; model?: string }>;
  deviceCount: number;
}

/** Legacy Packet Tracer 5-compatible PKT/PKA codec: XOR + zlib XML. */
export function decodeLegacyPacketTracer(data: ArrayBuffer): string {
  const encrypted = Buffer.from(data);
  if (encrypted.length < 8) throw new PacketTracerFormatError('Datei ist zu klein für ein Packet-Tracer-Archiv.');
  const decoded = Buffer.allocUnsafe(encrypted.length);
  for (let index = 0; index < encrypted.length; index++) {
    decoded[index] = encrypted[index] ^ ((encrypted.length - index) & 0xff);
  }
  const expectedSize = decoded.readUInt32BE(0);
  if (expectedSize === 0 || expectedSize > MAX_DECODED_XML_BYTES) {
    throw new PacketTracerFormatError('Nicht unterstütztes oder verschlüsseltes Packet-Tracer-Format.');
  }
  let xml: Buffer;
  try {
    xml = zlib.inflateSync(decoded.subarray(4), { maxOutputLength: MAX_DECODED_XML_BYTES });
  } catch {
    throw new PacketTracerFormatError('Packet-Tracer-Daten konnten nicht dekomprimiert werden.');
  }
  if (xml.length !== expectedSize || !xml.toString('utf8', 0, Math.min(xml.length, 128)).includes('<')) {
    throw new PacketTracerFormatError('Die Datei enthält keine lesbare Packet-Tracer-XML-Topologie.');
  }
  return xml.toString('utf8');
}

export function encodeLegacyPacketTracer(xml: string): ArrayBuffer {
  const source = Buffer.from(xml, 'utf8');
  if (!source.includes('<PACKETTRACER')) {
    throw new PacketTracerFormatError('Die XML enthält keinen PACKETTRACER-Root und kann nicht als PKT exportiert werden.');
  }
  if (source.length > MAX_DECODED_XML_BYTES) throw new PacketTracerFormatError('Die XML-Topologie ist zu groß für den sicheren Export.');
  const size = Buffer.allocUnsafe(4);
  size.writeUInt32BE(source.length, 0);
  const packed = Buffer.concat([size, zlib.deflateSync(source)]);
  const encrypted = Buffer.allocUnsafe(packed.length);
  for (let index = 0; index < packed.length; index++) {
    encrypted[index] = packed[index] ^ ((packed.length - index) & 0xff);
  }
  return encrypted.buffer.slice(encrypted.byteOffset, encrypted.byteOffset + encrypted.byteLength);
}

export function inspectPacketTracerXml(xml: string, xmlPath: string): PacketTracerInspection {
  const version = xml.match(/<VERSION>([^<]+)<\/VERSION>/i)?.[1]?.trim();
  const devices: PacketTracerInspection['devices'] = [];
  const deviceRe = /<DEVICE>([\s\S]*?)<\/DEVICE>/gi;
  let match: RegExpExecArray | null;
  while ((match = deviceRe.exec(xml)) !== null && devices.length < 200) {
    const block = match[1];
    const typeMatch = block.match(/<TYPE(?:\s+model="([^"]+)")?\s*>([^<]+)<\/TYPE>/i);
    const nameMatch = block.match(/<NAME[^>]*>([^<]+)<\/NAME>/i);
    if (!typeMatch && !nameMatch) continue;
    devices.push({
      name: nameMatch?.[1]?.trim() || 'Unbenanntes Gerät',
      type: typeMatch?.[2]?.trim() || 'Unbekannt',
      ...(typeMatch?.[1] ? { model: typeMatch[1].trim() } : {}),
    });
  }
  return { xmlPath, version, devices, deviceCount: devices.length };
}

export class PacketTracerService {
  constructor(private readonly vault: Vault) {}

  async decodeVaultFile(filePath: string): Promise<PacketTracerInspection> {
    const file = this.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof TFile)) throw new PacketTracerFormatError(`Datei nicht gefunden: ${filePath}`);
    if (!['pkt', 'pka'].includes(file.extension.toLowerCase())) throw new PacketTracerFormatError('Erwartet wird eine .pkt- oder .pka-Datei.');
    const xml = decodeLegacyPacketTracer(await this.vault.readBinary(file));
    await this.ensureFolder();
    const xmlPath = await this.uniquePath(`${this.safeStem(file.basename)}-decoded`, 'xml');
    await this.vault.create(xmlPath, xml);
    return inspectPacketTracerXml(xml, xmlPath);
  }

  async encodeVaultXml(xmlPath: string, outputPath?: string): Promise<string> {
    const source = this.vault.getAbstractFileByPath(xmlPath);
    if (!(source instanceof TFile)) throw new PacketTracerFormatError(`XML-Datei nicht gefunden: ${xmlPath}`);
    const packet = encodeLegacyPacketTracer(await this.vault.read(source));
    await this.ensureFolder();
    const requested = outputPath?.trim().replace(/^\/+/, '') || `${this.safeStem(source.basename)}.pkt`;
    const baseName = requested.endsWith('.pkt') ? requested.slice(0, -4) : requested;
    const destination = await this.uniquePath(this.safeStem(baseName), 'pkt');
    await this.vault.createBinary(destination, packet);
    return destination;
  }

  private async ensureFolder(): Promise<void> {
    if (!this.vault.getAbstractFileByPath('.claudian')) await this.vault.createFolder('.claudian');
    if (!this.vault.getAbstractFileByPath(PACKET_TRACER_FOLDER)) await this.vault.createFolder(PACKET_TRACER_FOLDER);
  }

  private async uniquePath(stem: string, extension: string): Promise<string> {
    let pathValue = `${PACKET_TRACER_FOLDER}/${stem}.${extension}`;
    let suffix = 2;
    while (this.vault.getAbstractFileByPath(pathValue)) pathValue = `${PACKET_TRACER_FOLDER}/${stem}-${suffix++}.${extension}`;
    return pathValue;
  }

  private safeStem(value: string): string {
    return path.basename(value).replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70) || 'packet-tracer-lab';
  }
}
