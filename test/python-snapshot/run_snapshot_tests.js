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

// Device blocks (extendedOpcode deviceType_category_opcode) are defined
// dynamically by the VM at runtime. Register a minimal equivalent so
// fixtures using the MicroPython pin event hat can load headlessly.
ScratchBlocks.Blocks.microPython_pin_whenPinLevel = {
    init: function () {
        this.jsonInit({
            message0: 'when pin %1 becomes %2',
            args0: [
                {
                    type: 'field_dropdown',
                    name: 'PIN',
                    options: [['IO4', '4'], ['IO5', '5']]
                },
                {
                    type: 'field_dropdown',
                    name: 'LEVEL',
                    options: [['high', '1'], ['low', '0']]
                }
            ],
            nextStatement: null
        });
    }
};

// --- Optional device extensions (external-resources-v3) --------------------
// s10/s11 exercise the *real* extension generators to lock the cross-cutting
// contract that a device extension registers its blocks + generators against
// the shared Blockly instance (and, for event hats, opts into asyncio mode
// via Blockly.Python.MICROPYTHON_EVENT_HATS). The extensions live in a sibling
// repo, so each is a soft dependency: when one is absent we warn and drop its
// fixture rather than failing the suite (a hand-written inline stub would not
// actually test the real generator).
const extensionsDir = path.join(repoRoot, '..', 'external-resources-v3', 'extensions');
const optionalExtensions = [
    {id: 'espEspNow', probe: 'espEspNow_whenMessage', fixture: 's10_espnow_async.xml'},
    {id: 'espBme280', probe: 'espBme280_temperature', fixture: 's11_bme280_read.xml'}
];
// Extension modules are CommonJS-ish (`exports = registerFn`). Run each in a
// sandbox that returns the assigned export, then register it against the same
// headless Blockly instance the generators use.
const loadExtModule = (extDir, file) => {
    const src = fs.readFileSync(path.join(extDir, file), 'utf8');
    return new Function('exports', 'Blockly', `${src}\nreturn exports;`)(undefined, ScratchBlocks);
};
// Device.getPinOptions resolves the active board's pin list from the live
// flyout, which does not exist headlessly. Make it return null so extension
// blocks with device pin dropdowns fall back to their built-in defaults.
if (ScratchBlocks.Device && typeof ScratchBlocks.Device.getPinOptions === 'function') {
    ScratchBlocks.Device.getPinOptions = () => null;
}
const skippedFixtures = new Set();
for (const ext of optionalExtensions) {
    const extDir = path.join(extensionsDir, ext.id);
    let available = false;
    if (fs.existsSync(path.join(extDir, 'generator.js')) &&
        fs.existsSync(path.join(extDir, 'blocks.js'))) {
        try {
            loadExtModule(extDir, 'blocks.js')(ScratchBlocks);
            loadExtModule(extDir, 'generator.js')(ScratchBlocks);
            available = typeof ScratchBlocks.Python[ext.probe] === 'function';
        } catch (err) {
            process.stdout.write(
                `WARN ${ext.id} extension failed to load, skipping ${ext.fixture}: ${err.message}\n`);
        }
    }
    if (!available) {
        process.stdout.write(
            `WARN ${ext.id} extension not found (external-resources-v3), skipping ${ext.fixture}.\n`);
        skippedFixtures.add(ext.fixture);
    }
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
    },
    s8_async_two_stacks: (fixture, result) => {
        check(fixture, 'both begin stacks become asyncio tasks',
            result.code.includes('async def _ob_task1():') &&
            result.code.includes('async def _ob_task2():'),
            result.code);
        check(fixture, 'tasks started under one gather entry point',
            result.code.includes('await asyncio.gather(_ob_task1(), _ob_task2())') &&
            result.code.includes('asyncio.run(_ob_main())'),
            result.code);
        check(fixture, 'wait block awaits instead of blocking',
            result.code.includes('await asyncio.sleep(1)'),
            result.code);
        check(fixture, 'wait_until polls cooperatively',
            /while not [^\n]+:\n\s+await asyncio\.sleep_ms\(10\)/.test(result.code),
            result.code);
        check(fixture, 'forever loop yields to sibling tasks',
            result.code.includes('await asyncio.sleep_ms(0)'),
            result.code);
        check(fixture, 'tasks declare shared variables global',
            /async def _ob_task1\(\):\n\s+global score/.test(result.code),
            result.code);
    },
    s9_pin_event_hat: (fixture, result) => {
        check(fixture, 'pin hat generates handler and watcher tasks',
            result.code.includes('async def _ob_on_pin4_2():') &&
            result.code.includes('async def _ob_watch2():'),
            result.code);
        check(fixture, 'watcher fires the handler on the rising edge',
            result.code.includes('if _ob_now == 1 and _ob_last != 1:') &&
            result.code.includes('await _ob_on_pin4_2()'),
            result.code);
        check(fixture, 'rising edge watch defaults the pin to pull-down',
            result.code.includes('p4.init(Pin.IN, Pin.PULL_DOWN)'),
            result.code);
        check(fixture, 'begin task and watcher both gathered',
            result.code.includes('await asyncio.gather(_ob_task1(), _ob_watch2())'),
            result.code);
    },
    s10_espnow_async: (fixture, result) => {
        // Loaded from the real extension, so this locks the contract that an
        // external device generator can opt a hat into async multi-task mode.
        check(fixture, 'extension registered its hat in MICROPYTHON_EVENT_HATS',
            ScratchBlocks.Python.MICROPYTHON_EVENT_HATS.indexOf('espEspNow_whenMessage') !== -1);
        check(fixture, 'message hat becomes an async handler + watcher',
            result.code.includes('async def _ob_on_espnow():') &&
            result.code.includes('async def _ob_espnow_watch():'),
            result.code);
        check(fixture, 'watcher polls espnow and awaits the handler',
            result.code.includes('if _ob_now.poll():') &&
            result.code.includes('await _ob_on_espnow()'),
            result.code);
        check(fixture, 'begin task and espnow watcher both gathered',
            result.code.includes('await asyncio.gather(_ob_task1(), _ob_espnow_watch())') &&
            result.code.includes('asyncio.run(_ob_main())'),
            result.code);
        check(fixture, 'espnow runtime imported and initialised once',
            result.code.includes('import obespnow') &&
            result.code.includes('_ob_now = obespnow.OBEspNow()'),
            result.code);
    },
    s11_bme280_read: (fixture, result) => {
        // Sync path (single begin stack): the real sensor extension imports
        // its driver and builds one shared SoftI2C bus, and every reporter
        // reads from that instance.
        check(fixture, 'bme280 init imports driver and builds SoftI2C bus once',
            result.code.includes('import bme280') &&
            result.code.includes('_bme = bme280.BME280(SoftI2C(sda=Pin(21), scl=Pin(22)))'),
            result.code);
        check(fixture, 'all four sensor reporters read from the _bme instance',
            result.code.includes('_bme.temperature()') &&
            result.code.includes('_bme.humidity()') &&
            result.code.includes('_bme.pressure()') &&
            result.code.includes('_bme.altitude()'),
            result.code);
    }
};

// --- Run -------------------------------------------------------------------

const fixtures = fs.readdirSync(fixturesDir)
    .filter(f => f.endsWith('.xml'))
    // Fixtures for absent optional extensions were flagged above.
    .filter(f => !skippedFixtures.has(f))
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

// --- P2-4: hats whose generator opens no suite must not own an indented body

// Simulates a realtime-only hat that has a Python generator but emits no
// wrapping `def ...:` header (the upload-mode conversion trap): the stack
// must degrade to legal top-level code instead of IndentationError at boot.
const p24Xml = `<xml xmlns="http://www.w3.org/1999/xhtml">
  <variables><variable type="" id="varX">x</variable></variables>
  <block type="event_whenflagclicked" id="p24hat" x="10" y="10">
    <next>
      <block type="data_setvariableto" id="p24b1">
        <field name="VARIABLE" id="varX">x</field>
        <value name="VALUE"><shadow type="text"><field name="TEXT">1</field></shadow></value>
        <next>
          <block type="control_if" id="p24b2">
            <statement name="SUBSTACK">
              <block type="data_changevariableby" id="p24b3">
                <field name="VARIABLE" id="varX">x</field>
                <value name="VALUE"><shadow type="math_number"><field name="NUM">2</field></shadow></value>
              </block>
            </statement>
          </block>
        </next>
      </block>
    </next>
  </block>
</xml>`;

const compileCheck = (fixture, label, code) => {
    const pyFile = path.join(tmpDir, `${fixture}.py`);
    fs.writeFileSync(pyFile, code);
    try {
        execFileSync('python3', ['-m', 'py_compile', pyFile], {stdio: 'pipe'});
    } catch (err) {
        check(fixture, label, false, `${String(err.stderr)}\n---- code ----\n${code}`);
    }
};

try {
    // Hat generator without a suite header: stack degrades to top level.
    ScratchBlocks.Python.event_whenflagclicked = () => '';
    const flat = generate(p24Xml);
    check('p2-4_headerless_hat', 'degradation notice emitted',
        flat.code.includes('event_whenflagclicked \u5e3d\u5b50\u672a\u751f\u6210\u51fd\u6570\u5934'),
        flat.code);
    check('p2-4_headerless_hat', 'children land at top level (no leading indent)',
        flat.code.includes('\nx = 1\n') && flat.code.includes('\nif False:\n'),
        flat.code);
    check('p2-4_headerless_hat', 'nested body keeps one indent level',
        /\nif False:\n {2}x \+= 2\n/.test(flat.code),
        flat.code);
    compileCheck('p2-4_headerless_hat', 'py_compile must pass', flat.code);

    // Hat generator that does open a suite keeps the indented body as-is.
    ScratchBlocks.Python.event_whenflagclicked = () => 'def on_flag_clicked():\n';
    const wrapped = generate(p24Xml);
    check('p2-4_wrapping_hat', 'suite-opening hat keeps indented body',
        wrapped.code.includes('def on_flag_clicked():\n  x = 1\n'),
        wrapped.code);
    check('p2-4_wrapping_hat', 'no degradation notice for wrapping hat',
        !wrapped.code.includes('\u5e3d\u5b50\u672a\u751f\u6210\u51fd\u6570\u5934'),
        wrapped.code);
    compileCheck('p2-4_wrapping_hat', 'py_compile must pass', wrapped.code);
} catch (err) {
    check('p2-4', 'generation must not throw', false, err.stack.split('\n', 3).join('\n'));
} finally {
    delete ScratchBlocks.Python.event_whenflagclicked;
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
