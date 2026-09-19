"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.defaults = exports.ConnectionError = exports.AttemptError = exports.systemResolver = exports.createSystemResolver = exports.connectTls = exports.connectTcp = void 0;
var connect_js_1 = require("./connect.js");
Object.defineProperty(exports, "connectTcp", { enumerable: true, get: function () { return connect_js_1.connectTcp; } });
Object.defineProperty(exports, "connectTls", { enumerable: true, get: function () { return connect_js_1.connectTls; } });
var resolver_js_1 = require("./resolver.js");
Object.defineProperty(exports, "createSystemResolver", { enumerable: true, get: function () { return resolver_js_1.createSystemResolver; } });
Object.defineProperty(exports, "systemResolver", { enumerable: true, get: function () { return resolver_js_1.systemResolver; } });
var errors_js_1 = require("./errors.js");
Object.defineProperty(exports, "AttemptError", { enumerable: true, get: function () { return errors_js_1.AttemptError; } });
Object.defineProperty(exports, "ConnectionError", { enumerable: true, get: function () { return errors_js_1.ConnectionError; } });
var config_js_1 = require("./config.js");
Object.defineProperty(exports, "defaults", { enumerable: true, get: function () { return config_js_1.defaults; } });
//# sourceMappingURL=index.js.map