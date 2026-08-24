require('chromedriver');
var webdriver = require('selenium-webdriver');
var chrome = require('selenium-webdriver/chrome');
var logging = require('selenium-webdriver/lib/logging');
var builder = new webdriver.Builder().forBrowser('chrome');

var loggingPrefs = new logging.Preferences();
loggingPrefs.setLevel(logging.Type.BROWSER, logging.Level.ALL);

if (process.env.CI) {
  // selenium-webdriver >= 4.17 removed Options.headless().
  // --disable-dev-shm-usage: CI runners mount a tiny /dev/shm which can
  // crash the renderer on large pages like the jsunit suites.
  const options = new chrome.Options().addArguments('--headless=new', '--disable-dev-shm-usage');
  options.setLoggingPrefs(loggingPrefs);
  if (process.platform === 'linux') {
    options.addArguments('no-sandbox');
  }
  builder.setChromeOptions(options);
}

var browser = builder.build();

// Parse jsunit html report, exit(1) if there are any failures.
var testHtml = function (htmlString) {
  var regex = /[\d]+\spassed,\s([\d]+)\sfailed./i;
  var numOfFailure = regex.exec(htmlString)[1];
  var regex2 = /Unit Tests for .*]/;
  var testStatus = regex2.exec(htmlString)[0];
  console.log("============Unit Test Summary=================");
  console.log(testStatus);
  var regex3 = /\d+ passed,\s\d+ failed/;
  var detail = regex3.exec(htmlString)[0];
  console.log(detail);
  console.log("============Unit Test Summary=================");
  if (parseInt(numOfFailure) !== 0) {
    console.log(htmlString);
    process.exit(1);
  }
};

var path = process.cwd();

// The closure TestRunner renders #closureTestRunnerLog only after the whole
// suite has finished, so wait for it instead of a fixed sleep (slow CI
// runners need well over 5 seconds).
var LOG_TIMEOUT_MS = 120000;

// On failure, dump page state and browser console to stderr for CI logs.
var dumpDiagnostics = async function () {
  try {
    var state = await browser.executeScript(
      'return document.readyState + " | title: " + document.title + " | body: " + ' +
      '(document.body ? document.body.innerText.slice(0, 600) : "(no body)")');
    console.error('PAGE STATE:', state);
    var entries = await browser.manage().logs().get('browser');
    entries.slice(-15).forEach(function (entry) {
      console.error('CONSOLE [' + entry.level.name + ']', entry.message.slice(0, 300));
    });
  } catch (diagErr) {
    console.error('diagnostics failed:', diagErr.message);
  }
};

var runTests = async function () {
  try {
    var element, text;

    await browser.get("file://" + path + "/tests/jsunit/vertical_tests.html");
    element = await browser.wait(
      webdriver.until.elementLocated({id: "closureTestRunnerLog"}), LOG_TIMEOUT_MS);
    text = await element.getText();
    testHtml(text);

    await browser.get("file://" + path + "/tests/jsunit/horizontal_tests.html");
    element = await browser.wait(
      webdriver.until.elementLocated({id: "closureTestRunnerLog"}), LOG_TIMEOUT_MS);
    text = await element.getText();
    testHtml(text);
  }
  catch (e) {
    await dumpDiagnostics();
    throw e;
  }
  finally {
    await browser.quit();
  }
};

runTests().catch(e => {
  console.error(e);
  process.exit(1);
});
