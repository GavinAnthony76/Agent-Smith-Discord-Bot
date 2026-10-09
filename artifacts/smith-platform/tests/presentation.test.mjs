import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import ts from 'typescript';

const source = name => readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8');
const printer = ts.createPrinter({ removeComments: true });

// These fingerprints cover the original mutation-hook configuration and payloads,
// not JSX, spacing or styling. Intentional behavioral work must review this guard.
const contracts = {
  'components/shell.tsx': 'a31f9a820df0a7c37e279182529bcdfb8b8c27263e287fed0d9b260c7f81b081',
  'components/panels.tsx': '333dd7c50bd23a440f38b5450970fa5c4d6f11c37ca23dfa8ea7bfaaf82293e4',
  'pages/dashboard.tsx': 'b4830a5c7fca80caa6e94fc7b5152a59fd444feae00759dd6ab51b6d47b216a8',
};
for (const [file, expected] of Object.entries(contracts)) {
  test(`${file}: existing mutation requests and callbacks are unchanged`, () => {
    const sf = ts.createSourceFile(file, source(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const calls = [];
    const visit = node => {
      if (ts.isCallExpression(node) &&
          (/\.mutate(?:Async)?$/.test(node.expression.getText(sf)) ||
           /^use(?:Update|Save|Delete|Perform|Logout|Complete)/.test(node.expression.getText(sf)))) {
        calls.push(printer.printNode(ts.EmitHint.Unspecified, node, sf).replace(/\s+/g, ' '));
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
    const actual = createHash('sha256').update(JSON.stringify(calls.sort())).digest('hex');
    assert.equal(actual, expected);
  });
}

test('live preparation retains Owner, production and runtime gates', () => {
  const text = source('pages/dashboard.tsx');
  assert.match(text, /guildId === '1555330318569971743' && o\.guild\.role === 'OWNER'/);
  assert.match(text, /mode !== 'production' \|\| !o\.runtimeStatus\?\.runtimeActive/);
  assert.match(text, /action:'acceptance-prepare',target:guildId,confirmed:true/);
});

test('shared forms preserve read-only, revision and dirty-state gates', () => {
  const text = source('components/panels.tsx');
  assert.match(text, /const ro = !mod\.editable/);
  assert.match(text, /disabled=\{dirty \|\| !mod\.enabled \|\| publish\.isPending\}/);
  assert.match(text, /revision: mod\.revision/);
  assert.match(text, /c\.editable &&/);
});

test('module cards distinguish saved configuration from runtime', () => {
  const text = source('components/smith-ui.tsx');
  assert.match(text, /Configured on/);
  assert.match(text, /Configured off/);
  assert.match(text, /RuntimeBadge status=\{runtimeStatus\}/);
  assert.match(text, /Last event: unavailable/);
});

test('unknown metrics remain unavailable rather than showing zero', () => {
  const text = source('components/smith-ui.tsx');
  assert.match(text, /value === null/);
  assert.match(text, /Unavailable/);
  assert.match(text, /No data source reported/);
});

test('keyboard focus, reduced motion and mobile touch styling are present', () => {
  const css = source('styles/smith.css');
  assert.match(css, /:focus-visible/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /min-height:44px/);
  assert.match(source('components/shell.tsx'), /aria-current=/);
  assert.match(source('components/shell.tsx'), /aria-label="Open menu"/);
});

test('missing artwork uses named placeholders without claiming stock art', () => {
  const text = source('components/branding.tsx');
  assert.match(text, /suppliedAssets/);
  assert.match(text, /failed \|\| !supplied/);
  assert.match(text, /if \(!failed\) setFailed\(true\)/);
  for (const name of ['avatar', 'banner']) {
    const svg = readFileSync(new URL(`../public/branding/agent-smith-${name}-placeholder.svg`, import.meta.url), 'utf8');
    assert.match(svg, /<svg/);
  }
});
