/**
 * Visual Blocks Language
 *
 * Copyright 2026 Arthur Zheng.
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

goog.provide('Blockly.Python.esp32');

goog.require('Blockly.Python');


// "when pin becomes level" event hat. Only reachable in async mode (its
// presence activates asyncMode_ in init): the user stack becomes an async
// handler and a watcher task polls the pin for the wanted edge, so several
// hats and begin stacks run concurrently.
Blockly.Python['microPython_pin_whenPinLevel'] = function(block) {
  Blockly.Python.imports_['machine_pin'] = 'from machine import Pin';
  Blockly.Python.imports_['asyncio'] = 'import asyncio';

  var pin = block.getFieldValue('PIN') || '4';
  var level = block.getFieldValue('LEVEL') === '0' ? '0' : '1';
  var ind = Blockly.Python.INDENT;

  Blockly.Python.setups_['pin_' + pin] = 'p' + pin + ' = Pin(' + pin + ')';
  if (!Blockly.Python.setups_['pin_mode_' + pin]) {
    // Bias the idle level away from the watched edge so an unwired pin
    // does not float and self-trigger. An explicit "set pin mode" block
    // still overrides this at boot.
    Blockly.Python.setups_['pin_mode_' + pin] = 'p' + pin +
      '.init(Pin.IN, ' + (level === '1' ? 'Pin.PULL_DOWN' : 'Pin.PULL_UP') + ')';
  }

  Blockly.Python.asyncTaskCount_++;
  var n = Blockly.Python.asyncTaskCount_;
  var handlerName = '_ob_on_pin' + pin + '_' + n;
  var watcherName = '_ob_watch' + n;

  // The user stack lives in its own async handler (children are indented
  // by scrub_, same pattern as the microbit event stacks).
  var handlerCode = 'async def ' + handlerName + '():\n';
  var nextBlock = block.nextConnection && block.nextConnection.targetBlock();
  if (!nextBlock) {
    handlerCode += ind + 'pass\n';
  } else {
    var variablesName = [];
    for (var x in Blockly.Python.variables_) {
      variablesName.push(
        Blockly.Python.variables_[x].slice(0, Blockly.Python.variables_[x].indexOf('=') - 1));
    }
    if (variablesName.length !== 0) {
      handlerCode += ind + 'global ' + variablesName.join(', ') + '\n';
    }
    handlerCode = Blockly.Python.scrub_(block, handlerCode);
  }
  Blockly.Python.libraries_['async_handler_' + n] = handlerCode;

  // Watcher task: edge detection by 20ms polling (debounces buttons).
  // The handler is awaited inline, so one stack never runs re-entrantly.
  Blockly.Python.libraries_['async_watcher_' + n] =
    'async def ' + watcherName + '():\n' +
    ind + '_ob_last = p' + pin + '.value()\n' +
    ind + 'while True:\n' +
    ind + ind + '_ob_now = p' + pin + '.value()\n' +
    ind + ind + 'if _ob_now == ' + level + ' and _ob_last != ' + level + ':\n' +
    ind + ind + ind + 'await ' + handlerName + '()\n' +
    ind + ind + '_ob_last = _ob_now\n' +
    ind + ind + 'await asyncio.sleep_ms(20)\n';
  Blockly.Python.asyncTasks_.push(watcherName);
  return null;
};

Blockly.Python['microPython_pin_esp32SetPinMode'] = function(block) {
  Blockly.Python.imports_['machine_pin'] = 'from machine import Pin';

  var pin = block.getFieldValue('PIN') || '4';
  var mode = block.getFieldValue('MODE') || 'INPUT';

  Blockly.Python.setups_['pin_' + pin] = 'p' + pin + ' = Pin(' + pin + ')';

  var code = '';
  switch (mode) {
    case 'INPUT':
      code = 'p' + pin + '.init(Pin.IN)\n';
      break;
    case 'OUTPUT':
      code = 'p' + pin + '.init(Pin.OUT)\n';
      break;
    case 'INPUT_PULLUP':
      code = 'p' + pin + '.init(Pin.IN, Pin.PULL_UP)\n';
      break;
    case 'INPUT_PULLDOWN':
      code = 'p' + pin + '.init(Pin.IN, Pin.PULL_DOWN)\n';
      break;
  }
  return code;
};

Blockly.Python['microPython_pin_esp32SetDigitalOutput'] = function(block) {
  Blockly.Python.imports_['machine_pin'] = 'from machine import Pin';

  var pin = block.getFieldValue('PIN') || '4';
  var level = Blockly.Python.valueToCode(block, 'LEVEL', Blockly.Python.ORDER_FUNCTION_CALL) || '0';

  Blockly.Python.setups_['pin_' + pin] = 'p' + pin + ' = Pin(' + pin + ')';
  // Writing has no effect unless the pin is in output mode. An explicit
  // "set pin mode" block in the program can still override this later.
  Blockly.Python.setups_['pin_mode_' + pin] = 'p' + pin + '.init(Pin.OUT)';

  var code = 'p' + pin + '.value(' + level + ')\n';
  return code;
};

Blockly.Python['microPython_pin_menu_level'] = function(block) {
  var code = block.getFieldValue('level') || '0';
  return [code, Blockly.Python.ORDER_ATOMIC];
};

Blockly.Python['microPython_pin_esp32SetPwmOutput'] = function(block) {
  Blockly.Python.imports_['machine_pin'] = 'from machine import Pin';
  Blockly.Python.imports_['machine_pwm'] = 'from machine import PWM';

  var pin = block.getFieldValue('PIN') || '4';
  var out = Blockly.Python.valueToCode(block, 'OUT', Blockly.Python.ORDER_FUNCTION_CALL) || '0';

  Blockly.Python.setups_['pwm_' + pin] = 'pwm' + pin + ' = PWM(Pin(' + pin + '), freq=1000, duty=0)';

  var code = 'pwm' + pin + '.duty(' + out + ')\n';
  return code;
};

Blockly.Python['microPython_pin_esp32SetDACOutput'] = function(block) {
  Blockly.Python.imports_['machine_pin'] = 'from machine import Pin';
  Blockly.Python.imports_['machine_dac'] = 'from machine import DAC';

  var pin = block.getFieldValue('PIN') || '25';
  var out = Blockly.Python.valueToCode(block, 'OUT', Blockly.Python.ORDER_FUNCTION_CALL) || '0';

  Blockly.Python.setups_['dac_' + pin] = 'dac' + pin + ' = DAC(Pin(' + pin + '))';

  var code = 'dac' + pin + '.write(' + out + ')\n';
  return code;
};

Blockly.Python['microPython_pin_esp32ReadDigitalPin'] = function(block) {
  Blockly.Python.imports_['machine_pin'] = 'from machine import Pin';

  var pin = block.getFieldValue('PIN') || '4';

  Blockly.Python.setups_['pin_' + pin] = 'p' + pin + ' = Pin(' + pin + ')';
  if (!Blockly.Python.setups_['pin_mode_' + pin]) {
    Blockly.Python.setups_['pin_mode_' + pin] = 'p' + pin + '.init(Pin.IN)';
  }

  var code = 'p' + pin + '.value()';
  return [code, Blockly.Python.ORDER_ATOMIC];
};

Blockly.Python['microPython_pin_esp32ReadAnalogPin'] = function(block) {
  Blockly.Python.imports_['machine_pin'] = 'from machine import Pin';
  Blockly.Python.imports_['machine_adc'] = 'from machine import ADC';

  var pin = block.getFieldValue('PIN') || '4';

  Blockly.Python.setups_['adc_' + pin] = 'adc' + pin + ' = ADC(Pin(' + pin + '))\n' +
    'adc' + pin + '.atten(ADC.ATTN_11DB)';

  var code = 'adc' + pin + '.read()';
  return [code, Blockly.Python.ORDER_ATOMIC];
};

Blockly.Python['microPython_pin_esp32ReadTouchPin'] = function(block) {
  Blockly.Python.imports_['machine_pin'] = 'from machine import Pin';
  Blockly.Python.imports_['machine_touchpad'] = 'from machine import TouchPad';

  var pin = block.getFieldValue('PIN') || '4';

  Blockly.Python.setups_['touchpad_' + pin] = 'tp' + pin + ' = TouchPad(Pin(' + pin + '))';

  var code = 'tp' + pin + '.read()';
  return [code, Blockly.Python.ORDER_ATOMIC];
};

// Servo objects live in a dict so a released pin can be driven again later:
// _ob_servo() recreates the PWM on demand, _ob_servo_release() deinits it.
// 0 degree -> 0.5ms pulse -> duty 26, 180 degree -> 2.5ms pulse -> duty 128.
var esp32ServoHelper =
  '_ob_servos = {}\n' +
  'def _ob_servo(pin, angle):\n' +
  '    if pin not in _ob_servos:\n' +
  '        _ob_servos[pin] = PWM(Pin(pin), freq=50)\n' +
  '    angle = min(180, max(0, angle))\n' +
  '    _ob_servos[pin].duty(int(25.6 + angle * 102.4 / 180))\n' +
  'def _ob_servo_release(pin):\n' +
  '    if pin in _ob_servos:\n' +
  '        _ob_servos.pop(pin).deinit()\n';

Blockly.Python['microPython_pin_setServoOutput'] = function(block) {
  Blockly.Python.imports_['machine_pin'] = 'from machine import Pin';
  Blockly.Python.imports_['machine_pwm'] = 'from machine import PWM';

  var pin = block.getFieldValue('PIN') || '4';
  var out = Blockly.Python.valueToCode(block, 'OUT', Blockly.Python.ORDER_FUNCTION_CALL) || '0';

  Blockly.Python.customFunctions_['servo'] = esp32ServoHelper;

  var code = '_ob_servo(' + pin + ', int(' + out + '))\n';
  return code;
};

Blockly.Python['microPython_pin_servoRelease'] = function(block) {
  Blockly.Python.imports_['machine_pin'] = 'from machine import Pin';
  Blockly.Python.imports_['machine_pwm'] = 'from machine import PWM';

  var pin = block.getFieldValue('PIN') || '4';

  Blockly.Python.customFunctions_['servo'] = esp32ServoHelper;

  var code = '_ob_servo_release(' + pin + ')\n';
  return code;
};

Blockly.Python['microPython_console_consolePrint'] = function(block) {
  var text = Blockly.Python.valueToCode(block, 'TEXT', Blockly.Python.ORDER_FUNCTION_CALL) || '\'\'';
  var eol = block.getFieldValue('EOL') || 'warp';

  var code = '';
  if (eol === 'warp') {
    code = 'print(' + text + ')\n';
  } else {
    code = 'print(' + text + ', end="")\n';
  }
  return code;
};

Blockly.Python['microPython_console_consoleInput'] = function(block) {
  var text = Blockly.Python.valueToCode(block, 'TEXT', Blockly.Python.ORDER_FUNCTION_CALL) || '\'\'';

  var code = 'input(' + text + ')';
  return [code, Blockly.Python.ORDER_ATOMIC];
};

Blockly.Python['microPython_console_esp32SetBleName'] = function(block) {
  var name = Blockly.Python.valueToCode(block, 'NAME', Blockly.Python.ORDER_FUNCTION_CALL) || '\'\'';
  Blockly.Python.imports_['obble'] = 'import obble';

  var code = 'obble.set_name(' + name + ')\n';
  return code;
};

Blockly.Python['microPython_neopixel_neopixelInit'] = function(block) {
  Blockly.Python.imports_['machine_pin'] = 'from machine import Pin';
  Blockly.Python.imports_['neopixel'] = 'import neopixel';

  var pin = block.getFieldValue('PIN') || '4';
  var count = Blockly.Python.valueToCode(block, 'COUNT', Blockly.Python.ORDER_FUNCTION_CALL) || '8';

  var code = '_ob_np = neopixel.NeoPixel(Pin(' + pin + '), int(' + count + '))\n';
  return code;
};

Blockly.Python['microPython_neopixel_neopixelSetColor'] = function(block) {
  var index = Blockly.Python.valueToCode(block, 'INDEX', Blockly.Python.ORDER_FUNCTION_CALL) || '0';
  var r = Blockly.Python.valueToCode(block, 'R', Blockly.Python.ORDER_FUNCTION_CALL) || '0';
  var g = Blockly.Python.valueToCode(block, 'G', Blockly.Python.ORDER_FUNCTION_CALL) || '0';
  var b = Blockly.Python.valueToCode(block, 'B', Blockly.Python.ORDER_FUNCTION_CALL) || '0';

  Blockly.Python.setups_['neopixel_brt'] = '_ob_np_brt = 1.0';

  var code = '_ob_np[int(' + index + ')] = (int(int(' + r + ') * _ob_np_brt), ' +
    'int(int(' + g + ') * _ob_np_brt), int(int(' + b + ') * _ob_np_brt))\n';
  return code;
};

Blockly.Python['microPython_neopixel_neopixelFill'] = function(block) {
  var r = Blockly.Python.valueToCode(block, 'R', Blockly.Python.ORDER_FUNCTION_CALL) || '0';
  var g = Blockly.Python.valueToCode(block, 'G', Blockly.Python.ORDER_FUNCTION_CALL) || '0';
  var b = Blockly.Python.valueToCode(block, 'B', Blockly.Python.ORDER_FUNCTION_CALL) || '0';

  Blockly.Python.setups_['neopixel_brt'] = '_ob_np_brt = 1.0';

  var code = '_ob_np.fill((int(int(' + r + ') * _ob_np_brt), ' +
    'int(int(' + g + ') * _ob_np_brt), int(int(' + b + ') * _ob_np_brt)))\n';
  return code;
};

Blockly.Python['microPython_neopixel_neopixelSetBrightness'] = function(block) {
  var brt = Blockly.Python.valueToCode(block, 'BRT', Blockly.Python.ORDER_FUNCTION_CALL) || '100';

  Blockly.Python.setups_['neopixel_brt'] = '_ob_np_brt = 1.0';

  var code = '_ob_np_brt = min(100, max(0, int(' + brt + '))) / 100\n';
  return code;
};

Blockly.Python['microPython_neopixel_neopixelShow'] = function() {
  return '_ob_np.write()\n';
};

Blockly.Python['microPython_neopixel_neopixelClear'] = function() {
  return '_ob_np.fill((0, 0, 0))\n_ob_np.write()\n';
};

Blockly.Python['microPython_sensor_sensorDhtRead'] = function(block) {
  Blockly.Python.imports_['machine_pin'] = 'from machine import Pin';
  Blockly.Python.imports_['dht'] = 'import dht';

  var dhtType = block.getFieldValue('DHTTYPE') === 'DHT22' ? 'DHT22' : 'DHT11';
  var pin = block.getFieldValue('PIN') || '4';
  var dhtData = block.getFieldValue('DHTDATA') === 'humidity' ? 'humidity' : 'temperature';

  Blockly.Python.setups_['dht_' + pin] = '_ob_dht_' + pin + ' = dht.' + dhtType + '(Pin(' + pin + '))';
  Blockly.Python.customFunctions_['dht_read'] =
    'def _ob_dht_read(d, what):\n' +
    '    try:\n' +
    '        d.measure()\n' +
    '    except:\n' +
    '        pass\n' +
    '    return d.temperature() if what == 0 else d.humidity()\n';

  var code = '_ob_dht_read(_ob_dht_' + pin + ', ' + (dhtData === 'temperature' ? '0' : '1') + ')';
  return [code, Blockly.Python.ORDER_ATOMIC];
};

Blockly.Python['microPython_sensor_sensorUltrasonicDistance'] = function(block) {
  Blockly.Python.imports_['machine_pin'] = 'from machine import Pin';
  Blockly.Python.imports_['time'] = 'import time';
  Blockly.Python.imports_['machine'] = 'import machine';

  var trig = block.getFieldValue('TRIG') || '5';
  var echo = block.getFieldValue('ECHO') || '18';

  Blockly.Python.customFunctions_['sr04'] =
    'def _ob_sr04(trig, echo):\n' +
    '    tp = Pin(trig, Pin.OUT)\n' +
    '    ep = Pin(echo, Pin.IN)\n' +
    '    tp.value(0)\n' +
    '    time.sleep_us(2)\n' +
    '    tp.value(1)\n' +
    '    time.sleep_us(10)\n' +
    '    tp.value(0)\n' +
    '    d = machine.time_pulse_us(ep, 1, 30000)\n' +
    '    return round(d / 58.0, 1) if d > 0 else 0\n';

  var code = '_ob_sr04(' + trig + ', ' + echo + ')';
  return [code, Blockly.Python.ORDER_ATOMIC];
};

Blockly.Python['microPython_sensor_sensorInternalTemperature'] = function() {
  Blockly.Python.imports_['esp32'] = 'import esp32';

  // Newer chips (c3/s3) expose mcu_temperature() in celsius, the classic
  // esp32 only has raw_temperature() in fahrenheit.
  Blockly.Python.customFunctions_['chip_temp'] =
    'def _ob_chip_temp():\n' +
    '    if hasattr(esp32, \'mcu_temperature\'):\n' +
    '        return esp32.mcu_temperature()\n' +
    '    return round((esp32.raw_temperature() - 32) / 1.8, 1)\n';

  var code = '_ob_chip_temp()';
  return [code, Blockly.Python.ORDER_ATOMIC];
};

Blockly.Python['microPython_sensor_sensorDs18b20Read'] = function(block) {
  Blockly.Python.imports_['machine_pin'] = 'from machine import Pin';
  Blockly.Python.imports_['time'] = 'import time';
  Blockly.Python.imports_['onewire'] = 'import onewire';
  Blockly.Python.imports_['ds18x20'] = 'import ds18x20';

  var pin = block.getFieldValue('PIN') || '4';

  Blockly.Python.setups_['ds18b20_' + pin] =
    '_ob_ds_' + pin + ' = ds18x20.DS18X20(onewire.OneWire(Pin(' + pin + ')))';
  Blockly.Python.customFunctions_['ds18b20_read'] =
    'def _ob_ds18b20_read(ds):\n' +
    '    try:\n' +
    '        roms = ds.scan()\n' +
    '        if not roms:\n' +
    '            return 0\n' +
    '        ds.convert_temp()\n' +
    '        time.sleep_ms(750)\n' +
    '        return round(ds.read_temp(roms[0]), 1)\n' +
    '    except:\n' +
    '        return 0\n';

  var code = '_ob_ds18b20_read(_ob_ds_' + pin + ')';
  return [code, Blockly.Python.ORDER_ATOMIC];
};

Blockly.Python['microPython_wifi_wifiConnect'] = function(block) {
  Blockly.Python.imports_['network'] = 'import network';
  Blockly.Python.imports_['time'] = 'import time';

  var ssid = Blockly.Python.valueToCode(block, 'SSID', Blockly.Python.ORDER_FUNCTION_CALL) || '\'\'';
  var password = Blockly.Python.valueToCode(block, 'PASSWORD', Blockly.Python.ORDER_FUNCTION_CALL) || '\'\'';

  Blockly.Python.setups_['wifi_wlan'] = '_ob_wlan = network.WLAN(network.STA_IF)\n_ob_wlan.active(True)';
  Blockly.Python.customFunctions_['wifi_connect'] =
    'def _ob_wifi_connect(ssid, pwd, timeout_ms=15000):\n' +
    '    _ob_wlan.connect(ssid, pwd)\n' +
    '    t = time.ticks_ms()\n' +
    '    while not _ob_wlan.isconnected() and time.ticks_diff(time.ticks_ms(), t) < timeout_ms:\n' +
    '        time.sleep_ms(200)\n';

  var code = '_ob_wifi_connect(' + ssid + ', ' + password + ')\n';
  return code;
};

Blockly.Python['microPython_wifi_wifiIsConnected'] = function() {
  Blockly.Python.imports_['network'] = 'import network';

  Blockly.Python.setups_['wifi_wlan'] = '_ob_wlan = network.WLAN(network.STA_IF)\n_ob_wlan.active(True)';

  var code = '_ob_wlan.isconnected()';
  return [code, Blockly.Python.ORDER_ATOMIC];
};

Blockly.Python['microPython_wifi_wifiGetIp'] = function() {
  Blockly.Python.imports_['network'] = 'import network';

  Blockly.Python.setups_['wifi_wlan'] = '_ob_wlan = network.WLAN(network.STA_IF)\n_ob_wlan.active(True)';

  var code = '_ob_wlan.ifconfig()[0]';
  return [code, Blockly.Python.ORDER_ATOMIC];
};

Blockly.Python['microPython_system_systemRunningTime'] = function() {
  Blockly.Python.imports_['time'] = 'import time';

  var code = 'time.ticks_ms()';
  return [code, Blockly.Python.ORDER_ATOMIC];
};

Blockly.Python['microPython_system_systemDelayMs'] = function(block) {
  var time = Blockly.Python.valueToCode(block, 'TIME', Blockly.Python.ORDER_FUNCTION_CALL) || '0';

  // Inside an asyncio task the delay must not block the scheduler.
  if (Blockly.Python.isInAsyncTask(block)) {
    Blockly.Python.imports_['asyncio'] = 'import asyncio';
    return 'await asyncio.sleep_ms(int(' + time + '))\n';
  }

  Blockly.Python.imports_['time'] = 'import time';

  var code = 'time.sleep_ms(int(' + time + '))\n';
  return code;
};

Blockly.Python['microPython_pin_esp32PlayTone'] = function(block) {
  Blockly.Python.imports_['machine_pin'] = 'from machine import Pin';
  Blockly.Python.imports_['machine_pwm'] = 'from machine import PWM';

  var pin = block.getFieldValue('PIN') || '4';
  var freq = Blockly.Python.valueToCode(block, 'FREQ', Blockly.Python.ORDER_FUNCTION_CALL) || '440';

  Blockly.Python.setups_['buzzer_' + pin] = 'buzzer' + pin + ' = PWM(Pin(' + pin + '), freq=440, duty=0)';

  var code = 'buzzer' + pin + '.freq(max(1, int(' + freq + ')))\nbuzzer' + pin + '.duty(512)\n';
  return code;
};

Blockly.Python['microPython_pin_esp32StopTone'] = function(block) {
  Blockly.Python.imports_['machine_pin'] = 'from machine import Pin';
  Blockly.Python.imports_['machine_pwm'] = 'from machine import PWM';

  var pin = block.getFieldValue('PIN') || '4';

  Blockly.Python.setups_['buzzer_' + pin] = 'buzzer' + pin + ' = PWM(Pin(' + pin + '), freq=440, duty=0)';

  var code = 'buzzer' + pin + '.duty(0)\n';
  return code;
};

Blockly.Python['microPython_wifi_wifiDisconnect'] = function() {
  Blockly.Python.imports_['network'] = 'import network';

  Blockly.Python.setups_['wifi_wlan'] = '_ob_wlan = network.WLAN(network.STA_IF)\n_ob_wlan.active(True)';

  var code = '_ob_wlan.disconnect()\n';
  return code;
};

Blockly.Python['microPython_wifi_wifiRssi'] = function() {
  Blockly.Python.imports_['network'] = 'import network';

  Blockly.Python.setups_['wifi_wlan'] = '_ob_wlan = network.WLAN(network.STA_IF)\n_ob_wlan.active(True)';
  Blockly.Python.customFunctions_['wifi_rssi'] =
    'def _ob_wifi_rssi():\n' +
    '    try:\n' +
    '        return _ob_wlan.status(\'rssi\')\n' +
    '    except:\n' +
    '        return 0\n';

  var code = '_ob_wifi_rssi()';
  return [code, Blockly.Python.ORDER_ATOMIC];
};

Blockly.Python['microPython_system_systemRestart'] = function() {
  Blockly.Python.imports_['machine'] = 'import machine';

  var code = 'machine.reset()\n';
  return code;
};
