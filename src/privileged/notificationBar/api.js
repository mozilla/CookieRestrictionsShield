"use strict";

/* global ExtensionAPI */

ChromeUtils.import("resource://gre/modules/Console.jsm");
ChromeUtils.import("resource://gre/modules/Services.jsm");
ChromeUtils.import("resource://gre/modules/XPCOMUtils.jsm");
ChromeUtils.import("resource://gre/modules/ExtensionCommon.jsm");
ChromeUtils.import("resource://gre/modules/ExtensionUtils.jsm");

/* eslint-disable-next-line */
var {EventManager, EventEmitter} = ExtensionCommon;
/* eslint-disable-next-line no-var */
var {Management: {global: {tabTracker}}} = ChromeUtils.import("resource://gre/modules/Extension.jsm", {});

// eslint-disable-next-line no-undef
XPCOMUtils.defineLazyModuleGetter(
  this,
  "BrowserWindowTracker",
  "resource:///modules/BrowserWindowTracker.jsm",
);

/** Return most recent NON-PRIVATE browser window, so that we can
 * manipulate chrome elements on it.
 */
function getMostRecentBrowserWindow() {
  return BrowserWindowTracker.getTopWindow({
    private: false,
    allowPopups: false,
  });
}

/** Display instrumented 'notification bar' explaining the feature to the user
 *
 *   Telemetry Probes:
 *
 *   - {event: survey-shown}
 *
 *   - {event: page-broken}
 *
 *   - {event: page-not-broken}
 *
 *    Note:  Bar WILL NOT SHOW if the only window open is a private window.
 *
 *    Note:  Handling of 'x' is not implemented.  For more complete implementation:
 *
 *      https://github.com/gregglind/57-perception-shield-study/blob/680124a/addon/lib/Feature.jsm#L148-L152
 *
 */
class NotificationBarEventEmitter extends EventEmitter {
  emitShow(variationName) {
    const self = this;
    const recentWindow = getMostRecentBrowserWindow();
    const browser = recentWindow.gBrowser.selectedBrowser;
    const tabId = tabTracker.getBrowserTabId(browser);

    const primaryAction =  {
      disableHighlight: true,
      label: "Yes (broken)",
      accessKey: "f",
      callback: (data) => {
        const addExceptionButton = recentWindow.document.getElementById("tracking-action-unblock");
        addExceptionButton.doCommand();
        self.emit("page-broken", tabId, data.checkboxChecked);
      },
    };

    const secondaryActions =  [
      {
        label: "No (works)",
        accessKey: "d",
        callback: ({checkboxChecked}) => {
          self.emit("page-not-broken", tabId, checkboxChecked);
        },
      },
    ];

    // option name is described as: "An optional string formatted to look bold and used in the
    //                    notification description header text. Usually a host name or
    //                    addon name."
    // It is bold, but not used in a header, we're working with it anyway.
    const options = {
      hideClose: true,
      persistent: true,
      autofocus: true,
      name: "Firefox Survey: ",
      popupIconURL: "chrome://branding/content/icon64.png",
      checkbox: {
        label: "Disable Privacy Study",
      },
    };
    recentWindow.PopupNotifications.show(browser, "cookie-restriction-notification", "<> Did you reload this page because it wasn't working correctly?", null, primaryAction, secondaryActions, options);
  }
}

this.notificationBar = class extends ExtensionAPI {
  /**
   * Extension Shutdown
   * Goes through each tab for each window and removes the notification, if it exists.
   */
  onShutdown(shutdownReason) {
    for (const win of BrowserWindowTracker.orderedWindows) {
      for (const browser of win.gBrowser.browsers) {
        const notification = win.PopupNotifications.getNotification("cookie-restriction-notification", browser);
        if (notification) {
          win.PopupNotifications.remove(notification);
        }
      }
    }
  }

  getAPI(context) {
    const notificationBarEventEmitter = new NotificationBarEventEmitter();
    return {
      notificationBar: {
        show() {
          notificationBarEventEmitter.emitShow();
        },
        onReportPageBroken: new EventManager(
          context,
          "notificationBar.onReportPageBroken",
          fire => {
            const listener = (value, tabId, checkboxChecked) => {
              fire.async(tabId, checkboxChecked);
            };
            notificationBarEventEmitter.on(
              "page-broken",
              listener,
            );
            return () => {
              notificationBarEventEmitter.off(
                "page-broken",
                listener,
              );
            };
          },
        ).api(),
        onReportPageNotBroken: new EventManager(
          context,
          "notificationBar.onReportPageNotBroken",
          fire => {
            const listener = (value, tabId, checkboxChecked) => {
              fire.async(tabId, checkboxChecked);
            };
            notificationBarEventEmitter.on(
              "page-not-broken",
              listener,
            );
            return () => {
              notificationBarEventEmitter.off(
                "page-not-broken",
                listener,
              );
            };
          },
        ).api(),
      },
    };
  }
};
