/** Execute the actual Swift recovery policy, without touching any application. */
import { execFileSync } from 'child_process';
import { mkdtempSync, readFileSync, rmSync,writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

it('uses transcript-only proof before input, send and reply, with actionable unreadable errors', () => {
  const source = readFileSync('scripts/desktop-bridge.swift', 'utf8');
  expect(source).toContain('func verifyCurrentChat()');
  expect(source.match(/guard verifyCurrentChat\(\)/g)).toHaveLength(4);
  expect(source).toContain('let values=transcriptNodes()');
  expect(source).not.toContain('let values=all.filter');
  expect(source).toContain('AXScrollToVisible');
  expect(source).toContain('AXScrollUpByPage');
  expect(source).toContain('App-Oberfläche nicht lesbar');
  expect(source).not.toContain('all.contains(where:{text($0)==anchor})');
  expect(source).toContain('transcriptNodes().contains');
});

it('recovers virtualized anchors read-only and never authorizes a missing anchor', () => {
  if (process.platform !== 'darwin') return;
  const source = readFileSync('scripts/desktop-bridge.swift', 'utf8');
  expect(source).toContain('func recoverAnchor(');
  const prefix = source.split('guard AXIsProcessTrusted()')[0];
  const dir = mkdtempSync(join(tmpdir(), 'anchor-test-'));
  try {
    const file = join(dir, 'test.swift');
    writeFileSync(file, prefix + `
var scrolls = 0
let recovered = recoverAnchor(observe: { scrolls >= 3 }, scroll: { scrolls += 1; return true }, wait: {})
assert(recovered && scrolls == 3)
scrolls = 0
assert(!recoverAnchor(observe: { false }, scroll: { scrolls += 1; return true }, wait: {}))
assert(scrolls == 12)
scrolls = 0
assert(recoverAnchor(observe: { true }, scroll: { scrolls += 1; return true }, wait: {}))
assert(scrolls == 0)
assert(!recoverAnchor(observe: { false }, scroll: { false }, wait: {}))
// A recovered anchor leaves the viewport on old history. Follow only forward.
var page = 0
var budget = 12
let reply = followTranscriptReply(read: { page == 4 ? "plain response" : nil }, scroll: { page += 1; return true }, wait: {}, remaining: &budget)
assert(reply == "plain response" && page == 4 && budget == 8)
page = 0
budget = 12
assert(followTranscriptReply(read: { nil }, scroll: { page += 1; return true }, wait: {}, remaining: &budget) == nil)
assert(page == 12 && budget == 0)
assert(followTranscriptReply(read: { nil }, scroll: { fatalError("exhausted budget must not scroll") }, wait: {}, remaining: &budget) == nil)
budget = 12
assert(followTranscriptReply(read: { nil }, scroll: { false }, wait: {}, remaining: &budget) == nil)
assert(budget == 11)
// Wheel policy is deterministic, not a claim about live AX event delivery.
var wheels = 0
var tick = 0.0
assert(recoverWithWheel(observe: { wheels == 11 }, signature: { String(wheels) }, guardedScroll: { wheels += 1; return true }, wait: {}, now: { tick }))
assert(wheels == 11)
wheels = 0
assert(!recoverWithWheel(observe: { false }, signature: { "stationary" }, guardedScroll: { wheels += 1; return true }, wait: {}, now: { tick }))
assert(wheels == 2)
wheels = 0
assert(!recoverWithWheel(observe: { false }, signature: { String(wheels) }, guardedScroll: { wheels += 1; return true }, wait: {}, now: { tick }))
assert(wheels == 12)
assert(!recoverWithWheel(observe: { false }, signature: { "x" }, guardedScroll: { false }, wait: { fatalError("failed front guard must not wait") }, now: { tick }))
wheels = 0
assert(!recoverWithWheel(observe: { false }, signature: { String(wheels) }, guardedScroll: { wheels += 1; return true }, wait: { tick += 20 }, now: { tick }))
assert(wheels == 1)
let window = CGRect(x: 100, y: 100, width: 900, height: 800)
let header = CGRect(x: 400, y: 140, width: 200, height: 30)
let input = CGRect(x: 400, y: 800, width: 500, height: 60)
assert(safeWheelTarget(CGRect(x: 400, y: 300, width: 200, height: 30), window: window, header: header, input: input))
assert(!safeWheelTarget(input, window: window, header: header, input: input))
assert(!safeWheelTarget(CGRect(x: 50, y: 300, width: 200, height: 30), window: window, header: header, input: input))
assert(!safeWheelTarget(CGRect(x: 400, y: 170, width: 200, height: 30), window: window, header: header, input: input))
print("anchor-policy-ok")
`);
    expect(execFileSync('/usr/bin/swift', [file], { encoding: 'utf8' })).toContain('anchor-policy-ok');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
