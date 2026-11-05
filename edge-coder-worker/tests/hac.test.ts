import { expect, test, describe } from 'vitest';
import {
  isHardwareAsCodeFile,
  validateCodeSyntax,
  validateFreeCadScript,
  validateMuJoCoModel,
  validatePlatformIoConfig,
  validatePlatformIoFirmware,
  validateUsdStage
} from '../src/code_generator';

const VALID_FREECAD = `import FreeCAD
import Part
from FreeCAD import Vector

def build_bracket():
    doc = FreeCAD.newDocument("bracket")
    plate = Part.makeBox(120, 80, 6)
    boss = Part.makeCylinder(12, 30, Vector(60, 40, 0))
    bracket = plate.fuse(boss)
    obj = doc.addObject("Part::Feature", "Bracket")
    obj.Shape = bracket
    doc.recompute()
    return doc

build_bracket()
`;

const VALID_MJCF = `<mujoco model="arm">
  <compiler angle="radian"/>
  <worldbody>
    <body name="link1" pos="0 0 0.1">
      <joint name="shoulder" type="hinge" axis="0 0 1" range="-1.57 1.57"/>
      <inertial pos="0 0 0.05" mass="1.2" diaginertia="0.01 0.01 0.002"/>
      <geom type="capsule" fromto="0 0 0 0 0 0.2" size="0.02"/>
    </body>
  </worldbody>
</mujoco>
`;

const VALID_URDF = `<robot name="axim_arm">
  <link name="base_link">
    <inertial>
      <mass value="2.5"/>
      <origin xyz="0 0 0"/>
    </inertial>
  </link>
  <link name="link1">
    <inertial>
      <mass value="1.1"/>
      <origin xyz="0 0 0.1"/>
    </inertial>
  </link>
  <joint name="shoulder" type="revolute">
    <parent link="base_link"/>
    <child link="link1"/>
    <limit lower="-1.57" upper="1.57" effort="10" velocity="1"/>
  </joint>
</robot>
`;

const VALID_PLATFORMIO = `[env:esp32s3]
platform = espressif32
board = esp32-s3-devkitc-1
framework = arduino
monitor_speed = 115200
`;

const VALID_SKETCH = `#include <Arduino.h>

void setup() {
  Serial.begin(115200);
}

void loop() {
  delay(100);
}
`;

describe('FreeCAD (Python) hardware-as-code validation', () => {
  test('accepts a script that builds and recomputes real geometry', () => {
    expect(validateCodeSyntax(VALID_FREECAD, 'models/bracket.py')).toEqual({ valid: true });
    expect(validateFreeCadScript(VALID_FREECAD).valid).toBe(true);
  });

  test('a plain Python file with no geometry import is not treated as a FreeCAD script', () => {
    const script = 'def build():\n    return 1\n';
    // Generic Python still passes structural validation...
    expect(validateCodeSyntax(script, 'src/helpers.py').valid).toBe(true);
    // ...but the FreeCAD-specific gate rejects it outright.
    expect(validateFreeCadScript(script).valid).toBe(false);
  });

  test('rejects a primitive constructed with no dimensions', () => {
    const code = 'import Part\nbox = Part.makeBox()\nPart.show(box)\n';
    const result = validateFreeCadScript(code);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('without dimensions');
  });

  test('rejects a Sketch that never adds geometry or constraints', () => {
    const code = 'import FreeCAD\nimport Sketcher\ndoc = FreeCAD.newDocument("s")\nsketch = doc.addObject("Sketcher::SketchObject", "Sketch")\ndoc.recompute()\n';
    const result = validateFreeCadScript(code);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('addGeometry');
  });

  test('accepts a Sketch that adds geometry and constraints', () => {
    const code = `import FreeCAD
import Part
import Sketcher
doc = FreeCAD.newDocument("s")
sketch = doc.addObject("Sketcher::SketchObject", "Sketch")
sketch.addGeometry(Part.LineSegment(FreeCAD.Vector(0, 0, 0), FreeCAD.Vector(10, 0, 0)))
sketch.addConstraint(Sketcher.Constraint("DistanceX", 0, 10.0))
doc.recompute()
`;
    expect(validateFreeCadScript(code).valid).toBe(true);
  });

  test('rejects a script that never shows, recomputes or exports', () => {
    const code = 'import Part\nbox = Part.makeBox(1, 1, 1)\n';
    const result = validateFreeCadScript(code);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('never shows, recomputes or exports');
  });

  test('rejects a Python block definition with no colon', () => {
    const code = 'import Part\ndef build()\n    box = Part.makeBox(1, 1, 1)\n    Part.show(box)\n';
    const result = validateCodeSyntax(code, 'models/broken.py');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('missing colon');
  });
});

describe('MuJoCo / URDF hardware-as-code validation', () => {
  test('accepts a model with joint limits and inertials', () => {
    expect(validateCodeSyntax(VALID_MJCF, 'robot/arm.xml')).toEqual({ valid: true });
    expect(validateCodeSyntax(VALID_MJCF, 'robot/arm.mjcf')).toEqual({ valid: true });
  });

  test('rejects a hinge joint with no range limit', () => {
    const broken = VALID_MJCF.replace(' range="-1.57 1.57"', '');
    const result = validateMuJoCoModel(broken, 'robot/arm.xml');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('range="min max"');
  });

  test('rejects a hinge joint with an inverted range', () => {
    const broken = VALID_MJCF.replace('range="-1.57 1.57"', 'range="1.57 -1.57"');
    expect(validateMuJoCoModel(broken, 'robot/arm.xml').valid).toBe(false);
  });

  test('rejects a sliding joint with no axis', () => {
    const broken = VALID_MJCF.replace(' axis="0 0 1"', '');
    const result = validateMuJoCoModel(broken, 'robot/arm.xml');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('three-component axis');
  });

  test('rejects an unnamed joint', () => {
    const broken = VALID_MJCF.replace('name="shoulder" ', '');
    const result = validateMuJoCoModel(broken, 'robot/arm.xml');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('missing a name attribute');
  });

  test('rejects an inertial block with no positive mass', () => {
    const broken = VALID_MJCF.replace('mass="1.2"', 'mass="0"');
    const result = validateMuJoCoModel(broken, 'robot/arm.xml');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('positive mass');
  });

  test('rejects an inertial block with no pos', () => {
    const broken = VALID_MJCF.replace('pos="0 0 0.05" ', '');
    const result = validateMuJoCoModel(broken, 'robot/arm.xml');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('pos="x y z"');
  });

  test('rejects a model with no mujoco root element', () => {
    const result = validateMuJoCoModel('<worldbody></worldbody>', 'robot/arm.xml');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('<mujoco>');
  });

  test('rejects unbalanced XML tags', () => {
    const broken = VALID_MJCF.replace('</body>', '');
    const result = validateMuJoCoModel(broken, 'robot/arm.xml');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/Unbalanced XML tags|Unclosed XML tags/);
  });

  test('accepts a URDF with limits and inertials', () => {
    expect(validateCodeSyntax(VALID_URDF, 'robot/arm.urdf')).toEqual({ valid: true });
  });

  test('rejects a URDF revolute joint with no limit block', () => {
    const broken = VALID_URDF.replace(/<limit[^>]*\/>/, '');
    const result = validateMuJoCoModel(broken, 'robot/arm.urdf');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('<limit');
  });

  test('rejects a URDF with no inertial data', () => {
    const broken = VALID_URDF.replace(/<inertial>[\s\S]*?<\/inertial>/g, '');
    const result = validateMuJoCoModel(broken, 'robot/arm.urdf');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('massless');
  });

  test('rejects a URDF whose robot element has no name', () => {
    const broken = VALID_URDF.replace('<robot name="axim_arm">', '<robot>');
    const result = validateMuJoCoModel(broken, 'robot/arm.urdf');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('missing a name attribute');
  });

  test('accepts a joint whose range and axis are inherited from a default class', () => {
    // The idiom every hand-written MJCF model uses. The validator used to read
    // only the joint's own attributes and reject this as "missing a range".
    const inherited = `<mujoco model="arm">
  <default>
    <joint axis="0 0 1" range="-1.57 1.57"/>
    <default class="gripper">
      <joint range="0 0.8"/>
    </default>
  </default>
  <worldbody>
    <body name="link1" pos="0 0 0.1">
      <joint name="shoulder" type="hinge"/>
      <joint name="finger" type="hinge" class="gripper"/>
      <inertial pos="0 0 0.05" mass="1.2" diaginertia="0.01 0.01 0.002"/>
    </body>
  </worldbody>
</mujoco>
`;
    expect(validateMuJoCoModel(inherited, 'robot/arm.xml')).toEqual({ valid: true });
  });

  test('a class template cannot rescue a joint that still has no range anywhere', () => {
    const noRange = `<mujoco model="arm">
  <default class="gripper">
    <joint axis="0 0 1"/>
  </default>
  <worldbody>
    <body name="link1" pos="0 0 0.1">
      <joint name="finger" type="hinge" class="gripper"/>
      <inertial pos="0 0 0.05" mass="1.2" diaginertia="0.01 0.01 0.002"/>
    </body>
  </worldbody>
</mujoco>
`;
    const result = validateMuJoCoModel(noRange, 'robot/arm.xml');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('range="min max"');
  });

  test('the joint\'s own limit overrides its class template', () => {
    const overridden = `<mujoco model="arm">
  <default class="gripper">
    <joint axis="0 0 1" range="0 0.8"/>
  </default>
  <worldbody>
    <body name="link1" pos="0 0 0.1">
      <joint name="finger" type="hinge" class="gripper" range="0.8 0"/>
      <inertial pos="0 0 0.05" mass="1.2" diaginertia="0.01 0.01 0.002"/>
    </body>
  </worldbody>
</mujoco>
`;
    expect(validateMuJoCoModel(overridden, 'robot/arm.xml').valid).toBe(false);
  });
});

describe('OpenUSD hardware-as-code validation', () => {
  const VALID_USDA = `#usda 1.0
(
    defaultPrim = "Bracket"
    metersPerUnit = 0.001
)

def Xform "Bracket"
{
    def Cube "Plate"
    {
        double size = 120
    }
}
`;

  test('accepts a stage with a header and a prim tree', () => {
    expect(validateCodeSyntax(VALID_USDA, 'models/bracket.usda')).toEqual({ valid: true });
    expect(validateUsdStage(VALID_USDA).valid).toBe(true);
  });

  test('rejects a stage with no #usda header', () => {
    const result = validateUsdStage('def Xform "Bracket"\n{\n}\n');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('#usda 1.0');
  });

  test('rejects a truncated prim tree', () => {
    const truncated = VALID_USDA.replace(/\}\s*$/, '');
    const result = validateUsdStage(truncated);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Unbalanced USDA prim scopes');
  });

  test('rejects a stage that defines no prims', () => {
    const result = validateUsdStage('#usda 1.0\n(\n    defaultPrim = "Bracket"\n)\n');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('defines no prims');
  });

  test('braces inside asset paths and comments do not count', () => {
    const tricky = `#usda 1.0

def Xform "Bracket"
{
    # a comment with an unbalanced { brace
    asset path = "@{asset}"
}
`;
    expect(validateUsdStage(tricky).valid).toBe(true);
  });
});

describe('PlatformIO hardware-as-code validation', () => {
  test('accepts a complete platformio.ini', () => {
    expect(validateCodeSyntax(VALID_PLATFORMIO, 'platformio.ini')).toEqual({ valid: true });
    expect(validatePlatformIoConfig(VALID_PLATFORMIO).valid).toBe(true);
  });

  test('rejects platformio.ini with no env section', () => {
    const result = validatePlatformIoConfig('board = esp32-s3-devkitc-1\n');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('[env:');
  });

  test('rejects platformio.ini with no board', () => {
    const result = validatePlatformIoConfig('[env:esp32s3]\nplatform = espressif32\nframework = arduino\n');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('board');
  });

  test('accepts a complete Arduino sketch', () => {
    expect(validateCodeSyntax(VALID_SKETCH, 'src/main.ino')).toEqual({ valid: true });
    expect(validatePlatformIoFirmware(VALID_SKETCH, 'src/main.ino').valid).toBe(true);
  });

  test('rejects a sketch with no include', () => {
    const result = validatePlatformIoFirmware('void setup() {}\nvoid loop() {}\n', 'src/main.ino');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('#include');
  });

  test('rejects a sketch with no loop()', () => {
    const result = validatePlatformIoFirmware(
      '#include <Arduino.h>\nvoid setup() { Serial.begin(115200); }\n',
      'src/main.ino'
    );
    expect(result.valid).toBe(false);
    expect(result.error).toContain('void loop()');
  });

  test('rejects a sketch with no setup()', () => {
    const result = validatePlatformIoFirmware(
      '#include <Arduino.h>\nvoid loop() { delay(10); }\n',
      'src/main.ino'
    );
    expect(result.valid).toBe(false);
    expect(result.error).toContain('void setup()');
  });

  test('rejects mismatched braces in C++ before checking firmware shape', () => {
    const result = validateCodeSyntax('#include <Arduino.h>\nvoid setup() {\n', 'src/main.ino');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Mismatched curly braces in C++');
  });

  test('accepts a declaration-only header guarded with #pragma once', () => {
    // Headers used to be rejected for having no #include, which failed legal
    // files like this one and dead-ended the task after the retry.
    const header = `#pragma once\n\nstruct MotorState {\n  float rpm;\n  float current_a;\n};\n`;
    expect(validateCodeSyntax(header, 'include/motor_state.h')).toEqual({ valid: true });
    expect(validateCodeSyntax(header, 'include/motor_state.hpp')).toEqual({ valid: true });
  });

  test('accepts a header guarded with #ifndef/#define', () => {
    const header = `#ifndef MOTOR_STATE_H\n#define MOTOR_STATE_H\nstruct MotorState { float rpm; };\n#endif\n`;
    expect(validatePlatformIoFirmware(header, 'include/motor_state.h').valid).toBe(true);
  });

  test('rejects a header with no include guard', () => {
    const result = validateCodeSyntax('struct MotorState { float rpm; };\n', 'include/motor_state.h');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('include guard');
  });

  test('still requires a translation unit to include a HAL', () => {
    const result = validatePlatformIoFirmware('int main() { return 0; }\n', 'src/main.cpp');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('#include');
  });
});

describe('Hardware-as-code file routing', () => {
  test('classifies the HAC file types the terminal can request', () => {
    for (const file of [
      'model.py', 'arm.xml', 'arm.mjcf', 'arm.urdf', 'main.ino', 'main.cpp', 'main.cc',
      'main.h', 'motor_state.hpp', 'motor_state.hh', 'stage.usda', 'stage.usd', 'platformio.ini'
    ]) {
      expect(isHardwareAsCodeFile(file), file).toBe(true);
    }
  });

  test('does not classify application source as hardware', () => {
    for (const file of ['App.jsx', 'index.ts', 'README.md', 'schema.json']) {
      expect(isHardwareAsCodeFile(file), file).toBe(false);
    }
  });
});
