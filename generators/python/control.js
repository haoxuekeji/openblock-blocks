/**
 * Visual Blocks Language
 *
 * Copyright 2021 Arthur Zheng.
 * https://github.com/openblockcc/hxblock-blocks
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
'use strict';

goog.provide('Blockly.Python.control');

goog.require('Blockly.Python');


Blockly.Python['control_wait'] = function(block) {
  var arg0 = Blockly.Python.valueToCode(block, 'DURATION',
      Blockly.Python.ORDER_FUNCTION_CALL);
  // The microbit firmware provides a global sleep(ms). Other MicroPython
  // boards (esp32 etc.) only have time.sleep(seconds).
  if (block.getRootBlock().type.indexOf('event_whenmicrobit') === 0) {
    return "sleep(" + arg0 + " * 1000" + ")\n";
  }
  // Inside an asyncio task a blocking sleep would starve every other
  // task, await the scheduler-friendly sleep instead.
  if (Blockly.Python.isInAsyncTask(block)) {
    Blockly.Python.imports_['asyncio'] = 'import asyncio';
    return "await asyncio.sleep(" + arg0 + ")\n";
  }
  Blockly.Python.imports_['time'] = 'import time';
  var code = "time.sleep(" + arg0 + ")\n";
  return code;
};

Blockly.Python['control_repeat'] = function(block) {
  var repeats = Blockly.Python.valueToCode(block, 'TIMES',
      Blockly.Python.ORDER_FUNCTION_CALL);
  var branch = Blockly.Python.statementToCode(block, 'SUBSTACK');
  branch = Blockly.Python.addLoopTrap(branch, block.id);

  // Nested repeat loops each need their own loop variable, otherwise the
  // inner loop shadows the outer one: count, count2, count3...
  // These names are declared in Blockly.Python.addReservedWords.
  var depth = 0;
  var parent = block.getSurroundParent();
  while (parent) {
    if (parent.type === 'control_repeat') {
      depth++;
    }
    parent = parent.getSurroundParent();
  }
  var loopVar = depth === 0 ? 'count' : 'count' + (depth + 1);

  var code = "for " + loopVar + " in range(" + repeats + "):\n";
  if (branch) {
    code += branch;
  } else {
    code += Blockly.Python.INDENT + "pass\n";
  }
  // Yield once per iteration so sibling asyncio tasks stay scheduled even
  // when the loop body contains no await of its own.
  if (Blockly.Python.isInAsyncTask(block)) {
    Blockly.Python.imports_['asyncio'] = 'import asyncio';
    code += Blockly.Python.INDENT + "await asyncio.sleep_ms(0)\n";
  }
  return code;
};

Blockly.Python['control_forever'] = function(block) {
  var branch = Blockly.Python.statementToCode(block, 'SUBSTACK');
  branch = Blockly.Python.addLoopTrap(branch, block.id);

  var code = "while True:\n";
  code += branch;

  // Asyncio task: yield each iteration so sibling tasks get scheduled.
  if (Blockly.Python.isInAsyncTask(block)) {
    Blockly.Python.imports_['asyncio'] = 'import asyncio';
    code += Blockly.Python.INDENT + "await asyncio.sleep_ms(0)\n";
    return code;
  }

  var rootType = block.getRootBlock().type;
  if (rootType === 'event_whenmicrobitbegin' || rootType === 'event_whenmicropythonbegin') {
    Blockly.Python.firstLoop = false;
    code += Blockly.Python.INDENT + "repeat()\n";
  }

  return code;
};

Blockly.Python['control_if'] = function(block) {
  var argument = Blockly.Python.valueToCode(block, 'CONDITION',
      Blockly.Python.ORDER_NONE) || 'False';
  var branch = Blockly.Python.statementToCode(block, 'SUBSTACK');
  branch = Blockly.Python.addLoopTrap(branch, block.id);

  var code = "if " + argument + ":\n";
  if (branch) {
    code += branch;
  } else {
    code += Blockly.Python.INDENT + "pass\n";
  }
  return code;
};

Blockly.Python['control_if_else'] = function(block) {
  var argument = Blockly.Python.valueToCode(block, 'CONDITION',
      Blockly.Python.ORDER_NONE) || 'False';
  var branch = Blockly.Python.statementToCode(block, 'SUBSTACK');
  branch = Blockly.Python.addLoopTrap(branch, block.id);
  var branch2 = Blockly.Python.statementToCode(block, 'SUBSTACK2');
  branch2 = Blockly.Python.addLoopTrap(branch2, block.id);

  var code = "if " + argument + ":\n";
  if (branch) {
    code += branch;
  } else {
    code += Blockly.Python.INDENT + "pass\n";
  }
  code += "else:\n";
  if (branch2) {
    code += branch2;
  } else {
    code += Blockly.Python.INDENT + "pass\n";
  }
  return code;
};

Blockly.Python['control_wait_until'] = function(block) {
  var argument = Blockly.Python.valueToCode(block, 'CONDITION',
      Blockly.Python.ORDER_UNARY_POSTFIX) || 'False';
  var code = "while not " + argument + ":\n";
  if (block.getRootBlock().type === 'event_whenmicrobitbegin') {
    code += Blockly.Python.INDENT + "repeat()\n";
  } else if (Blockly.Python.isInAsyncTask(block)) {
    // Poll cooperatively so sibling asyncio tasks keep running while
    // this task waits for the condition.
    Blockly.Python.imports_['asyncio'] = 'import asyncio';
    code += Blockly.Python.INDENT + "await asyncio.sleep_ms(10)\n";
  } else {
    // A while loop with no body is an IndentationError, busy-wait instead.
    code += Blockly.Python.INDENT + "pass\n";
  }
  return code;
};

Blockly.Python['control_repeat_until'] = function(block) {
  var argument = Blockly.Python.valueToCode(block, 'CONDITION',
      Blockly.Python.ORDER_UNARY_POSTFIX) || 'False';

  var branch = Blockly.Python.statementToCode(block, 'SUBSTACK');
  branch = Blockly.Python.addLoopTrap(branch, block.id);

  var code = "while not " + argument + ":\n";
  code += branch;
  if (block.getRootBlock().type === 'event_whenmicrobitbegin') {
    code += Blockly.Python.INDENT + "repeat()\n";
  } else if (Blockly.Python.isInAsyncTask(block)) {
    // Yield once per iteration, mirroring control_forever in async mode.
    Blockly.Python.imports_['asyncio'] = 'import asyncio';
    code += Blockly.Python.INDENT + "await asyncio.sleep_ms(0)\n";
  }
  return code;
};
