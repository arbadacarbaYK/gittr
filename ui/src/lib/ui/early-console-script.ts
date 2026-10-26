/**
 * Runs from its own head script, after the theme boot script.
 * Must stay valid JavaScript on its own: a syntax error here used to sit in
 * the same tag as the theme boot and stop both from running
 * (`Missing catch or finally after try` on every page).
 */
export function gittrConsoleBootScript(): string {
  return `(function() {
    if (typeof console === 'undefined') return;
    var buildFullMessage = function(args) {
      var allMessages = args.map(function(arg) {
        if (typeof arg === 'string') return arg;
        if (arg && typeof arg === 'object') {
          if (arg.message) return arg.message.toString();
          if (arg.toString) return arg.toString();
          if (arg.name && arg.stack) return arg.name + ' ' + arg.stack;
        }
        return '';
      }).join(' ');
      var stacked = args.find(function(arg) { return arg && arg.stack; });
      var stackTrace = stacked && stacked.stack ? stacked.stack.toString() : '';
      return (allMessages + ' ' + stackTrace).toLowerCase();
    };
    var shouldSuppress = function(fullMessage) {
      if (fullMessage.indexOf('[remotesigner]') !== -1) return false;
      return fullMessage.indexOf('error connecting relay') !== -1 ||
        fullMessage.indexOf('websocket connection to') !== -1 ||
        fullMessage.indexOf('websocket') !== -1 ||
        fullMessage.indexOf('reconnecting after') !== -1 ||
        (fullMessage.indexOf('wss://') !== -1 &&
          (fullMessage.indexOf('failed') !== -1 ||
            fullMessage.indexOf('error') !== -1 ||
            fullMessage.indexOf('502') !== -1 ||
            fullMessage.indexOf('reconnect') !== -1)) ||
        fullMessage.indexOf('accessing element.ref was removed in react 19') !== -1 ||
        fullMessage.indexOf('ref is now a regular prop') !== -1 ||
        fullMessage.indexOf('element.ref was removed') !== -1 ||
        fullMessage.indexOf('will be removed from the jsx element type') !== -1 ||
        fullMessage.indexOf('[file fetch] api error: 404') !== -1 ||
        (fullMessage.indexOf('api error') !== -1 && fullMessage.indexOf('404') !== -1) ||
        (fullMessage.indexOf('element.ref') !== -1 && fullMessage.indexOf('react 19') !== -1);
    };
    if (console.error) {
      var originalError = console.error;
      console.error = function() {
        var args = Array.prototype.slice.call(arguments);
        if (shouldSuppress(buildFullMessage(args))) return;
        originalError.apply(console, args);
      };
    }
    if (console.warn) {
      var originalWarn = console.warn;
      console.warn = function() {
        var args = Array.prototype.slice.call(arguments);
        if (shouldSuppress(buildFullMessage(args))) return;
        originalWarn.apply(console, args);
      };
    }
    if (console.log) {
      var originalLog = console.log;
      console.log = function() {
        var args = Array.prototype.slice.call(arguments);
        if (buildFullMessage(args).indexOf('reconnecting after') !== -1) return;
        originalLog.apply(console, args);
      };
    }
  })();`;
}
