/**
 * Python generator snapshot tests (FUN-001A).
 *
 * Loads the built artifacts the way the openblock-gui save-snapshot path
 * does (dist/vertical.js + python_compressed.js standalone, see
 * openblock-gui/src/lib/python-snapshot.js), deserializes each fixture
 * workspace XML headlessly and asserts:
 *   1. generation does not throw (including unsupported stage blocks);
 *   2. the generated Python matches the snapshot in expected/;
 *   3. every snapshot passes `python3 -m py_compile`;
 *   4. fixture specific behaviours (import random, wait_until body,
 *      nested repeat loop variables, unsupported block placeholders,
 *      coverage reporting).
 *
 * Usage:
 *   node test/python-snapshot/run_snapshot_tests.js           # run tests
 *   node test/python-snapshot/run_snapshot_tests.js --update  # refresh snapshots
 *
 * Layout note (OB-031C alignment): this suite is wired as the
 * `test:python-snapshot` npm script. Fixtures live in fixtures/*.xml with
 * matching snapshots in expected/*.py; adding a fixture only requires the
 * XML + running --update once and reviewing the snapshot diff.
 */

'use strict';

const {execFileSync} = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.join(__dirname, '..', '..');
const fixturesDir = path.join(__dirname, 'fixtures');
const expectedDir = path.join(__dirname, 'expected');
const update = process.argv.includes('--update');

// --- Headless DOM (jsdom) -------------------------------------------------

const {JSDOM} = require('jsdom');
const dom = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>', {
    pretendToBeVisual: true
});

global.window = dom.window;
global.document = dom.window.document;
// Node exposes `navigator` as a read-only getter, defineProperty overrides it.
Object.defineProperty(global, 'navigator', {
    value: dom.window.navigator,
    writable: true,
    configurable: true
});
for (const key of ['DOMParser', 'XMLSerializer', 'Element', 'Event', 'HTMLElement']) {
    global[key] = dom.window[key];
}

// --- Load Blockly core + Python generator (same artifacts as the GUI) -----

const ScratchBlocks = require(path.join(repoRoot, 'dist', 'vertical.js'));

const loadGenerator = file => {
    let src = fs.readFileSync(path.join(repoRoot, file), 'utf8');
    // The compressed generators are CommonJS modules pulling Blockly from
    // the published package; inject our instance instead.
    src = src.replace(/^\s*let Blockly = require\('hxblock-blocks'\);?\s*$/m, '');
    new Function('Blockly', src)(ScratchBlocks);
};

// python_compressed.js must be loadable on its own: the GUI save-snapshot
// path (openblock-gui/src/lib/python-snapshot.js, FUN-001C) imports it
// without arduino_compressed.js. A stray Blockly.Arduino reference in the
// generator sources makes this throw at load time and white-screens the GUI.
loadGenerator('python_compressed.js');

if (typeof ScratchBlocks.Python['math_n100to100_number'] !== 'function') {
    process.stderr.write('FAIL math_n100to100_number generator missing after standalone load\n');
    process.exit(1);
}

// --- Helpers ---------------------------------------------------------------

const generate = xmlText => {
    const workspace = new ScratchBlocks.Workspace(new ScratchBlocks.Options({}));
    // Some block init() implementations read getMainWorkspace().options.
    ScratchBlocks.mainWorkspace = workspace;
    try {
        const xmlDom = ScratchBlocks.Xml.textToDom(xmlText);
        ScratchBlocks.Xml.domToWorkspace(xmlDom, workspace);
        const code = ScratchBlocks.Python.workspaceToCode(workspace);
        const coverage = ScratchBlocks.Python.getCoverage(workspace);
        const unsupportedInPass = (ScratchBlocks.Python.lastUnsupportedBlocks_ || []).slice();
        return {code, coverage, unsupportedInPass};
    } finally {
        workspace.dispose();
        ScratchBlocks.mainWorkspace = null;
    }
};

const failures = [];
const check = (fixture, label, ok, detail) => {
    if (ok) return;
    failures.push(`[${fixture}] ${label}${detail ? `\n    ${detail}` : ''}`);
};

// Fixture specific assertions beyond the snapshot itself.
const extraAssertions = {
    s1_loop_var_condition: (fixture, result) => {
        check(fixture, 'no unsupported blocks expected',
            result.coverage.unsupportedTotal === 0,
            `coverage: ${JSON.stringify(result.coverage.unsupported)}`);
    },
    s2_lists: (fixture, result) => {
        check(fixture, 'operator_random must register "import random"',
            result.code.includes('import random'));
    },
    s4_custom_procedure: (fixture, result) => {
        check(fixture, 'custom procedure definition generated',
            /def \w+\(/.test(result.code));
        check(fixture, 'no unsupported blocks expected',
            result.coverage.unsupportedTotal === 0,
            `coverage: ${JSON.stringify(result.coverage.unsupported)}`);
    },
    s5_stage_blocks: (fixture, result) => {
        check(fixture, 'unsupported hat emits skipped-stack placeholder',
            result.code.includes('event_whenflagclicked'));
        check(fixture, 'unsupported statement keeps the stack going',
            result.code.includes('x += 2'));
        check(fixture, 'unsupported value block degrades to 0',
            result.code.includes('y = 0'));
        check(fixture, 'unsupported blocks recorded during generation',
            result.unsupportedInPass.includes('event_whenflagclicked') &&
            result.unsupportedInPass.includes('looks_think') &&
            result.unsupportedInPass.includes('sensing_loudness'),
            `recorded: ${JSON.stringify(result.unsupportedInPass)}`);
        check(fixture, 'coverage reports unsupported stage blocks',
            result.coverage.unsupportedTotal >= 4 &&
            result.coverage.unsupported.motion_movesteps === 1,
            `coverage: ${JSON.stringify(result.coverage.unsupported)}`);
    },
    s6_wait_until: (fixture, result) => {
        check(fixture, 'wait_until loop body must not be empty',
            /while not [^\n]+:\n\s+\S/.test(result.code));
    },
    s7_nested_repeat: (fixture, result) => {
        for (const loopVar of ['count', 'count2', 'count3']) {
            check(fixture, `nested repeat uses loop variable "${loopVar}"`,
                result.code.includes(`for ${loopVar} in range(`));
        }
    }
};

// --- Run -------------------------------------------------------------------

const fixtures = fs.readdirSync(fixturesDir)
    .filter(f => f.endsWith('.xml'))
    .sort();

if (fixtures.length === 0) {
    process.stderr.write('No fixtures found.\n');
    process.exit(1);
}

if (update && !fs.existsSync(expectedDir)) {
    fs.mkdirSync(expectedDir, {recursive: true});
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'python-snapshot-'));
let generatedCount = 0;

for (const fixtureFile of fixtures) {
    const fixture = path.basename(fixtureFile, '.xml');
    const xmlText = fs.readFileSync(path.join(fixturesDir, fixtureFile), 'utf8');

    let result;
    try {
        result = generate(xmlText);
    } catch (err) {
        check(fixture, 'generation must not throw', false, err.stack.split('\n', 3).join('\n'));
        continue;
    }
    generatedCount++;

    const snapshotPath = path.join(expectedDir, `${fixture}.py`);
    if (update) {
        fs.writeFileSync(snapshotPath, result.code);
        process.stdout.write(`updated ${path.relative(repoRoot, snapshotPath)}\n`);
    } else if (!fs.existsSync(snapshotPath)) {
        check(fixture, 'snapshot exists (run with --update to create)', false);
    } else {
        const expected = fs.readFileSync(snapshotPath, 'utf8');
        check(fixture, 'generated code matches snapshot', result.code === expected,
            `---- generated ----\n${result.code}\n---- expected ----\n${expected}`);
    }

    // Syntax check the generated code, not just the stored snapshot.
    const pyFile = path.join(tmpDir, `${fixture}.py`);
    fs.writeFileSync(pyFile, result.code);
    try {
        execFileSync('python3', ['-m', 'py_compile', pyFile], {stdio: 'pipe'});
    } catch (err) {
        check(fixture, 'py_compile must pass', false, String(err.stderr));
    }

    if (extraAssertions[fixture]) {
        extraAssertions[fixture](fixture, result);
    }
}

process.stdout.write(`\n${generatedCount}/${fixtures.length} fixtures generated`);
if (update && !failures.length) {
    process.stdout.write(', snapshots refreshed.\n');
    process.exit(0);
}
if (failures.length) {
    process.stdout.write(`, ${failures.length} failure(s):\n\n`);
    for (const failure of failures) {
        process.stdout.write(`FAIL ${failure}\n`);
    }
    process.exit(1);
}
process.stdout.write(', all assertions passed.\n');
