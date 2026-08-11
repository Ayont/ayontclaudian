import * as rendererSafeUnrefHelpers from '../../../scripts/rendererSafeUnref.js';

const {
  findUnsafeTimerUnrefSites,
  patchRendererUnsafeUnrefSites,
} = rendererSafeUnrefHelpers;

describe('rendererSafeUnref helpers', () => {
  it('patches the known unsafe timer .unref() bundle sites', () => {
    const input = [
      'if ($ && !$.killed && $.exitCode === null) setTimeout((Q) => {',
      '  if (Q.killed || Q.exitCode !== null) return;',
      '  Q.kill("SIGTERM"), setTimeout((J) => {',
      '    if (J.exitCode === null) J.kill("SIGKILL");',
      '  }, 5e3, Q).unref();',
      '}, wx, $).unref(), $.once("exit", () => D5.delete($));',
      'await Promise.race([closePromise, new Promise((resolve5) => setTimeout(resolve5, 2e3).unref())]);',
    ].join('\n');

    const result = patchRendererUnsafeUnrefSites(input);

    expect(result.appliedPatches).toEqual([
      { name: 'timer-unref-optional-call', count: 3 },
    ]);
    expect(result.contents).toContain('}, 5e3, Q).unref?.();');
    expect(result.contents).toContain('}, wx, $).unref?.(),');
    expect(result.contents).toContain('setTimeout(resolve5, 2e3).unref?.()');
    expect(findUnsafeTimerUnrefSites(result.contents)).toEqual([]);
  });

  it('patches the current claude-sdk shape with a block-bodied exit handler', () => {
    const input = [
      'if ($ && !$.killed && $.exitCode === null) setTimeout((X) => {',
      '  if (X.killed || X.exitCode !== null) return;',
      '  X.kill("SIGTERM"), setTimeout((J) => {',
      '    if (J.exitCode === null) J.kill("SIGKILL");',
      '  }, 5e3, X).unref();',
      '}, LM, $).unref(), $.once("exit", () => {',
      '  if (this.processExitHandler) process.off("exit", this.processExitHandler), this.processExitHandler = void 0;',
      '});',
    ].join('\n');

    const result = patchRendererUnsafeUnrefSites(input);

    expect(result.appliedPatches).toEqual([
      { name: 'timer-unref-optional-call', count: 2 },
    ]);
    // The surrounding statement is left untouched — only the call is made optional.
    expect(result.contents).toContain('this.processExitHandler');
    expect(findUnsafeTimerUnrefSites(result.contents)).toEqual([]);
  });

  it('patches the latest claude-sdk async close callback shape', () => {
    const input = [
      'if (Q && !Q.killed && Q.exitCode === null) setTimeout((J, Y) => {',
      '  if (J.exitCode !== null) {',
      '    Y();',
      '    return;',
      '  }',
      '  if (process.platform === "win32") {',
      '    setTimeout((X, W) => {',
      '      if (X.exitCode === null) X.kill("SIGKILL");',
      '      W();',
      '    }, 5e3, J, Y).unref();',
      '    return;',
      '  }',
      '  J.kill("SIGTERM"), setTimeout((X) => {',
      '    if (X.exitCode === null) X.kill("SIGKILL");',
      '  }, 5e3, J).unref(), Y();',
      '}, Tx, Q, $).unref(), Q.once("exit", () => VX.delete(Q));',
    ].join('\n');

    const result = patchRendererUnsafeUnrefSites(input);

    expect(result.appliedPatches).toEqual([
      { name: 'timer-unref-optional-call', count: 3 },
    ]);
    expect(findUnsafeTimerUnrefSites(result.contents)).toEqual([]);
  });

  // The reason this rewrite exists: the previous implementation matched whole
  // statements with regexes built around esbuild's UNMINIFIED spacing, so
  // enabling minification silently stopped patching (and the verifier then
  // failed the build). Patching the call site itself is formatting-agnostic.
  it('patches the same sites after minification collapses the formatting', () => {
    const minified = 'if(r&&!r.killed&&r.exitCode===null)setTimeout((n,i)=>{'
      + 'if(n.exitCode!==null){i();return}'
      + 'if(process.platform==="win32"){setTimeout((a,c)=>{a.exitCode===null&&a.kill("SIGKILL"),c()},5e3,n,i).unref();return}'
      + 'n.kill("SIGTERM"),setTimeout(a=>{a.exitCode===null&&a.kill("SIGKILL")},5e3,n).unref(),i()'
      + '},rZ,r,e).unref(),r.once("exit",()=>t.delete(r));'
      + 'new Promise(resolve9=>setTimeout(resolve9,2e3).unref())';

    const result = patchRendererUnsafeUnrefSites(minified);

    expect(result.appliedPatches).toEqual([
      { name: 'timer-unref-optional-call', count: 4 },
    ]);
    expect(findUnsafeTimerUnrefSites(result.contents)).toEqual([]);
  });

  it('reports remaining direct timer .unref() calls but ignores guarded usage', () => {
    const input = [
      'const timer = setTimeout(run, 1000);',
      'timer.unref?.();',
      'if (timer.unref) timer.unref();',
      'setTimeout(run, 1000).unref();',
      'setInterval(run, 1000).unref();',
    ].join('\n');

    expect(findUnsafeTimerUnrefSites(input)).toEqual([
      { line: 4, snippet: 'setTimeout(run, 1000).unref()' },
      { line: 5, snippet: 'setInterval(run, 1000).unref()' },
    ]);
  });

  it('leaves a bundle without unsafe sites byte-identical', () => {
    const input = 'const timer = setTimeout(run, 1000);\ntimer.unref?.();\n';

    const result = patchRendererUnsafeUnrefSites(input);

    expect(result.contents).toBe(input);
    expect(result.appliedPatches).toEqual([]);
  });

  it('patches every site when several appear on one line', () => {
    const input = 'setTimeout(a, 1).unref(), setTimeout(b, 2).unref();';

    const result = patchRendererUnsafeUnrefSites(input);

    expect(result.contents).toBe('setTimeout(a, 1).unref?.(), setTimeout(b, 2).unref?.();');
    expect(findUnsafeTimerUnrefSites(result.contents)).toEqual([]);
  });
});
