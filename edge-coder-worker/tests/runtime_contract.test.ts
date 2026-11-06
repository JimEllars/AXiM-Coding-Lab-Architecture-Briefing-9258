/**
 * Runtime-contract parity: the dashboard's promise vs the worker's routing.
 *
 * `src/lib/fleetRegistry.js` publishes `RUNTIME_EXPECTED_EXTENSIONS` and
 * `PromptTerminal` uses it to tell the operator "this runtime covers this
 * path". The worker is what actually enforces that promise in
 * `validateCodeSyntax()`. Nothing tied the two together, so they drifted:
 * the dashboard advertised `.xml` under `ROS 2 / Python`, the worker routed
 * every `.xml` to the MuJoCo validator, and every well-formed ROS 2 launch
 * file came back "missing the <mujoco> root element" after an LLM run had
 * already been paid for.
 *
 * This suite is the missing link. For every `(runtime, extension)` pair the
 * dashboard advertises, it renders a small but genuine artifact of that type
 * and requires the worker to accept it. A new extension in the table without a
 * matching branch in the worker fails here instead of in production.
 *
 * The fixtures are deliberately minimal-but-real: they satisfy the validators'
 * actual requirements (include guards, joint ranges, inertial mass) rather than
 * being shaped to slip past them, so a validator that gets stricter later
 * surfaces as a fixture that needs updating — which is the point.
 */
import { describe, it, expect } from 'vitest';
import { validateCodeSyntax } from '../src/code_generator';
import { RUNTIME_EXPECTED_EXTENSIONS, findRuntimeMismatches } from '../../src/lib/fleetRegistry.js';

/** A representative, valid artifact for each extension the dashboard promises. */
const FIXTURES: Record<string, string> = {
  '.ts': 'export const retryLimit = 3;\n',
  '.tsx': "export const Badge = () => <span>b</span>;\n",
  '.js': 'export const retryLimit = 3;\n',
  '.jsx': "export const Badge = () => <span>b</span>;\n",
  '.json': '{ "retryLimit": 3 }\n',
  // Plain module: the FreeCAD validator must not fire, because the script
  // imports no geometry API.
  '.py:plain': 'def add(a, b):\n    return a + b\n',
  // FreeCAD script: imports the geometry API and emits a solid.
  '.py:freecad': [
    'import FreeCAD',
    'import Part',
    'doc = FreeCAD.newDocument("bracket")',
    'box = Part.makeBox(40, 20, 5)',
    'doc.addObject("Part::Feature", "Bracket").Shape = box',
    'doc.recompute()',
    '',
  ].join('\n'),
  '.cpp': '#include <Arduino.h>\nint main(void) { return 0; }\n',
  '.cc': '#include <Arduino.h>\nint main(void) { return 0; }\n',
  '.ino': [
    '#include <Arduino.h>',
    'void setup() { pinMode(2, OUTPUT); }',
    'void loop() { digitalWrite(2, HIGH); }',
    '',
  ].join('\n'),
  '.h': '#pragma once\nint readSensor(void);\n',
  '.hpp': '#ifndef SENSOR_HPP\n#define SENSOR_HPP\nint readSensor();\n#endif\n',
  '.hh': '#pragma once\nclass Sensor {};\n',
  '.ini': '[env:esp32dev]\nplatform = espressif32\nboard = esp32dev\nframework = arduino\n',
  // ROS 2 launch file: the artifact that used to be rejected.
  '.xml:ros2': [
    '<?xml version="1.0"?>',
    '<launch>',
    '  <node pkg="telemetry" exec="publisher" name="telemetry_publisher">',
    '    <param name="rate_hz" value="50"/>',
    '  </node>',
    '</launch>',
    '',
  ].join('\n'),
  // MuJoCo scene.
  '.xml:mujoco': [
    '<mujoco model="arm">',
    '  <worldbody>',
    '    <body name="link1">',
    '      <inertial pos="0 0 0" mass="1.2"/>',
    '      <joint name="shoulder" type="hinge" range="-1.57 1.57" axis="0 0 1"/>',
    '    </body>',
    '  </worldbody>',
    '</mujoco>',
    '',
  ].join('\n'),
  '.mjcf': [
    '<mujoco model="arm">',
    '  <worldbody>',
    '    <body name="link1">',
    '      <inertial pos="0 0 0" mass="1.2"/>',
    '      <joint name="shoulder" type="hinge" range="-1.57 1.57" axis="0 0 1"/>',
    '    </body>',
    '  </worldbody>',
    '</mujoco>',
    '',
  ].join('\n'),
  '.urdf': [
    '<robot name="axim_arm">',
    '  <link name="base_link">',
    '    <inertial><mass value="2.0"/></inertial>',
    '  </link>',
    '  <joint name="shoulder_joint" type="revolute">',
    '    <limit lower="-1.57" upper="1.57"/>',
    '  </joint>',
    '</robot>',
    '',
  ].join('\n'),
  '.usda': ['#usda 1.0', 'def Xform "Bracket"', '{', '}', ''].join('\n'),
  '.usd': 'PX2CRATE is a binary container; the worker never parses it as text.\n',
  '.yaml': 'nodes:\n  publisher:\n    rate_hz: 50\n',
  '.yml': 'nodes:\n  publisher:\n    rate_hz: 50\n',
  '.toml': '[ros2]\nrate_hz = 50\n',
};

/**
 * `.py` and `.xml` mean different things depending on the runtime, so the
 * lookup is keyed on `runtime:ext` where ambiguity exists.
 */
const DISAMBIGUATED: Record<string, Record<string, string>> = {
  'Python Sandbox': { '.py': '.py:plain' },
  'ROS 2 / Python': { '.py': '.py:plain', '.xml': '.xml:ros2' },
  'FreeCAD / OpenUSD': { '.py': '.py:freecad' },
  'MuJoCo / URDF': { '.xml': '.xml:mujoco' },
};

function fixtureFor(runtime: string, ext: string): string {
  const key = DISAMBIGUATED[runtime]?.[ext] ?? ext;
  const fixture = FIXTURES[key];
  if (!fixture) throw new Error(`No fixture for ${runtime} / ${ext} (looked up "${key}")`);
  return fixture;
}

function samplePathFor(runtime: string, ext: string): string {
  if (ext === '.ini') return 'platformio.ini';
  const base = runtime.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `fixtures/${base}/artifact${ext}`;
}

describe('runtime contract parity (dashboard promise vs worker routing)', () => {
  const pairs: Array<{ runtime: string; ext: string }> = [];
  for (const [runtime, extensions] of Object.entries(RUNTIME_EXPECTED_EXTENSIONS as Record<string, string[]>)) {
    for (const ext of extensions) pairs.push({ runtime, ext });
  }

  it('has at least one advertised extension per runtime', () => {
    expect(pairs.length).toBeGreaterThan(0);
    for (const runtime of Object.keys(RUNTIME_EXPECTED_EXTENSIONS)) {
      expect(
        pairs.some((pair) => pair.runtime === runtime),
        `${runtime} advertises no extensions`
      ).toBe(true);
    }
  });

  it.each(pairs.map((pair) => [`${pair.runtime} → ${pair.ext}`, pair] as const))(
    'worker accepts a valid %s artifact',
    (_label, { runtime, ext }) => {
      const path = samplePathFor(runtime, ext);
      const code = fixtureFor(runtime, ext);

      // The dashboard must consider this path valid for the runtime, otherwise
      // the operator is warned about a combination the table itself lists.
      expect(findRuntimeMismatches(runtime, [path])).toEqual([]);

      const verdict = validateCodeSyntax(code, path);
      expect(verdict.valid, `${runtime} ${ext}: ${verdict.error}`).toBe(true);
    }
  );

  it('rejects a path whose extension the runtime does not advertise', () => {
    // The counter-case: the hint has to be able to fire, or the parity
    // assertions above would pass trivially on an empty mismatch list.
    expect(findRuntimeMismatches('FreeCAD / OpenUSD', ['src/main.cpp'])).toEqual(['src/main.cpp']);
    expect(findRuntimeMismatches('Node.js Edge', ['models/bracket.py'])).toEqual(['models/bracket.py']);
  });

  it('still rejects a robotics model that violates the HAC contract', () => {
    // Parity must not have been bought by loosening the validator.
    const unconstrainedHinge = [
      '<mujoco model="arm">',
      '  <worldbody>',
      '    <body name="link1">',
      '      <joint name="shoulder" type="hinge" axis="0 0 1"/>',
      '    </body>',
      '  </worldbody>',
      '</mujoco>',
    ].join('\n');
    expect(validateCodeSyntax(unconstrainedHinge, 'robot/scene.xml').valid).toBe(false);
  });

  it('still rejects a ROS 2 launch file with unclosed tags', () => {
    const broken = '<launch>\n  <node name="x">\n</launch>\n';
    expect(validateCodeSyntax(broken, 'launch/broken.launch.xml').valid).toBe(false);
  });
});
