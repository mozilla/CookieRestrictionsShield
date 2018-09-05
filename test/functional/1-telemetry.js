/* eslint-env node, mocha */

// for unhandled promise rejection debugging
process.on("unhandledRejection", r => console.error(r)); // eslint-disable-line no-console

const {assert} = require("chai");
const utils = require("./utils");
const firefox = require("selenium-webdriver/firefox");
const Context = firefox.Context;

describe("telemetry", function() {
  // This gives Firefox time to start, and us a bit longer during some of the tests.
  this.timeout(15000);

  let driver;
  let studyPings;

  // runs ONCE
  before(async () => {
    driver = await utils.setupWebdriver.promiseSetupDriver(
      utils.FIREFOX_PREFERENCES,
    );
    await utils.setPreference(driver, "extensions.cookie-restrictions-shield_mozilla_org.test.variationName", "CookiesBlocked");
    await utils.setupWebdriver.installAddon(driver);
  });

  after(() => {
    driver.quit();
  });

  function checkTelemetryPayload(nonTracking=false) {
    it("has recorded pings", async () => {
      assert(studyPings.length, "at least one shield telemetry ping");
    });

    it("correctly records etld as a hash", async () => {
      const ping = studyPings[0];
      const attributes = ping.payload.data.attributes;
      assert.exists(attributes.etld, "etld exists");
      assert.notInclude(attributes.etld, "itisatrap", "etld does not contain the domain");
      assert.equal(attributes.etld.length * 4, 256, "etld is a 256 bit hex string");
    });

    it("correctly records whether the page was reloaded", async () => {
      const ping = studyPings[0];
      const attributes = ping.payload.data.attributes;
      assert.equal(attributes.page_reloaded, "false", "page reloaded is false");
      assert.equal(parseInt(attributes.page_reloaded_survey), 0, "page reloaded survey not shown");
    });

    it("correctly records the amount of trackers on the page", async function() {
      if (nonTracking) {
        this.skip();
      }
      let ping = studyPings[0];
      let attributes = ping.payload.data.attributes;
      assert.equal(attributes.num_blockable_trackers, "1", "found a blockable tracker");
      assert.equal(attributes.num_trackers_blocked, "1", "found blocked trackers");
    });

    it("correctly records no info on control center interaction", async () => {
      let ping = studyPings[0];
      let attributes = ping.payload.data.attributes;
      assert.equal(attributes.user_opened_control_center, "false", "user opened the control center is not included in the ping");
      assert.equal(attributes.user_toggled_exception, "0", "user toggled exception is not included in the ping");
      assert.equal(attributes.user_reported_page_breakage, "false", "user reported page breakage exception is not included in the ping");
    });

    it("correctly records performance metrics", async () => {
      const ping = studyPings[0];
      const attributes = ping.payload.data.attributes;
      assert.isAtLeast(parseInt(attributes.TIME_TO_DOM_COMPLETE_MS), 0, "has TIME_TO_DOM_COMPLETE_MS data");
      assert.isAtLeast(parseInt(attributes.TIME_TO_DOM_CONTENT_LOADED_START_MS), 0, "has TIME_TO_DOM_CONTENT_LOADED_START_MS data");
      assert.isAtLeast(parseInt(attributes.TIME_TO_DOM_INTERACTIVE_MS), 0, "has TIME_TO_DOM_INTERACTIVE_MS data");
      assert.isAtLeast(parseInt(attributes.TIME_TO_LOAD_EVENT_START_MS), 0, "has TIME_TO_LOAD_EVENT_START_MS data");
      assert.isAtLeast(parseInt(attributes.TIME_TO_LOAD_EVENT_END_MS), 0, "has TIME_TO_LOAD_EVENT_END_MS data");
      assert.isAtLeast(parseInt(attributes.TIME_TO_RESPONSE_START_MS), 0, "has TIME_TO_RESPONSE_START_MS data");
    });

    it("correctly records JS errors", async () => {
      const ping = studyPings[0];
      const attributes = ping.payload.data.attributes;
      assert.equal(parseInt(attributes.num_EvalError), 2, "has EvalError");
      assert.equal(parseInt(attributes.num_InternalError), 1, "has InternalError");
      assert.equal(parseInt(attributes.num_RangeError), 1, "has RangeError");
      assert.equal(parseInt(attributes.num_ReferenceError), 4, "has ReferenceError");
      assert.equal(parseInt(attributes.num_SyntaxError), 2, "has SyntaxError");
      assert.equal(parseInt(attributes.num_TypeError), 1, "has TypeError");
      assert.equal(parseInt(attributes.num_URIError), 1, "has URIError");
      assert.equal(parseInt(attributes.num_SecurityError), 1, "has SecurityError");
    });

    it("correctly records the set preferences in the payload", async () => {
      const ping = studyPings[0];
      const attributes = ping.payload.data.attributes;
      const browser_contentblocking_enabled = await utils.getPreference(driver, "browser.contentblocking.enabled");
      const privacy_trackingprotection_enabled = await utils.getPreference(driver, "privacy.trackingprotection.enabled");
      assert.equal(attributes.browser_contentblocking_enabled, browser_contentblocking_enabled.toString(), "browser_contentblocking_enabled is set, and equals the pref");
      assert.equal(attributes.privacy_trackingprotection_enabled, privacy_trackingprotection_enabled.toString(), "privacy_trackingprotection_enabled is set, and equals the pref");
    });
  }

  async function throwErrors() {
    function throwErrorOnPage(type) {
      return driver.executeScript(`
        let script = document.createElement("script");
        script.innerHTML = 'throw ${type}("custom ${type}");';
        document.body.appendChild(script);
      `);
    }

    // Throw a bunch of errors to test.
    await throwErrorOnPage("EvalError");
    await throwErrorOnPage("EvalError");

    await throwErrorOnPage("InternalError");

    await throwErrorOnPage("RangeError");

    await throwErrorOnPage("ReferenceError");
    await throwErrorOnPage("ReferenceError");
    await throwErrorOnPage("ReferenceError");
    await throwErrorOnPage("ReferenceError");

    await throwErrorOnPage("SyntaxError");
    await throwErrorOnPage("SyntaxError");

    await throwErrorOnPage("TypeError");

    await throwErrorOnPage("URIError");

    await driver.executeScript(`
      let script = document.createElement("script");
      script.innerHTML = 'throw new DOMException("custom security issues", "SecurityError");';
      document.body.appendChild(script);
    `);
  }

  describe("records shield telemetry on tracking pages after reload", function() {
    before(async () => {
      const time = Date.now();
      driver.setContext(Context.CONTENT);
      await driver.get("https://itisatrap.org/firefox/its-a-tracker.html");
      await driver.sleep(500);
      await throwErrors();
      await driver.navigate().refresh();
      await driver.sleep(500);
      studyPings = await utils.telemetry.getShieldPingsAfterTimestamp(
        driver,
        time,
      );
      studyPings = studyPings.filter(ping => ping.type === "shield-study-addon");
    });

    after(async () => {
      driver.setContext(Context.CONTENT);
      // Navigate to a benign site to avoid sending telemetry in the next test.
      await driver.get("https://example.org");
      await driver.sleep(500);
    });

    checkTelemetryPayload();
  });

  describe("records shield telemetry on tracking pages after navigation", function() {
    before(async () => {
      const time = Date.now();
      driver.setContext(Context.CONTENT);
      await driver.get("https://itisatrap.org/firefox/its-a-tracker.html");
      await driver.sleep(500);
      await throwErrors();
      await driver.get("https://example.com");
      await driver.sleep(500);
      studyPings = await utils.telemetry.getShieldPingsAfterTimestamp(
        driver,
        time,
      );
      studyPings = studyPings.filter(ping => ping.type === "shield-study-addon");
    });

    checkTelemetryPayload();
  });

  describe("records shield telemetry on tracking pages after the tab closes", function() {
    before(async () => {
      const time = Date.now();
      utils.openNewTab(driver);
      await driver.sleep(500);
      const tabs = await driver.getAllWindowHandles();
      await driver.switchTo().window(tabs[1]);
      driver.setContext(Context.CONTENT);
      await driver.get("https://itisatrap.org/firefox/its-a-tracker.html");
      await driver.sleep(500);
      await throwErrors();
      await utils.removeCurrentTab(driver);
      await driver.switchTo().window(tabs[0]);
      await driver.sleep(500);
      studyPings = await utils.telemetry.getShieldPingsAfterTimestamp(
        driver,
        time,
      );
      studyPings = studyPings.filter(ping => ping.type === "shield-study-addon");
    });

    checkTelemetryPayload();
  });

  describe("records shield telemetry on non-tracking pages", function() {
    before(async () => {
      const time = Date.now();
      driver.setContext(Context.CONTENT);
      await driver.get("https://example.org");
      await driver.sleep(500);
      await throwErrors();
      await driver.get("https://example.com");
      await driver.sleep(500);
      studyPings = await utils.telemetry.getShieldPingsAfterTimestamp(
        driver,
        time,
      );
      studyPings = studyPings.filter(ping => ping.type === "shield-study-addon");
    });

    checkTelemetryPayload(true);
  });
});
