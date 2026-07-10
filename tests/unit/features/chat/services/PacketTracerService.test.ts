import {
  decodeLegacyPacketTracer,
  encodeLegacyPacketTracer,
  inspectPacketTracerXml,
  PacketTracerFormatError,
} from '@/features/chat/services/PacketTracerService';

const SAMPLE_XML = `<?xml version="1.0"?>
<PACKETTRACER5>
  <VERSION>5.2.0.0068</VERSION>
  <NETWORK>
    <DEVICES>
      <DEVICE><TYPE model="1941">Router</TYPE><NAME translate="true">R1</NAME></DEVICE>
      <DEVICE><TYPE model="2960">Switch</TYPE><NAME translate="true">SW1</NAME></DEVICE>
    </DEVICES>
  </NETWORK>
</PACKETTRACER5>`;

describe('PacketTracerService codec', () => {
  it('round-trips a legacy Packet Tracer XML topology', () => {
    const encoded = encodeLegacyPacketTracer(SAMPLE_XML);
    expect(decodeLegacyPacketTracer(encoded)).toBe(SAMPLE_XML);
  });

  it('extracts Packet Tracer version and devices from decoded XML', () => {
    const inspection = inspectPacketTracerXml(SAMPLE_XML, '.claudian/packet-tracer/lab.xml');
    expect(inspection.version).toBe('5.2.0.0068');
    expect(inspection.deviceCount).toBe(2);
    expect(inspection.devices).toEqual([
      { name: 'R1', type: 'Router', model: '1941' },
      { name: 'SW1', type: 'Switch', model: '2960' },
    ]);
  });

  it('rejects unsupported or malformed packet data', () => {
    expect(() => decodeLegacyPacketTracer(new Uint8Array([1, 2, 3, 4]).buffer)).toThrow(PacketTracerFormatError);
    expect(() => encodeLegacyPacketTracer('<root/>')).toThrow(PacketTracerFormatError);
  });
});
