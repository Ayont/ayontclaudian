/**
 * Makes bundled `setTimeout(...).unref()` / `setInterval(...).unref()` calls
 * safe to run in Electron's renderer process.
 *
 * Obsidian plugins execute in the renderer, where the timer functions follow
 * BROWSER semantics and return a number — not a Node `Timeout` object. Any
 * bundled dependency that calls `.unref()` on the return value (the Claude
 * Agent SDK's process transport and the MCP SDK's stdio close path both do)
 * therefore throws `TypeError: ....unref is not a function` at runtime.
 *
 * The fix is to make the call optional: `.unref?.()` is a no-op on a number and
 * still unrefs a real Node timer, so one rewrite is correct under both runtimes.
 *
 * This used to be done with regexes that matched the *entire* surrounding
 * statement and rewrote it into named `const` timers. Those patterns encoded
 * esbuild's unminified spacing (`if (x) {\n  ...`), which made them silently
 * stop matching the moment minification was enabled — the verifier below then
 * failed the build. Locating the call site by paren matching and rewriting only
 * the `.unref()` itself has no formatting assumptions at all, handles minified
 * and unminified output identically, and needs no new pattern when a dependency
 * changes the shape of the code around the timer.
 */

const TIMER_CALL_PREFIXES = ['setTimeout(', 'setInterval('];

const SAFE_UNREF_CALL = '.unref?.()';

/**
 * Every `setTimeout(...)`/`setInterval(...)` call whose result has `.unref()`
 * invoked directly on it, with the source offsets of that `.unref()`.
 *
 * @returns {{ line: number, snippet: string, unrefStart: number, unrefEnd: number }[]}
 */
function locateTimerUnrefSites(contents) {
  const sites = [];
  const seenUnrefStarts = new Set();

  // Advance past the timer's OPENING paren, never past its closing one: the
  // SDK's kill path nests a `setTimeout(...).unref()` inside another timer's
  // callback, and skipping to the end of the outer call would step straight
  // over the inner sites. That is exactly what the previous scanner did, which
  // left the nested calls both unpatched and invisible to the verifier.
  let searchIndex = 0;
  while (searchIndex < contents.length) {
    const timerStart = findNextTimerCall(contents, searchIndex);
    if (!timerStart) {
      break;
    }

    searchIndex = timerStart.openParenIndex + 1;

    const callEnd = findMatchingParen(contents, timerStart.openParenIndex);
    if (callEnd === -1) {
      continue;
    }

    // `.unref?.()` deliberately does NOT match — already-safe calls are skipped,
    // which is what makes patching idempotent and the post-patch verify pass.
    const unrefMatch = contents.slice(callEnd + 1).match(/^(\s*)\.unref\(\)/);
    if (!unrefMatch) {
      continue;
    }

    const unrefStart = callEnd + 1 + unrefMatch[1].length;
    if (seenUnrefStarts.has(unrefStart)) {
      continue;
    }

    seenUnrefStarts.add(unrefStart);
    sites.push({
      line: contents.slice(0, timerStart.startIndex).split('\n').length,
      snippet: contents.slice(timerStart.startIndex, callEnd + 1 + unrefMatch[0].length),
      unrefStart,
      unrefEnd: callEnd + 1 + unrefMatch[0].length,
    });
  }

  // Nested sites are discovered after their enclosing one, so sort into source
  // order — both the back-to-front splice and the failure report assume it.
  return sites.sort((left, right) => left.unrefStart - right.unrefStart);
}

/** Rewrites every unsafe timer `.unref()` in `contents` to `.unref?.()`. */
function patchRendererUnsafeUnrefSites(contents) {
  const sites = locateTimerUnrefSites(contents);
  if (sites.length === 0) {
    return { contents, appliedPatches: [] };
  }

  // Back to front so each splice leaves the earlier offsets valid.
  let nextContents = contents;
  for (let index = sites.length - 1; index >= 0; index -= 1) {
    const site = sites[index];
    nextContents = nextContents.slice(0, site.unrefStart)
      + SAFE_UNREF_CALL
      + nextContents.slice(site.unrefEnd);
  }

  return {
    contents: nextContents,
    appliedPatches: [{ name: 'timer-unref-optional-call', count: sites.length }],
  };
}

/**
 * Build-time guard: anything still reported here would throw in the renderer.
 * The build fails on a non-empty result rather than shipping the bundle.
 */
function findUnsafeTimerUnrefSites(contents) {
  return locateTimerUnrefSites(contents).map(({ line, snippet }) => ({ line, snippet }));
}

function findNextTimerCall(contents, startIndex) {
  let nextMatch = null;

  for (const prefix of TIMER_CALL_PREFIXES) {
    const index = contents.indexOf(prefix, startIndex);
    if (index === -1) {
      continue;
    }
    if (!nextMatch || index < nextMatch.startIndex) {
      nextMatch = {
        prefix,
        startIndex: index,
        openParenIndex: index + prefix.length - 1,
      };
    }
  }

  return nextMatch;
}

function findMatchingParen(contents, openParenIndex) {
  let depth = 1;
  let quote = null;

  for (let index = openParenIndex + 1; index < contents.length; index += 1) {
    const char = contents[index];

    if (quote) {
      if (char === '\\') {
        index += 1;
        continue;
      }
      if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '"' || char === '\'' || char === '`') {
      quote = char;
      continue;
    }

    if (char === '(') {
      depth += 1;
      continue;
    }

    if (char === ')') {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}

module.exports = {
  findUnsafeTimerUnrefSites,
  patchRendererUnsafeUnrefSites,
};
